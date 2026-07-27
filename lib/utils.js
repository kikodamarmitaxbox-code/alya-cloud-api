const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class UserFacingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserFacingError';
  }
}

function sendJson(res, status, data) {
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!res.hasHeader('Access-Control-Allow-Origin')) res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.statusCode = status;
  }
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (!res.hasHeader('Access-Control-Allow-Origin')) res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.statusCode = status;
  }
  res.end(text);
}

function readJsonBody(req, maxBytes = 120000) {
  return new Promise((resolve, reject) => {
    let body = '';
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      req.removeAllListeners('error');
      req.removeAllListeners('timeout');
    };

    timeoutId = setTimeout(() => {
      cleanup();
      req.destroy();
      reject(new UserFacingError('Solicitacao demorou muito para responder.'));
    }, 30000);

    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > maxBytes) {
        cleanup();
        req.destroy();
        reject(new UserFacingError('Mensagem muito grande.'));
      }
    });

    req.on('end', () => {
      cleanup();
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new UserFacingError('Formato da mensagem invalido.'));
      }
    });

    req.on('error', (error) => {
      cleanup();
      reject(new UserFacingError('Erro ao ler a solicitacao.'));
    });
  });
}

function containsSensitiveText(text) {
  return [
    /sk-or-v1-[a-z0-9]+/i,
    /sk-[a-z0-9_-]{20,}/i,
    /AIza[0-9A-Za-z_-]{20,}/,
    /ghp_[0-9A-Za-z_]{20,}/,
    /OPENROUTER_API_KEY/i,
    /GEMINI_API_KEY/i
  ].some((pattern) => pattern.test(text));
}

function loadLocalEnv(override = false) {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (key && (override || process.env[key] === undefined)) process.env[key] = value;
  }
}

async function getSafeRequest(req) {
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
    throw new UserFacingError('Escreva uma mensagem para o assistente.');
  }

  return {
    safeMessages,
    settings: require('./chat').normalizeSettings(body.settings)
  };
}

module.exports = {
  UserFacingError,
  sendJson,
  sendText,
  readJsonBody,
  containsSensitiveText,
  loadLocalEnv,
  getSafeRequest
};
