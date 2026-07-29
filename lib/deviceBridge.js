'use strict';

const crypto = require('crypto');
const store = require('./persistentStore');

const TASK_PREFIX = 'device-task:';
const TASK_TTL_MS = 5 * 60 * 1000;
const CLAIM_TTL_MS = 45 * 1000;

function getDeviceSecret() {
  const value = String(process.env.ALYA_DEVICE_SECRET || '');
  return value.length >= 32 ? value : '';
}

function safeEqual(first, second) {
  const a = Buffer.from(String(first || ''));
  const b = Buffer.from(String(second || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function authenticateDevice(req) {
  const configured = getDeviceSecret();
  const provided = String(req?.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  return Boolean(configured && safeEqual(configured, provided));
}

function sanitizeDestination(value) {
  return String(value || 'global')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32) || 'global';
}

function createScreenshotTask(destination, requestedBy) {
  if (!getDeviceSecret()) {
    return {
      ok: false,
      message: 'A ponte com o computador ainda não está configurada.'
    };
  }
  const task = {
    id: crypto.randomUUID(),
    type: 'screenshot',
    destination: sanitizeDestination(destination),
    requestedBy: String(requestedBy || 'admin').slice(0, 64),
    status: 'queued',
    createdAt: Date.now(),
    expiresAt: Date.now() + TASK_TTL_MS,
    claimedAt: 0,
    deviceId: ''
  };
  store.set(`${TASK_PREFIX}${task.id}`, task);
  return {
    ok: true,
    taskId: task.id,
    message: `Pedido enviado ao seu computador. A imagem será mandada ao Discord “${task.destination}”.`
  };
}

function claimNextTask(deviceId = 'windows-pc') {
  const now = Date.now();
  const safeDeviceId = String(deviceId || 'windows-pc').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const tasks = store.keys(TASK_PREFIX)
    .map((key) => store.get(key))
    .filter(Boolean)
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

  for (const task of tasks) {
    if (Number(task.expiresAt || 0) <= now || ['done', 'failed'].includes(task.status)) {
      store.remove(`${TASK_PREFIX}${task.id}`);
      continue;
    }
    const claimExpired = task.status === 'claimed' && now - Number(task.claimedAt || 0) > CLAIM_TTL_MS;
    if (task.status !== 'queued' && !claimExpired) continue;
    task.status = 'claimed';
    task.claimedAt = now;
    task.deviceId = safeDeviceId;
    store.set(`${TASK_PREFIX}${task.id}`, task);
    return {
      id: task.id,
      type: task.type,
      destination: task.destination,
      expiresAt: task.expiresAt
    };
  }
  return null;
}

function getClaimedTask(taskId, deviceId) {
  const task = store.get(`${TASK_PREFIX}${String(taskId || '')}`);
  if (!task || task.status !== 'claimed' || Number(task.expiresAt || 0) <= Date.now()) return null;
  const safeDeviceId = String(deviceId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (!safeDeviceId || task.deviceId !== safeDeviceId) return null;
  return task;
}

function completeTask(taskId, deviceId, ok, error = '') {
  const task = getClaimedTask(taskId, deviceId);
  if (!task) return false;
  task.status = ok ? 'done' : 'failed';
  task.completedAt = Date.now();
  task.error = ok ? '' : String(error || 'Falha no computador').slice(0, 200);
  store.set(`${TASK_PREFIX}${task.id}`, task);
  setTimeout(() => store.remove(`${TASK_PREFIX}${task.id}`), 60_000).unref?.();
  return true;
}

module.exports = {
  getDeviceSecret,
  authenticateDevice,
  sanitizeDestination,
  createScreenshotTask,
  claimNextTask,
  getClaimedTask,
  completeTask
};
