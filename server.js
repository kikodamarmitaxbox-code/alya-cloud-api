const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const logger = require('./lib/logger');
const { isAuthenticated, hasSitePassword, validateLogin, setAuthCookie, clearAuthCookie, readSiteUsers, getAuthenticatedUsername } = require('./lib/auth');
const { askAssistant, askAssistantStream, normalizeSettings, getProviderStatus, setPreferredProvider } = require('./lib/chat');
const { handleWhatsappReceive, handleWhatsappApprove, handleWhatsappCancel, getWhatsappQueue, readWhatsappLog } = require('./lib/whatsapp');
const { DiscordManager } = require('./lib/discord');
const FileStorage = require('./lib/storage/FileStorage');
const { UserFacingError, sendJson, sendText, loadLocalEnv, getSafeRequest, readJsonBody } = require('./lib/utils');
const { readDevProfile, handleApplyProfile, rotateBackups } = require('./lib/profile');
const { saveConversationHistory, loadConversationHistory, deleteConversationHistory, listAllConversations } = require('./lib/history');
const { listFiles, readFile, writeFile, executeCommand, installDependency, createBackup, restoreBackup } = require('./lib/fileOps');
const memory = require('./lib/memory');
const pluginManager = require('./lib/plugins');
const { searchWeb, shouldSearchWeb } = require('./lib/webSearch');
const { apiLimiter, authLimiter, expensiveLimiter } = require('./lib/rateLimit');
const { createUser, deleteUser, listUsers, getUser } = require('./lib/users');
const notifications = require('./lib/notifications');
const computerControl = require('./lib/computerControl');
const persistentStore = require('./lib/persistentStore');
const metrics = require('./lib/metrics');
const codeAgent = require('./lib/codeAgent');

const root = __dirname;
const publicDir = path.join(root, 'public');
const port = Number(process.env.PORT || 3000);

let publicTunnelUrl = '';
let cloudflaredProcess = null;
let tunnelStartAttempts = 0;
const TUNNEL_MAX_ATTEMPTS = 10;
let tunnelReconnectTimer = null;

function getCloudflaredPath() {
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(root, 'tools', 'cloudflared.exe');
  }
  return path.join(root, 'tools', 'cloudflared');
}

function ensureCloudflaredExists() {
  const tunnelPath = getCloudflaredPath();
  if (fs.existsSync(tunnelPath)) {
    return tunnelPath;
  }

  logger.warn('cloudflared not found at', tunnelPath);
  return null;
}

function startCloudflareTunnel() {
  if (publicTunnelUrl) {
    logger.info('Cloudflare Tunnel already running at', publicTunnelUrl);
    return;
  }

  const tunnelPath = ensureCloudflaredExists();
  if (!tunnelPath) {
    logger.warn('Cloudflare Tunnel skipped: cloudflared not available.');
    return;
  }

  tunnelStartAttempts += 1;
  if (tunnelStartAttempts > TUNNEL_MAX_ATTEMPTS) {
    logger.warn('Cloudflare Tunnel max attempts reached.');
    return;
  }

  logger.info('Starting Cloudflare Tunnel...');

  const args = ['tunnel', '--url', `http://localhost:${port}`];
  cloudflaredProcess = spawn(tunnelPath, args, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  cloudflaredProcess.stdout.on('data', (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && match[0] !== publicTunnelUrl) {
      publicTunnelUrl = match[0];
      tunnelStartAttempts = 0;
      logger.info(`Cloudflare Tunnel ready at ${publicTunnelUrl}`);
    }
  });

  cloudflaredProcess.stderr.on('data', (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && match[0] !== publicTunnelUrl) {
      publicTunnelUrl = match[0];
      tunnelStartAttempts = 0;
      logger.info(`Cloudflare Tunnel ready at ${publicTunnelUrl}`);
    }
  });

  cloudflaredProcess.on('error', (error) => {
    logger.error('Cloudflare Tunnel error:', error);
    cloudflaredProcess = null;
    publicTunnelUrl = '';
  });

  cloudflaredProcess.on('exit', (code, signal) => {
    logger.warn('Cloudflare Tunnel exited with code', code, 'signal', signal);
    cloudflaredProcess = null;
    publicTunnelUrl = '';
    // Reconexão automática com delay progressivo
    const delay = Math.min(tunnelStartAttempts * 5000, 30000) || 5000;
    logger.info(`Tentando reconectar o túnel em ${delay / 1000}s...`);
    if (tunnelReconnectTimer) clearTimeout(tunnelReconnectTimer);
    tunnelReconnectTimer = setTimeout(() => {
      tunnelReconnectTimer = null;
      startCloudflareTunnel();
    }, delay);
  });
}

