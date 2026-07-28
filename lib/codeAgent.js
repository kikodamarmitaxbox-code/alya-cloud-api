'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('./logger');
const persistentStore = require('./persistentStore');

const execAsync = promisify(exec);
const projectRoot = path.resolve(__dirname, '..');
const projectsRoot = path.join(projectRoot, 'projects');
const backupRoot = path.join(projectRoot, '.alya-code', 'panel-backups');
const actionHistoryFile = path.join(projectRoot, '.alya-code', 'panel-history.json');
const ignoredFolders = new Set([
  '.git', '.vault', '.alya-code', 'node_modules', 'dist', 'build', 'coverage', '.next'
]);
const protectedFile = /(^|[\\/])(\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/i;
const binaryExtension = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.mp3', '.wav', '.mp4', '.mov',
  '.zip', '.rar', '.7z', '.pdf', '.exe', '.dll', '.bin', '.woff', '.woff2', '.ttf'
]);
const pendingPlans = new Map();
const agentSessions = new Map();
const providerCooldowns = new Map();
const projectTreeCache = new Map();
const fileContentCache = new Map();
const MAX_ACTION_HISTORY = 40;
const CODE_PROVIDER_HEALTH_KEY = 'code-agent:provider-health';
const PLAN_STORE_PREFIX = 'code-plan:';
const SESSION_STORE_PREFIX = 'code-session:';

function normalizeProjectId(projectId) {
  const value = String(projectId || 'main').trim().toLowerCase();
  if (!value || value === 'main') return 'main';
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(value)) {
    throw new Error('Projeto inválido.');
  }
  return value;
}

function getSelectedProjectRoot(projectId = 'main') {
  const id = normalizeProjectId(projectId);
  if (id === 'main') return projectRoot;
  const selected = path.resolve(projectsRoot, id);
  const relative = path.relative(projectsRoot, selected);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Projeto fora do espaço permitido.');
  }
  if (!fs.existsSync(selected) || !fs.statSync(selected).isDirectory()) {
    throw new Error('Projeto não encontrado.');
  }
  return selected;
}

function listProjects() {
  const projects = [{
    id: 'main',
    name: 'Alya principal',
    description: 'Projeto principal da Alya'
  }];
  if (!fs.existsSync(projectsRoot)) return projects;
  const entries = fs.readdirSync(projectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[a-z0-9][a-z0-9_-]{0,47}$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    projects.push({
      id: entry.name.toLowerCase(),
      name: entry.name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
      description: 'Projeto separado'
    });
  }
  return projects;
}

function createProject(name) {
  const displayName = String(name || '').trim().slice(0, 60);
  const id = displayName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (!id || id === 'main') throw new Error('Escolha outro nome para o projeto.');
  const target = path.resolve(projectsRoot, id);
  const relative = path.relative(projectsRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Nome de projeto inválido.');
  }
  if (fs.existsSync(target)) throw new Error('Já existe um projeto com esse nome.');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(
    path.join(target, 'README.md'),
    `# ${displayName}\n\nProjeto criado pela Code Alya.\n`,
    'utf8'
  );
  invalidateProjectCache(id);
  return {
    ok: true,
    project: {
      id,
      name: displayName,
      description: 'Projeto separado'
    }
  };
}

function readActionHistory() {
  try {
    if (!fs.existsSync(actionHistoryFile)) return [];
    const parsed = JSON.parse(fs.readFileSync(actionHistoryFile, 'utf8'));
    return Array.isArray(parsed) ? parsed.slice(-MAX_ACTION_HISTORY) : [];
  } catch {
    return [];
  }
}

