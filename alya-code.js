#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { exec } = require('child_process');
const { promisify } = require('util');
const { loadLocalEnv } = require('./lib/utils');

loadLocalEnv();

const execAsync = promisify(exec);
const workspace = process.cwd();
const stateDir = path.join(workspace, '.alya-code');
const backupRoot = path.join(stateDir, 'backups');
const autoApprove = process.argv.includes('--yes');
const ignoredFolders = new Set(['.git', '.vault', 'node_modules', '.alya-code', 'dist', 'build', 'coverage', '.next']);
const blockedFiles = /(^|[\\/])(\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/i;
const binaryExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.mp3', '.wav', '.mp4', '.mov',
  '.zip', '.rar', '.7z', '.pdf', '.exe', '.dll', '.bin', '.woff', '.woff2', '.ttf'
]);

let selectedModel = process.env.ALYA_CODE_MODEL || 'gemini-3.5-flash';
let sessionBackups = [];
let terminal = null;

function color(code, text) {
  return process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function relativePath(filePath) {
  return path.relative(workspace, filePath).replace(/\\/g, '/');
}

function resolveProjectPath(requestedPath) {
  const clean = String(requestedPath || '').trim().replace(/^["']|["']$/g, '');
  const resolved = path.resolve(workspace, clean);
  const relative = path.relative(workspace, resolved);
  if (!clean || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Caminho fora do projeto bloqueado.');
  }
  const pathParts = relative.split(path.sep);
  if (pathParts.some((part) => ['.git', '.vault', '.alya-code'].includes(part))) {
    throw new Error('Pasta interna protegida.');
  }
  if (blockedFiles.test(relative)) {
    throw new Error('Arquivo secreto protegido.');
  }
  return resolved;
}

function projectTree(limit = 350) {
  const files = [];
  function walk(directory) {
    if (files.length >= limit) return;
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= limit) break;
      if (entry.isDirectory() && ignoredFolders.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (!blockedFiles.test(relativePath(fullPath))) files.push(relativePath(fullPath));
    }
  }
  walk(workspace);
  return files;
}

function readProjectFile(requestedPath) {
  const filePath = resolveProjectPath(requestedPath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error('Arquivo não encontrado.');
  }
  if (binaryExtensions.has(path.extname(filePath).toLowerCase())) {
    throw new Error('Arquivo binário não pode ser lido como texto.');
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return content.length > 30000
    ? `${content.slice(0, 30000)}\n\n[arquivo cortado após 30.000 caracteres]`
    : content;
}

function parseModelJson(text) {
  const clean = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('O modelo não devolveu um plano válido.');
  return JSON.parse(clean.slice(start, end + 1));
}

function normalizePlan(plan) {
  const sourceActions = Array.isArray(plan?.actions)
    ? plan.actions
    : plan?.action
      ? [plan.action]
      : [];
  return {
    message: String(plan?.message || plan?.mensagem || ''),
    actions: sourceActions.map((action) => (
      typeof action === 'string' ? { type: action.toLowerCase() } : action
    ))
  };
}

function systemPrompt() {
  return `Você é Alya Code, uma agente de programação trabalhando no terminal do usuário.
Seu objetivo é entender pedidos, inspecionar o projeto, editar somente o necessário e validar o resultado.

REGRAS OBRIGATÓRIAS:
- Responda somente com JSON válido, sem markdown e sem texto fora do JSON.
- Nunca peça, leia, revele ou edite arquivos .env, credenciais, tokens, chaves privadas ou pastas fora do projeto.
- Antes de editar um arquivo que você ainda não viu, solicite a ação "read".
- Preserve o estilo e a arquitetura existentes.
- Não invente resultados de testes.
- Faça alterações pequenas e completas.
- Nunca use comandos destrutivos.
- Não exponha raciocínio interno.

FORMATO:
{
  "message": "explicação curta em português",
  "actions": [
    {"type":"read","path":"arquivo"},
    {"type":"write","path":"arquivo","content":"conteúdo completo do arquivo"},
    {"type":"run","command":"comando seguro"},
    {"type":"done"}
  ]
}

Use no máximo 6 ações por resposta. Quando terminar, devolva apenas uma ação "done".`;
}

async function callGemini(model, task, transcript) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt() }] },
        contents: [{
          role: 'user',
          parts: [{
            text: `PEDIDO:\n${task}\n\nARQUIVOS DO PROJETO:\n${projectTree().join('\n')}\n\nRESULTADOS ANTERIORES:\n${transcript || 'Nenhum.'}`
          }]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 16000
        }
      }),
      signal: AbortSignal.timeout(60000)
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Gemini respondeu ${response.status}`);
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
}

async function callMistral(task, transcript) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error('MISTRAL_API_KEY não configurada');
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.MISTRAL_CODE_MODEL || process.env.MISTRAL_MODEL || 'mistral-small-latest',
      messages: [
        { role: 'system', content: systemPrompt() },
        {
          role: 'user',
          content: `PEDIDO:\n${task}\n\nARQUIVOS DO PROJETO:\n${projectTree().join('\n')}\n\nRESULTADOS ANTERIORES:\n${transcript || 'Nenhum.'}`
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 12000
    }),
    signal: AbortSignal.timeout(60000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Mistral respondeu ${response.status}`);
  return data.choices?.[0]?.message?.content || '';
}