function stopCloudflareTunnel() {
  if (tunnelReconnectTimer) {
    clearTimeout(tunnelReconnectTimer);
    tunnelReconnectTimer = null;
  }
  if (cloudflaredProcess) {
    cloudflaredProcess.kill('SIGTERM');
    cloudflaredProcess = null;
    publicTunnelUrl = '';
  }
}

async function handleAlyLink(req, res) {
  const alyBase = publicTunnelUrl || `http://localhost:${port}`;
  const chatUrl = `${alyBase}/aly`;
  const apiUrl = `${alyBase}/api/aly-chat`;
  sendJson(res, 200, {
    publicUrl: alyBase,
    chatUrl,
    apiUrl,
    local: !publicTunnelUrl
  });
}

async function handleAlyStatus(req, res) {
  sendJson(res, 200, {
    tunnelUp: Boolean(publicTunnelUrl),
    publicUrl: publicTunnelUrl || null,
    localUrl: `http://localhost:${port}`
  });
}

async function handleAlyImage(req, res) {
  metrics.increment('imageRequests');
  const body = await readJsonBody(req);
  const prompt = String(body.prompt || '').trim().replace(/\s+/g, ' ').slice(0, 600);
  const imageType = ['avatar', 'banner', 'personagem'].includes(body.type) ? body.type : 'personagem';
  const imageStyle = ['anime', 'cinematico', 'realista', '3d'].includes(body.style) ? body.style : 'cinematico';

  if (!prompt) {
    throw new UserFacingError('Descreva a imagem que você quer criar.', 400);
  }

  const formats = {
    avatar: { width: 1024, height: 1024, label: 'foto de perfil quadrada, rosto bem enquadrado e destaque no centro' },
    banner: { width: 1536, height: 768, label: 'banner horizontal, composição panorâmica e sem texto importante nas bordas' },
    personagem: { width: 1024, height: 1365, label: 'personagem em retrato vertical, pose expressiva e composição elegante' }
  };
  const styles = {
    anime: 'ilustração anime premium, linhas limpas, cores vibrantes, iluminação suave e acabamento profissional',
    cinematico: 'arte cinematográfica, iluminação dramática, composição profissional, cores harmoniosas e muitos detalhes',
    realista: 'fotografia realista de alta qualidade, textura natural, iluminação de estúdio e foco nítido',
    '3d': 'arte 3D premium, materiais detalhados, iluminação de estúdio, profundidade e acabamento de jogo moderno'
  };
  const format = formats[imageType];
  const fullPrompt = `${prompt}. Create a ${format.label}. ${styles[imageStyle]}. High quality, polished details, balanced composition, beautiful background, no watermark, no logo, no readable text. Appropriate for all ages.`;
  const apiKey = process.env.POLLINATIONS_API_KEY;
  if (!apiKey) {
    throw new UserFacingError('O gerador de imagens ainda precisa da chave POLLINATIONS_API_KEY no Render.');
  }

  const model = process.env.POLLINATIONS_IMAGE_MODEL || 'flux';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const imageUrl = `https://gen.pollinations.ai/image/${encodeURIComponent(fullPrompt)}?width=${format.width}&height=${format.height}&model=${encodeURIComponent(model)}&nologo=true`;
    const response = await fetch(imageUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Gerador respondeu ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) throw new Error('O gerador não devolveu uma imagem.');
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    if (imageBuffer.length > 10 * 1024 * 1024) throw new Error('A imagem gerada ficou grande demais.');

    sendJson(res, 200, {
      ok: true,
      imageUrl: `data:${contentType};base64,${imageBuffer.toString('base64')}`,
      imageType,
      imageStyle,
      model
    });
  } catch (error) {
    logger.warn('Image generation failed:', error.message);
    throw new UserFacingError(
      error.name === 'AbortError'
        ? 'A imagem demorou demais. Tente novamente.'
        : 'O gerador de imagens está indisponível agora. Tente novamente em alguns minutos.'
    );
  } finally {
    clearTimeout(timeout);
  }
}

