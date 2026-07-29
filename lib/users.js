const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const logger = require('./logger');
const store = require('./persistentStore');

const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 5;
const VALID_ROLES = new Set(['admin', 'user']);
const usersFile = path.join(__dirname, '..', 'nova-data', 'users.json');

function normalizeUsername(username) {
  return String(username || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32);
}

function normalizeRole(role) {
  return VALID_ROLES.has(role) ? role : 'user';
}

function normalizeStoredUser(user) {
  if (!user || typeof user !== 'object') return null;
  const username = normalizeUsername(user.username);
  if (!username || !String(user.password || '').startsWith('$2')) return null;
  return {
    username,
    password: String(user.password),
    role: normalizeRole(user.role),
    blocked: user.blocked === true,
    sessionVersion: Math.max(1, Number(user.sessionVersion) || 1),
    createdAt: user.createdAt || new Date().toISOString()
  };
}

function loadUsers() {
  try {
    const persisted = store.get('users');
    const source = Array.isArray(persisted)
      ? persisted
      : fs.existsSync(usersFile)
        ? JSON.parse(fs.readFileSync(usersFile, 'utf8'))
        : [];
    return Array.isArray(source) ? source.map(normalizeStoredUser).filter(Boolean) : [];
  } catch (error) {
    logger.error('Não foi possível carregar as contas.');
    return [];
  }
}

