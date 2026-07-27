'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'server.js',
  'lib/auth.js',
  'lib/chat.js',
  'lib/codeAgent.js',
  'lib/fileOps.js',
  'lib/plugins.js',
  'public/aly.js',
  'public/code-alya.js'
];

function verifySyntax() {
  for (const relativePath of requiredFiles) {
    const filePath = path.join(root, relativePath);
    if (!fs.existsSync(filePath)) throw new Error(`Arquivo obrigatório ausente: ${relativePath}`);
    execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
  }
}

async function verifySafety() {
  const fileOps = require('../lib/fileOps');
  const codeAgent = require('../lib/codeAgent');

  const protectedRead = fileOps.readFile('.env');
  if (protectedRead.ok || !/protegido/i.test(protectedRead.error || '')) {
    throw new Error('A proteção de arquivos secretos não está ativa.');
  }

  const commandNeedsApproval = fileOps.executeCommand('git status', false);
  if (!commandNeedsApproval.requiresApproval) {
    throw new Error('Os comandos do painel antigo não estão pedindo aprovação.');
  }

  let blocked = false;
  try {
    codeAgent.readProjectFile('.env');
  } catch (error) {
    blocked = /protegido/i.test(error.message);
  }
  if (!blocked) throw new Error('A Code Alya não bloqueou um arquivo secreto.');

  const workspace = codeAgent.getWorkspaceStatus();
  if (!workspace.ok || !Array.isArray(workspace.files) || !workspace.files.includes('server.js')) {
    throw new Error('A Code Alya não conseguiu ler o projeto.');
  }

  const command = await codeAgent.runSafeCommand('node --check server.js');
  if (!command.ok) throw new Error(`A validação do servidor falhou: ${command.output}`);
}

(async () => {
  verifySyntax();
  await verifySafety();
  console.log('Verificação concluída: Alya e Code Alya estão prontas para uso.');
})().catch((error) => {
  console.error(`Verificação falhou: ${error.message}`);
  process.exitCode = 1;
});
