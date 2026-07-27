'use strict';

const state = {
  workspace: null,
  openFiles: new Map(),
  activePath: '',
  busy: false,
  terminalOpen: true
};

const projectName = document.querySelector('#projectName');
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
    throw new Error('Entre na Alya primeiro para abrir a Code Alya.');
  }
  if (!response.ok || data.ok === false) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
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
    const data = await api('/api/code-alya/workspace');
    state.workspace = data;
    projectName.textContent = data.name;
    modelBadge.innerHTML = `<i></i>${escapeHtml(data.model)}`;
    renderTree();
  } catch (error) {
    fileTree.innerHTML = `<div class="message-content">${escapeHtml(error.message)} <a href="/aly">Voltar para entrar</a></div>`;
    modelBadge.textContent = 'Offline';
    showToast(error.message, 'error');
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
      const data = await api(`/api/code-alya/file?path=${encodeURIComponent(filePath)}`);
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
    await api('/api/code-alya/file', {
      method: 'POST',
      body: JSON.stringify({ path: file.path, content: file.content })
    });
    file.savedContent = file.content;
    file.dirty = false;
    saveStatus.textContent = 'Salvo';
    renderTabs();
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
    : `<div class="message-label">ALYA</div><div class="message-content"><p>${escapeHtml(content)}</p>${extraHtml}</div>`;
  chatMessages.appendChild(article);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return article;
}

function addThinking() {
  const article = document.createElement('article');
  article.className = 'message assistant-message thinking-message';
  article.innerHTML = '<div class="message-label">ALYA</div><div class="message-content"><span class="thinking-dots"><i></i><i></i><i></i></span><span>Analisando o projeto e preparando o código...</span></div>';
  chatMessages.appendChild(article);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return article;
}

function renderPlan(data) {
  modelBadge.innerHTML = `<i></i>${escapeHtml(data.model)}`;
  const actionsHtml = data.actions.map((action) => {
    if (action.type === 'write') {
      return `<div class="plan-action"><span>✎</span><b>${escapeHtml(action.path)}</b><span>${action.lines} linhas</span></div>`;
    }
    return `<div class="plan-action"><span>›_</span><b>${escapeHtml(action.command)}</b></div>`;
  }).join('');
  const planHtml = data.planId
    ? `<div class="plan-card">
        <div class="plan-head"><strong>Plano pronto para aplicar</strong><span>${escapeHtml(data.model)}</span></div>
        <div class="plan-actions">${actionsHtml}</div>
        <button class="plan-apply" type="button" data-plan="${escapeHtml(data.planId)}">Aplicar mudanças</button>
      </div>`
    : '';
  const article = addMessage('assistant', data.summary, planHtml);
  article.querySelector('[data-plan]')?.addEventListener('click', applyPlan);
}

async function sendCodeRequest(message) {
  const clean = String(message || '').trim();
  if (!clean || state.busy) return;
  state.busy = true;
  sendCodeButton.disabled = true;
  codePromptInput.value = '';
  addMessage('user', clean);
  const thinking = addThinking();
  try {
    const data = await api('/api/code-alya/plan', {
      method: 'POST',
      body: JSON.stringify({
        message: clean,
        contextFiles: [...state.openFiles.keys()]
      })
    });
    thinking.remove();
    renderPlan(data);
  } catch (error) {
    thinking.remove();
    addMessage('assistant', error.message);
    showToast(error.message, 'error');
  } finally {
    state.busy = false;
    sendCodeButton.disabled = false;
    codePromptInput.focus();
  }
}

async function applyPlan(event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Aplicando e testando...';
  try {
    const data = await api('/api/code-alya/apply', {
      method: 'POST',
      body: JSON.stringify({ planId: button.dataset.plan })
    });
    for (const result of data.commandResults || []) {
      appendTerminal(`$ ${result.command}`, 'terminal-command');
      appendTerminal(result.output || (result.ok ? 'Concluído.' : 'Falhou.'), result.ok ? '' : 'terminal-error');
    }
    for (const filePath of data.changedFiles || []) {
      if (state.openFiles.has(filePath)) {
        state.openFiles.delete(filePath);
        await openFile(filePath);
      }
    }
    button.textContent = '✓ Mudanças aplicadas';
    addMessage('assistant', `${data.changedFiles.length} arquivo(s) atualizado(s). ${data.ok ? 'As verificações terminaram.' : 'Uma verificação encontrou um problema; veja o terminal.'}`);
    await loadWorkspace();
    showToast('Mudanças aplicadas com backup automático.');
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Tentar aplicar novamente';
    showToast(error.message, 'error');
  }
}

function appendTerminal(text, className = '') {
  const line = document.createElement('p');
  line.className = className;
  line.textContent = text;
  terminalOutput.appendChild(line);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

async function runTerminalCommand(command) {
  const clean = String(command || '').trim();
  if (!clean) return;
  appendTerminal(`alya ❯ ${clean}`, 'terminal-command');
  terminalInput.value = '';
  terminalInput.disabled = true;
  try {
    const data = await api('/api/code-alya/command', {
      method: 'POST',
      body: JSON.stringify({ command: clean })
    });
    appendTerminal(data.output || 'Concluído.');
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

window.addEventListener('beforeunload', (event) => {
  if ([...state.openFiles.values()].some((file) => file.dirty)) {
    event.preventDefault();
    event.returnValue = '';
  }
});

loadWorkspace();
