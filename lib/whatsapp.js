const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');
const { askAssistant, normalizeSettings } = require('./chat');

const dataDir = path.join(__dirname, '..', 'nova-data');
const whatsappQueueFile = path.join(dataDir, 'whatsapp-queue.json');
const whatsappLogFile = path.join(dataDir, 'whatsapp-log.json');

let whatsappQueue = loadWhatsappQueue();

function loadWhatsappQueue() {
  try {
    if (!fs.existsSync(whatsappQueueFile)) return [];
    const data = JSON.parse(fs.readFileSync(whatsappQueueFile, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    logger.error('Error loading WhatsApp queue:', error);
    return [];
  }
}

function saveWhatsappQueue() {
  try {
    ensureDataDir();
    fs.writeFileSync(whatsappQueueFile, `${JSON.stringify(whatsappQueue, null, 2)}\n`, 'utf8');
  } catch (error) {
    logger.error('Error saving WhatsApp queue:', error);
    throw error;
  }
}

function readWhatsappLog() {
  try {
    if (!fs.existsSync(whatsappLogFile)) return [];
    const data = JSON.parse(fs.readFileSync(whatsappLogFile, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    logger.error('Error reading WhatsApp log:', error);
    return [];
  }
}

function writeWhatsappLog(log) {
  try {
    ensureDataDir();
    fs.writeFileSync(whatsappLogFile, `${JSON.stringify(log, null, 2)}\n`, 'utf8');
  } catch (error) {
    logger.error('Error writing WhatsApp log:', error);
    throw error;
  }
}

function logWhatsappAction(action, entry) {
  try {
    const log = readWhatsappLog();
    log.push({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      action,
      ...entry
    });
    writeWhatsappLog(log.slice(-100));
  } catch (error) {
    logger.error('Error logging WhatsApp action:', error);
  }
}

function ensureDataDir() {
  const backupDir = path.join(dataDir, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
}

async function handleWhatsappReceive(body) {
  const from = String(body.from || '').trim();
  const message = String(body.message || '').trim();

  if (!from || !message) {
    throw new Error('Campos "from" e "message" sao obrigatorios.');
  }

  const settings = normalizeSettings(body.settings || {});
  const safeMessages = [{ role: 'user', content: message }];

  let aiReply = '';
  try {
    aiReply = await askAssistant(safeMessages, settings);
  } catch (error) {
    logger.error('Error generating AI reply for WhatsApp:', error);
    aiReply = 'Desculpe, nao consegui gerar uma resposta no momento.';
  }

  const entry = {
    id: crypto.randomUUID(),
    from,
    contactName: body.contactName || null,
    message,
    aiReply,
    settings,
    receivedAt: new Date().toISOString(),
    status: 'pending'
  };

  whatsappQueue.push(entry);
  saveWhatsappQueue();
  logger.info(`WhatsApp message received from ${from}, queued for approval`);

  return {
    ok: true,
    id: entry.id,
    message: 'Mensagem recebida e aguardando aprovacao.',
    aiReply
  };
}

async function handleWhatsappApprove(id, customReply) {
  const index = whatsappQueue.findIndex((item) => item.id === id);
  if (index === -1) {
    throw new Error('Mensagem nao encontrada na fila.');
  }

  const entry = whatsappQueue[index];
  const replyToSend = customReply || entry.aiReply;

  logWhatsappAction('approved', {
    id: entry.id,
    from: entry.from,
    contactName: entry.contactName,
    originalReply: entry.aiReply,
    sentReply: replyToSend,
    wasEdited: customReply !== null
  });

  whatsappQueue.splice(index, 1);
  saveWhatsappQueue();
  logger.info(`WhatsApp message approved for ${entry.from}`);

  return {
    ok: true,
    message: 'Resposta aprovada e pronta para envio.',
    id: entry.id,
    from: entry.from,
    contactName: entry.contactName,
    reply: replyToSend
  };
}

async function handleWhatsappCancel(id) {
  const index = whatsappQueue.findIndex((item) => item.id === id);
  if (index === -1) {
    throw new Error('Mensagem nao encontrada na fila.');
  }

  const entry = whatsappQueue[index];

  logWhatsappAction('cancelled', {
    id: entry.id,
    from: entry.from,
    contactName: entry.contactName,
    message: entry.message,
    aiReply: entry.aiReply
  });

  whatsappQueue.splice(index, 1);
  saveWhatsappQueue();
  logger.info(`WhatsApp message cancelled for ${entry.from}`);

  return {
    ok: true,
    message: 'Envio cancelado.',
    id: entry.id
  };
}

function getWhatsappQueue() {
  return whatsappQueue;
}

module.exports = {
  handleWhatsappReceive,
  handleWhatsappApprove,
  handleWhatsappCancel,
  getWhatsappQueue,
  readWhatsappLog
};
