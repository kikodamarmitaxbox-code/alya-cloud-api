const crypto = require('crypto');
const store = require('./persistentStore');

function safeUserId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

function safeFileId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function storageKey(userId, fileId) {
  return `userfile:${safeUserId(userId)}:${safeFileId(fileId)}`;
}

function sanitizeFile(record) {
  if (!record) return null;
  return {
    id: record.id,
    name: record.name,
    mime: record.mime,
    size: record.size,
    createdAt: record.createdAt
  };
}

function saveUserFile(userId, name, mime, buffer) {
  const ownerId = safeUserId(userId);
  if (!ownerId || !Buffer.isBuffer(buffer) || !buffer.length) {
    return { ok: false, error: 'Arquivo inválido.' };
  }
  const id = `${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`;
  const record = {
    id,
    ownerId,
    name: String(name || 'arquivo').slice(0, 120),
    mime: String(mime || 'application/octet-stream').slice(0, 120),
    size: buffer.length,
    data: buffer.toString('base64'),
    createdAt: new Date().toISOString()
  };
  store.set(storageKey(ownerId, id), record);
  return { ok: true, file: sanitizeFile(record) };
}

function listUserFiles(userId) {
  const ownerId = safeUserId(userId);
  return store.keys(`userfile:${ownerId}:`)
    .map((key) => store.get(key))
    .filter((record) => record?.ownerId === ownerId)
    .map(sanitizeFile)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getUserFile(userId, fileId) {
  const ownerId = safeUserId(userId);
  const record = store.get(storageKey(ownerId, fileId));
  if (!record || record.ownerId !== ownerId || !record.data) return null;
  return {
    ...sanitizeFile(record),
    buffer: Buffer.from(record.data, 'base64')
  };
}

function deleteUserFile(userId, fileId) {
  const ownerId = safeUserId(userId);
  const record = getUserFile(ownerId, fileId);
  if (!record) return false;
  store.remove(storageKey(ownerId, fileId));
  return true;
}

function deleteAllUserFiles(userId) {
  const ownerId = safeUserId(userId);
  const keys = store.keys(`userfile:${ownerId}:`);
  keys.forEach((key) => store.remove(key));
  return keys.length;
}

module.exports = {
  saveUserFile,
  listUserFiles,
  getUserFile,
  deleteUserFile,
  deleteAllUserFiles
};
