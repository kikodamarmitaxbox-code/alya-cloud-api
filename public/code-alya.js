'use strict';

const CHAT_STORAGE_KEY = 'code-alya-chat-v1';
const PROJECT_STORAGE_KEY = 'code-alya-project-v1';
const AUTO_MODE_STORAGE_KEY = 'code-alya-supervised-v1';
const WELCOME_MESSAGE = 'Oi, Pedro! Me conta o que você quer criar. Eu converso com você, analiso o projeto e programo quando você pedir.';

function loadStoredChatHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || '[]');
    const messages = Array.isArray(parsed)
      ? parsed
        .filter((item) => item && ['user', 'assistant'].includes(item.role))
        .map((item) => ({
          role: item.role,
          content: String(item.content || '').slice(0, 4000)
        }))
        .slice(-40)
      : [];
    return messages.length ? messages : [{ role: 'assistant', content: WELCOME_MESSAGE }];
  } catch {
    return [{ role: 'assistant', content: WELCOME_MESSAGE }];
  }
}

const state = {
  workspace: null,
  openFiles: new Map(),
  activePath: '',
  busy: false,
  terminalOpen: true,
  lastActionId: '',
  projectId: localStorage.getItem(PROJECT_STORAGE_KEY) || 'main',
  autoMode: localStorage.getItem(AUTO_MODE_STORAGE_KEY) !== 'false',
  chatHistory: loadStoredChatHistory()
};

const projectSelect = document.querySelector('#projectSelect');
const newProjectButton = document.querySelector('#newProjectButton');
const modelBadge = document.querySelector('#modelBadge');
const fileTree = document.querySelector('#fileTree');
const fileSearchInput = document.querySelector('#fileSearchInput');
const editorTabs = document.querySelector('#editorTabs');
const editorEmpty = document.querySelector('#editorEmpty');
const editorWorkspace = document.querySelector('#editorWorkspace');
const activeFilePath = document.querySelector('#activeFilePath');
const codeEditor = document.querySelector('#codeEditor');
const lineNumbers = document.querySelector('#lineNumbers');
const saveFileButton = document.querySelector('#saveFileButton');
const saveStatus = document.querySelector('#saveStatus');
const chatMessages = document.querySelector('#chatMessages');
const codeChatForm = document.querySelector('#codeChatForm');
const codePromptInput = document.querySelector('#codePromptInput');
const sendCodeButton = document.querySelector('#sendCodeButton');
const contextBar = document.querySelector('#contextBar');
const contextFiles = document.querySelector('#contextFiles');
const terminalPanel = document.querySelector('.terminal-panel');
const terminalForm = document.querySelector('#terminalForm');
const terminalInput = document.querySelector('#terminalInput');
const terminalOutput = document.querySelector('#terminalOutput');
const toast = document.querySelector('#toast');
const assistantPanel = document.querySelector('#assistantPanel');
const undoLastButton = document.querySelector('#undoLastButton');
const newChatButton = document.querySelector('#newChatButton');
const diagnoseButton = document.querySelector('#diagnoseButton');
const autoModeToggle = document.querySelector('#autoModeToggle');

function persistChatHistory() {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(state.chatHistory.slice(-40)));
  } catch {
    // O chat continua funcionando mesmo quando o navegador bloqueia armazenamento.
  }
}

function rememberMessage(role, content) {
  state.chatHistory.push({ role, content: String(content || '').slice(0, 4000) });
  state.chatHistory = state.chatHistory.slice(-40);
  persistChatHistory();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    throw new Error('Entre na Sofia primeiro para abrir a Code Sofia.');
  }
  if (!response.ok || data.ok === false) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}

async function streamApi(url, options = {}, onProgress = () => {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(options.headers || {})
    }
  });
  if (response.status === 401) throw new Error('Entre na Sofia primeiro para abrir a Code Sofia.');
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Não foi possível concluir.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  const processFrame = (frame) => {
    const dataLine = frame.split(/\r?\n/).find((line) => line.startsWith('data:'));
    if (!dataLine) return;
    const event = JSON.parse(dataLine.slice(5).trim());
    if (event.type === 'progress') onProgress(event.message, event.kind || 'progress');
    else if (event.type === 'result') result = event.data;
    else if (event.type === 'error') throw new Error(event.error || 'A Code Sofia encontrou um problema.');
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';
    for (const frame of frames) processFrame(frame);
    if (done) break;
  }
  if (buffer.trim()) processFrame(buffer);
  if (!result) throw new Error('A Code Sofia não recebeu o resultado completo.');
  return result;
}