function writeActionHistory(history) {
  fs.mkdirSync(path.dirname(actionHistoryFile), { recursive: true });
  const temporaryFile = `${actionHistoryFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(history.slice(-MAX_ACTION_HISTORY), null, 2), 'utf8');
  fs.renameSync(temporaryFile, actionHistoryFile);
}

function recordAction(entry) {
  const history = readActionHistory();
  history.push(entry);
  writeActionHistory(history);
  return entry;
}

function sanitizeProviderError(error) {
  return String(error?.message || error || 'Falha desconhecida')
    .replace(/api_key:[^\s'"}]+/gi, 'api_key:[oculta]')
    .replace(/(?:sk|csk|gsk|nvapi|cfat|key)[-_][A-Za-z0-9_-]{16,}/gi, '[chave oculta]')
    .replace(/AQ\.[A-Za-z0-9_-]{16,}/g, '[chave oculta]')
    .replace(/AIza[A-Za-z0-9_-]{16,}/g, '[chave oculta]')
    .slice(0, 500);
}

function providerTimeout() {
  const configured = Number(process.env.ALYA_CODE_TIMEOUT_MS || 18000);
  return Math.min(45000, Math.max(8000, Number.isFinite(configured) ? configured : 18000));
}

function requestSignal(externalSignal) {
  const timeoutSignal = AbortSignal.timeout(providerTimeout());
  if (!externalSignal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([externalSignal, timeoutSignal]);
  return timeoutSignal;
}

function relativePath(filePath, selectedRoot = projectRoot) {
  return path.relative(selectedRoot, filePath).replace(/\\/g, '/');
}

function resolveSafePath(requestedPath, projectId = 'main') {
  const selectedProjectId = normalizeProjectId(projectId);
  const selectedRoot = getSelectedProjectRoot(selectedProjectId);
  const clean = String(requestedPath || '').trim().replace(/^["']|["']$/g, '');
  if (!clean) throw new Error('Escolha um arquivo do projeto.');
  const resolved = path.resolve(selectedRoot, clean);
  const relative = path.relative(selectedRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Caminho fora do projeto bloqueado.');
  }
  if (selectedProjectId === 'main' && relative.split(path.sep)[0] === 'projects') {
    throw new Error('Escolha o projeto correto antes de abrir esse arquivo.');
  }
  if (relative.split(path.sep).some((part) => ignoredFolders.has(part))) {
    throw new Error('Pasta interna protegida.');
  }
  if (protectedFile.test(relative)) throw new Error('Arquivo secreto protegido.');
  return resolved;
}

function invalidateProjectCache(projectId = 'main') {
  const normalized = normalizeProjectId(projectId);
  projectTreeCache.delete(normalized);
  for (const key of fileContentCache.keys()) {
    if (key.startsWith(`${normalized}:`)) fileContentCache.delete(key);
  }
}

function getProjectTree(limit = 500, projectId = 'main') {
  const normalizedProjectId = normalizeProjectId(projectId);
  const cached = projectTreeCache.get(normalizedProjectId);
  if (cached && Date.now() - cached.createdAt < 15000) {
    return cached.files.slice(0, limit);
  }
  const selectedRoot = getSelectedProjectRoot(projectId);
  const files = [];
  function walk(directory) {
    if (files.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= limit) break;
      if (ignoredFolders.has(entry.name)) continue;
      if (selectedRoot === projectRoot && directory === projectRoot && entry.name === 'projects') continue;
      const fullPath = path.join(directory, entry.name);
      const relative = relativePath(fullPath, selectedRoot);
      if (protectedFile.test(relative)) continue;
      if (entry.isDirectory()) walk(fullPath);
      else files.push(relative);
    }
  }
  walk(selectedRoot);
  projectTreeCache.set(normalizedProjectId, { createdAt: Date.now(), files });
  return files.slice(0, limit);
}

function readProjectFile(requestedPath, maxLength = 50000, projectId = 'main') {
  const selectedRoot = getSelectedProjectRoot(projectId);
  const filePath = resolveSafePath(requestedPath, projectId);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error('Arquivo não encontrado.');
  }
  if (binaryExtension.has(path.extname(filePath).toLowerCase())) {
    throw new Error('Esse arquivo não pode ser aberto no editor de texto.');
  }
  const selectedProjectId = normalizeProjectId(projectId);
  const cacheKey = `${selectedProjectId}:${relativePath(filePath, selectedRoot)}`;
  const stat = fs.statSync(filePath);
  const cached = fileContentCache.get(cacheKey);
  const content = cached && cached.modifiedAt === stat.mtimeMs && cached.size === stat.size
    ? cached.content
    : fs.readFileSync(filePath, 'utf8');
  if (!cached || cached.modifiedAt !== stat.mtimeMs || cached.size !== stat.size) {
    fileContentCache.set(cacheKey, {
      modifiedAt: stat.mtimeMs,
      size: stat.size,
      content
    });
  }
  return {
    path: relativePath(filePath, selectedRoot),
    content: content.length > maxLength
      ? `${content.slice(0, maxLength)}\n\n[conteúdo cortado no painel]`
      : content,
    truncated: content.length > maxLength
  };
}

function codeSystemPrompt() {
  return `Você é Code Alya, uma agente profissional de programação dentro de um painel visual.
Analise o pedido, leia os arquivos necessários, proponha alterações pequenas e completas e sugira validações.

REGRAS:
- Responda SOMENTE com JSON válido, sem markdown e sem texto antes ou depois.
- Converse diretamente com Pedro, como uma parceira de programação. Nunca diga "o usuário" nem descreva a conversa em terceira pessoa.
- Para cumprimentos ou perguntas sem pedido de mudança, responda curta e naturalmente em "summary" e use apenas "done". Exemplo: para "oi", responda "Oi, Pedro! O que vamos criar hoje?".
- Quando Pedro pedir uma mudança, nunca responda apenas "done" nem prometa que vai alterar sem incluir ações. Use "read" se precisar analisar, depois "write" e "command" para preparar e verificar a mudança.
- Lembre do histórico desta conversa e use-o para continuar a tarefa, sem pedir a mesma informação duas vezes.
- Nunca acesse .env, credenciais, tokens, chaves privadas, .vault ou caminhos fora do projeto.
- Se precisar do conteúdo de um arquivo não fornecido, use uma ação {"type":"read","path":"..."}.
- Para mudanças pequenas em arquivos existentes, prefira {"type":"patch","path":"arquivo","find":"trecho exato atual","replace":"novo trecho"}.
- Use o conteúdo COMPLETO do arquivo em uma ação "write" apenas para arquivos novos ou quando uma alteração por trecho não for segura.
- Preserve a arquitetura e o estilo existentes.
- Não invente resultados de testes.
- Antes da execução, "summary" deve explicar o que você PRETENDE verificar ou alterar. Nunca diga que analisou logs, executou testes ou encontrou erros se essas ações ainda não foram realmente executadas.
- Se Pedro pedir somente análise e proibir alterações, não use ações "write". Sugira apenas comandos seguros de verificação quando eles forem necessários.
- Nunca use comandos destrutivos ou interativos. Para instalar um pacote, testar, fazer commit ou enviar ao Git, proponha o comando na lista: ele só será executado depois da aprovação explícita do Pedro.
- Use no máximo 8 ações.

FORMATO:
{
  "summary": "explicação curta em português",
  "actions": [
    {"type":"read","path":"arquivo"},
    {"type":"patch","path":"arquivo","find":"trecho exato atual","replace":"novo trecho"},
    {"type":"write","path":"arquivo","content":"conteúdo completo"},
    {"type":"command","command":"node --check arquivo.js"},
    {"type":"command","command":"npm install nome-do-pacote"},
    {"type":"command","command":"git add arquivo.js"},
    {"type":"command","command":"git commit -m \"mensagem\""},
    {"type":"command","command":"git push origin main"},
    {"type":"done"}
  ]
}`;
}

function parsePlan(text) {
  const clean = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const candidates = [clean];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < clean.length; index += 1) {
    const character = clean[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(clean.slice(start, index + 1));
        start = -1;
      }
    }
  }

  for (const candidate of [...new Set(candidates)]) {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      if (!('summary' in parsed) && !('message' in parsed) && !('actions' in parsed)) continue;
      return {
        summary: String(parsed.summary || parsed.message || 'Plano preparado.').slice(0, 1200),
        actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 8) : []
      };
    } catch {
      // Tenta o próximo objeto JSON encontrado na resposta.
    }
  }
  throw new Error('A IA não devolveu um plano válido.');
}

function fallbackPlan(text) {
  const clean = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?|```/gi, '')
    .trim();
  const summaryMatch = clean.match(/["']?summary["']?\s*:\s*["“]([^"\n}”]{1,1200})/i);
  const plainSummary = (
    summaryMatch?.[1] ||
    (/^[^{}[\]]{8,1200}$/.test(clean) ? clean : '')
  ).trim();
  return {
    summary: plainSummary || 'O modelo respondeu fora do formato esperado. Nenhuma alteração foi aplicada; reformule o pedido ou tente novamente.',
    actions: []
  };
}

function looksLikeChangeRequest(task) {
  return /\b(crie|criar|corrija|corrigir|conserte|consertar|adicione|adicionar|remova|remover|altere|alterar|mude|mudar|melhore|melhorar|otimize|otimizar|deixe|implemente|implementar)\b/i
    .test(String(task || ''));
}

function hasActionablePlan(actions) {
  return (Array.isArray(actions) ? actions : [])
    .some((action) => ['read', 'write', 'command'].includes(String(action?.type || '').toLowerCase()));
}

function chooseFilesForInspection(projectId = 'main') {
  const files = getProjectTree(500, projectId);
  const preferred = [
    'package.json',
    'server.js',
    'app.js',
    'src/index.js',
    'src/app.js',
    'public/aly.js',
    'lib/chat.js'
  ];
  const selected = preferred.filter((file) => files.includes(file));
  for (const file of files) {
    if (selected.length >= 4) break;
    if (
      !selected.includes(file) &&
      /\.(?:js|mjs|cjs|ts|tsx|jsx|json|html|css|py)$/i.test(file)
    ) {
      selected.push(file);
    }
  }
  return selected.slice(0, 4).map((file) => ({ type: 'read', path: file }));
}

function taskWords(task) {
  return [...new Set(
    String(task || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .match(/[a-z0-9_-]{3,}/g) || []
  )].filter((word) => ![
    'para', 'como', 'mais', 'uma', 'isso', 'esse', 'essa', 'quero', 'fazer',
    'deixe', 'melhorar', 'corrigir', 'criar', 'adicione', 'projeto'
  ].includes(word));
}

function getRelevantProjectFiles(task, contextFiles = [], projectId = 'main', limit = 140) {
  const files = getProjectTree(500, projectId);
  const words = taskWords(task);
  const opened = new Set(contextFiles || []);
  return files
    .map((file, index) => {
      const normalized = file.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const base = path.basename(normalized, path.extname(normalized));
      let score = Math.max(0, 30 - Math.floor(index / 12));
      if (opened.has(file)) score += 1000;
      if (['package.json', 'server.js', 'app.js', 'src/index.js', 'src/app.js'].includes(file)) score += 80;
      if (/\.(?:js|mjs|cjs|ts|tsx|jsx|json|html|css|py)$/i.test(file)) score += 20;
      for (const word of words) {
        if (base.includes(word)) score += 90;
        else if (normalized.includes(word)) score += 35;
      }
      return { file, score };
    })
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, limit)
    .map((entry) => entry.file);
}

async function callGemini(prompt, signal) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini não configurado');
  const model = process.env.ALYA_CODE_MODEL || process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: codeSystemPrompt() }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: Number(process.env.ALYA_CODE_MAX_TOKENS || 6000)
        }
      }),
      signal: requestSignal(signal)
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Gemini respondeu ${response.status}`);
  return {
    model,
    text: data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || ''
  };
}

async function callCompatibleProvider(provider, prompt, signal) {
  const configs = {
    deepseek: {
      key: process.env.DEEPSEEK_API_KEY,
      url: 'https://api.deepseek.com/chat/completions',
      model: process.env.DEEPSEEK_CODE_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
    },
    mistral: {
      key: process.env.MISTRAL_API_KEY,
      url: 'https://api.mistral.ai/v1/chat/completions',
      model: process.env.MISTRAL_CODE_MODEL || process.env.MISTRAL_MODEL || 'mistral-small-latest'
    },
    nvidia: {
      key: process.env.NVIDIA_API_KEY,
      url: 'https://integrate.api.nvidia.com/v1/chat/completions',
      model: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b'
    },
    openrouter: {
      key: process.env.OPENROUTER_API_KEY,
      url: 'https://openrouter.ai/api/v1/chat/completions',
      model: process.env.OPENROUTER_CODE_MODEL || process.env.OPENROUTER_MODEL || 'openrouter/free'
    }
  };
  const config = configs[provider];
  if (!config?.key) throw new Error(`${provider} não configurado`);
  const payload = {
    model: config.model,
    messages: [
      { role: 'system', content: codeSystemPrompt() },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    max_tokens: Number(process.env.ALYA_CODE_MAX_TOKENS || 6000)
  };
  if (provider === 'openrouter') {
    payload.plugins = [{ id: 'response-healing' }];
  }
  let response = await fetch(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: requestSignal(signal)
  });
  let data = await response.json().catch(() => ({}));
  // Alguns modelos gratuitos do OpenRouter não aceitam response_format.
  // O prompt ainda exige JSON, então tentamos uma segunda vez sem esse campo.
  if (!response.ok && provider === 'openrouter') {
    delete payload.response_format;
    delete payload.plugins;
    response = await fetch(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'Code Alya'
      },
      body: JSON.stringify(payload),
      signal: requestSignal(signal)
    });
    data = await response.json().catch(() => ({}));
  }
  if (!response.ok) throw new Error(data.error?.message || `${provider} respondeu ${response.status}`);
  return { model: config.model, text: data.choices?.[0]?.message?.content || '' };
}

function codeProviderIsConfigured(provider) {
  return Boolean({
    gemini: process.env.GEMINI_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
    nvidia: process.env.NVIDIA_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY
  }[provider]);
}

function readCodeProviderHealth() {
  const value = persistentStore.get(CODE_PROVIDER_HEALTH_KEY, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function recordCodeProviderResult(provider, ok, latency, error = '') {
  const health = readCodeProviderHealth();
  const previous = health[provider] || {};
  const failures = ok ? 0 : Number(previous.failures || 0) + 1;
  health[provider] = {
    ok,
    failures,
    averageLatency: previous.averageLatency
      ? Math.round((Number(previous.averageLatency) * 0.7) + (latency * 0.3))
      : Math.round(latency),
    retryAt: ok ? 0 : Date.now() + Math.min(300000, 15000 * (2 ** Math.min(failures - 1, 4))),
    error: ok ? '' : sanitizeProviderError(error),
    updatedAt: new Date().toISOString()
  };
  persistentStore.set(CODE_PROVIDER_HEALTH_KEY, health);
  if (ok) providerCooldowns.delete(provider);
  else providerCooldowns.set(provider, health[provider].retryAt);
}

function waitForHedge(delay, signal) {
  if (!delay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Tentativa cancelada'));
    }, { once: true });
  });
}

async function askModel(prompt, options = {}) {
  const preferred = String(process.env.ALYA_CODE_PROVIDER || process.env.AI_PROVIDER || '')
    .trim()
    .toLowerCase();
  const excludedProviders = new Set(options.excludeProviders || []);
  const configuredOrder = String(process.env.ALYA_CODE_FALLBACKS || '')
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);
  const baseOrder = [...new Set([
    preferred,
    ...configuredOrder,
    'openrouter',
    'mistral',
    'gemini',
    'nvidia',
    'deepseek'
  ].filter((provider) => (
    provider &&
    !excludedProviders.has(provider) &&
    codeProviderIsConfigured(provider)
  )))];
  if (!baseOrder.length) throw new Error('Nenhum modelo de programação está configurado.');

  const health = readCodeProviderHealth();
  const now = Date.now();
  let providers = baseOrder
    .filter((provider) => Math.max(
      Number(health[provider]?.retryAt || 0),
      Number(providerCooldowns.get(provider) || 0)
    ) <= now);
  if (!providers.length) {
    providers = [...baseOrder].sort((a, b) => (
      Number(health[a]?.retryAt || 0) - Number(health[b]?.retryAt || 0)
    )).slice(0, 1);
  }
  providers.sort((a, b) => {
    const score = (provider) => (
      (provider === preferred ? -3000 : 0) +
      Number(health[provider]?.averageLatency || 10000) +
      (Number(health[provider]?.failures || 0) * 4000) +
      (baseOrder.indexOf(provider) * 250)
    );
    return score(a) - score(b);
  });

  const hedgeLimit = Math.min(
    providers.length,
    Math.max(1, Math.min(3, Number(process.env.ALYA_CODE_HEDGE_MAX || 2)))
  );
  const hedgeDelay = Math.max(500, Math.min(8000, Number(process.env.ALYA_CODE_HEDGE_DELAY_MS || 2200)));
  providers = providers.slice(0, hedgeLimit);
  const groupController = new AbortController();
  const errors = [];
  let releaseBackups;
  const startBackupsNow = new Promise((resolve) => { releaseBackups = resolve; });
  const attempts = providers.map(async (provider, index) => {
    if (index > 0) {
      await Promise.race([
        waitForHedge(index * hedgeDelay, groupController.signal),
        startBackupsNow
      ]);
    }
    options.onProgress?.(
      index === 0
        ? `Consultando ${provider}...`
        : `${provider} entrou como modelo de reserva...`
    );
    const startedAt = Date.now();
    try {
      const result = provider === 'gemini'
        ? await callGemini(prompt, groupController.signal)
        : await callCompatibleProvider(provider, prompt, groupController.signal);
      recordCodeProviderResult(provider, true, Date.now() - startedAt);
      return { ...result, provider };
    } catch (error) {
      const safeError = sanitizeProviderError(error);
      errors.push(`${provider}: ${safeError}`);
      if (!/cancelada|aborted/i.test(safeError)) {
        recordCodeProviderResult(provider, false, Date.now() - startedAt, safeError);
      }
      if (index === 0) releaseBackups();
      throw error;
    }
  });
  try {
    const winner = await Promise.any(attempts);
    groupController.abort();
    return winner;
  } catch {
    groupController.abort();
  }
  if (errors.length) logger.warn(`Code Alya sem provedor disponível: ${errors.join(' • ')}`);
  throw new Error(
    errors.length
      ? 'Os modelos de programação não responderam agora. A Code Alya tentou as opções configuradas; aguarde um pouco e tente novamente.'
      : 'Os modelos estão em pausa por alguns instantes. Tente novamente em breve.'
  );
}

async function askForValidPlan(prompt, options = {}) {
  let response = await askModel(prompt, options);
  try {
    return { response, plan: parsePlan(response.text) };
  } catch {
    options.onProgress?.('Ajustando o formato do plano...');
    const repairPrompt = `${prompt}

