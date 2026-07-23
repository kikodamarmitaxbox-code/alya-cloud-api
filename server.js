const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');

const logger = require('./lib/logger');
const { isAuthenticated, hasSitePassword, validateLogin, setAuthCookie, clearAuthCookie, readSiteUsers } = require('./lib/auth');
const { askAssistant, askAssistantStream, normalizeSettings } = require('./lib/chat');
const { handleWhatsappReceive, handleWhatsappApprove, handleWhatsappCancel, getWhatsappQueue, readWhatsappLog } = require('./lib/whatsapp');
const { DiscordManager } = require('./lib/discord');
const FileStorage = require('./lib/storage/FileStorage');
const { UserFacingError, sendJson, sendText, loadLocalEnv, getSafeRequest, readJsonBody } = require('./lib/utils');
const { readDevProfile, handleApplyProfile, rotateBackups } = require('./lib/profile');
const { saveConversationHistory, loadConversationHistory, deleteConversationHistory, listAllConversations } = require('./lib/history');
const { listFiles, readFile, writeFile, executeCommand, installDependency, createBackup, restoreBackup } = require('./lib/fileOps');
const memory = require('./lib/memory');
const { apiLimiter, authLimiter } = require('./lib/rateLimit');

const root = __dirname;
const publicDir = path.join(root, 'public');
const port = Number(process.env.PORT || 3000);

loadLocalEnv();

const discordStorage = new FileStorage(path.join(__dirname, 'nova-data', 'discord'));
const discordManager = new DiscordManager({ storage: discordStorage });
discordManager.init().catch((error) => logger.error('Discord init error:', error));

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const corsMiddleware = cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
});