function showToast(message, type = '') {
  toast.textContent = message;
  toast.className = `toast show ${type}`.trim();
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = 'toast'; }, 3200);
}

async function loadWorkspace() {
  fileTree.innerHTML = '<div class="tree-loading"><span></span><span></span><span></span></div>';
  try {
    const data = await api(`/api/code-alya/workspace?project=${encodeURIComponent(state.projectId)}`);
    state.workspace = data;
    state.projectId = data.projectId;
    projectSelect.value = data.projectId;
    localStorage.setItem(PROJECT_STORAGE_KEY, data.projectId);
    modelBadge.innerHTML = `<i></i>${escapeHtml(data.model)}`;
    renderTree();
    await loadActionHistory();
  } catch (error) {
    fileTree.innerHTML = `<div class="message-content">${escapeHtml(error.message)} <a href="/aly">Voltar para entrar</a></div>`;
    modelBadge.textContent = 'Offline';
    showToast(error.message, 'error');
  }
}

async function loadActionHistory() {
  try {
    const data = await api(`/api/code-alya/history?limit=12&project=${encodeURIComponent(state.projectId)}`);
    const undoable = (data.actions || []).find((entry) => entry.canUndo);
    state.lastActionId = undoable?.id || '';
    undoLastButton.disabled = !state.lastActionId;
    undoLastButton.title = state.lastActionId
      ? 'Desfazer a última alteração'
      : 'Nenhuma alteração para desfazer';
  } catch {
    state.lastActionId = '';
    undoLastButton.disabled = true;
  }
}

async function loadProjects() {
  const data = await api('/api/code-alya/projects');
  const projects = data.projects || [];
  if (!projects.some((project) => project.id === state.projectId)) state.projectId = 'main';
  projectSelect.innerHTML = projects.map((project) => (
    `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`
  )).join('');
  projectSelect.value = state.projectId;
  await loadWorkspace();
}

function hasDirtyFiles() {
  return [...state.openFiles.values()].some((file) => file.dirty);
}

async function switchProject(projectId) {
  if (hasDirtyFiles() && !window.confirm('Trocar de projeto sem salvar as mudanças abertas?')) {
    projectSelect.value = state.projectId;
    return;
  }
  state.projectId = projectId;
  state.openFiles.clear();
  state.activePath = '';
  state.workspace = null;
  localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
  renderEditor();
  await loadWorkspace();
}

async function createNewProject() {
  const name = window.prompt('Qual será o nome do novo projeto?');
  if (!String(name || '').trim()) return;
  newProjectButton.disabled = true;
  try {
    const data = await api('/api/code-alya/projects', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    await loadProjects();
    await switchProject(data.project.id);
    showToast(`Projeto “${data.project.name}” criado.`);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    newProjectButton.disabled = false;
  }
}

function buildTree(paths) {
  const root = {};
  for (const filePath of paths) {
    const parts = filePath.split('/');
    let cursor = root;
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      if (!cursor[part]) cursor[part] = isFile ? { __file: filePath } : {};
      cursor = cursor[part];
    });
  }
  return root;
}

function iconForFile(name) {
  const extension = name.split('.').pop().toLowerCase();
  if (extension === 'js') return '<span style="color:#f1d35c">JS</span>';
  if (extension === 'html') return '<span style="color:#ed8063">&lt;&gt;</span>';
  if (extension === 'css') return '<span style="color:#63a8ed">#</span>';
  if (extension === 'json') return '<span style="color:#e4bc68">{}</span>';
  if (extension === 'md') return '<span style="color:#82b8ff">M</span>';
  return '·';
}