CORREÇÃO DE FORMATO:
Responda agora SOMENTE com um objeto JSON curto e válido.
Exemplo: {"summary":"o que será feito","actions":[{"type":"command","command":"npm run verify"}]}
Use uma ação {"type":"done"} quando nenhuma mudança for necessária. Não use markdown ou texto fora do JSON.`;
    try {
      response = await askModel(repairPrompt, {
        ...options,
        excludeProviders: [response.provider]
      });
    } catch {
      response = await askModel(repairPrompt, options);
    }
    try {
      return { response, plan: parsePlan(response.text) };
    } catch {
      return { response, plan: fallbackPlan(response.text) };
    }
  }
}

function buildPrompt(task, contextFiles, extraContext = '', history = [], projectId = 'main') {
  const sections = [];
  for (const requestedPath of [...new Set(contextFiles || [])].slice(0, 6)) {
    try {
      const file = readProjectFile(requestedPath, 18000, projectId);
      sections.push(`\n--- ${file.path} ---\n${file.content}`);
    } catch {
      // Arquivos inválidos apenas deixam de entrar no contexto.
    }
  }
  const conversation = Array.isArray(history)
    ? history
      .filter((item) => item && ['user', 'assistant'].includes(item.role))
      .slice(-10)
      .map((item) => `${item.role === 'user' ? 'PEDRO' : 'ALYA'}: ${String(item.content || '').slice(0, 1600)}`)
      .join('\n')
    : '';
  return `HISTÓRICO DA CONVERSA:\n${conversation || 'Esta é a primeira mensagem.'}