function saveUsers(users) {
  try {
    const safeUsers = users.map(normalizeStoredUser).filter(Boolean);
    store.set('users', safeUsers);
    const dataDir = path.dirname(usersFile);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(usersFile, JSON.stringify(safeUsers, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    return true;
  } catch (error) {
    logger.error('Não foi possível salvar as contas.');
    return false;
  }
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (value.length > 200) return 'A senha é muito longa.';
  return '';
}

async function createUser(username, password, options = {}) {
  const normalizedUsername = normalizeUsername(username);
  const role = normalizeRole(options.role);

  if (normalizedUsername.length < 3) {
    return { ok: false, error: 'O usuário deve ter pelo menos 3 caracteres.' };
  }
  const passwordError = validatePassword(password);
  if (passwordError) return { ok: false, error: passwordError };

  const users = loadUsers();
  if (users.some((user) => user.username === normalizedUsername)) {
    return { ok: false, error: 'Usuário já existe.' };
  }

  const newUser = {
    username: normalizedUsername,
    password: await bcrypt.hash(String(password), SALT_ROUNDS),
    role,
    blocked: false,
    sessionVersion: 1,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);

  if (!saveUsers(users)) return { ok: false, error: 'Erro ao salvar usuário.' };
  logger.info('Conta criada com segurança.');
  return { ok: true, user: sanitizeUser(newUser) };
}

async function createUserFromHash(username, passwordHash, options = {}) {
  const normalizedUsername = normalizeUsername(username);
  const hash = String(passwordHash || '').trim();
  if (normalizedUsername.length < 3 || !hash.startsWith('$2')) {
    return { ok: false, error: 'Conta administrativa não configurada.' };
  }
  const users = loadUsers();
  const existing = users.find((user) => user.username === normalizedUsername);
  if (existing) {
    if (existing.role !== 'admin' && options.role === 'admin') {
      existing.role = 'admin';
      saveUsers(users);
    }
    return { ok: true, user: sanitizeUser(existing), existing: true };
  }
  const newUser = {
    username: normalizedUsername,
    password: hash,
    role: normalizeRole(options.role),
    blocked: false,
    sessionVersion: 1,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  if (!saveUsers(users)) return { ok: false, error: 'Erro ao salvar usuário.' };
  logger.info('Conta administrativa inicial configurada.');
  return { ok: true, user: sanitizeUser(newUser) };
}

async function ensureBootstrapAdmin() {
  const username = normalizeUsername(process.env.ADMIN_USERNAME);
  const passwordHash = String(process.env.ADMIN_PASSWORD_HASH || '').trim();
  if (!username || !passwordHash) return { ok: false, skipped: true };
  return createUserFromHash(username, passwordHash, { role: 'admin' });
}

async function createOrUpdateAdmin(username, password) {
  const normalizedUsername = normalizeUsername(username);
  const passwordError = validatePassword(password);
  if (normalizedUsername.length < 3) {
    return { ok: false, error: 'O usuário deve ter pelo menos 3 caracteres.' };
  }
  if (passwordError) return { ok: false, error: passwordError };
  const users = loadUsers();
  const existing = users.find((user) => user.username === normalizedUsername);
  if (!existing) return createUser(normalizedUsername, password, { role: 'admin' });
  existing.password = await bcrypt.hash(String(password), SALT_ROUNDS);
  existing.role = 'admin';
  existing.blocked = false;
  existing.sessionVersion = Math.max(1, Number(existing.sessionVersion) || 1) + 1;
  if (!saveUsers(users)) return { ok: false, error: 'Erro ao salvar administrador.' };
  logger.info('Conta administrativa atualizada com segurança.');
  return { ok: true, user: sanitizeUser(existing), updated: true };
}

function deleteUser(username, options = {}) {
  const normalizedUsername = normalizeUsername(username);
  const users = loadUsers();
  const index = users.findIndex((user) => user.username === normalizedUsername);
  if (index === -1) return { ok: false, error: 'Usuário não encontrado.' };
  if (options.actorUsername === normalizedUsername) {
    return { ok: false, error: 'Você não pode apagar a própria conta.' };
  }
  if (!options.force && users[index].role === 'admin' &&
      users.filter((user) => user.role === 'admin').length <= 1) {
    return { ok: false, error: 'Não é possível remover o último administrador.' };
  }
  users.splice(index, 1);
  if (!saveUsers(users)) return { ok: false, error: 'Erro ao remover usuário.' };
  logger.info('Conta removida.');
  return { ok: true, username: normalizedUsername };
}

async function changePassword(username, newPassword) {
  const normalizedUsername = normalizeUsername(username);
  const passwordError = validatePassword(newPassword);
  if (passwordError) return { ok: false, error: passwordError };
  const users = loadUsers();
  const user = users.find((item) => item.username === normalizedUsername);
  if (!user) return { ok: false, error: 'Usuário não encontrado.' };
  user.password = await bcrypt.hash(String(newPassword), SALT_ROUNDS);
  user.sessionVersion = Math.max(1, Number(user.sessionVersion) || 1) + 1;
  if (!saveUsers(users)) return { ok: false, error: 'Erro ao salvar a nova senha.' };
  logger.info('Senha de conta alterada com segurança.');
  return { ok: true, user: sanitizeUser(user) };
}

function setUserBlocked(username, blocked, options = {}) {
  const normalizedUsername = normalizeUsername(username);
  const users = loadUsers();
  const user = users.find((item) => item.username === normalizedUsername);
  if (!user) return { ok: false, error: 'Usuário não encontrado.' };
  if (options.actorUsername === normalizedUsername) {
    return { ok: false, error: 'Você não pode bloquear a própria conta.' };
  }
  if (blocked && user.role === 'admin' &&
      users.filter((item) => item.role === 'admin' && !item.blocked).length <= 1) {
    return { ok: false, error: 'Não é possível bloquear o último administrador.' };
  }
  user.blocked = Boolean(blocked);
  user.sessionVersion = Math.max(1, Number(user.sessionVersion) || 1) + 1;
  if (!saveUsers(users)) return { ok: false, error: 'Erro ao atualizar a conta.' };
  logger.info(user.blocked ? 'Conta bloqueada.' : 'Conta desbloqueada.');
  return { ok: true, user: sanitizeUser(user) };
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    username: user.username,
    role: normalizeRole(user.role),
    blocked: user.blocked === true,
    createdAt: user.createdAt
  };
}

function listUsers() {
  return loadUsers().map(sanitizeUser);
}

function getUser(username) {
  const normalizedUsername = normalizeUsername(username);
  return loadUsers().find((user) => user.username === normalizedUsername) || null;
}

module.exports = {
  SALT_ROUNDS,
  MIN_PASSWORD_LENGTH,
  createUser,
  createUserFromHash,
  ensureBootstrapAdmin,
  createOrUpdateAdmin,
  deleteUser,
  changePassword,
  setUserBlocked,
  listUsers,
  getUser,
  loadUsers,
  normalizeUsername,
  sanitizeUser,
  validatePassword
};