function renderNode(node, depth = 0) {
  return Object.entries(node)
    .sort(([nameA, valueA], [nameB, valueB]) => {
      const fileA = Boolean(valueA.__file);
      const fileB = Boolean(valueB.__file);
      return Number(fileA) - Number(fileB) || nameA.localeCompare(nameB);
    })
    .map(([name, value]) => {
      if (value.__file) {
        const active = value.__file === state.activePath ? ' active' : '';
        return `<button class="tree-file${active}" type="button" data-file="${escapeHtml(value.__file)}" style="padding-left:${7 + depth * 4}px"><span class="tree-icon">${iconForFile(name)}</span><span>${escapeHtml(name)}</span></button>`;
      }
      return `<div class="tree-node">
        <button class="tree-folder" type="button"><span class="chevron">▼</span><span class="tree-icon">◇</span><span>${escapeHtml(name)}</span></button>
        <div class="tree-children">${renderNode(value, depth + 1)}</div>
      </div>`;
    }).join('');
}

function renderTree(filter = '') {
  if (!state.workspace) return;
  const normalized = filter.trim().toLowerCase();
  const paths = normalized
    ? state.workspace.files.filter((file) => file.toLowerCase().includes(normalized))
    : state.workspace.files;
  fileTree.innerHTML = renderNode(buildTree(paths)) || '<div class="empty-tab">Nenhum arquivo encontrado</div>';
  fileTree.querySelectorAll('.tree-folder').forEach((button) => {
    button.addEventListener('click', () => button.classList.toggle('collapsed'));
  });
  fileTree.querySelectorAll('[data-file]').forEach((button) => {
    button.addEventListener('click', () => openFile(button.dataset.file));
  });
}

async function openFile(filePath) {
  try {
    if (!state.openFiles.has(filePath)) {
      const data = await api(`/api/code-alya/file?path=${encodeURIComponent(filePath)}&project=${encodeURIComponent(state.projectId)}`);
      state.openFiles.set(filePath, {
        path: filePath,
        content: data.content,
        savedContent: data.content,
        dirty: false
      });
    }
    state.activePath = filePath;
    renderEditor();
    renderTree(fileSearchInput.value);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderEditor() {
  renderTabs();
  renderContextFiles();
  const file = state.openFiles.get(state.activePath);
  if (!file) {
    editorEmpty.hidden = false;
    editorWorkspace.hidden = true;
    saveFileButton.disabled = true;
    return;
  }
  editorEmpty.hidden = true;
  editorWorkspace.hidden = false;
  activeFilePath.textContent = file.path;
  if (codeEditor.value !== file.content) codeEditor.value = file.content;
  saveFileButton.disabled = !file.dirty;
  updateLineNumbers();
}

function renderTabs() {
  if (!state.openFiles.size) {
    editorTabs.innerHTML = '<div class="empty-tab">Nenhum arquivo aberto</div>';
    return;
  }
  editorTabs.innerHTML = [...state.openFiles.values()].map((file) => {
    const name = file.path.split('/').pop();
    return `<button class="editor-tab${file.path === state.activePath ? ' active' : ''}${file.dirty ? ' dirty' : ''}" type="button" data-tab="${escapeHtml(file.path)}"><i></i><span>${escapeHtml(name)}</span><em data-close="${escapeHtml(file.path)}">×</em></button>`;
  }).join('');
  editorTabs.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', (event) => {
      if (event.target.dataset.close) return;
      state.activePath = tab.dataset.tab;
      renderEditor();
      renderTree(fileSearchInput.value);
    });
  });
  editorTabs.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const file = state.openFiles.get(button.dataset.close);
      if (file?.dirty && !window.confirm('Fechar sem salvar as mudanças?')) return;
      state.openFiles.delete(button.dataset.close);
      if (state.activePath === button.dataset.close) {
        state.activePath = [...state.openFiles.keys()].pop() || '';
      }
      renderEditor();
      renderTree(fileSearchInput.value);
    });
  });
}

function renderContextFiles() {
  const paths = [...state.openFiles.keys()];
  contextBar.hidden = paths.length === 0;
  contextFiles.innerHTML = paths.map((file) => `<span class="context-chip">${escapeHtml(file.split('/').pop())}</span>`).join('');
}