PEDIDO ATUAL DO PEDRO:\n${String(task).slice(0, 4000)}

ARQUIVOS DO PROJETO:
${getRelevantProjectFiles(task, contextFiles, projectId).join('\n')}

ARQUIVOS ABERTOS:
${sections.join('\n') || 'Nenhum arquivo aberto.'}

INFORMAÇÕES ADICIONAIS:
${extraContext || 'Nenhuma.'}`;
}

function normalizeActions(actions, projectId = 'main') {
  const selectedRoot = getSelectedProjectRoot(projectId);
  const normalized = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    const type = String(action?.type || '').toLowerCase();
    try {
      if (
        type === 'patch' &&
        action.path &&
        typeof action.find === 'string' &&
        typeof action.replace === 'string'
      ) {
        if (!action.find || action.find.length > 50000 || action.replace.length > 100000) {
          throw new Error('Alteração por trecho inválida.');
        }
        const filePath = resolveSafePath(action.path, projectId);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          throw new Error('Arquivo da alteração não encontrado.');
        }
        const currentContent = fs.readFileSync(filePath, 'utf8');
        const occurrences = currentContent.split(action.find).length - 1;
        if (occurrences !== 1) {
          throw new Error('O trecho precisa existir uma única vez no arquivo.');
        }
        normalized.push({
          type: 'write',
          path: relativePath(filePath, selectedRoot),
          content: currentContent.replace(action.find, action.replace)
        });
      } else if (type === 'write' && action.path && typeof action.content === 'string') {
        const filePath = resolveSafePath(action.path, projectId);
        normalized.push({
          type,
          path: relativePath(filePath, selectedRoot),
          content: action.content
        });
      } else if (type === 'command' && action.command) {
        normalized.push({ type, command: validateCommand(action.command) });
      }
    } catch {
      // O modelo pode sugerir uma ação fora da lista segura. Ignoramos só essa
      // ação, mantendo a conversa e o restante do plano funcionando.
    }
  }
  return normalized;
}

function createChangePreview(action, projectId = 'main') {
  const filePath = resolveSafePath(action.path, projectId);
  const existed = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  const previousContent = existed ? fs.readFileSync(filePath, 'utf8') : '';
  const beforeLines = previousContent ? previousContent.split(/\r?\n/) : [];
  const afterLines = action.content ? action.content.split(/\r?\n/) : [];
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) prefix += 1;

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) suffix += 1;

  const removedLines = Math.max(0, beforeLines.length - prefix - suffix);
  const addedLines = Math.max(0, afterLines.length - prefix - suffix);
  const previewStart = Math.max(0, prefix - 2);
  const previewEnd = Math.min(afterLines.length, prefix + Math.max(addedLines, 1) + 2);

  return {
    path: action.path,
    status: existed ? 'modify' : 'create',
    beforeLines: beforeLines.length,
    afterLines: afterLines.length,
    addedLines,
    removedLines,
    snippet: afterLines.slice(previewStart, previewEnd).join('\n').slice(0, 6000)
  };
}

function persistPlan(plan) {
  pendingPlans.set(plan.id, plan);
  persistentStore.set(`${PLAN_STORE_PREFIX}${plan.id}`, plan);
}

function getPendingPlan(planId) {
  const id = String(planId || '');
  const stored = pendingPlans.get(id) || persistentStore.get(`${PLAN_STORE_PREFIX}${id}`, null);
  if (stored) pendingPlans.set(id, stored);
  return stored;
}

function removePendingPlan(planId) {
  const id = String(planId || '');
  pendingPlans.delete(id);
  persistentStore.remove(`${PLAN_STORE_PREFIX}${id}`);
}

function persistAgentSession(session) {
  agentSessions.set(session.id, session);
  persistentStore.set(`${SESSION_STORE_PREFIX}${session.id}`, session);
}

function getAgentSession(sessionId) {
  const id = String(sessionId || '');
  const stored = agentSessions.get(id) || persistentStore.get(`${SESSION_STORE_PREFIX}${id}`, null);
  if (stored) agentSessions.set(id, stored);
  return stored;
}

async function createCodePlan(task, contextFiles = [], history = [], options = {}) {
  const cleanTask = String(task || '').trim();
  if (!cleanTask) throw new Error('Conte para a Code Alya o que você quer criar.');
  const projectId = normalizeProjectId(options.projectId);
  getSelectedProjectRoot(projectId);
  const autoMode = options.autoMode === true;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const sessionId = String(options.sessionId || crypto.randomUUID());
  const extraContext = String(options.extraContext || '').slice(0, 24000);

  onProgress('Mapeando somente os arquivos importantes...');
  const prompt = buildPrompt(cleanTask, contextFiles, extraContext, history, projectId);
  onProgress('Escolhendo o modelo mais rápido disponível...');
  let { response, plan } = await askForValidPlan(prompt, { onProgress });
  if (!hasActionablePlan(plan.actions) && looksLikeChangeRequest(cleanTask)) {
    onProgress('Pedindo ações concretas ao modelo...');
    ({ response, plan } = await askForValidPlan(`${prompt}

