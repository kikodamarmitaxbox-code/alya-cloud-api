const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

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
    ensureHistoryDir();
    const filePath = getHistoryFilePath(conversationId);
    const data = {
      id: conversationId,
      messages: messages.slice(-100),
      updatedAt: new Date().toISOString()
    };
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
    const filePath = getHistoryFilePath(conversationId);
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
    const filePath = getHistoryFilePath(conversationId);
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