function updateLineNumbers() {
  const count = Math.max(1, codeEditor.value.split('\n').length);
  lineNumbers.textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n');
  lineNumbers.scrollTop = codeEditor.scrollTop;
}

async function saveActiveFile() {
  const file = state.openFiles.get(state.activePath);
  if (!file || !file.dirty) return;
  saveFileButton.disabled = true;
  saveStatus.textContent = 'Salvando...';
  try {
    const data = await api('/api/code-alya/file', {
      method: 'POST',
      body: JSON.stringify({
        path: file.path,
        content: file.content,
        projectId: state.projectId
      })
    });
    state.lastActionId = data.actionId || state.lastActionId;
    undoLastButton.disabled = !state.lastActionId;
    file.savedContent = file.content;
    file.dirty = false;
    saveStatus.textContent = 'Salvo';
    renderTabs();
    await loadActionHistory();
    setTimeout(() => { saveStatus.textContent = ''; }, 1800);
  } catch (error) {
    saveStatus.textContent = '';
    showToast(error.message, 'error');
  } finally {
    saveFileButton.disabled = !file.dirty;
  }
}

function addMessage(role, content, extraHtml = '') {
  const article = document.createElement('article');
  article.className = role === 'user' ? 'message user-message' : 'message assistant-message';
  article.innerHTML = role === 'user'
    ? `<div class="message-content"><p>${escapeHtml(content)}</p></div>`
    : `<div class="message-label">SOFIA</div><div class="message-content"><p>${escapeHtml(content)}</p>${extraHtml}</div>`;
  chatMessages.appendChild(article);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return article;
}

function addThinking() {
  const article = document.createElement('article');
  article.className = 'message assistant-message thinking-message';
  article.innerHTML = '<div class="message-label">SOFIA</div><div class="message-content"><span class="thinking-dots"><i></i><i></i><i></i></span><span class="thinking-status">Analisando o projeto e preparando o código...</span></div>';
  chatMessages.appendChild(article);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return article;
}

