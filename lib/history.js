const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');
const store = require('./persistentStore');

const dataDir = path.join(__dirname, '..', 'nova-data');
const historyDir = path.join(dataDir, 'history');

function ensureHistoryDir() {
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
  }
}

function safePart(value, fallback = 'default') {
  return String(value || fallback).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || fallback;
}

function scopedId(userId, conversationId) {
  return `${safePart(userId, 'anonymous')}__${safePart(conversationId)}`;
}

function getHistoryFilePath(storageId) {
  return path.join(historyDir, `${storageId}.json`);
}

function saveConversationHistory(conversationId, messages, userId = 'anonymous') {
  try {
    const safeId = safePart(conversationId, '');
    if (!safeId) return { ok: false, error: 'ID de conversa inválido.' };
    const ownerId = safePart(userId, 'anonymous');
    const storageId = scopedId(ownerId, safeId);
    ensureHistoryDir();
    const filePath = getHistoryFilePath(storageId);
    const data = {
      id: safeId,
      ownerId,
      messages: Array.isArray(messages) ? messages.slice(-100) : [],
      updatedAt: new Date().toISOString()
    };
    store.set(`history:${storageId}`, data);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    logger.info('Histórico de conversa salvo.', { ownerId, conversationId: safeId });
    return { ok: true };
  } catch (error) {
    logger.error('Error saving conversation history:', error);
    return { ok: false, error: error.message };
  }
}

function loadConversationHistory(conversationId, userId = 'anonymous') {
  try {
    const safeId = safePart(conversationId, '');
    if (!safeId) return { ok: true, messages: [] };
    const storageId = scopedId(userId, safeId);
    const persisted = store.get(`history:${storageId}`);
    if (persisted) return { ok: true, messages: persisted.messages || [] };
    const filePath = getHistoryFilePath(storageId);
    if (!fs.existsSync(filePath)) {
      return { ok: true, messages: [] };
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { ok: true, messages: data.messages || [] };
  } catch (error) {
    logger.error('Error loading conversation history:', error);
    return { ok: false, messages: [], error: error.message };
  }
}

function deleteConversationHistory(conversationId, userId = 'anonymous') {
  try {
    const safeId = safePart(conversationId, '');
    if (!safeId) return { ok: true };
    const storageId = scopedId(userId, safeId);
    store.remove(`history:${storageId}`);
    const filePath = getHistoryFilePath(storageId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info('Histórico de conversa removido.', { ownerId: safePart(userId), conversationId: safeId });
    }
    return { ok: true };
  } catch (error) {
    logger.error('Error deleting conversation history:', error);
    return { ok: false, error: error.message };
  }
}

function listAllConversations(userId = 'anonymous') {
  try {
    const ownerId = safePart(userId, 'anonymous');
    const prefix = `history:${ownerId}__`;
    const persisted = store.keys(prefix).map((key) => store.get(key)).filter((data) => data?.ownerId === ownerId);
    if (persisted.length) {
      return {
        ok: true,
        conversations: persisted.map((data) => ({
          id: data.id,
          updatedAt: data.updatedAt,
          messageCount: data.messages?.length || 0
        })).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      };
    }
    ensureHistoryDir();
    const files = fs.readdirSync(historyDir)
      .filter(file => file.startsWith(`${ownerId}__`))
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const filePath = path.join(historyDir, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
          id: data.id,
          updatedAt: data.updatedAt,
          messageCount: data.messages?.length || 0
        };
      })
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    
    return { ok: true, conversations: files };
  } catch (error) {
    logger.error('Error listing conversations:', error);
    return { ok: false, conversations: [], error: error.message };
  }
}

function deleteAllUserHistory(userId) {
  const ownerId = safePart(userId, 'anonymous');
  const keys = store.keys(`history:${ownerId}__`);
  keys.forEach((key) => store.remove(key));
  ensureHistoryDir();
  const files = fs.readdirSync(historyDir)
    .filter((file) => file.startsWith(`${ownerId}__`) && file.endsWith('.json'));
  files.forEach((file) => fs.unlinkSync(path.join(historyDir, file)));
  return Math.max(keys.length, files.length);
}

module.exports = {
  saveConversationHistory,
  loadConversationHistory,
  deleteConversationHistory,
  listAllConversations,
  deleteAllUserHistory,
  scopedId
};