async function askCodingModel(task, transcript) {
  const attempts = [
    { label: selectedModel, run: () => callGemini(selectedModel, task, transcript) },
    { label: 'gemini-2.5-pro', run: () => callGemini('gemini-2.5-pro', task, transcript) },
    { label: 'Mistral reserva', run: () => callMistral(task, transcript) }
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      const result = await attempt.run();
      return { plan: normalizePlan(parseModelJson(result)), model: attempt.label };
    } catch (error) {
      errors.push(`${attempt.label}: ${error.message}`);
    }
  }
  throw new Error(`Nenhum modelo respondeu.\n${errors.join('\n')}`);
}

async function confirm(question) {
  if (autoApprove) return true;
  if (!terminal) throw new Error('Confirmação indisponível fora do terminal interativo.');
  const answer = (await terminal.question(`${color('33', question)} [s/N] `)).trim().toLowerCase();
  return answer === 's' || answer === 'sim' || answer === 'y' || answer === 'yes';
}

function createBackup(filePath) {
  const relative = relativePath(filePath);
  const session = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(backupRoot, session, relative);
  const existed = fs.existsSync(filePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (existed) fs.copyFileSync(filePath, destination);
  const entry = { target: filePath, backup: destination, existed };
  sessionBackups.push(entry);
}

async function writeProjectFile(action) {
  const filePath = resolveProjectPath(action.path);
  const content = String(action.content ?? '');
  if (content.length > 500000) throw new Error('Alteração grande demais; divida em arquivos menores.');
  const approved = await confirm(`Permitir alteração em ${relativePath(filePath)}?`);
  if (!approved) return 'Alteração recusada pelo usuário.';
  createBackup(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return `Arquivo salvo: ${relativePath(filePath)}`;
}

function commandAllowed(command) {
  const value = String(command || '').trim();
  if (!value || value.length > 240) return false;
  if (/[;&|`]|(\$\()/.test(value)) return false;
  if (/(?:^|[\\/\s])\.\.(?:[\\/\s]|$)|[a-z]:\\|%[a-z_]+%|~\//i.test(value)) return false;
  if (/\b(rm|del|erase|rmdir|remove-item|format|shutdown|reboot|taskkill)\b/i.test(value)) return false;
  if (/\bgit\s+(reset|clean|checkout|restore|push|commit|rebase)\b/i.test(value)) return false;
  if (/^npx tsc\b/i.test(value)) return /\s--noEmit(?:\s|$)/i.test(value);
  if (/^npx eslint\b/i.test(value)) return !/\s--fix(?:\s|$)/i.test(value);
  if (/^npx prettier\b/i.test(value)) return /\s--check(?:\s|$)/i.test(value) && !/\s--write(?:\s|$)/i.test(value);
  return /^(npm (?:test|run [\w:-]+)|node --check [\w./\\ -]+|git (?:status|diff)(?:\s|$))/i.test(value);
}

async function runSafeCommand(command) {
  if (!commandAllowed(command)) throw new Error('Comando bloqueado pela proteção do terminal.');
  const approved = await confirm(`Executar "${command}"?`);
  if (!approved) return 'Comando recusado pelo usuário.';
  try {
    const result = await execAsync(command, {
      cwd: workspace,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
    return `${result.stdout || ''}${result.stderr || ''}`.trim().slice(0, 16000) || 'Comando concluído sem saída.';
  } catch (error) {
    return `Falhou (${error.code || 'erro'}):\n${String(error.stdout || '')}${String(error.stderr || error.message || '')}`.slice(0, 16000);
  }
}

async function executeAction(action) {
  switch (action?.type) {
    case 'read':
      return `READ ${action.path}:\n${readProjectFile(action.path)}`;
    case 'write':
      return `WRITE ${action.path}:\n${await writeProjectFile(action)}`;
    case 'run':
      return `RUN ${action.command}:\n${await runSafeCommand(action.command)}`;
    case 'done':
      return 'DONE';
    default:
      return 'Ação desconhecida ignorada.';
  }
}

async function runAgent(task) {
  let transcript = '';
  sessionBackups = [];
  for (let round = 1; round <= 8; round += 1) {
    process.stdout.write(color('36', `\nAlya Code está pensando com ${selectedModel}...\n`));
    const { plan, model } = await askCodingModel(task, transcript);
    if (model !== selectedModel) console.log(color('33', `Modelo de reserva usado: ${model}`));
    if (plan.message) console.log(color('35', `Alya: ${plan.message}`));
    const actions = Array.isArray(plan.actions) ? plan.actions.slice(0, 6) : [];
    if (!actions.length) return;

    const results = [];
    for (const action of actions) {
      if (action.type === 'done') {
        console.log(color('32', 'Concluído.'));
        return;
      }
      try {
        const result = await executeAction(action);
        console.log(color('90', result.split('\n')[0]));
        results.push(result);
      } catch (error) {
        results.push(`ERRO ${action.type}: ${error.message}`);
        console.log(color('31', error.message));
      }
    }
    transcript = `${transcript}\n\nRODADA ${round}:\n${results.join('\n\n')}`.slice(-90000);
  }
  console.log(color('33', 'A Alya atingiu o limite de etapas. Revise as alterações antes de continuar.'));
}

function undoChanges() {
  if (!sessionBackups.length) {
    console.log('Não há alterações desta sessão para desfazer.');
    return;
  }
  for (const entry of [...sessionBackups].reverse()) {
    if (entry.existed && fs.existsSync(entry.backup)) {
      fs.mkdirSync(path.dirname(entry.target), { recursive: true });
      fs.copyFileSync(entry.backup, entry.target);
    } else if (!entry.existed && fs.existsSync(entry.target)) {
      fs.unlinkSync(entry.target);
    }
  }
  sessionBackups = [];
  console.log(color('32', 'Alterações da última tarefa foram desfeitas.'));
}

function printHelp() {
  console.log(`
${color('35', 'Comandos da Alya Code')}
  /help                 mostra esta ajuda
  /model                mostra o modelo atual
  /model <nome>         troca o modelo Gemini
  /files                lista os arquivos do projeto
  /read <arquivo>       mostra um arquivo de texto
  /undo                 desfaz arquivos alterados na última tarefa
  /clear                limpa a tela
  /exit                 fecha a Alya Code

Exemplos:
  corrija o erro do servidor e teste
  crie uma página de login bonita
  analise este projeto e melhore a segurança
`);
}

async function main() {
  terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  console.log(color('35', '\n✦ Alya Code — sua programadora no terminal'));
  console.log(`Projeto: ${workspace}`);
  console.log(`Modelo principal: ${selectedModel}`);
  if (!process.env.GEMINI_API_KEY) {
    console.log(color('33', 'GEMINI_API_KEY não encontrada. A reserva Mistral será usada se estiver configurada.'));
    console.log('Crie gratuitamente em: https://aistudio.google.com/app/apikey');
  }
  console.log('Digite /help para ver os comandos.\n');

  while (true) {
    const input = (await terminal.question(color('36', 'Você › '))).trim();
    if (!input) continue;
    if (input === '/exit' || input === '/sair') break;
    if (input === '/help') {
      printHelp();
      continue;
    }
    if (input === '/files') {
      console.log(projectTree().join('\n'));
      continue;
    }
    if (input.startsWith('/read ')) {
      try {
        console.log(readProjectFile(input.slice(6)));
      } catch (error) {
        console.log(color('31', error.message));
      }
      continue;
    }
    if (input === '/model') {
      console.log(`Modelo atual: ${selectedModel}`);
      continue;
    }
    if (input.startsWith('/model ')) {
      const requested = input.slice(7).trim();
      if (!/^gemini-[a-z0-9.-]+$/i.test(requested)) {
        console.log(color('31', 'Use um nome de modelo Gemini válido.'));
      } else {
        selectedModel = requested;
        console.log(color('32', `Modelo alterado para ${selectedModel}.`));
      }
      continue;
    }
    if (input === '/undo') {
      undoChanges();
      continue;
    }
    if (input === '/clear') {
      console.clear();
      continue;
    }
    try {
      await runAgent(input);
    } catch (error) {
      console.log(color('31', `Erro: ${error.message}`));
    }
  }

  terminal.close();
  console.log('Até mais!');
}

if (require.main === module) {
  if (process.argv.includes('--help')) {
    printHelp();
  } else {
    main().catch((error) => {
      console.error(error.message);
      terminal?.close();
      process.exitCode = 1;
    });
  }
}

module.exports = {
  askCodingModel,
  commandAllowed,
  parseModelJson,
  projectTree,
  readProjectFile,
  resolveProjectPath
};