const server = http.createServer(async (req, res) => {
  try {
    corsMiddleware(req, res, () => {});
    
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      if (!apiLimiter.check(req, res)) return;
      if (!requireAuth(req, res)) return;
      await handleChat(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/chat-stream') {
      if (!apiLimiter.check(req, res)) return;
      if (!requireAuth(req, res)) return;
      await handleChatStream(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/aly-chat') {
      if (!apiLimiter.check(req, res)) return;
      await handleAlyChat(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/aly-chat-stream') {
      if (!apiLimiter.check(req, res)) return;
      await handleAlyChatStream(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/aly') {
      serveAlyStatic(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/status') {
      const users = readSiteUsers();
      sendJson(res, 200, {
        protected: hasSitePassword(),
        authenticated: isAuthenticated(req),
        loginMode: users.length > 0 ? 'users' : hasSitePassword() ? 'password' : 'none'
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      if (!authLimiter.check(req, res)) return;
      await handleLogin(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      clearAuthCookie(res);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      await handleHealthCheck(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/dev/profile') {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, readDevProfile());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/dev/apply-profile') {
      if (!requireAuth(req, res)) return;
      const result = await handleApplyProfile(req);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/whatsapp/receive') {
      await handleWhatsappReceiveRoute(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/whatsapp/queue') {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, { queue: getWhatsappQueue() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/whatsapp/approve') {
      if (!requireAuth(req, res)) return;
      const result = await handleWhatsappApproveRoute(req, res);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/whatsapp/cancel') {
      if (!requireAuth(req, res)) return;
      const result = await handleWhatsappCancelRoute(req, res);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/whatsapp/log') {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, { log: readWhatsappLog() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/discord/receive') {
      await handleDiscordReceiveRoute(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/memory/remember') {
      if (!requireAuth(req, res)) return;
      await handleMemoryRemember(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/memory/forget') {
      if (!requireAuth(req, res)) return;
      await handleMemoryForget(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/memory/permanent') {
      if (!requireAuth(req, res)) return;
      const userId = getCurrentUserId(req);
      const result = memory.getAllPermanentMemory(userId);
      sendJson(res, 200, { memories: result });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/memory/knowledge') {
      if (!requireAuth(req, res)) return;
      const userId = getCurrentUserId(req);
      const result = memory.getAllKnowledge(userId);
      sendJson(res, 200, { knowledge: result });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/memory/pinned') {
      if (!requireAuth(req, res)) return;
      const userId = getCurrentUserId(req);
      const result = memory.getPinnedMemory(userId);
      sendJson(res, 200, { pinned: result });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/memory/context') {
      if (!requireAuth(req, res)) return;
      const userId = getCurrentUserId(req);
      const query = url.searchParams.get('q') || '';
      const result = memory.getMemoryContext(userId, query);
      sendJson(res, 200, { context: result });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/memory/knowledge') {
      if (!requireAuth(req, res)) return;
      await handleMemoryKnowledge(req, res);
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/api/memory/permanent') {
      if (!requireAuth(req, res)) return;
      await handleMemoryDeletePermanent(req, res);
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/api/memory/knowledge') {
      if (!requireAuth(req, res)) return;
      await handleMemoryDeleteKnowledge(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/discord/queue') {
      if (!requireAuth(req, res)) return;
      const queue = await discordManager.getQueue();
      sendJson(res, 200, { queue });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/discord/approve') {
      if (!requireAuth(req, res)) return;
      const result = await handleDiscordApproveRoute(req, res);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/discord/cancel') {
      if (!requireAuth(req, res)) return;
      const result = await handleDiscordCancelRoute(req, res);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/discord/log') {
      if (!requireAuth(req, res)) return;
      const log = await discordManager.getLog();
      sendJson(res, 200, { log });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/discord/status') {
      sendJson(res, 200, {
        enabled: discordManager.enabled,
        ready: discordManager.isReady(),
        approvalRequired: discordManager.approvalRequired
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/history/save') {
      if (!requireAuth(req, res)) return;
      const result = await handleSaveHistory(req);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/history/load') {
      if (!requireAuth(req, res)) return;
      const conversationId = url.searchParams.get('conversationId');
      const result = loadConversationHistory(conversationId);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/api/history/delete') {
      if (!requireAuth(req, res)) return;
      const conversationId = url.searchParams.get('conversationId');
      const result = deleteConversationHistory(conversationId);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/history/list') {
      if (!requireAuth(req, res)) return;
      const result = listAllConversations();
      sendJson(res, 200, result);
      return;
    }

    // Dev mode file operations
    if (req.method === 'GET' && url.pathname === '/api/dev/files') {
      if (!requireAuth(req, res)) return;
      const dirPath = url.searchParams.get('path') || root;
      const result = listFiles(dirPath);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/dev/file') {
      if (!requireAuth(req, res)) return;
      const filePath = url.searchParams.get('path');
      const result = readFile(filePath);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/dev/file') {
      if (!requireAuth(req, res)) return;
      const result = await handleWriteFile(req);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/dev/command') {
      if (!requireAuth(req, res)) return;
      const result = await handleExecuteCommand(req);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/dev/install') {
      if (!requireAuth(req, res)) return;
      const result = await handleInstallDependency(req);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/dev/backup') {
      if (!requireAuth(req, res)) return;
      const result = await handleCreateBackup(req);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/dev/restore') {
      if (!requireAuth(req, res)) return;
      const result = await handleRestoreBackup(req);
      sendJson(res, 200, result);
      return;
    }

    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Metodo nao permitido.' });
      return;
    }

    serveStatic(url.pathname, res);
  } catch (error) {
    logger.error('Server error:', error);
    const message = error instanceof UserFacingError
      ? error.message
      : 'Algo deu errado no servidor local.';
    if (res.headersSent) {
      res.end(`\n${message}`);
      return;
    }
    sendJson(res, 500, { error: message });
  }
});

server.listen(port, '0.0.0.0', () => {
  logger.info(`Assistente pronto em http://localhost:${port}`);
  rotateBackups();
  
  setInterval(() => {
    rotateBackups();
  }, 24 * 60 * 60 * 1000);

  discordManager.start().catch((error) => logger.error('Discord start error:', error));
});

process.on('SIGINT', async () => {
  await discordManager.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await discordManager.stop();
  process.exit(0);
});

function serveStatic(requestPath, res) {
  const safePath = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.normalize(path.join(publicDir, safePath));

  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, 'Acesso negado.');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, 404, 'Arquivo nao encontrado.');
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

function requireAuth(req, res) {
  if (isAuthenticated(req)) return true;
  sendJson(res, 401, { error: 'Digite a senha para entrar na Astra.' });
  return false;
}

async function handleLogin(req, res) {
  loadLocalEnv(true);
  const body = await readJsonBody(req);
  const users = readSiteUsers();

  if (users.length === 0 && !hasSitePassword()) {
    sendJson(res, 200, { ok: true, protected: false, loginMode: 'none' });
    return;
  }

  const result = await validateLogin(body.username, body.password);
  
  if (!result.success) {
    sendJson(res, 401, { error: result.error });
    return;
  }

  setAuthCookie(res, result.user);
  sendJson(res, 200, { 
    ok: true, 
    protected: true, 
    loginMode: users.length > 0 ? 'users' : 'password', 
    user: result.user 
  });
}

async function handleChat(req, res) {
  const { safeMessages, settings } = await getSafeRequest(req);
  const userId = getCurrentUserId(req);
  const memoryContext = memory.getMemoryContext(userId, safeMessages[safeMessages.length - 1]?.content);
  const reply = await askAssistant(safeMessages, settings, memoryContext);
  sendJson(res, 200, { reply });
}

async function handleChatStream(req, res) {
  const { safeMessages, settings } = await getSafeRequest(req);
  const userId = getCurrentUserId(req);
  const memoryContext = memory.getMemoryContext(userId, safeMessages[safeMessages.length - 1]?.content);
  await askAssistantStream(safeMessages, settings, res, memoryContext);
}

function normalizeAlyReply(reply) {
  if (typeof reply !== 'string') return '';

  let text = reply;

  text = text.replace(/\*\*.*?\*\*/g, (match) => match.slice(2, -2));
  text = text.replace(/\*.*?\*/g, (match) => match.slice(1, -1));
  text = text.replace(/`{1,3}[^`]*`{1,3}/g, (match) => match.replace(/`/g, ''));
  text = text.replace(/\[.*?\]\(.*?\)/g, '$1');
  text = text.replace(/#{1,6}\s/g, '');
  text = text.replace(/[-*_]{2,}/g, '');
  text = text.replace(/\n{3,}/g, '\n\n');

  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2000}-\u{206F}\u{FE00}-\u{FE0F}]/gu;
  text = text.replace(emojiRegex, '');

  text = text.replace(/[•·–—−]+/g, '-');
  text = text.replace(/\s+/g, ' ').trim();

  const sentences = text.match(/[^.!?]*[.!?]+/g) || [text];
  const shortSentences = sentences.map(s => s.trim()).filter(s => s.length > 0);
  const limited = shortSentences.slice(0, 50);

  return limited.join(' ').trim();
}

async function handleAlyChat(req, res) {
  const body = await readJsonBody(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const safeMessages = messages
    .filter((message) => message && ['user', 'assistant'].includes(message.role))
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').slice(0, 2400)
    }));

  if (safeMessages.length === 0) {
    sendJson(res, 400, { error: 'Escreva uma mensagem para a Alya.' });
    return;
  }

  const settings = normalizeSettings(body.settings || {});
  const memoryContext = memory.getMemoryContext('public', safeMessages[safeMessages.length - 1]?.content);
  let reply = await askAssistant(safeMessages, settings, memoryContext);

  if (/cannot read .* image/i.test(reply)) {
    reply = 'No momento eu nao consigo analisar imagens. Envie apenas texto, que eu respondo na hora.';
  } else {
    reply = normalizeAlyReply(reply);
  }

  sendJson(res, 200, { reply });
}

async function handleAlyChatStream(req, res) {
  const body = await readJsonBody(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const safeMessages = messages
    .filter((message) => message && ['user', 'assistant'].includes(message.role))
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').slice(0, 2400)
    }));

  if (safeMessages.length === 0) {
    sendJson(res, 400, { error: 'Escreva uma mensagem para a Alya.' });
    return;
  }

  const settings = normalizeSettings(body.settings || {});
  const memoryContext = memory.getMemoryContext('public', safeMessages[safeMessages.length - 1]?.content);
  await askAssistantStream(safeMessages, settings, res, memoryContext);
}

function serveAlyStatic(res) {
  const filePath = path.join(publicDir, 'aly.html');
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, 404, 'Pagina publica nao encontrada.');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

async function handleHealthCheck(req, res) {
  const health = {
    ok: true,
    name: 'Astra',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    dependencies: {
      openrouter: !!process.env.OPENROUTER_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY
    },
    discord: {
      enabled: discordManager.enabled,
      ready: discordManager.isReady()
    }
  };
  
  sendJson(res, 200, health);
}

async function handleWhatsappReceiveRoute(req, res) {
  const body = await readJsonBody(req);
  const result = await handleWhatsappReceive(body);
  sendJson(res, 200, result);
}

async function handleWhatsappApproveRoute(req, res) {
  const body = await readJsonBody(req);
  const result = await handleWhatsappApprove(body.id, body.reply);
  sendJson(res, 200, result);
}

async function handleWhatsappCancelRoute(req, res) {
  const body = await readJsonBody(req);
  const result = await handleWhatsappCancel(body.id);
  sendJson(res, 200, result);
}

async function handleDiscordReceiveRoute(req, res) {
  const body = await readJsonBody(req);
  const from = String(body.from || body.channelId || '').trim();
  const message = String(body.message || '').trim();
  const author = String(body.author || 'Usuario').trim();

  if (!from || !message) {
    sendJson(res, 400, { error: 'Campos "from"/"channelId" e "message" sao obrigatorios.' });
    return;
  }

  const historyKey = `history:${from}:external`;
  let context = await discordManager.storage.get(historyKey) || [];
  context.push({ role: 'user', content: message, author, timestamp: Date.now() });
  if (context.length > 20) context.splice(0, context.length - 20);
  await discordManager.storage.set(historyKey, context);

  try {
    const settings = normalizeSettings(body.settings || {});
    const aiReply = await askAssistant(context, settings);
    context.push({ role: 'assistant', content: aiReply, timestamp: Date.now() });
    if (context.length > 20) context.splice(0, context.length - 20);
    await discordManager.storage.set(historyKey, context);

    if (discordManager.approvalRequired) {
      const queue = await discordManager.getQueue();
      queue.push({
        id: crypto.randomUUID(),
        channelId: from,
        userId: 'external',
        author,
        message,
        aiReply,
        receivedAt: new Date().toISOString(),
        status: 'pending'
      });
      await discordManager.setQueue(queue);
    }

    sendJson(res, 200, { ok: true, aiReply });
  } catch (error) {
    logger.error('Discord receive error:', error);
    sendJson(res, 500, { error: 'Nao consegui gerar uma resposta agora.' });
  }
}

async function handleDiscordApproveRoute(req, res) {
  const body = await readJsonBody(req);
  const id = String(body.id || '').trim();
  const customReply = body.reply !== undefined ? String(body.reply).trim() : null;

  if (!id) {
    sendJson(res, 400, { error: 'ID da mensagem e obrigatorio.' });
    return;
  }

  const queue = await discordManager.getQueue();
  const index = queue.findIndex((item) => item.id === id);
  if (index === -1) {
    sendJson(res, 404, { error: 'Mensagem nao encontrada na fila.' });
    return;
  }

  const entry = queue[index];
  const replyToSend = customReply || entry.aiReply;

  try {
    await discordManager.sendMessage(entry.channelId, replyToSend);
  } catch (error) {
    logger.error('Error sending approved Discord message:', error);
    await discordManager.addLog('approve_failed', {
      id: entry.id,
      channelId: entry.channelId,
      error: error.message
    });
    sendJson(res, 500, { error: 'Nao consegui enviar a mensagem aprovada no Discord.' });
    return;
  }

  await discordManager.addLog('approved', {
    id: entry.id,
    channelId: entry.channelId,
    author: entry.author,
    originalReply: entry.aiReply,
    sentReply: replyToSend,
    wasEdited: customReply !== null
  });

  queue.splice(index, 1);
  await discordManager.setQueue(queue);

  sendJson(res, 200, { ok: true, message: 'Resposta enviada no Discord.', id: entry.id });
}

async function handleDiscordCancelRoute(req, res) {
  const body = await readJsonBody(req);
  const id = String(body.id || '').trim();

  if (!id) {
    sendJson(res, 400, { error: 'ID da mensagem e obrigatorio.' });
    return;
  }

  const queue = await discordManager.getQueue();
  const index = queue.findIndex((item) => item.id === id);
  if (index === -1) {
    sendJson(res, 404, { error: 'Mensagem nao encontrada na fila.' });
    return;
  }

  const entry = queue[index];
  await discordManager.addLog('cancelled', {
    id: entry.id,
    channelId: entry.channelId,
    author: entry.author,
    message: entry.message,
    aiReply: entry.aiReply
  });

  queue.splice(index, 1);
  await discordManager.setQueue(queue);

  sendJson(res, 200, { ok: true, message: 'Envio cancelado.', id: entry.id });
}

async function handleSaveHistory(req) {
  const body = await readJsonBody(req);
  const { conversationId, messages } = body;
  return saveConversationHistory(conversationId, messages);
}

async function handleWriteFile(req) {
  const body = await readJsonBody(req);
  const { path: filePath, content, approved = false } = body;
  return writeFile(filePath, content, !approved);
}

async function handleExecuteCommand(req) {
  const body = await readJsonBody(req);
  const { command, approved = false } = body;
  return executeCommand(command, !approved);
}

async function handleInstallDependency(req) {
  const body = await readJsonBody(req);
  const { package: packageName, approved = false } = body;
  return installDependency(packageName);
}

async function handleCreateBackup(req) {
  const body = await readJsonBody(req);
  const { path: filePath } = body;
  return createBackup(filePath);
}

async function handleRestoreBackup(req) {
  const body = await readJsonBody(req);
  const { backupPath, originalPath } = body;
  return restoreBackup(backupPath, originalPath);
}

function getCurrentUserId(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/nova-session=([^;]+)/);
  if (!match) return 'anonymous';
  try {
    const decoded = decodeURIComponent(match[1]);
    const payload = JSON.parse(decoded);
    return String(payload.user || 'anonymous');
  } catch {
    return 'anonymous';
  }
}

async function handleMemoryRemember(req, res) {
  const body = await readJsonBody(req);
  const userId = getCurrentUserId(req);
  const { text, category } = body;
  
  if (!text || !String(text).trim()) {
    sendJson(res, 400, { error: 'Texto da memoria e obrigatorio.' });
    return;
  }
  
  const entry = memory.addPermanentMemory(userId, String(text).trim(), category);
  sendJson(res, 200, { ok: true, memory: entry });
}

async function handleMemoryForget(req, res) {
  const body = await readJsonBody(req);
  const userId = getCurrentUserId(req);
  const { text } = body;
  
  if (!text || !String(text).trim()) {
    sendJson(res, 400, { error: 'Texto da memoria e obrigatorio.' });
    return;
  }
  
  const memories = memory.searchPermanentMemory(userId, String(text).trim());
  let removed = 0;
  memories.forEach(m => {
    if (m.text && m.text.toLowerCase().includes(String(text).trim().toLowerCase())) {
      memory.removePermanentMemory(userId, m.id);
      removed++;
    }
  });
  
  sendJson(res, 200, { ok: true, removed });
}

async function handleMemoryKnowledge(req, res) {
  const body = await readJsonBody(req);
  const userId = getCurrentUserId(req);
  const { title, content, type } = body;
  
  if (!title || !content || !String(title).trim() || !String(content).trim()) {
    sendJson(res, 400, { error: 'Titulo e conteudo sao obrigatorios.' });
    return;
  }
  
  const entry = memory.addKnowledge(userId, String(title).trim(), String(content).trim(), type);
  sendJson(res, 200, { ok: true, knowledge: entry });
}

async function handleMemoryDeletePermanent(req, res) {
  const body = await readJsonBody(req);
  const userId = getCurrentUserId(req);
  const { id } = body;
  
  if (!id) {
    sendJson(res, 400, { error: 'ID da memoria e obrigatorio.' });
    return;
  }
  
  memory.removePermanentMemory(userId, String(id));
  sendJson(res, 200, { ok: true });
}

async function handleMemoryDeleteKnowledge(req, res) {
  const body = await readJsonBody(req);
  const userId = getCurrentUserId(req);
  const { id } = body;
  
  if (!id) {
    sendJson(res, 400, { error: 'ID do conhecimento e obrigatorio.' });
    return;
  }
  
  memory.removeKnowledge(userId, String(id));
  sendJson(res, 200, { ok: true });
}

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection:', error);
});
