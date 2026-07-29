'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

process.env.SESSION_SECRET = crypto.randomBytes(48).toString('hex');
process.env.AUTH_REQUIRED = 'true';
process.env.ALYA_DEVICE_SECRET = crypto.randomBytes(40).toString('base64url');
process.env.DATABASE_URL = '';
process.env.DISCORD_ENABLED = 'false';
process.env.DISABLE_TUNNEL = 'true';
process.env.NODE_ENV = 'test';

const root = path.resolve(__dirname, '..');
const store = require('../lib/persistentStore');
const {
  MIN_PASSWORD_LENGTH,
  createUser,
  deleteUser,
  validatePassword
} = require('../lib/users');
const {
  INVALID_LOGIN_MESSAGE,
  createAuthToken,
  validateAuthToken,
  validateLogin
} = require('../lib/auth');
const history = require('../lib/history');
const memory = require('../lib/memory');
const userFiles = require('../lib/userFiles');

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
    if (child.exitCode !== null) throw new Error('O servidor encerrou durante o teste.');
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
      PORT: String(port),
      SESSION_SECRET: process.env.SESSION_SECRET,
      DATABASE_URL: '',
      DISCORD_ENABLED: 'false',
      DISABLE_TUNNEL: 'true',
      NODE_ENV: 'test'
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

function cleanupUserData(username, conversationId) {
  deleteUser(username, { force: true });
  history.deleteConversationHistory(conversationId, username);
  store.remove(`memory:${username}`);
  userFiles.deleteAllUserFiles(username);
  const memoryFile = path.join(root, 'nova-data', 'memory', `${username}.json`);
  if (fs.existsSync(memoryFile)) fs.unlinkSync(memoryFile);
}