O pedido exige uma mudança no projeto. Não use apenas "done" e não prometa alterações sem ações.
Se ainda precisa entender o código, devolva ações "read". Caso já saiba a correção, devolva ações "patch" ou "write" e comandos seguros de teste.`, { onProgress }));
  }
  if (!hasActionablePlan(plan.actions) && looksLikeChangeRequest(cleanTask)) {
    const inspectionActions = chooseFilesForInspection(projectId);
    if (inspectionActions.length) {
      plan = {
        summary: 'Vou analisar os principais arquivos do projeto antes de preparar a mudança.',
        actions: inspectionActions
      };
    }
  }
  const requestedReads = plan.actions
    .filter((action) => String(action?.type).toLowerCase() === 'read' && action.path)
    .map((action) => action.path)
    .slice(0, 6);

  if (requestedReads.length) {
    onProgress(`Lendo ${requestedReads.length} arquivo(s) necessário(s)...`);
    ({ response, plan } = await askForValidPlan(buildPrompt(
      cleanTask,
      [...contextFiles, ...requestedReads],
      `${extraContext}\n\nOs arquivos pedidos já foram carregados. Como este é um pedido de mudança, devolva o plano final com pelo menos uma ação "write" ou "command". Não responda apenas "done" e não prometa uma mudança sem incluir as ações.`,
      history,
      projectId
    ), { onProgress }));
  }
  if (!hasActionablePlan(plan.actions) && looksLikeChangeRequest(cleanTask)) {
    plan = {
      summary: 'O modelo não preparou uma alteração segura. Vou verificar o projeto primeiro, sem modificar arquivos.',
      actions: [{ type: 'command', command: 'npm run verify' }]
    };
  }

  const actions = normalizeActions(plan.actions, projectId);
  const existingSession = getAgentSession(sessionId);
  const session = existingSession || {
    id: sessionId,
    task: cleanTask,
    contextFiles: [...new Set(contextFiles || [])].slice(0, 6),
    history: Array.isArray(history) ? history.slice(-20) : [],
    projectId,
    autoMode,
    round: 0,
    createdAt: Date.now(),
    lastExecution: null
  };
  session.autoMode = autoMode || session.autoMode;
  session.projectId = projectId;
  session.updatedAt = Date.now();
  persistAgentSession(session);
  if (!actions.length) {
    session.completedAt = Date.now();
    persistAgentSession(session);
    onProgress('Resposta pronta.');
    return {
      ok: true,
      planId: null,
      sessionId,
      sessionComplete: true,
      model: response.model,
      provider: response.provider,
      summary: plan.summary,
      actions: [],
      preview: []
    };
  }

  const planId = crypto.randomUUID();
  const storedPlan = {
    id: planId,
    task: cleanTask,
    model: response.model,
    provider: response.provider,
    summary: plan.summary,
    actions,
    projectId,
    sessionId,
    createdAt: Date.now()
  };
  persistPlan(storedPlan);
  cleanupPlans();
  onProgress('Plano pronto para sua revisão.');

  return {
    ok: true,
    planId,
    sessionId,
    sessionComplete: false,
    model: response.model,
    provider: response.provider,
    summary: storedPlan.summary,
    actions: actions.map((action) => (
      action.type === 'write'
        ? { type: 'write', path: action.path, lines: action.content.split(/\r?\n/).length }
        : action
    )),
    preview: actions
      .filter((action) => action.type === 'write')
      .map((action) => createChangePreview(action, projectId))
  };
}

function cleanupPlans() {
  const cutoff = Date.now() - (30 * 60 * 1000);
  for (const [id, plan] of pendingPlans.entries()) {
    if (plan.createdAt < cutoff) removePendingPlan(id);
  }
  for (const key of persistentStore.keys(PLAN_STORE_PREFIX)) {
    const plan = persistentStore.get(key, null);
    if (!plan || plan.createdAt < cutoff) persistentStore.remove(key);
  }
  const sessionCutoff = Date.now() - (2 * 60 * 60 * 1000);
  for (const [id, session] of agentSessions.entries()) {
    if ((session.updatedAt || session.createdAt) < sessionCutoff) {
      agentSessions.delete(id);
      persistentStore.remove(`${SESSION_STORE_PREFIX}${id}`);
    }
  }
  for (const key of persistentStore.keys(SESSION_STORE_PREFIX)) {
    const session = persistentStore.get(key, null);
    if (!session || (session.updatedAt || session.createdAt) < sessionCutoff) {
      persistentStore.remove(key);
    }
  }
}

function createBackup(filePath, sessionId = crypto.randomUUID(), projectId = 'main') {
  const selectedRoot = getSelectedProjectRoot(projectId);
  const relative = relativePath(filePath, selectedRoot);
  const destination = path.join(backupRoot, projectId, sessionId, relative);
  const existed = fs.existsSync(filePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (existed) fs.copyFileSync(filePath, destination);
  return {
    path: relative,
    backup: relativePath(destination),
    existed,
    projectId
  };
}

function restoreBackups(backups, fallbackProjectId = 'main') {
  const restoredFiles = [];
  for (const snapshot of [...(backups || [])].reverse()) {
    const projectId = normalizeProjectId(snapshot.projectId || fallbackProjectId);
    const target = resolveSafePath(snapshot.path, projectId);
    const backup = path.resolve(projectRoot, String(snapshot.backup || ''));
    const backupRelative = path.relative(backupRoot, backup);
    if (backupRelative.startsWith('..') || path.isAbsolute(backupRelative)) {
      throw new Error('Backup inválido bloqueado.');
    }
    if (snapshot.existed) {
      if (!fs.existsSync(backup)) throw new Error(`Backup ausente para ${snapshot.path}.`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(backup, target);
    } else if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
    invalidateProjectCache(projectId);
    restoredFiles.push(snapshot.path);
  }
  return [...new Set(restoredFiles)];
}

function validateCommand(command) {
  const value = String(command || '').trim();
  if (!value || value.length > 300) throw new Error('Comando inválido.');
  if (/[;&|><`]/.test(value) || value.includes('$(')) {
    throw new Error('Comando combinado bloqueado.');
  }
  if (
    /(?:^|[\s"'=])(?:\.env(?:\.[^\s"'=]*)?|\.git(?:[\\/]|$)|\.alya-code(?:[\\/]|$)|node_modules(?:[\\/]|$)|credentials?|secrets?)(?:[\s"'=\\/]|$)/i.test(value)
  ) {
    throw new Error('Comando com arquivo ou pasta protegida bloqueado.');
  }
  if (/^rg\b/i.test(value) && /\s(?:--hidden|--no-ignore|-u{2,3})(?:\s|$)/i.test(value)) {
    throw new Error('Pesquisa que ignora as proteções do projeto bloqueada.');
  }
  const allowed = [
    /^node\s+--check\s+[\w./\\-]+$/i,
    /^node\s+scripts[\\/]verify\.js$/i,
    /^npm\s+(test|run\s+[\w:-]+)(?:\s+--\s+[\w./\\-]+)*$/i,
    /^npm\s+audit(?:\s+--omit=dev)?$/i,
    /^npm\s+install\s+(?:@[\w.-]+\/)?[\w.-]+(?:\s+(?:@[\w.-]+\/)?[\w.-]+)*$/i,
    /^git\s+(status|diff|log)(?:\s+[\w./\\="'-]+)*$/i,
    /^git\s+add\s+(?:[\w./\\-]+\s*)+$/i,
    /^git\s+commit\s+-m\s+["'][^"'`;&|<>]{1,160}["']$/i,
    /^git\s+push\s+origin\s+main$/i,
    /^rg(?:\s+[\w./\\="'*?:-]+)+$/i
  ];
  if (!allowed.some((pattern) => pattern.test(value))) {
    throw new Error('Esse comando não está na lista segura da Code Alya.');
  }
  return value;
}

async function runSafeCommand(command, projectId = 'main') {
  const safeCommand = validateCommand(command);
  const selectedRoot = getSelectedProjectRoot(projectId);
  try {
    const result = await execAsync(safeCommand, {
      cwd: selectedRoot,
      timeout: 60000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    });
    return {
      ok: true,
      command: safeCommand,
      output: `${result.stdout || ''}${result.stderr || ''}`.trim().slice(0, 20000)
    };
  } catch (error) {
    return {
      ok: false,
      command: safeCommand,
      output: `${error.stdout || ''}${error.stderr || ''}${error.message || ''}`.trim().slice(0, 20000)
    };
  }
}

function focusedValidationCommands(changedFiles, projectId = 'main', existingCommands = []) {
  const selectedRoot = getSelectedProjectRoot(projectId);
  const commands = [];
  for (const file of [...new Set(changedFiles || [])]) {
    if (
      /\.(?:js|mjs|cjs)$/i.test(file) &&
      /^[\w./\\-]+$/.test(file) &&
      fs.existsSync(resolveSafePath(file, projectId))
    ) {
      commands.push(`node --check ${file}`);
    }
    if (commands.length >= 4) break;
  }
  const packagePath = path.join(selectedRoot, 'package.json');
  if (fs.existsSync(packagePath)) {
    try {
      const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      if (packageData.scripts?.verify) commands.push('npm run verify');
      else if (
        packageData.scripts?.test &&
        !/no test specified/i.test(String(packageData.scripts.test))
      ) commands.push('npm test');
    } catch {
      // O teste de sintaxe específico continuará disponível mesmo com package.json inválido.
    }
  }
  const existing = new Set(existingCommands || []);
  return [...new Set(commands)].filter((command) => !existing.has(command)).slice(0, 5);
}

async function applyCodePlan(planId) {
  cleanupPlans();
  const plan = getPendingPlan(planId);
  if (!plan) throw new Error('Esse plano expirou. Peça novamente à Code Alya.');

  const changedFiles = [];
  const commandResults = [];
  const backups = [];
  const backedUpPaths = new Set();
  const actionId = crypto.randomUUID();
  const projectId = normalizeProjectId(plan.projectId);
  getSelectedProjectRoot(projectId);

  try {
    for (const action of plan.actions) {
      if (action.type !== 'write') continue;
      const filePath = resolveSafePath(action.path, projectId);
      if (!backedUpPaths.has(action.path)) {
        backups.push(createBackup(filePath, actionId, projectId));
        backedUpPaths.add(action.path);
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, action.content, 'utf8');
      invalidateProjectCache(projectId);
      changedFiles.push(action.path);
    }
  } catch (error) {
    restoreBackups(backups, projectId);
    throw new Error(`A alteração falhou e foi desfeita automaticamente: ${error.message}`);
  }

  for (const action of plan.actions) {
    if (action.type === 'command') {
      if (/^npm\s+install\b/i.test(action.command)) {
        for (const dependencyFile of ['package.json', 'package-lock.json']) {
          const dependencyPath = resolveSafePath(dependencyFile, projectId);
          if (fs.existsSync(dependencyPath) && !backedUpPaths.has(dependencyFile)) {
            backups.push(createBackup(dependencyPath, actionId, projectId));
            backedUpPaths.add(dependencyFile);
          }
        }
      }
      commandResults.push(await runSafeCommand(action.command, projectId));
      if (/^npm\s+install\b/i.test(action.command)) {
        changedFiles.push(...['package.json', 'package-lock.json'].filter((dependencyFile) => {
          const snapshot = backups.find((entry) => entry.path === dependencyFile);
          if (!snapshot || !fs.existsSync(resolveSafePath(dependencyFile, projectId))) return false;
          const before = snapshot.existed && fs.existsSync(path.resolve(projectRoot, snapshot.backup))
            ? fs.readFileSync(path.resolve(projectRoot, snapshot.backup), 'utf8')
            : '';
          const after = fs.readFileSync(resolveSafePath(dependencyFile, projectId), 'utf8');
          return before !== after;
        }));
      }
    }
  }
  const automaticValidation = focusedValidationCommands(
    changedFiles,
    projectId,
    plan.actions
      .filter((action) => action.type === 'command')
      .map((action) => action.command)
  );
  for (const command of automaticValidation) {
    commandResults.push(await runSafeCommand(command, projectId));
  }

  removePendingPlan(plan.id);
  if (backups.length || commandResults.length) {
    recordAction({
      id: actionId,
      type: 'plan',
      createdAt: new Date().toISOString(),
      summary: plan.summary,
      model: plan.model,
      provider: plan.provider,
      projectId,
      changedFiles: [...new Set(changedFiles)],
      backups,
      commandResults,
      undoneAt: null
    });
  }
  const session = getAgentSession(plan.sessionId);
  if (session) {
    session.round += 1;
    session.updatedAt = Date.now();
    session.lastExecution = {
      changedFiles: [...new Set(changedFiles)],
      commandResults
    };
    persistAgentSession(session);
  }

  return {
    ok: commandResults.every((result) => result.ok),
    actionId,
    summary: plan.summary,
    changedFiles: [...new Set(changedFiles)],
    commandResults,
    canUndo: backups.length > 0,
    sessionId: plan.sessionId || null,
    canContinue: Boolean(session?.autoMode && session.round < 6)
  };
}

function saveProjectFile(requestedPath, content, projectId = 'main') {
  const selectedProjectId = normalizeProjectId(projectId);
  const selectedRoot = getSelectedProjectRoot(selectedProjectId);
  const filePath = resolveSafePath(requestedPath, selectedProjectId);
  const nextContent = String(content ?? '');
  if (nextContent.length > 1000000) throw new Error('Arquivo grande demais para salvar pelo painel.');
  const actionId = crypto.randomUUID();
  const backup = createBackup(filePath, actionId, selectedProjectId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(filePath, nextContent, 'utf8');
    invalidateProjectCache(selectedProjectId);
  } catch (error) {
    restoreBackups([backup], selectedProjectId);
    throw error;
  }
  const relative = relativePath(filePath, selectedRoot);
  recordAction({
    id: actionId,
    type: 'manual-save',
    createdAt: new Date().toISOString(),
    summary: `Edição manual de ${relative}`,
    projectId: selectedProjectId,
    changedFiles: [relative],
    backups: [backup],
    commandResults: [],
    undoneAt: null
  });
  return {
    ok: true,
    actionId,
    canUndo: true,
    path: relative,
    bytes: Buffer.byteLength(nextContent, 'utf8')
  };
}

function getActionHistory(limit = 12, projectId = '') {
  const selectedProjectId = projectId ? normalizeProjectId(projectId) : '';
  return readActionHistory()
    .filter((entry) => !selectedProjectId || normalizeProjectId(entry.projectId) === selectedProjectId)
    .slice(-Math.min(30, Math.max(1, Number(limit) || 12)))
    .reverse()
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      createdAt: entry.createdAt,
      summary: entry.summary,
      model: entry.model || '',
      provider: entry.provider || '',
      projectId: normalizeProjectId(entry.projectId),
      changedFiles: Array.isArray(entry.changedFiles) ? entry.changedFiles : [],
      commands: Array.isArray(entry.commandResults)
        ? entry.commandResults.map((result) => ({ command: result.command, ok: result.ok }))
        : [],
      undoneAt: entry.undoneAt || null,
      canUndo: !entry.undoneAt && Array.isArray(entry.backups) && entry.backups.length > 0
    }));
}