function decodeUploadedFile(body) {
  const name = String(body.name || 'arquivo').replace(/[^\p{L}\p{N}._ -]/gu, '').slice(0, 120);
  const mime = String(body.mime || 'application/octet-stream').slice(0, 120);
  const base64 = String(body.data || '');
  if (!base64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(base64)) {
    throw new UserFacingError('O arquivo enviado é inválido.');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > 4 * 1024 * 1024) {
    throw new UserFacingError('Envie um arquivo de até 4 MB.');
  }
  return { name, mime, buffer };
}

async function analyzeUploadedImage(name, mime, buffer, question) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new UserFacingError('A análise de imagens precisa da chave MISTRAL_API_KEY no Render.');

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.MISTRAL_VISION_MODEL || 'mistral-small-latest',
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${question || 'Analise esta imagem com detalhes e explique em português simples.'}\nNome do arquivo: ${name}`
          },
          {
            type: 'image_url',
            image_url: `data:${mime};base64,${buffer.toString('base64')}`
          }
        ]
      }]
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new UserFacingError('Não consegui analisar essa imagem agora.');
  return String(data.choices?.[0]?.message?.content || '').trim();
}

async function handleAlyFile(req, res) {
  metrics.increment('fileUploads');
  const body = await readJsonBody(req, 6 * 1024 * 1024);
  const { name, mime, buffer } = decodeUploadedFile(body);
  const extension = path.extname(name).toLowerCase();
  const question = String(body.question || '').trim().slice(0, 600);

  if (mime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) {
    const analysis = await analyzeUploadedImage(name, mime, buffer, question);
    sendJson(res, 200, { ok: true, name, kind: 'image', analysis });
    return;
  }

  let text = '';
  if (extension === '.pdf' || mime === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const parsed = await pdfParse(buffer);
    text = parsed.text || '';
  } else if (
    mime.startsWith('text/') ||
    ['.txt', '.md', '.csv', '.json', '.js', '.html', '.css'].includes(extension)
  ) {
    text = buffer.toString('utf8');
  } else {
    throw new UserFacingError('Use PDF, TXT, Markdown, CSV, JSON ou uma imagem.');
  }

  text = text.replace(/\0/g, '').trim();
  if (!text) throw new UserFacingError('Não encontrei texto legível nesse arquivo.');
  sendJson(res, 200, {
    ok: true,
    name,
    kind: 'document',
    text: text.slice(0, 18000),
    truncated: text.length > 18000
  });
}

async function handleTunnelRestart(req, res) {
  logger.info('Reiniciando Cloudflare Tunnel manualmente...');
  stopCloudflareTunnel();
  tunnelStartAttempts = 0;
  startCloudflareTunnel();
  // Aguarda até 15s para o novo link aparecer
  let attempts = 0;
  while (!publicTunnelUrl && attempts < 30) {
    await new Promise(r => setTimeout(r, 500));
    attempts++;
  }
  if (publicTunnelUrl) {
    sendJson(res, 200, { success: true, publicUrl: publicTunnelUrl, chatUrl: `${publicTunnelUrl}/aly` });
  } else {
    sendJson(res, 200, { success: false, message: 'Túnel iniciando... tente copiar o link novamente em alguns segundos.' });
  }
}

loadLocalEnv();

const discordStorage = new FileStorage(path.join(__dirname, 'nova-data', 'discord'));
const discordManager = new DiscordManager({ storage: discordStorage });

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function originAllowed(req, origin) {
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    if (originUrl.host === req.headers.host) return true;
    const configured = String(process.env.CORS_ORIGIN || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return configured.includes(origin);
  } catch {
    return false;
  }
}

function applySecurityHeaders(req, res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin || `https://${req.headers.host || 'localhost'}`);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
}