function updateThinking(article, message) {
  const status = article?.querySelector('.thinking-status');
  if (status && message) status.textContent = message;
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function restoreChatHistory() {
  if (
    state.chatHistory.length === 1 &&
    state.chatHistory[0].role === 'assistant' &&
    state.chatHistory[0].content === WELCOME_MESSAGE
  ) return;
  chatMessages.innerHTML = '';
  for (const message of state.chatHistory) addMessage(message.role, message.content);
}

function renderPlan(data) {
  modelBadge.innerHTML = `<i></i>${escapeHtml(data.model)}`;
  if (data.sessionComplete || !data.planId) {
    addMessage('assistant', data.summary || 'Tarefa concluída.');
    rememberMessage('assistant', data.summary || 'Tarefa concluída.');
    return;
  }
  const actions = Array.isArray(data.actions) ? data.actions : [];
  const previews = new Map((data.preview || []).map((preview) => [preview.path, preview]));
  const hasWrites = actions.some((action) => action.type === 'write');
  const hasImportantCommand = actions.some((action) => (
    action.type === 'command' &&
    /^(?:npm\s+install|git\s+(?:commit|push))\b/i.test(action.command || '')
  ));
  const actionsHtml = actions.map((action) => {
    if (action.type === 'write') {
      const preview = previews.get(action.path);
      const changeLabel = preview?.status === 'create'
        ? 'novo arquivo'
        : `+${preview?.addedLines || 0} −${preview?.removedLines || 0}`;
      const previewHtml = preview
        ? `<details class="plan-preview">
            <summary>Ver prévia de ${escapeHtml(action.path)}</summary>
            <div class="preview-stats"><span>${escapeHtml(changeLabel)}</span><span>${preview.beforeLines} → ${preview.afterLines} linhas</span></div>
            <pre>${escapeHtml(preview.snippet || '[arquivo sem conteúdo]')}</pre>
          </details>`
        : '';
      return `<div class="plan-write-block">
        <div class="plan-action"><span>✎</span><b>${escapeHtml(action.path)}</b><span>${escapeHtml(changeLabel)}</span></div>
        ${previewHtml}
      </div>`;
    }
    return `<div class="plan-action"><span>›_</span><b>${escapeHtml(action.command)}</b></div>`;
  }).join('');
  const planHtml = data.planId
    ? `<div class="plan-card">
        <div class="plan-head"><strong>${hasWrites ? 'Revisão pronta' : 'Verificações prontas'}</strong><span>${escapeHtml(data.model)}</span></div>
        <div class="plan-actions">${actionsHtml}</div>
        <button class="plan-apply" type="button" data-plan="${escapeHtml(data.planId)}" data-session="${escapeHtml(data.sessionId || '')}" data-has-writes="${hasWrites}" data-important-command="${hasImportantCommand}">
          ${hasWrites ? 'Aplicar com backup' : 'Executar verificações'}
        </button>
      </div>`
    : '';
  const article = addMessage('assistant', data.summary, planHtml);
  rememberMessage('assistant', data.summary);
  article.querySelector('[data-plan]')?.addEventListener('click', applyPlan);
}

async function sendCodeRequest(message) {
  const clean = String(message || '').trim();
  if (!clean || state.busy) return;
  state.busy = true;
  sendCodeButton.disabled = true;
  codePromptInput.value = '';
  ensureTerminalVisible();
  appendTerminal('── Analisando novo pedido ──', 'terminal-system');
  rememberMessage('user', clean);
  addMessage('user', clean);
  const thinking = addThinking();
  const wakeTimer = setTimeout(() => {
    updateThinking(thinking, 'O servidor gratuito está acordando. Seu pedido continua salvo...');
  }, 4500);
  try {
    const data = await streamApi('/api/code-alya/plan-stream', {
      method: 'POST',
      body: JSON.stringify({
        message: clean,
        contextFiles: [...state.openFiles.keys()],
        history: state.chatHistory,
        projectId: state.projectId,
        autoMode: state.autoMode
      })
    }, (message) => {
      clearTimeout(wakeTimer);
      updateThinking(thinking, message);
      appendTerminal(`[Sofia] ${message}`, 'terminal-system');
    });
    clearTimeout(wakeTimer);
    thinking.remove();
    renderPlan(data);
  } catch (error) {
    clearTimeout(wakeTimer);
    thinking.remove();
    addMessage('assistant', error.message);
    rememberMessage('assistant', error.message);
    showToast(error.message, 'error');
  } finally {
    state.busy = false;
    sendCodeButton.disabled = false;
    codePromptInput.focus();
  }
}

async function applyPlan(event) {
  const button = event.currentTarget;
  const hasWrites = button.dataset.hasWrites === 'true';
  const hasImportantCommand = button.dataset.importantCommand === 'true';
  if (
    (hasWrites || hasImportantCommand) &&
    !window.confirm(
      hasImportantCommand
        ? 'Este plano instala pacotes ou envia alterações pelo Git. Revise os comandos acima e confirme para continuar.'
        : 'Aplicar estas mudanças? A Code Sofia criará um backup para você poder desfazer.'
    )
  ) return;
  button.disabled = true;
  button.textContent = hasWrites ? 'Aplicando e testando...' : 'Executando verificações...';
  ensureTerminalVisible();
  appendTerminal('── Iniciando plano aprovado ──', 'terminal-system');
  try {
    const data = await streamApi('/api/code-alya/apply-stream', {
      method: 'POST',
      body: JSON.stringify({ planId: button.dataset.plan })
    }, appendTerminalProgress);
    for (const filePath of data.changedFiles || []) {
      if (state.openFiles.has(filePath)) {
        state.openFiles.delete(filePath);
        await openFile(filePath);
      }
    }
    state.lastActionId = data.canUndo ? data.actionId : state.lastActionId;
    undoLastButton.disabled = !state.lastActionId;
    button.textContent = hasWrites ? '✓ Mudanças aplicadas' : '✓ Verificações concluídas';
    const resultMessage = `${data.changedFiles.length} arquivo(s) atualizado(s). ${
      data.ok
        ? 'As verificações terminaram.'
        : 'Uma verificação encontrou um problema; veja o terminal.'
    }${data.canUndo ? ' Você pode desfazer pelo botão ↶ no topo do chat.' : ''}`;
    addMessage('assistant', resultMessage);
    rememberMessage('assistant', resultMessage);
    await loadWorkspace();
    showToast(hasWrites ? 'Mudanças aplicadas com backup automático.' : 'Verificações concluídas.');
    if (data.canContinue && state.autoMode && data.sessionId) {
      await continueSupervisedSession(data.sessionId);
    }
  } catch (error) {
    appendTerminal(error.message, 'terminal-error');
    button.disabled = false;
    button.textContent = hasWrites ? 'Tentar aplicar novamente' : 'Tentar verificar novamente';
    showToast(error.message, 'error');
  }
}

async function continueSupervisedSession(sessionId) {
  const progressMessage = 'Etapa aprovada e concluída. Vou analisar o resultado real e preparar a próxima etapa.';
  addMessage('assistant', progressMessage);
  rememberMessage('assistant', progressMessage);
  const thinking = addThinking();
  try {
    const data = await api('/api/code-alya/continue', {
      method: 'POST',
      body: JSON.stringify({ sessionId })
    });
    thinking.remove();
    renderPlan(data);
  } catch (error) {
    thinking.remove();
    addMessage('assistant', error.message);
    rememberMessage('assistant', error.message);
    showToast(error.message, 'error');
  }
}

async function runSmartDiagnosis() {
  if (state.busy) return;
  state.busy = true;
  diagnoseButton.disabled = true;
  sendCodeButton.disabled = true;
  const requestMessage = `Faça um diagnóstico inteligente do projeto “${state.workspace?.name || state.projectId}”.`;
  addMessage('user', requestMessage);
  rememberMessage('user', requestMessage);
  const thinking = addThinking();
  try {
    const data = await api('/api/code-alya/diagnose', {
      method: 'POST',
      body: JSON.stringify({
        projectId: state.projectId,
        history: state.chatHistory
      })
    });
    thinking.remove();
    for (const result of data.diagnostics || []) {
      appendTerminal(`$ ${result.command}`, 'terminal-command');
      appendTerminal(result.output || (result.ok ? 'Concluído sem erros.' : 'Falhou.'), result.ok ? '' : 'terminal-error');
    }
    renderPlan(data);
  } catch (error) {
    thinking.remove();
    addMessage('assistant', error.message);
    rememberMessage('assistant', error.message);
    showToast(error.message, 'error');
  } finally {
    state.busy = false;
    diagnoseButton.disabled = false;
    sendCodeButton.disabled = false;
  }
}

async function undoLastChange() {
  if (!state.lastActionId) return;
  if (!window.confirm('Desfazer a última alteração feita pela Code Sofia?')) return;
  undoLastButton.disabled = true;
  try {
    const data = await api('/api/code-alya/undo', {
      method: 'POST',
      body: JSON.stringify({ actionId: state.lastActionId })
    });
    for (const filePath of data.restoredFiles || []) {
      state.openFiles.delete(filePath);
      if (state.activePath === filePath) state.activePath = '';
    }
    renderEditor();
    await loadWorkspace();
    addMessage('assistant', data.message);
    rememberMessage('assistant', data.message);
    showToast('Alteração desfeita com segurança.');
  } catch (error) {
    showToast(error.message, 'error');
    await loadActionHistory();
  }
}

function startNewChat() {
  if (state.busy) return;
  if (
    state.chatHistory.some((message) => message.role === 'user') &&
    !window.confirm('Começar uma conversa nova? O histórico atual será limpo deste navegador.')
  ) return;
  state.chatHistory = [{ role: 'assistant', content: WELCOME_MESSAGE }];
  persistChatHistory();
  chatMessages.innerHTML = '';
  addMessage('assistant', WELCOME_MESSAGE);
  codePromptInput.focus();
  showToast('Nova conversa iniciada.');
}

function appendTerminal(text, className = '') {
  const line = document.createElement('p');
  line.className = className;
  line.textContent = text;
  terminalOutput.appendChild(line);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function ensureTerminalVisible() {
  state.terminalOpen = true;
  terminalPanel.classList.remove('collapsed');
}

function appendTerminalProgress(message, kind = 'output') {
  const className = kind === 'command'
    ? 'terminal-command'
    : kind === 'error'
      ? 'terminal-error'
      : kind === 'stage' || kind === 'progress'
        ? 'terminal-system'
        : '';
  appendTerminal(message, className);
}

async function runTerminalCommand(command) {
  const clean = String(command || '').trim();
  if (!clean) return;
  ensureTerminalVisible();
  terminalInput.value = '';
  terminalInput.disabled = true;
  try {
    const data = await streamApi('/api/code-alya/command-stream', {
      method: 'POST',
      body: JSON.stringify({ command: clean, projectId: state.projectId })
    }, appendTerminalProgress);
    if (!data.output) appendTerminal(data.ok ? '✓ Concluído sem saída.' : '✗ O comando falhou.');
  } catch (error) {
    appendTerminal(error.message, 'terminal-error');
  } finally {
    terminalInput.disabled = false;
    terminalInput.focus();
  }
}

fileSearchInput.addEventListener('input', () => renderTree(fileSearchInput.value));
document.querySelector('#collapseAllButton').addEventListener('click', () => {
  fileTree.querySelectorAll('.tree-folder').forEach((folder) => folder.classList.add('collapsed'));
});
document.querySelector('#refreshButton').addEventListener('click', loadWorkspace);
projectSelect.addEventListener('change', () => switchProject(projectSelect.value));
newProjectButton.addEventListener('click', createNewProject);
saveFileButton.addEventListener('click', saveActiveFile);

codeEditor.addEventListener('input', () => {
  const file = state.openFiles.get(state.activePath);
  if (!file) return;
  file.content = codeEditor.value;
  file.dirty = file.content !== file.savedContent;
  saveFileButton.disabled = !file.dirty;
  renderTabs();
  updateLineNumbers();
});
codeEditor.addEventListener('scroll', updateLineNumbers);
codeEditor.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = codeEditor.selectionStart;
    codeEditor.setRangeText('  ', start, codeEditor.selectionEnd, 'end');
    codeEditor.dispatchEvent(new Event('input'));
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveActiveFile();
  }
});

codeChatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  sendCodeRequest(codePromptInput.value);
});
codePromptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    codeChatForm.requestSubmit();
  }
});
document.querySelectorAll('[data-code-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    const prompt = button.dataset.codePrompt;
    if (window.innerWidth <= 780) assistantPanel.classList.add('open');
    sendCodeRequest(prompt);
  });
});

terminalForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runTerminalCommand(terminalInput.value);
});
document.querySelector('#clearTerminalButton').addEventListener('click', () => { terminalOutput.innerHTML = ''; });
document.querySelector('#toggleTerminalButton').addEventListener('click', () => {
  state.terminalOpen = !state.terminalOpen;
  terminalPanel.classList.toggle('collapsed', !state.terminalOpen);
});
document.querySelector('#mobileChatButton').addEventListener('click', () => assistantPanel.classList.add('open'));
document.querySelector('#closeMobileChatButton').addEventListener('click', () => assistantPanel.classList.remove('open'));
undoLastButton.addEventListener('click', undoLastChange);
newChatButton.addEventListener('click', startNewChat);
diagnoseButton.addEventListener('click', runSmartDiagnosis);
autoModeToggle.checked = state.autoMode;
autoModeToggle.addEventListener('change', () => {
  state.autoMode = autoModeToggle.checked;
  localStorage.setItem(AUTO_MODE_STORAGE_KEY, String(state.autoMode));
  showToast(state.autoMode
    ? 'Modo supervisionado ligado: cada nova etapa pedirá sua aprovação.'
    : 'Modo supervisionado desligado: será preparado apenas um plano por pedido.');
});

window.addEventListener('beforeunload', (event) => {
  if ([...state.openFiles.values()].some((file) => file.dirty)) {
    event.preventDefault();
    event.returnValue = '';
  }
});

restoreChatHistory();
loadProjects().catch((error) => {
  showToast(error.message, 'error');
  loadWorkspace();
});

if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
