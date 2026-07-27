'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const projectRoot = path.resolve(__dirname, '..');
const backupRoot = path.join(projectRoot, '.alya-code', 'panel-backups');
const ignoredFolders = new Set([
  '.git', '.vault', '.alya-code', 'node_modules', 'dist', 'build', 'coverage', '.next'
]);
const protectedFile = /(^|[\\/])(\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/i;
const binaryExtension = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.mp3', '.wav', '.mp4', '.mov',
  '.zip', '.rar', '.7z', '.pdf', '.exe', '.dll', '.bin', '.woff', '.woff2', '.ttf'
]);
const pendingPlans = new Map();

function relativePath(filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function resolveSafePath(requestedPath) {
  const clean = String(requestedPath || '').trim().replace(/^["']|["']$/g, '');
  if (!clean) throw new Error('Escolha um arquivo do projeto.');
  const resolved = path.resolve(projectRoot, clean);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Caminho fora do projeto bloqueado.');
  }
  if (relative.split(path.sep).some((part) => ignoredFolders.has(part))) {
    throw new Error('Pasta interna protegida.');
  }
  if (protectedFile.test(relative)) throw new Error('Arquivo secreto protegido.');
  return resolved;
}

function getProjectTree(limit = 500) {
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
      const fullPath = path.join(directory, entry.name);
      const relative = relativePath(fullPath);
      if (protectedFile.test(relative)) continue;
      if (entry.isDirectory()) walk(fullPath);
      else files.push(relative);
    }
  }
  walk(projectRoot);
  return files;
}

function readProjectFile(requestedPath, maxLength = 50000) {
  const filePath = resolveSafePath(requestedPath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error('Arquivo não encontrado.');
  }
  if (binaryExtension.has(path.extname(filePath).toLowerCase())) {
    throw new Error('Esse arquivo não pode ser aberto no editor de texto.');
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return {
    path: relativePath(filePath),
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
- Lembre do histórico desta conversa e use-o para continuar a tarefa, sem pedir a mesma informação duas vezes.
- Nunca acesse .env, credenciais, tokens, chaves privadas, .vault ou caminhos fora do projeto.
- Se precisar do conteúdo de um arquivo não fornecido, use uma ação {"type":"read","path":"..."}.
- Para modificar, use o conteúdo COMPLETO do arquivo em uma ação "write".
- Preserve a arquitetura e o estilo existentes.
- Não invente resultados de testes.
- Nunca use comandos destrutivos, instalações automáticas ou comandos interativos.
- Use no máximo 8 ações.

FORMATO:
{
  "summary": "explicação curta em português",
  "actions": [
    {"type":"read","path":"arquivo"},
    {"type":"write","path":"arquivo","content":"conteúdo completo"},
    {"type":"command","command":"node --check arquivo.js"},
    {"type":"done"}
  ]
}`;
}

function parsePlan(text) {
  const clean = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('A IA não devolveu um plano válido.');
  const parsed = JSON.parse(clean.slice(start, end + 1));
  return {
    summary: String(parsed.summary || parsed.message || 'Plano preparado.').slice(0, 1200),
    actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 8) : []
  };
}

async function callGemini(prompt) {
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
          maxOutputTokens: Number(process.env.ALYA_CODE_MAX_TOKENS || 16000)
        }
      }),
      signal: AbortSignal.timeout(90000)
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Gemini respondeu ${response.status}`);
  return {
    model,
    text: data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || ''
  };
}

async function callCompatibleProvider(provider, prompt) {
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
    max_tokens: Number(process.env.ALYA_CODE_MAX_TOKENS || 12000)
  };
  let response = await fetch(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90000)
  });
  let data = await response.json().catch(() => ({}));
  // Alguns modelos gratuitos do OpenRouter não aceitam response_format.
  // O prompt ainda exige JSON, então tentamos uma segunda vez sem esse campo.
  if (!response.ok && provider === 'openrouter') {
    delete payload.response_format;
    response = await fetch(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'Code Alya'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90000)
    });
    data = await response.json().catch(() => ({}));
  }
  if (!response.ok) throw new Error(data.error?.message || `${provider} respondeu ${response.status}`);
  return { model: config.model, text: data.choices?.[0]?.message?.content || '' };
}