const server = http.createServer(async (req, res) => {
  try {
    const origin = req.headers.origin || '*';
    if (!originAllowed(req, req.headers.origin)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Origem não autorizada.' }));
      return;
    }
    applySecurityHeaders(req, res, req.headers.origin);

    // Resposta imediata 204 No Content para preflight OPTIONS do navegador
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);

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
      if (!requireAuth(req, res)) return;
      await handleAlyChat(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/aly-chat-stream') {
      if (!apiLimiter.check(req, res)) return;
      if (!requireAuth(req, res)) return;
      await handleAlyChatStream(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/aly-image') {
      if (!expensiveLimiter.check(req, res)) return;
      if (!requireAuth(req, res)) return;
      await handleAlyImage(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/aly-file') {
      if (!expensiveLimiter.check(req, res)) return;
      if (!requireAuth(req, res)) return;
      await handleAlyFile(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/code-alya/workspace') {
      if (!requireAuth(req, res)) return;
      await sendCodeAgentResponse(res, () => codeAgent.getWorkspaceStatus());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/code-alya/file') {
      if (!requireAuth(req, res)) return;
      await sendCodeAgentResponse(res, () => ({
        ok: true,
        ...codeAgent.readProjectFile(url.searchParams.get('path'))
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/code-alya/plan') {
      if (!expensiveLimiter.check(req, res)) return;
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      await sendCodeAgentResponse(res, () => codeAgent.createCodePlan(
        body.message,
        body.contextFiles,
        body.history
      ));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/code-alya/apply') {
      if (!apiLimiter.check(req, res)) return;
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      await sendCodeAgentResponse(res, () => codeAgent.applyCodePlan(body.planId));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/code-alya/command') {
      if (!apiLimiter.check(req, res)) return;
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      await sendCodeAgentResponse(res, () => codeAgent.runSafeCommand(body.command));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/code-alya/file') {
      if (!apiLimiter.check(req, res)) return;
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      await sendCodeAgentResponse(res, () => codeAgent.saveProjectFile(body.path, body.content));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/ai-status') {
      sendJson(res, 200, getProviderStatus());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/system-dashboard') {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, {
        ok: true,
        providers: getProviderStatus(),
        storage: persistentStore.getStatus(),
        usage: metrics.snapshot(),
        discord: {
          enabled: discordManager.enabled,
          ready: discordManager.isReady()
        },
        service: {
          uptimeSeconds: Math.round(process.uptime()),
          environment: process.env.RENDER ? 'Render' : 'Local',
          version: '2.1.0'
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/system/model') {
      if (!apiLimiter.check(req, res)) return;
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      const result = setPreferredProvider(body.provider);
      if (!result.ok) {
        sendJson(res, 400, { error: result.error });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        provider: result.provider,
        message: 'Modelo principal alterado.'
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/computer/propose') {
      if (!computerControl.localOnly(req)) return sendJson(res, 403, { error: 'O controle do computador só funciona neste computador.' });
      const body = await readJsonBody(req);
      return sendJson(res, 200, computerControl.createProposal(body.request));
    }

    if (req.method === 'POST' && url.pathname === '/api/computer/execute') {
      if (!computerControl.localOnly(req)) return sendJson(res, 403, { error: 'O controle do computador só funciona neste computador.' });
      const body = await readJsonBody(req);
      return sendJson(res, 200, computerControl.executeProposal(body.approvalId));
    }

    if (req.method === 'GET' && url.pathname === '/aly') {
      serveAlyStatic(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/game') {
      serveGameStatic(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/aly-link') {
      await handleAlyLink(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/aly-status') {
      await handleAlyStatus(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/tunnel-restart') {
      await handleTunnelRestart(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/status') {
      const users = readSiteUsers();
      const hasUsers = users.length > 0 || listUsers().length > 0;
      sendJson(res, 200, {
        protected: hasSitePassword(),
        authenticated: isAuthenticated(req),
        loginMode: hasUsers ? 'users' : hasSitePassword() ? 'password' : 'none'
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      if (!authLimiter.check(req, res)) return;
      await handleLogin(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      if (!authLimiter.check(req, res)) return;
      if (process.env.ALLOW_SELF_REGISTRATION !== 'true' && !isAuthenticated(req)) {
        sendJson(res, 403, { error: 'Criação pública de contas está desativada.' });
        return;
      }
      const body = await readJsonBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '').trim();

      if (!username || !password) {
        sendJson(res, 400, { error: 'Digite seu usuário e senha.' });
        return;
      }

      if (username.length < 3) {
        sendJson(res, 400, { error: 'O usuário deve ter pelo menos 3 caracteres.' });
        return;
      }

      if (password.length < 8) {
        sendJson(res, 400, { error: 'A senha deve ter pelo menos 8 caracteres.' });
        return;
      }

      const result = await createUser(username, password);
      if (!result.ok) {
        sendJson(res, 400, { error: result.error });
        return;
      }

      setAuthCookie(res, result.user.username);
      try {
        notifications.createNotification({
          title: 'Novo Usuário Cadastrado',
          message: `Nova conta criada com sucesso para "${result.user.username}".`,
          category: 'Segurança',
          priority: 'Média'
        });
      } catch {}

      sendJson(res, 200, { ok: true, username: result.user.username });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      clearAuthCookie(res);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/users/create') {
      if (!requireAuth(req, res)) return;
      await handleCreateUser(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/users/list') {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, { users: listUsers() });
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/api/users/delete') {
      if (!requireAuth(req, res)) return;
      await handleDeleteUser(req, res);
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
      const body = await readJsonBody(req);
      const result = await handleApplyProfile(body);
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

    // Rotas da Memória Inteligente (All, Put, Delete)
    if (req.method === 'GET' && url.pathname === '/api/memory/all') {
      const userId = getCurrentUserId(req) || 'public';
      const result = memory.getAllMemories(userId);
      sendJson(res, 200, { memories: result });
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/api/memory/item') {
      const userId = getCurrentUserId(req) || 'public';
      const body = await readJsonBody(req);
      const updated = memory.updateMemoryItem(userId, body.id, body.text, body.category);
      sendJson(res, 200, { ok: updated });
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/api/memory/item') {
      const userId = getCurrentUserId(req) || 'public';
      const body = await readJsonBody(req);
      const id = body.id || url.searchParams.get('id');
      const removed = memory.removeMemoryItem(userId, id);
      sendJson(res, 200, { ok: removed });
      return;
    }

    // Rotas do Sistema de Plugins
    if (req.method === 'GET' && url.pathname === '/api/plugins') {
      const list = pluginManager.getPluginsList();
      sendJson(res, 200, { plugins: list });
      return;
    }

    // Rotas do Centro de Notificações Inteligentes (Exclusivo Alya Privada)
    if (req.method === 'GET' && url.pathname === '/api/notifications') {
      if (!requireAuth(req, res)) return;
      const data = notifications.getNotifications();
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/notifications/mark-read') {
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      const ok = notifications.markAsRead(body.id || 'ALL');
      const data = notifications.getNotifications();
      sendJson(res, 200, { ok, ...data });
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/api/notifications') {
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req).catch(() => ({}));
      const id = body.id || url.searchParams.get('id') || 'ALL';
      const ok = notifications.deleteNotification(id);
      const data = notifications.getNotifications();
      sendJson(res, 200, { ok, ...data });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/notifications/create') {
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      const item = notifications.createNotification({
        title: body.title,
        message: body.message,
        category: body.category,
        priority: body.priority,
        details: body.details
      });
      const data = notifications.getNotifications();
      sendJson(res, 200, { item, ...data });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/plugins/toggle') {
      const body = await readJsonBody(req);
      const ok = await pluginManager.togglePlugin(body.id, body.enable);
      sendJson(res, 200, { ok, plugins: pluginManager.getPluginsList() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/plugins/reload') {
      await pluginManager.loadAll();
      sendJson(res, 200, { ok: true, plugins: pluginManager.getPluginsList() });
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

    if (url.pathname === '/code-alya') {
      serveStatic('/code-alya.html', res);
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

async function startApplication() {
  await persistentStore.init();
  await discordManager.init().catch((error) => logger.error('Discord init error:', error));
  server.listen(port, '0.0.0.0', async () => {
  logger.info(`Assistente pronto em http://localhost:${port}`);
  notifications.createNotification({
    title: 'Servidor Alya Inicializado',
    message: `Servidor Alya v2.0.0 ativo em http://localhost:${port}. Pronta para uso!`,
    category: 'Sistema',
    priority: 'Média'
  });
  rotateBackups();
  startCloudflareTunnel();
  await pluginManager.init().catch((err) => logger.error('PluginManager init error:', err));

  // Otimização automática de memória RAM (Limpeza a cada 15 min)
  setInterval(() => {
    try {
      if (global.gc) global.gc();
      const mem = process.memoryUsage();
      logger.info(`Otimização de Memória: RAM usada ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB / RSS ${(mem.rss / 1024 / 1024).toFixed(1)} MB`);
    } catch {}
  }, 15 * 60 * 1000);

  setInterval(() => {
    rotateBackups();
  }, 24 * 60 * 60 * 1000);

  discordManager.start().catch((error) => logger.error('Discord start error:', error));
  });
}

startApplication().catch((error) => {
  logger.error('Application startup failed:', error);
  process.exit(1);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`Porta ${port} ja esta em uso. Feche o processo anterior ou execute start-alya.ps1`);
  } else {
    logger.error('Server listen error:', error);
  }
  process.exit(1);
});

process.on('SIGINT', async () => {
  stopCloudflareTunnel();
  await discordManager.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  stopCloudflareTunnel();
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
  sendJson(res, 401, { error: 'Digite a senha para entrar na Alya.' });
  return false;
}

async function sendCodeAgentResponse(res, operation) {
  try {
    const result = await operation();
    sendJson(res, result?.ok === false ? 400 : 200, result);
  } catch (error) {
    const message = error instanceof Error && error.message
      ? error.message
      : 'A Code Alya não conseguiu concluir essa ação.';
    logger.warn(`Code Alya: ${message}`);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handleLogin(req, res) {
  const body = await readJsonBody(req);
  const users = readSiteUsers();

  if (users.length === 0 && !hasSitePassword()) {
    sendJson(res, 200, { ok: true, protected: false, loginMode: 'none' });
    return;
  }

  const result = await validateLogin(body.username, body.password);

  if (!result.success) {
    metrics.increment('loginFailures');
    sendJson(res, 401, { error: result.error });
    return;
  }

  metrics.increment('loginSuccesses');
  setAuthCookie(res, result.user);
  sendJson(res, 200, {
    ok: true,
    protected: true,
    loginMode: users.length > 0 || listUsers().length > 0 ? 'users' : 'password',
    user: result.user
  });
}

async function handleChat(req, res) {
  const { safeMessages, settings } = await getSafeRequest(req);
  const userId = getCurrentUserId(req);
  const memoryContext = memory.getMemoryContext(userId, safeMessages[safeMessages.length - 1]?.content);
  try {
    const reply = await askAssistant(safeMessages, settings, memoryContext);
    sendJson(res, 200, { reply: reply || 'Recebi sua mensagem.' });
  } catch (error) {
    logger.error('Chat error:', error);
    sendJson(res, 200, { reply: 'Estou com dificuldade de responder agora. Tente de novo em alguns segundos.' });
  }
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

  // Remover tags de raciocínio de modelos como DeepSeek R1
  if (text.includes('</think>')) {
    text = text.split('</think>').pop();
  }
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // Filtrar respostas de safety check da API
  const safetyCrumbs = /^(user safety[:\s]*safe|safe|unsafe|content policy|i cannot|as an ai)/i;
  if (safetyCrumbs.test(text.trim()) && text.trim().length < 50) {
    return '';
  }

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

  return text;
}

async function handleAlyChat(req, res) {
  metrics.increment('chatRequests');
  const body = await readJsonBody(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const safeMessages = messages
    .filter((message) => message && ['user', 'assistant'].includes(message.role))
    .slice(-6)
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').slice(0, 2400)
    }));

  if (safeMessages.length === 0) {
    sendJson(res, 400, { error: 'Escreva uma mensagem para a Alya.' });
    return;
  }

  const lastUserMsg = safeMessages[safeMessages.length - 1]?.content || '';
  const userId = getCurrentUserId(req);

  // Extração inteligente de memória em background
  memory.extractSmartMemories(userId, lastUserMsg);

  const settings = normalizeSettings(body.settings || {});
  let memoryContext = memory.getMemoryContext(userId, lastUserMsg);

  // Executar hook de plugins (ex: plugin de busca web)
  try {
    const hookRes = await pluginManager.runHook('beforeMessage', {
      lastUserMessage: lastUserMsg,
      systemPrompt: memoryContext
    });
    if (hookRes && hookRes.systemPrompt) {
      memoryContext = hookRes.systemPrompt;
    }
  } catch {}

  // Se não foi pesquisado via plugin mas precisa de busca, realizar busca web direta
  if (shouldSearchWeb(lastUserMsg) && !memoryContext.includes('[DADOS PESQUISADOS NA INTERNET')) {
    try {
      const searchResult = await searchWeb(lastUserMsg);
      if (searchResult && searchResult.text) {
        memoryContext += `\n\n[DADOS PESQUISADOS NA INTERNET EM TEMPO REAL]:\n${searchResult.text}\nUse estas informações verdadeiras e atualizadas da web para responder à pergunta sobre "${lastUserMsg}".`;
      }
    } catch {}
  }

  const imageReply = 'No momento eu nao consigo analisar imagens. Envie apenas texto, que eu respondo na hora.';
  const fallbackReply = 'Estou com dificuldade de responder agora. Tente de novo em alguns segundos.';

  try {
    let reply = await askAssistant(safeMessages, settings, memoryContext);

    if (/cannot read .* image|model does not support image input|image input not supported/i.test(reply)) {
      reply = imageReply;
    } else {
      reply = normalizeAlyReply(reply);
      if (!reply.trim()) {
        reply = 'Recebi sua mensagem. Pode me perguntar mais detalhes?';
      }
    }

    metrics.increment('chatSuccesses');
    sendJson(res, 200, { reply });
  } catch (error) {
    metrics.increment('chatErrors');
    logger.error('Aly chat error:', error);
    const message = /limite gratuito de hoje/i.test(error.message || '') ? error.message : fallbackReply;
    sendJson(res, 200, { reply: message });
  }
}

async function handleAlyChatStream(req, res) {
  metrics.increment('chatRequests');
  const body = await readJsonBody(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const safeMessages = messages
    .filter((message) => message && ['user', 'assistant'].includes(message.role))
    .slice(-6)
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').slice(0, 2400)
    }));

  if (safeMessages.length === 0) {
    sendJson(res, 400, { error: 'Escreva uma mensagem para a Alya.' });
    return;
  }

  const lastUserMsg = safeMessages[safeMessages.length - 1]?.content || '';
  const userId = getCurrentUserId(req);

  // Extração inteligente de memória em background
  memory.extractSmartMemories(userId, lastUserMsg);

  const settings = normalizeSettings(body.settings || {});
  let memoryContext = memory.getMemoryContext(userId, lastUserMsg);

  // Executar hook de plugins
  try {
    const hookRes = await pluginManager.runHook('beforeMessage', {
      lastUserMessage: lastUserMsg,
      systemPrompt: memoryContext
    });
    if (hookRes && hookRes.systemPrompt) {
      memoryContext = hookRes.systemPrompt;
    }
  } catch {}

  // Pesquisa web ao vivo
  if (shouldSearchWeb(lastUserMsg) && !memoryContext.includes('[DADOS PESQUISADOS NA INTERNET')) {
    try {
      const searchResult = await searchWeb(lastUserMsg);
      if (searchResult && searchResult.text) {
        memoryContext += `\n\n[DADOS PESQUISADOS NA INTERNET EM TEMPO REAL]:\n${searchResult.text}\nUse estas informações verdadeiras e atualizadas da web para responder à pergunta sobre "${lastUserMsg}".`;
      }
    } catch {}
  }

  await askAssistantStream(safeMessages, settings, res, memoryContext);
  metrics.increment('chatSuccesses');
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

function serveGameStatic(res) {
  const filePath = path.join(publicDir, 'game.html');
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, 404, 'Jogo nao encontrado.');
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
    name: 'Alya',
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
  return writeFile(filePath, content, approved);
}

async function handleExecuteCommand(req) {
  const body = await readJsonBody(req);
  const { command, approved = false } = body;
  return executeCommand(command, approved);
}

async function handleInstallDependency(req) {
  const body = await readJsonBody(req);
  const { package: packageName, approved = false } = body;
  return installDependency(packageName, approved);
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
  return getAuthenticatedUsername(req) || 'anonymous';
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

async function handleCreateUser(req, res) {
  const body = await readJsonBody(req);
  const { username, password } = body;

  if (!username || !password) {
    sendJson(res, 400, { error: 'Nome de usuario e senha sao obrigatorios.' });
    return;
  }

  const result = await createUser(username, password);

  if (result.ok) {
    sendJson(res, 200, result);
  } else {
    sendJson(res, 400, { error: result.error });
  }
}

async function handleDeleteUser(req, res) {
  const body = await readJsonBody(req);
  const { username } = body;

  if (!username) {
    sendJson(res, 400, { error: 'Nome de usuario e obrigatorio.' });
    return;
  }

  const result = deleteUser(username);

  if (result.ok) {
    sendJson(res, 200, result);
  } else {
    sendJson(res, 400, { error: result.error });
  }
}

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection:', error);
});
