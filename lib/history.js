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

function getHistoryFilePath(conversationId) {
  return path.join(historyDir, `${conversationId}.json`);
}

function saveConversationHistory(conversationId, messages) {
  try {
    const safeId = String(conversationId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
    if (!safeId) return { ok: false, error: 'ID de conversa inválido.' };
    ensureHistoryDir();
    const filePath = getHistoryFilePath(safeId);
    const data = {
      id: safeId,
      messages: messages.slice(-100),
      updatedAt: new Date().toISOString()
    };
    store.set(`history:${safeId}`, data);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    logger.info(`History saved for conversation ${conversationId}`);
    return { ok: true };
  } catch (error) {
    logger.error('Error saving conversation history:', error);
    return { ok: false, error: error.message };
  }
}

function loadConversationHistory(conversationId) {
  try {
    const safeId = String(conversationId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
    if (!safeId) return { ok: true, messages: [] };
    const persisted = store.get(`history:${safeId}`);
    if (persisted) return { ok: true, messages: persisted.messages || [] };
    const filePath = getHistoryFilePath(safeId);
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

function deleteConversationHistory(conversationId) {
  try {
    const safeId = String(conversationId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
    if (!safeId) return { ok: true };
    store.remove(`history:${safeId}`);
    const filePath = getHistoryFilePath(safeId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`History deleted for conversation ${conversationId}`);
    }
    return { ok: true };
  } catch (error) {
    logger.error('Error deleting conversation history:', error);
    return { ok: false, error: error.message };
  }
}

function listAllConversations() {
  try {
    const persisted = store.keys('history:').map((key) => store.get(key)).filter(Boolean);
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

module.exports = {
  saveConversationHistory,
  loadConversationHistory,
  deleteConversationHistory,
  listAllConversations
};