async function main() {
  await store.init();
  const suffix = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const admin = `testadmin_${suffix}`.slice(0, 32);
  const friend = `testfriend_${suffix}`.slice(0, 32);
  const invited = `testinvite_${suffix}`.slice(0, 32);
  const minimumPasswordUser = `testfive_${suffix}`.slice(0, 32);
  const adminPassword = crypto.randomBytes(24).toString('base64url');
  const friendPassword = crypto.randomBytes(24).toString('base64url');
  const invitedPassword = crypto.randomBytes(24).toString('base64url');
  const changedFriendPassword = crypto.randomBytes(24).toString('base64url');
  const conversationId = `isolamento_${suffix}`;
  let child = null;

  try {
    assert(MIN_PASSWORD_LENGTH === 5, 'O mínimo de senha deveria ser cinco caracteres.');
    assert(Boolean(validatePassword('1234')), 'Uma senha com quatro caracteres foi aceita.');
    assert(!validatePassword('12345'), 'Uma senha com cinco caracteres foi recusada.');
    assert(
      (await createUser(minimumPasswordUser, '12345', { role: 'user' })).ok,
      'Não foi possível criar uma conta com senha de cinco caracteres.'
    );
    assert(
      (await validateLogin(minimumPasswordUser, '12345')).success,
      'A conta com senha de cinco caracteres não conseguiu entrar.'
    );
    assert((await createUser(admin, adminPassword, { role: 'admin' })).ok, 'Falha ao criar administrador de teste.');
    assert((await createUser(friend, friendPassword, { role: 'user' })).ok, 'Falha ao criar amigo de teste.');
    await store.flush();

    const wrong = await validateLogin(admin, `${adminPassword}x`);
    assert(!wrong.success && wrong.error === INVALID_LOGIN_MESSAGE, 'A senha errada não retornou a mensagem segura.');
    const correct = await validateLogin(admin, adminPassword);
    assert(correct.success && correct.user.role === 'admin', 'O login administrativo falhou.');
    assert(validateAuthToken(createAuthToken(correct.user)), 'O token de sessão não foi validado.');

    const port = 3300 + Math.floor(Math.random() * 300);
    const baseUrl = `http://127.0.0.1:${port}`;
    child = startServer(port);
    await waitForServer(baseUrl, child);

    const health = await request(baseUrl, '/health');
    assert(health.status === 200, '/health deveria permanecer público.');
    const blockedDevice = await request(baseUrl, '/api/device/tasks?deviceId=teste', {
      headers: { Authorization: 'Bearer segredo-errado' }
    });
    const allowedDevice = await request(baseUrl, '/api/device/tasks?deviceId=teste', {
      headers: { Authorization: `Bearer ${process.env.ALYA_DEVICE_SECRET}` }
    });
    assert(blockedDevice.status === 401, 'A ponte local aceitou um segredo incorreto.');
    assert(allowedDevice.status === 200, 'A ponte local recusou o segredo correto.');
    const blocked = await request(baseUrl, '/api/history/list');
    assert(blocked.status === 401, 'Rota privada aceitou acesso sem login.');
    const blockedCodePage = await request(baseUrl, '/code-alya.html');
    const blockedGamePage = await request(baseUrl, '/game.html');
    assert(blockedCodePage.status === 302 && blockedGamePage.status === 302, 'Uma página privada abriu sem login.');

    const invalid = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: admin, password: `${adminPassword}x` }
    });
    assert(invalid.status === 401 && invalid.data.error === INVALID_LOGIN_MESSAGE, 'Login incorreto revelou uma mensagem diferente.');

    const registration = await request(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '127.0.0.2' },
      body: { username: invited, password: invitedPassword }
    });
    assert(registration.status === 201 && registration.cookie, 'Cadastro individual não criou uma sessão.');

    const duplicateRegistration = await request(baseUrl, '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '127.0.0.2' },
      body: { username: invited, password: invitedPassword }
    });
    assert(duplicateRegistration.status === 400, 'Foi possível cadastrar o mesmo usuário duas vezes.');

    const adminLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: admin, password: adminPassword }
    });
    const friendLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: friend, password: friendPassword }
    });
    assert(adminLogin.status === 200 && adminLogin.cookie, 'O administrador não recebeu uma sessão.');
    assert(friendLogin.status === 200 && friendLogin.cookie, 'O amigo não recebeu uma sessão.');

    const adminUsers = await request(baseUrl, '/api/users/list', { cookie: adminLogin.cookie });
    const friendUsers = await request(baseUrl, '/api/users/list', { cookie: friendLogin.cookie });
    assert(adminUsers.status === 200, 'O administrador não acessou a gestão de contas.');
    assert(friendUsers.status === 403, 'Uma conta comum acessou a gestão administrativa.');
    const adminCodePage = await request(baseUrl, '/code-alya.html', { cookie: adminLogin.cookie });
    const friendCodePage = await request(baseUrl, '/code-alya.html', { cookie: friendLogin.cookie });
    assert(adminCodePage.status === 200, 'O administrador não acessou a Code Alya.');
    assert(friendCodePage.status === 302, 'Uma conta comum abriu a página administrativa.');

    await request(baseUrl, '/api/history/save', {
      method: 'POST',
      cookie: adminLogin.cookie,
      headers: { 'Content-Type': 'application/json' },
      body: { conversationId, messages: [{ role: 'user', content: 'histórico do administrador' }] }
    });
    await request(baseUrl, '/api/history/save', {
      method: 'POST',
      cookie: friendLogin.cookie,
      headers: { 'Content-Type': 'application/json' },
      body: { conversationId, messages: [{ role: 'user', content: 'histórico do amigo' }] }
    });
    const adminHistory = await request(baseUrl, `/api/history/load?conversationId=${conversationId}`, { cookie: adminLogin.cookie });
    const friendHistory = await request(baseUrl, `/api/history/load?conversationId=${conversationId}`, { cookie: friendLogin.cookie });
    assert(adminHistory.data.messages?.[0]?.content === 'histórico do administrador', 'Histórico do administrador foi misturado.');
    assert(friendHistory.data.messages?.[0]?.content === 'histórico do amigo', 'Histórico do amigo foi misturado.');

    await request(baseUrl, '/api/memory/remember', {
      method: 'POST',
      cookie: adminLogin.cookie,
      headers: { 'Content-Type': 'application/json' },
      body: { text: 'memória exclusiva do administrador', category: 'preferences' }
    });
    const friendMemories = await request(baseUrl, '/api/memory/all', { cookie: friendLogin.cookie });
    assert(!JSON.stringify(friendMemories.data).includes('memória exclusiva do administrador'), 'Memória vazou entre contas.');

    const adminFileUpload = await request(baseUrl, '/api/aly-file', {
      method: 'POST',
      cookie: adminLogin.cookie,
      headers: { 'Content-Type': 'application/json' },
      body: {
        name: 'arquivo-admin.txt',
        mime: 'text/plain',
        data: Buffer.from('arquivo exclusivo do administrador').toString('base64')
      }
    });
    const friendFileUpload = await request(baseUrl, '/api/aly-file', {
      method: 'POST',
      cookie: friendLogin.cookie,
      headers: { 'Content-Type': 'application/json' },
      body: {
        name: 'arquivo-amigo.txt',
        mime: 'text/plain',
        data: Buffer.from('arquivo exclusivo do amigo').toString('base64')
      }
    });
    assert(adminFileUpload.status === 200 && friendFileUpload.status === 200, 'Falha ao salvar arquivos de teste.');
    const adminFiles = await request(baseUrl, '/api/files', { cookie: adminLogin.cookie });
    const friendFiles = await request(baseUrl, '/api/files', { cookie: friendLogin.cookie });
    assert(adminFiles.data.files?.some((file) => file.name === 'arquivo-admin.txt'), 'Arquivo do administrador não foi salvo.');
    assert(!adminFiles.data.files?.some((file) => file.name === 'arquivo-amigo.txt'), 'Arquivo do amigo apareceu para o administrador.');
    assert(friendFiles.data.files?.some((file) => file.name === 'arquivo-amigo.txt'), 'Arquivo do amigo não foi salvo.');
    const crossFile = await request(
      baseUrl,
      `/api/files/download?id=${adminFileUpload.data.file.id}`,
      { cookie: friendLogin.cookie }
    );
    assert(crossFile.status === 404, 'Uma conta conseguiu baixar o arquivo de outra.');

    const logout = await request(baseUrl, '/api/auth/logout', {
      method: 'POST',
      cookie: adminLogin.cookie
    });
    assert(logout.status === 200 && /alya_session=$/.test(logout.cookie), 'Logout não encerrou a sessão.');
    const afterLogout = await request(baseUrl, '/api/history/list', { cookie: logout.cookie });
    assert(afterLogout.status === 401, 'A sessão continuou ativa depois do logout.');

    await stopServer(child);
    child = startServer(port);
    await waitForServer(baseUrl, child);
    const afterRestart = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: friend, password: friendPassword }
    });
    assert(afterRestart.status === 200, 'A conta deixou de funcionar após reiniciar o servidor.');

    const adminAfterRestart = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: admin, password: adminPassword }
    });
    const passwordChanged = await request(baseUrl, '/api/users/password', {
      method: 'POST',
      cookie: adminAfterRestart.cookie,
      headers: { 'Content-Type': 'application/json' },
      body: { username: friend, password: changedFriendPassword }
    });
    assert(passwordChanged.status === 200, 'Administrador não conseguiu trocar a senha.');
    const staleSession = await request(baseUrl, '/api/files', { cookie: afterRestart.cookie });
    assert(staleSession.status === 401, 'A sessão antiga continuou válida após trocar a senha.');
    const oldPasswordLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: friend, password: friendPassword }
    });
    const newPasswordLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: friend, password: changedFriendPassword }
    });
    assert(oldPasswordLogin.status === 401 && newPasswordLogin.status === 200, 'A troca de senha não invalidou a senha antiga.');

    const blockResult = await request(baseUrl, '/api/users/block', {
      method: 'POST',
      cookie: adminAfterRestart.cookie,
      headers: { 'Content-Type': 'application/json' },
      body: { username: friend, blocked: true }
    });
    assert(blockResult.status === 200, 'Administrador não conseguiu bloquear a conta.');
    const blockedLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: friend, password: changedFriendPassword }
    });
    assert(blockedLogin.status === 401, 'A conta bloqueada ainda conseguiu entrar.');
    const unblockResult = await request(baseUrl, '/api/users/block', {
      method: 'POST',
      cookie: adminAfterRestart.cookie,
      headers: { 'Content-Type': 'application/json' },
      body: { username: friend, blocked: false }
    });
    assert(unblockResult.status === 200, 'Administrador não conseguiu desbloquear a conta.');
    const deleteResult = await request(baseUrl, '/api/users/delete', {
      method: 'DELETE',
      cookie: adminAfterRestart.cookie,
      headers: { 'Content-Type': 'application/json' },
      body: { username: friend }
    });
    assert(deleteResult.status === 200, 'Administrador não conseguiu apagar a conta.');
    const deletedLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: friend, password: changedFriendPassword }
    });
    assert(deletedLogin.status !== 200, 'A conta apagada ainda conseguiu entrar.');

    process.stdout.write('Autenticação verificada: contas individuais, dados e arquivos isolados, senha, bloqueio, exclusão, logout e reinício.\n');
  } finally {
    await stopServer(child);
    cleanupUserData(admin, conversationId);
    cleanupUserData(friend, conversationId);
    cleanupUserData(invited, conversationId);
    cleanupUserData(minimumPasswordUser, conversationId);
    await store.flush();
  }
}

main().catch((error) => {
  process.stderr.write(`Falha no teste de autenticação: ${error.message}\n`);
  process.exitCode = 1;
});
