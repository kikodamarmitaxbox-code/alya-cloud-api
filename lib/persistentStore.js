const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const cache = new Map();
let pool = null;
let ready = false;
let durable = false;
let lastError = '';
let pendingWrites = 0;

function safeKey(value) {
  return String(value || '').replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 220);
}

function get(key, fallback = null) {
  const normalized = safeKey(key);
  return cache.has(normalized) ? cache.get(normalized) : fallback;
}

async function writeRemote(key, value) {
  if (!pool) return;
  pendingWrites += 1;
  try {
    await pool.query(
      `INSERT INTO alya_store (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
    lastError = '';
  } catch (error) {
    lastError = error.message;
    logger.error('Persistent store write failed:', error);
  } finally {
    pendingWrites -= 1;
  }
}

function set(key, value) {
  const normalized = safeKey(key);
  cache.set(normalized, value);
  if (pool) void writeRemote(normalized, value);
  return true;
}

function remove(key) {
  const normalized = safeKey(key);
  cache.delete(normalized);
  if (pool) {
    void pool.query('DELETE FROM alya_store WHERE key = $1', [normalized]).catch((error) => {
      lastError = error.message;
      logger.error('Persistent store delete failed:', error);
    });
  }
  return true;
}

function keys(prefix = '') {
  return [...cache.keys()].filter((key) => key.startsWith(prefix));
}

async function migrateLocalData() {
  const dataDir = path.join(__dirname, '..', 'nova-data');
  const migrations = [];

  const usersFile = path.join(dataDir, 'users.json');
  if (!cache.has('users') && fs.existsSync(usersFile)) {
    try {
      migrations.push(['users', JSON.parse(fs.readFileSync(usersFile, 'utf8'))]);
    } catch {}
  }

  for (const [folder, prefix] of [['memory', 'memory:'], ['history', 'history:']]) {
    const directory = path.join(dataDir, folder);
    if (!fs.existsSync(directory)) continue;
    for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.json'))) {
      const id = path.basename(file, '.json');
      const key = `${prefix}${safeKey(id)}`;
      if (cache.has(key)) continue;
      try {
        migrations.push([key, JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))]);
      } catch {}
    }
  }

  for (const [key, value] of migrations) {
    cache.set(key, value);
    await writeRemote(key, value);
  }
  if (migrations.length) logger.info(`Persistent store migrated ${migrations.length} local records.`);
}

async function init() {
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  if (!connectionString) {
    ready = true;
    durable = false;
    logger.warn('DATABASE_URL not configured; Alya is using temporary local storage.');
    return getStatus();
  }

  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS alya_store (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const result = await pool.query('SELECT key, value FROM alya_store');
    for (const row of result.rows) cache.set(row.key, row.value);
    durable = true;
    ready = true;
    lastError = '';
    await migrateLocalData();
    logger.info(`Persistent store ready with ${cache.size} records.`);
  } catch (error) {
    pool = null;
    durable = false;
    ready = true;
    lastError = error.message;
    logger.error('Persistent store initialization failed:', error);
  }
  return getStatus();
}

function getStatus() {
  return {
    ready,
    durable,
    mode: durable ? 'postgres' : 'temporary',
    records: cache.size,
    pendingWrites,
    healthy: ready && (!process.env.DATABASE_URL || durable),
    error: lastError ? 'Falha ao conectar ao banco permanente.' : ''
  };
}

module.exports = { init, get, set, remove, keys, getStatus };
