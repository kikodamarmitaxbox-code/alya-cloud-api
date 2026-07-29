'use strict';

const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');

process.env.AUTH_REQUIRED = 'false';
process.env.SESSION_SECRET = crypto.randomBytes(48).toString('hex');
process.env.DATABASE_URL = '';
process.env.DISCORD_ENABLED = 'false';
process.env.DISABLE_TUNNEL = 'true';
process.env.NODE_ENV = 'test';

const root = path.resolve(__dirname, '..');
const history = require('../lib/history');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(baseUrl, route, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.cookie) headers.Cookie = options.cookie;
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'manual'
  });
  const data = await response.json().catch(() => ({}));
  return {
    status: response.status,
    data,
    cookie: String(response.headers.get('set-cookie') || '').split(';')[0]
  };
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('O servidor encerrou durante o teste de visitantes.');
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('O servidor não iniciou no tempo esperado.');
}

function startServer(port) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.output = '';
  child.stdout.on('data', (chunk) => { child.output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { child.output += chunk.toString(); });
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function main() {
  const port = 3650 + Math.floor(Math.random() * 250);
  const baseUrl = `http://127.0.0.1:${port}`;
  const conversationId = `visitante_${Date.now().toString(36)}`;
  let child = null;
  let firstUsername = '';
  let secondUsername = '';

  try {
    child = startServer(port);
    await waitForServer(baseUrl, child);

    const firstStatus = await request(baseUrl, '/api/auth/status');
    const secondStatus = await request(baseUrl, '/api/auth/status');
    assert(firstStatus.status === 200 && firstStatus.data.authenticated, 'O primeiro visitante não entrou automaticamente.');
    assert(secondStatus.status === 200 && secondStatus.data.authenticated, 'O segundo visitante não entrou automaticamente.');
    assert(firstStatus.data.loginMode === 'guest', 'O servidor não ativou o acesso sem login.');
    assert(firstStatus.cookie && secondStatus.cookie, 'A identidade privada do navegador não foi criada.');

    firstUsername = firstStatus.data.user?.username || '';
    secondUsername = secondStatus.data.user?.username || '';
    assert(firstUsername && secondUsername && firstUsername !== secondUsername, 'Dois navegadores receberam a mesma identidade.');

    const repeatedStatus = await request(baseUrl, '/api/auth/status', { cookie: firstStatus.cookie });
    assert(repeatedStatus.data.user?.username === firstUsername, 'O mesmo navegador perdeu sua identidade.');

    const firstSave = await request(baseUrl, '/api/history/save', {
      method: 'POST',
      cookie: firstStatus.cookie,
      headers: { 'Content-Type': 'application/json' },
      body: {
        conversationId,
        messages: [{ role: 'user', content: 'conversa exclusiva do primeiro navegador' }]
      }
    });
    assert(firstSave.status === 200 && firstSave.data.ok, 'O visitante não conseguiu salvar sua conversa.');

    const firstHistory = await request(
      baseUrl,
      `/api/history/load?conversationId=${encodeURIComponent(conversationId)}`,
      { cookie: firstStatus.cookie }
    );
    const secondHistory = await request(
      baseUrl,
      `/api/history/load?conversationId=${encodeURIComponent(conversationId)}`,
      { cookie: secondStatus.cookie }
    );
    assert(
      firstHistory.data.messages?.[0]?.content === 'conversa exclusiva do primeiro navegador',
      'O primeiro navegador não recuperou a própria conversa.'
    );
    assert(
      !JSON.stringify(secondHistory.data).includes('conversa exclusiva do primeiro navegador'),
      'Uma conversa vazou para outro navegador.'
    );

    const blockedAdmin = await request(baseUrl, '/api/code-alya/status', { cookie: firstStatus.cookie });
    const blockedComputer = await request(baseUrl, '/api/computer/status', { cookie: firstStatus.cookie });
    assert(blockedAdmin.status === 403, 'Um visitante acessou a Code Alya administrativa.');
    assert(blockedComputer.status === 403, 'Um visitante acessou o controle do computador.');

    const login = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'qualquer', password: 'qualquer' }
    });
    const register = await request(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'qualquer', password: 'qualquer' }
    });
    assert(login.status === 410 && register.status === 410, 'Login ou cadastro ainda está ativo no modo público.');

    process.stdout.write('Acesso sem login verificado: entrada automática, navegadores isolados e administração bloqueada.\n');
  } finally {
    await stopServer(child);
    if (firstUsername) history.deleteConversationHistory(conversationId, firstUsername);
    if (secondUsername) history.deleteConversationHistory(conversationId, secondUsername);
  }
}

main().catch((error) => {
  process.stderr.write(`Falha no teste de acesso sem login: ${error.message}\n`);
  process.exitCode = 1;
});
