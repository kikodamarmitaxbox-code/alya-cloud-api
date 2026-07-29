'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'server.js',
  'lib/auth.js',
  'lib/chat.js',
  'lib/systemPrompt.js',
  'lib/codeAgent.js',
  'lib/persistentStore.js',
  'lib/userFiles.js',
  'lib/fileOps.js',
  'lib/plugins.js',
  'public/aly.js',
  'public/code-alya.js',
  'public/sw.js'
];

function verifySyntax() {
  for (const relativePath of requiredFiles) {
    const filePath = path.join(root, relativePath);
    if (!fs.existsSync(filePath)) throw new Error(`Arquivo obrigatório ausente: ${relativePath}`);
    execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
  }
}

function verifyCodeAlyaInterface() {
  const html = fs.readFileSync(path.join(root, 'public', 'code-alya.html'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'public', 'code-alya.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const referencedIds = [...client.matchAll(/querySelector\(['"]#([^'"]+)['"]\)/g)]
    .map((match) => match[1]);
  for (const id of new Set(referencedIds)) {
    if (!new RegExp(`id=["']${id}["']`).test(html)) {
      throw new Error(`Elemento da Code Alya ausente na interface: #${id}`);
    }
  }
  if (
    !client.includes("streamApi('/api/code-alya/plan-stream'") ||
    !server.includes("url.pathname === '/api/code-alya/plan-stream'")
  ) {
    throw new Error('O progresso em tempo real da Code Alya não está conectado.');
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
  if (
    typeof codeAgent.parseModelPlan !== 'function' ||
    typeof codeAgent.normalizeModelActions !== 'function' ||
    typeof codeAgent.getActionHistory !== 'function' ||
    typeof codeAgent.undoCodeAction !== 'function' ||
    typeof codeAgent.listProjects !== 'function' ||
    typeof codeAgent.createProject !== 'function' ||
    typeof codeAgent.diagnoseProject !== 'function' ||
    typeof codeAgent.continueCodeSession !== 'function'
  ) {
    throw new Error('Um recurso profissional da Code Alya não está disponível.');
  }
  if (!codeAgent.listProjects().some((project) => project.id === 'main')) {
    throw new Error('O projeto principal da Code Alya não está disponível.');
  }
  const recoveredPlan = codeAgent.parseModelPlan(
    'texto antes {"summary":"Plano recuperado","actions":[{"type":"done"}]} texto depois {inválido}'
  );
  if (recoveredPlan.summary !== 'Plano recuperado' || recoveredPlan.actions.length !== 1) {
    throw new Error('A Code Alya não recuperou uma resposta com texto extra.');
  }

  const testProjectName = `Verificação Alya ${Date.now()}`;
  const createdProject = codeAgent.createProject(testProjectName).project;
  const projectsRoot = path.resolve(root, 'projects');
  const testProjectRoot = path.resolve(projectsRoot, createdProject.id);
  const projectRelative = path.relative(projectsRoot, testProjectRoot);
  if (projectRelative.startsWith('..') || path.isAbsolute(projectRelative)) {
    throw new Error('O projeto temporário saiu da pasta segura.');
  }
  try {
    const projectReadme = codeAgent.readProjectFile('README.md', 50000, createdProject.id);
    if (!projectReadme.content.includes(testProjectName)) {
      throw new Error('O projeto separado não conseguiu ler o próprio arquivo.');
    }
    const patchActions = codeAgent.normalizeModelActions([{
      type: 'patch',
      path: 'README.md',
      find: 'Projeto criado pela Code Alya.',
      replace: 'Projeto verificado pela Code Alya.'
    }], createdProject.id);
    if (
      patchActions.length !== 1 ||
      patchActions[0].type !== 'write' ||
      !patchActions[0].content.includes('Projeto verificado pela Code Alya.')
    ) {
      throw new Error('A edição econômica por trechos não foi preparada corretamente.');
    }
    let crossProjectBlocked = false;
    try {
      codeAgent.readProjectFile(`projects/${createdProject.id}/README.md`, 50000, 'main');
    } catch (error) {
      crossProjectBlocked = /projeto correto/i.test(error.message);
    }
    if (!crossProjectBlocked) {
      throw new Error('Um projeto conseguiu atravessar o isolamento de arquivos.');
    }
  } finally {
    const entries = fs.readdirSync(testProjectRoot);
    if (entries.length !== 1 || entries[0] !== 'README.md') {
      throw new Error('O projeto temporário contém arquivos inesperados e não foi removido.');
    }
    fs.unlinkSync(path.join(testProjectRoot, 'README.md'));
    fs.rmdirSync(testProjectRoot);
  }

  const command = await codeAgent.runSafeCommand('node --check server.js');
  if (!command.ok) throw new Error(`A validação do servidor falhou: ${command.output}`);

  let protectedCommandBlocked = false;
  try {
    await codeAgent.runSafeCommand('rg token .env');
  } catch (error) {
    protectedCommandBlocked = /protegida|protegido/i.test(error.message);
  }
  if (!protectedCommandBlocked) {
    throw new Error('O terminal seguro aceitou uma busca em arquivo secreto.');
  }
}

(async () => {
  verifySyntax();
  verifyCodeAlyaInterface();
  await verifySafety();
  console.log('Verificação concluída: Alya e Code Alya estão prontas para uso.');
})().catch((error) => {
  console.error(`Verificação falhou: ${error.message}`);
  process.exitCode = 1;
});