function undoCodeAction(actionId = '') {
  const history = readActionHistory();
  const requestedId = String(actionId || '').trim();
  let index = -1;
  for (let cursor = history.length - 1; cursor >= 0; cursor -= 1) {
    const entry = history[cursor];
    if (entry.undoneAt || !Array.isArray(entry.backups) || entry.backups.length === 0) continue;
    if (!requestedId || entry.id === requestedId) {
      index = cursor;
      break;
    }
  }
  if (index === -1) throw new Error('Não há uma alteração disponível para desfazer.');

  const entry = history[index];
  const restoredFiles = restoreBackups(entry.backups, entry.projectId);
  entry.undoneAt = new Date().toISOString();
  history[index] = entry;
  writeActionHistory(history);
  return {
    ok: true,
    actionId: entry.id,
    restoredFiles,
    message: restoredFiles.length === 1
      ? `${restoredFiles[0]} voltou para a versão anterior.`
      : `${restoredFiles.length} arquivos voltaram para a versão anterior.`
  };
}

async function continueCodeSession(sessionId) {
  cleanupPlans();
  const session = getAgentSession(sessionId);
  if (!session) throw new Error('A sessão supervisionada expirou. Comece a tarefa novamente.');
  if (!session.autoMode) throw new Error('Esta tarefa não está no modo automático supervisionado.');
  if (!session.lastExecution) throw new Error('A etapa atual ainda precisa ser aprovada.');
  if (session.round >= 6) {
    return {
      ok: true,
      planId: null,
      sessionId: session.id,
      sessionComplete: true,
      summary: 'A Code Alya concluiu o limite seguro de etapas. Revise o projeto antes de continuar.',
      actions: [],
      preview: []
    };
  }

  const commandContext = session.lastExecution.commandResults
    .map((result) => [
      `COMANDO: ${result.command}`,
      `RESULTADO: ${result.ok ? 'SUCESSO' : 'FALHA'}`,
      String(result.output || '').slice(0, 6000)
    ].join('\n'))
    .join('\n\n');
  const extraContext = `ETAPA ${session.round} CONCLUÍDA COM RESULTADOS REAIS:
Arquivos alterados: ${session.lastExecution.changedFiles.join(', ') || 'nenhum'}

${commandContext || 'Nenhum comando executado.'}

Continue a tarefa original. Se ela já estiver completa, responda com uma ação "done".`;
  session.lastExecution = null;
  persistAgentSession(session);
  return createCodePlan(
    session.task,
    session.contextFiles,
    session.history,
    {
      projectId: session.projectId,
      autoMode: true,
      sessionId: session.id,
      extraContext
    }
  );
}