async function askModel(prompt) {
  const attempts = [
    () => callGemini(prompt),
    () => callCompatibleProvider('deepseek', prompt),
    () => callCompatibleProvider('mistral', prompt),
    () => callCompatibleProvider('nvidia', prompt),
    () => callCompatibleProvider('openrouter', prompt)
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(`Nenhum modelo de programação respondeu. ${errors.join(' • ')}`);
}

function buildPrompt(task, contextFiles, extraContext = '', history = []) {
  const sections = [];
  for (const requestedPath of [...new Set(contextFiles || [])].slice(0, 8)) {
    try {
      const file = readProjectFile(requestedPath, 30000);
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
${getProjectTree().join('\n')}

ARQUIVOS ABERTOS:
${sections.join('\n') || 'Nenhum arquivo aberto.'}

INFORMAÇÕES ADICIONAIS:
${extraContext || 'Nenhuma.'}`;
}

function normalizeActions(actions) {
  return actions.flatMap((action) => {
    const type = String(action?.type || '').toLowerCase();
    if (type === 'write' && action.path && typeof action.content === 'string') {
      resolveSafePath(action.path);
      return [{
        type,
        path: relativePath(resolveSafePath(action.path)),
        content: action.content
      }];
    }
    if (type === 'command' && action.command) {
      validateCommand(action.command);
      return [{ type, command: String(action.command).trim().slice(0, 300) }];
    }
    return [];
  });
}

async function createCodePlan(task, contextFiles = [], history = []) {
  const cleanTask = String(task || '').trim();
  if (!cleanTask) throw new Error('Conte para a Code Alya o que você quer criar.');

  let response = await askModel(buildPrompt(cleanTask, contextFiles, '', history));
  let plan = parsePlan(response.text);
  const requestedReads = plan.actions
    .filter((action) => String(action?.type).toLowerCase() === 'read' && action.path)
    .map((action) => action.path)
    .slice(0, 6);

  if (requestedReads.length) {
    response = await askModel(buildPrompt(
      cleanTask,
      [...contextFiles, ...requestedReads],
      'Os arquivos pedidos já foram carregados. Agora devolva o plano final com ações write/command/done.',
      history
    ));
    plan = parsePlan(response.text);
  }

  const actions = normalizeActions(plan.actions);
  if (!actions.length) {
    return {
      ok: true,
      planId: null,
      model: response.model,
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
    summary: plan.summary,
    actions,
    createdAt: Date.now()
  };
  pendingPlans.set(planId, storedPlan);
  cleanupPlans();

  return {
    ok: true,
    planId,
    model: response.model,
    summary: storedPlan.summary,
    actions: actions.map((action) => (
      action.type === 'write'
        ? { type: 'write', path: action.path, lines: action.content.split(/\r?\n/).length }
        : action
    )),
    preview: actions
      .filter((action) => action.type === 'write')
      .map((action) => ({ path: action.path, content: action.content.slice(0, 12000) }))
  };
}

function cleanupPlans() {
  const cutoff = Date.now() - (30 * 60 * 1000);
  for (const [id, plan] of pendingPlans.entries()) {
    if (plan.createdAt < cutoff) pendingPlans.delete(id);
  }
}

function createBackup(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(backupRoot, stamp, relativePath(filePath));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, destination);
}

function validateCommand(command) {
  const value = String(command || '').trim();
  if (!value || value.length > 300) throw new Error('Comando inválido.');
  if (/[;&|><`]/.test(value) || value.includes('$(')) {
    throw new Error('Comando combinado bloqueado.');
  }
  const allowed = [
    /^node\s+--check\s+[\w./\\-]+$/i,
    /^npm\s+(test|run\s+[\w:-]+)(?:\s+--\s+[\w./\\-]+)*$/i,
    /^git\s+(status|diff|log)(?:\s+[\w./\\="'-]+)*$/i,
    /^rg(?:\s+[\w./\\="'*?:-]+)+$/i
  ];
  if (!allowed.some((pattern) => pattern.test(value))) {
    throw new Error('Esse comando não está na lista segura da Code Alya.');
  }
  return value;
}

async function runSafeCommand(command) {
  const safeCommand = validateCommand(command);
  try {
    const result = await execAsync(safeCommand, {
      cwd: projectRoot,
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

async function applyCodePlan(planId) {
  cleanupPlans();
  const plan = pendingPlans.get(String(planId || ''));
  if (!plan) throw new Error('Esse plano expirou. Peça novamente à Code Alya.');

  const changedFiles = [];
  const commandResults = [];
  for (const action of plan.actions) {
    if (action.type === 'write') {
      const filePath = resolveSafePath(action.path);
      createBackup(filePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, action.content, 'utf8');
      changedFiles.push(action.path);
    } else if (action.type === 'command') {
      commandResults.push(await runSafeCommand(action.command));
    }
  }
  pendingPlans.delete(plan.id);
  return {
    ok: commandResults.every((result) => result.ok),
    summary: plan.summary,
    changedFiles,
    commandResults
  };
}

function saveProjectFile(requestedPath, content) {
  const filePath = resolveSafePath(requestedPath);
  const nextContent = String(content ?? '');
  if (nextContent.length > 1000000) throw new Error('Arquivo grande demais para salvar pelo painel.');
  createBackup(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, nextContent, 'utf8');
  return { ok: true, path: relativePath(filePath), bytes: Buffer.byteLength(nextContent, 'utf8') };
}

function getWorkspaceStatus() {
  return {
    ok: true,
    name: path.basename(projectRoot),
    root: projectRoot,
    files: getProjectTree(),
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
    }
  };
}

module.exports = {
  getWorkspaceStatus,
  readProjectFile,
  createCodePlan,
  applyCodePlan,
  runSafeCommand,
  saveProjectFile
};