async function diagnoseProject(projectId = 'main', history = []) {
  const selectedProjectId = normalizeProjectId(projectId);
  const selectedRoot = getSelectedProjectRoot(selectedProjectId);
  const commands = [];
  const packagePath = path.join(selectedRoot, 'package.json');
  if (fs.existsSync(packagePath)) {
    try {
      const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      if (packageData.scripts?.verify) commands.push('npm run verify');
      else if (
        packageData.scripts?.test &&
        !/no test specified/i.test(String(packageData.scripts.test))
      ) commands.push('npm test');
    } catch {
      // Um package.json inválido será explicado pelos verificadores de sintaxe.
    }
  }
  if (!commands.length) {
    commands.push(
      ...getProjectTree(120, selectedProjectId)
        .filter((file) => file.endsWith('.js') && /^[\w./\\-]+$/.test(file))
        .slice(0, 6)
        .map((file) => `node --check ${file}`)
    );
  }
  commands.push('git status');

  const diagnostics = [];
  for (const command of [...new Set(commands)].slice(0, 8)) {
    diagnostics.push(await runSafeCommand(command, selectedProjectId));
  }
  const diagnosticContext = diagnostics.map((result) => [
    `COMANDO: ${result.command}`,
    `RESULTADO: ${result.ok ? 'SUCESSO' : 'FALHA'}`,
    String(result.output || '').slice(0, 6000)
  ].join('\n')).join('\n\n');
  const plan = await createCodePlan(
    'Faça um diagnóstico inteligente deste projeto. Use somente os resultados reais abaixo, encontre a causa dos problemas e prepare a correção e os testes necessários.',
    [],
    history,
    {
      projectId: selectedProjectId,
      autoMode: true,
      extraContext: `DIAGNÓSTICO REAL EXECUTADO:\n${diagnosticContext}`
    }
  );
  return {
    ...plan,
    diagnostics: diagnostics.map((result) => ({
      command: result.command,
      ok: result.ok,
      output: String(result.output || '').slice(0, 4000)
    }))
  };
}

function getWorkspaceStatus(projectId = 'main') {
  const selectedProjectId = normalizeProjectId(projectId);
  const selectedRoot = getSelectedProjectRoot(selectedProjectId);
  return {
    ok: true,
    projectId: selectedProjectId,
    name: selectedProjectId === 'main' ? 'Alya principal' : path.basename(selectedRoot),
    files: getProjectTree(500, selectedProjectId),
    model: process.env.ALYA_CODE_MODEL || process.env.GEMINI_MODEL || (
      process.env.DEEPSEEK_API_KEY ? process.env.DEEPSEEK_CODE_MODEL || 'deepseek-v4-flash'
        : process.env.MISTRAL_API_KEY ? process.env.MISTRAL_CODE_MODEL || process.env.MISTRAL_MODEL || 'mistral-small-latest'
          : process.env.OPENROUTER_MODEL || 'automático'
    ),
    providers: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
      mistral: Boolean(process.env.MISTRAL_API_KEY),
      nvidia: Boolean(process.env.NVIDIA_API_KEY),
      openrouter: Boolean(process.env.OPENROUTER_API_KEY)
    },
    canUndo: getActionHistory(1, selectedProjectId).some((entry) => entry.canUndo)
  };
}

module.exports = {
  parseModelPlan: parsePlan,
  normalizeModelActions: normalizeActions,
  listProjects,
  createProject,
  getWorkspaceStatus,
  readProjectFile,
  createCodePlan,
  diagnoseProject,
  continueCodeSession,
  applyCodePlan,
  runSafeCommand,
  saveProjectFile,
  getActionHistory,
  undoCodeAction
};
