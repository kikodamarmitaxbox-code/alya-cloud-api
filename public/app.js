const accessGate = document.querySelector("#accessGate");
const accessForm = document.querySelector("#accessForm");
const usernameField = document.querySelector("#usernameField");
const accessUsername = document.querySelector("#accessUsername");
const accessPassword = document.querySelector("#accessPassword");
const accessSubmit = document.querySelector("#accessSubmit");
const accessError = document.querySelector("#accessError");
const appShell = document.querySelector("#appShell");
const welcomeScreen = document.querySelector("#welcomeScreen");
const messagesEl = document.querySelector("#messages");
const form = document.querySelector("#chatForm");
const input = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const attachFileButton = document.querySelector("#attachFileButton");
const imageButton = document.querySelector("#imageButton");
const voiceButton = document.querySelector("#voiceButton");
const clearButton = document.querySelector("#clearButton");
const personalitySelect = document.querySelector("#personalitySelect");
const memoryButton = document.querySelector("#memoryButton");
const exportButton = document.querySelector("#exportButton");
const memoryModal = document.querySelector("#memoryModal");
const memoryInput = document.querySelector("#memoryInput");
const closeMemoryButton = document.querySelector("#closeMemoryButton");
const saveMemoryButton = document.querySelector("#saveMemoryButton");
const devModeButton = document.querySelector("#devModeButton");
const devHistoryButton = document.querySelector("#devHistoryButton");
const fileApprovalModal = document.querySelector("#fileApprovalModal");
const filePreview = document.querySelector("#filePreview");
const applyFileEditButton = document.querySelector("#applyFileEditButton");
const cancelFileEditButton = document.querySelector("#cancelFileEditButton");
const modeButtons = Array.from(document.querySelectorAll(".mode-button"));
const typingIndicator = document.querySelector("#typingIndicator");

// Dev Panel Elements
const devPanelButton = document.querySelector("#devPanelButton");
const devPanelModal = document.querySelector("#devPanelModal");
const closeDevPanelButton = document.querySelector("#closeDevPanelButton");
const devParentDirButton = document.querySelector("#devParentDirButton");
const devFilesList = document.querySelector("#devFilesList");
const devNewFileButton = document.querySelector("#devNewFileButton");
const devNewFolderButton = document.querySelector("#devNewFolderButton");
const devCurrentDir = document.querySelector(".dev-current-dir");
const devCodeEditor = document.querySelector("#devCodeEditor");
const devSaveFileButton = document.querySelector("#devSaveFileButton");
const devEditingFilePath = document.querySelector("#devEditingFilePath");
const devTabs = document.querySelectorAll(".dev-tabs .settings-nav-item");
const devTabPanes = document.querySelectorAll(".dev-tab-pane");
const devTerminalOutput = document.querySelector("#devTerminalOutput");
const devConsoleForm = document.querySelector("#devConsoleForm");
const devConsoleInput = document.querySelector("#devConsoleInput");
const devConsoleSubmit = document.querySelector("#devConsoleSubmit");
const devConsoleShortcuts = document.querySelectorAll(".dev-console-shortcuts button");
const devCreateBackupButton = document.querySelector("#devCreateBackupButton");
const devBackupsList = document.querySelector("#devBackupsList");
const shareLinkButton = document.querySelector("#shareLinkButton");

function showTypingIndicator() {
  if (!typingIndicator) return;
  typingIndicator.hidden = false;
  typingIndicator.setAttribute("aria-hidden", "false");
  scrollToBottom();
}

function hideTypingIndicator() {
  if (!typingIndicator) return;
  typingIndicator.hidden = true;
  typingIndicator.setAttribute("aria-hidden", "true");
}

function typeWriter(element, text, speed = 18) {
  return new Promise((resolve) => {
    element.textContent = "";
    let i = 0;
    const length = text.length;

    function step() {
      if (i < length) {
        element.textContent += text.charAt(i);
        i++;
        scrollToBottom();
        const progress = i / length;
        const nextDelay = progress > 0.7 ? Math.max(4, speed * 0.5) : speed;
        setTimeout(step, nextDelay);
      } else {
        resolve();
      }
    }

    step();
  });
}

const welcomeSplash = document.querySelector("#welcomeSplash");

function getWelcomeEnabled() {
  const raw = localStorage.getItem("nova-welcome-enabled");
  if (raw === null) return true;
  return raw !== "false";
}

function setWelcomeEnabled(enabled) {
  localStorage.setItem("nova-welcome-enabled", String(enabled));
}

function getUserName() {
  const saved = localStorage.getItem("nova-username");
  if (saved) return saved;
  const parts = (settings.memory || "").split("\n");
  const nameLine = parts.find((line) => line.toLowerCase().startsWith("meu nome:"));
  if (nameLine) {
    const name = nameLine.split(":").slice(1).join(":").trim();
    if (name) {
      localStorage.setItem("nova-username", name);
      return name;
    }
  }
  return "Pedro";
}

function playStartupSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(480, now);
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.25);
    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.exponentialRampToValueAtTime(0.08, now + 0.25);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.9);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(720, now + 0.12);
    osc2.frequency.exponentialRampToValueAtTime(1320, now + 0.45);
    gain2.gain.setValueAtTime(0.0001, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.05, now + 0.25);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 1.1);

    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = "triangle";
    osc3.frequency.setValueAtTime(180, now + 0.35);
    osc3.frequency.exponentialRampToValueAtTime(60, now + 1.4);
    gain3.gain.setValueAtTime(0.0001, now + 0.35);
    gain3.gain.exponentialRampToValueAtTime(0.04, now + 0.5);
    gain3.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(now + 0.35);
    osc3.stop(now + 1.4);
  } catch {
    // Ignore audio errors
  }
}

async function showWelcomeSplash() {
  if (!welcomeSplash) return;
  if (!getWelcomeEnabled()) {
    welcomeSplash.hidden = true;
    input.focus();
    return;
  }

  const userName = getUserName();
  const titleEl = welcomeSplash.querySelector(".splash-title");
  if (titleEl) titleEl.textContent = `Bem-vindo, ${userName}!`;

  welcomeSplash.hidden = false;
  welcomeSplash.classList.remove("fade-out");
  playStartupSound();

  await new Promise((resolve) => setTimeout(resolve, 2600));

  welcomeSplash.classList.add("fade-out");
  await new Promise((resolve) => setTimeout(resolve, 600));
  welcomeSplash.hidden = true;
  input.focus();
}

const sidebarConversationsList = document.querySelector("#conversationsListSidebar");
const searchConversationsInput = document.querySelector("#searchConversationsInput");
const conversationsListModal = document.querySelector("#conversationsListModal");

function scrollToBottom() {
  if (!messagesEl) return;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  messagesEl.scrollTo({
    top: messagesEl.scrollHeight,
    behavior: prefersReducedMotion ? "auto" : "smooth"
  });
}

const storageKey = "nova-chat-history";
const settingsKey = "nova-settings";
const apiBase = (window.location.protocol === "file:" || ((window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && window.location.port !== "3000"))
  ? "http://localhost:3000"
  : "";
let history = loadHistory();
let settings = loadSettings();
let pendingFileProfile = null;
let loginMode = "password";
let conversations = loadConversations();
let currentConversationId = conversations.length > 0 ? conversations[0].id : null;
if (!currentConversationId) {
  currentConversationId = createNewConversation();
}

personalitySelect.value = settings.personality;
memoryInput.value = settings.memory;
syncModeUI();
syncDevModeUI();

if (history.length === 0) {
  history = [
    {
      role: "assistant",
      content: "Oi, eu sou a Alya. Posso te ajudar com ideias, estudos, textos e organizacao."
    }
  ];
}

function syncAccessUI() {
  if (!usernameField) return;
  usernameField.hidden = loginMode !== "users";
}

function syncModeUI() {
  modeButtons.forEach((button) => {
    const isActive = button.dataset.mode === settings.mode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function syncDevModeUI() {
  if (!devModeButton) return;
  devModeButton.classList.toggle("active", settings.devMode);
  devModeButton.setAttribute("aria-pressed", String(settings.devMode));
}

boot();

accessForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  accessSubmit.disabled = true;
  accessError.textContent = "";

  try {
    const response = await fetch(`${apiBase}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: accessUsername.value,
        password: accessPassword.value
      })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.error) {
      throw new Error(data.error || "Nao consegui entrar agora.");
    }

    showApp();
  } catch (error) {
    accessError.textContent = error.message || "Senha incorreta.";
    accessPassword.select();
  } finally {
    accessSubmit.disabled = false;
  }
});

// Acesso & Cadastro (Entrar / Criar Conta própria)
const tabLoginBtn = document.querySelector('#tabLoginBtn');
const tabRegisterBtn = document.querySelector('#tabRegisterBtn');
const registerForm = document.querySelector('#registerForm');
const regUsername = document.querySelector('#regUsername');
const regPassword = document.querySelector('#regPassword');
const regConfirmPassword = document.querySelector('#regConfirmPassword');
const registerSubmit = document.querySelector('#registerSubmit');
const registerError = document.querySelector('#registerError');
const registerSuccess = document.querySelector('#registerSuccess');

if (tabLoginBtn && tabRegisterBtn && registerForm && accessForm) {
  tabLoginBtn.addEventListener('click', () => {
    tabLoginBtn.classList.add('active');
    tabRegisterBtn.classList.remove('active');
    accessForm.hidden = false;
    registerForm.hidden = true;
  });

  tabRegisterBtn.addEventListener('click', () => {
    tabRegisterBtn.classList.add('active');
    tabLoginBtn.classList.remove('active');
    accessForm.hidden = true;
    registerForm.hidden = false;
  });
}

if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    registerError.textContent = '';
    registerSuccess.textContent = '';

    const username = regUsername.value.trim();
    const password = regPassword.value.trim();
    const confirm = regConfirmPassword.value.trim();

    if (!username || !password) {
      registerError.textContent = 'Digite um usuário e uma senha.';
      return;
    }

    if (password !== confirm) {
      registerError.textContent = 'As senhas não coincidem!';
      return;
    }

    registerSubmit.disabled = true;

    try {
      const response = await fetch(`${apiBase}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Erro ao criar conta.');
      }

      registerSuccess.textContent = '✅ Conta criada com sucesso! Entrando...';
      setTimeout(() => {
        showApp();
      }, 1000);
    } catch (err) {
      registerError.textContent = err.message || 'Erro ao realizar cadastro.';
    } finally {
      registerSubmit.disabled = false;
    }
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const content = input.value.trim();
  if (!content) return;

  // Check for Dev commands first
  const devCommand = parseDevCommand(content);

  if (devCommand) {
    history.push({ role: "user", content });
    input.value = "";
    input.style.height = "auto";
    render();

    const assistantMessage = { role: "assistant", content: "" };
    history.push(assistantMessage);
    saveHistory();
    render();

    if (devCommand.action === 'listFiles' || devCommand.action === 'readFile') {
      // Read-only actions don't need approval
      const endpoint = devCommand.action === 'listFiles' ? '/api/dev/files' : '/api/dev/file';
      const param = devCommand.action === 'listFiles' ? 'path' : 'path';
      const url = `${apiBase}${endpoint}?${param}=${encodeURIComponent(devCommand.details.path || '')}`;

      try {
        const response = await fetch(url);
        const result = await response.json();

        if (result.ok) {
          if (devCommand.action === 'listFiles') {
            assistantMessage.content = `Arquivos encontrados:\n${result.files.map(f => `- ${f.type}: ${f.name}`).join('\n')}`;
          } else {
            assistantMessage.content = `Conteúdo do arquivo:\n\`\`\`\n${result.content}\n\`\`\``;
          }
          addDevHistory(devCommand.action, devCommand.details, 'success');
        } else {
          assistantMessage.content = `Erro: ${result.error}`;
          addDevHistory(devCommand.action, devCommand.details, 'error');
        }
      } catch (error) {
        assistantMessage.content = `Erro ao executar ação: ${error.message}`;
        addDevHistory(devCommand.action, devCommand.details, 'error');
      }
    } else {
      // Actions that may require approval
      const result = await executeDevAction(devCommand.action, devCommand.details);

      if (result === null) {
        // Action requires approval, waiting for user
        assistantMessage.content = "Aguardando aprovação do usuário...";
        return;
      }

      if (result.ok) {
        assistantMessage.content = "Ação executada com sucesso.";
      } else {
        assistantMessage.content = `Erro ao executar ação: ${result.error}`;
      }
    }

    saveHistory();
    render();
    return;
  }

  // Normal chat flow
  history.push({ role: "user", content });
  input.value = "";
  input.style.height = "auto";
  setBusy(true);
  saveHistory();
  render();
  scrollToBottom();

  const assistantMessage = { role: "assistant", content: "" };
  history.push(assistantMessage);
  saveHistory();
  render();
  showTypingIndicator();

  try {
    const response = await fetch(`${apiBase}/api/chat-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: history
          .filter((message) => message.role !== "system")
          .slice(0, -1),
        settings
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Nao consegui falar com a API agora.");
    }

    hideTypingIndicator();
    await readStreamingReply(response, assistantMessage);
    assistantMessage.content = assistantMessage.content.trim() || "Nao recebi uma resposta da IA.";
    applyAssistantConfig(assistantMessage);
    prepareFileProfileEdit(assistantMessage);
    saveHistory();
    render();
    scrollToBottom();
  } catch (error) {
    hideTypingIndicator();
    assistantMessage.content = error.message || "Nao consegui responder agora.";
    saveHistory();
    render();
    scrollToBottom();
  } finally {
    setBusy(false);
    input.focus();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

clearButton.addEventListener("click", () => {
  history = [
    {
      role: "assistant",
      content: "Conversa limpa. Me diga no que voce quer focar agora."
    }
  ];
  saveHistory();
  render();
  scrollToBottom();
  input.focus();
});

exportButton.addEventListener("click", exportConversation);

personalitySelect.addEventListener("change", () => {
  settings.personality = personalitySelect.value;
  saveSettings();
});

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    settings.mode = button.dataset.mode || "normal";
    saveSettings();
    syncModeUI();
    input.focus();
  });
}

devModeButton.addEventListener("click", () => {
  settings.devMode = !settings.devMode;
  saveSettings();
  syncDevModeUI();

  history.push({
    role: "assistant",
    content: settings.devMode
      ? "Modo Dev ativado. Agora posso ajudar a configurar minha personalidade e memoria pelo chat. Você pode usar comandos como:\n- 'criar arquivo caminho/arquivo.js: conteúdo'\n- 'ler arquivo caminho/arquivo.js'\n- 'listar arquivos diretorio'\n- 'executar comando npm install'\n- 'instalar dependência nome-do-pacote'"
      : "Modo Dev desativado. Voltei ao modo normal."
  });
  saveHistory();
  render();
});

devHistoryButton.addEventListener("click", () => {
  devHistoryPanel.hidden = false;
  renderDevHistory();
});

memoryButton.addEventListener("click", () => {
  memoryInput.value = settings.memory;
  memoryModal.hidden = false;
  memoryInput.focus();
});

closeMemoryButton.addEventListener("click", closeMemory);
cancelFileEditButton.addEventListener("click", closeFileApproval);

saveMemoryButton.addEventListener("click", () => {
  settings.memory = memoryInput.value.trim();
  saveSettings();
  closeMemory();
});

memoryModal.addEventListener("click", (event) => {
  if (event.target === memoryModal) closeMemory();
});

fileApprovalModal.addEventListener("click", (event) => {
  if (event.target === fileApprovalModal) closeFileApproval();
});

applyFileEditButton.addEventListener("click", applyPendingFileProfile);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !memoryModal.hidden) closeMemory();
  if (event.key === "Escape" && !fileApprovalModal.hidden) closeFileApproval();
});

messagesEl.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-message-action]");
  if (!button) return;

  const index = Number(button.dataset.messageIndex);
  const message = history[index];
  if (!message?.content) return;

  if (button.dataset.messageAction === "copy") {
    await copyText(message.content);
    flashButton(button, "Copiado");
  }

  if (button.dataset.messageAction === "speak") {
    speakText(message.content);
  }
});

function render() {
  messagesEl.innerHTML = "";

  for (const [index, message] of history.entries()) {
    const article = document.createElement("article");
    article.className = `message ${message.role}`;
    if (message.role === "assistant" && !message.content) {
      article.classList.add("typing");
    }

    const label = document.createElement("span");
    label.className = "message-label";
    label.textContent = message.role === "user" ? "Voce" : (loadAppSettings().aiName || "Alya");

    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = message.content || "Pensando...";

    article.append(label, content);

    if (message.role === "assistant" && message.content) {
      const actions = document.createElement("div");
      actions.className = "message-actions";

      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.dataset.messageAction = "copy";
      copyButton.dataset.messageIndex = String(index);
      copyButton.title = "Copiar resposta";
      copyButton.setAttribute("aria-label", "Copiar resposta");
      copyButton.textContent = "Copiar";

      const speakButton = document.createElement("button");
      speakButton.type = "button";
      speakButton.dataset.messageAction = "speak";
      speakButton.dataset.messageIndex = String(index);
      speakButton.title = "Ouvir resposta";
      speakButton.setAttribute("aria-label", "Ouvir resposta");
      speakButton.textContent = "Ouvir";

      actions.append(copyButton, speakButton);
      article.append(actions);
    }

    messagesEl.append(article);
  }

  scrollToBottom();
}

function setBusy(isBusy) {
  sendButton.disabled = isBusy;
  input.disabled = isBusy;

  const statusPill = document.querySelector('.status-pill');
  if (isBusy) {
    statusPill.textContent = 'digitando...';
    statusPill.style.color = 'var(--accent-warm)';
  } else {
    statusPill.textContent = 'pronta';
    statusPill.style.color = 'var(--accent)';
  }
}

async function readStreamingReply(response, assistantMessage) {
  if (!response.body) {
    const text = await response.text();
    assistantMessage.content = text;
    if (text.length > 300) {
      const contentEl = messagesEl.querySelector('.message.assistant:last-child .message-content');
      if (contentEl) {
        hideTypingIndicator();
        await typeWriter(contentEl, text, 16);
        assistantMessage.content = text;
        return;
      }
    }
    hideTypingIndicator();
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let renderScheduled = false;

  function scheduleRender() {
    if (!renderScheduled) {
      renderScheduled = true;
      requestAnimationFrame(() => {
        render();
        scrollToBottom();
        renderScheduled = false;
      });
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    assistantMessage.content += decoder.decode(value, { stream: true });
    scheduleRender();
  }

  const rest = decoder.decode();
  if (rest) assistantMessage.content += rest;
  render();
  scrollToBottom();
}

function compress(str) {
  try {
    return LZString.compressToUTF16(str);
  } catch {
    return str;
  }
}

function decompress(str) {
  try {
    return LZString.decompressFromUTF16(str);
  } catch {
    return str;
  }
}

function loadHistory() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return [];
    const decompressed = decompress(saved);
    return Array.isArray(JSON.parse(decompressed)) ? JSON.parse(decompressed) : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    const toSave = JSON.stringify(history.slice(-50));
    localStorage.setItem(storageKey, compress(toSave));
  } catch (error) {
    console.error("Error saving history:", error);
  }
}

function loadConversations() {
  try {
    const saved = localStorage.getItem("nova-conversations");
    if (!saved) return [];
    const decompressed = decompress(saved);
    return Array.isArray(JSON.parse(decompressed)) ? JSON.parse(decompressed) : [];
  } catch {
    return [];
  }
}

function saveConversations() {
  try {
    const toSave = JSON.stringify(conversations);
    localStorage.setItem("nova-conversations", compress(toSave));
  } catch (error) {
    console.error("Error saving conversations:", error);
  }
}

function createNewConversation() {
  const id = Date.now().toString(36) + Math.random().toString(36).substring(2);
  const conversation = {
    id,
    title: "Nova conversa",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  conversations.unshift(conversation);
  saveConversations();
  renderSidebarConversations();
  scrollToBottom();
  return id;
}

function updateConversationTitle(conversationId, firstMessage) {
  const conversation = conversations.find(c => c.id === conversationId);
  if (conversation && conversation.title === "Nova conversa") {
    conversation.title = firstMessage.slice(0, 30) + (firstMessage.length > 30 ? "..." : "");
    conversation.updatedAt = new Date().toISOString();
    saveConversations();
  }
}

function loadDevHistory() {
  try {
    const saved = localStorage.getItem("nova-dev-history");
    if (!saved) return [];
    const decompressed = decompress(saved);
    return Array.isArray(JSON.parse(decompressed)) ? JSON.parse(decompressed) : [];
  } catch {
    return [];
  }
}

function saveDevHistory() {
  try {
    const toSave = JSON.stringify(devHistory.slice(-50));
    localStorage.setItem("nova-dev-history", compress(toSave));
  } catch (error) {
    console.error("Error saving dev history:", error);
  }
}

function addDevHistory(action, details, status = 'success') {
  devHistory.unshift({
    id: Date.now().toString(36),
    action,
    details,
    status,
    timestamp: new Date().toISOString()
  });
  saveDevHistory();
}

function showDevApproval(action, details) {
  pendingDevAction = { action, details };

  let content = `<p class="warning">${details.warning || 'Esta ação requer sua aprovação.'}</p>`;

  if (action === 'writeFile') {
    content += `<p><strong>Arquivo:</strong> <code>${details.path}</code></p>`;
    content += `<p><strong>Conteúdo:</strong></p>`;
    content += `<pre>${escapeHtml(details.content)}</pre>`;
  } else if (action === 'executeCommand') {
    content += `<p><strong>Comando:</strong> <code>${escapeHtml(details.command)}</code></p>`;
  } else if (action === 'installDependency') {
    content += `<p><strong>Pacote:</strong> <code>${escapeHtml(details.package)}</code></p>`;
  }

  devApprovalContent.innerHTML = content;
  devApprovalModal.hidden = false;
}

async function executeDevAction(action, details, approved = false) {
  const endpoint = getDevEndpoint(action);

  try {
    const response = await fetch(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...details, approved })
    });
    const result = await response.json();

    if (result.requiresApproval) {
      showDevApproval(action, result);
      return null;
    }

    addDevHistory(action, details, result.ok ? 'success' : 'error');
    return result;
  } catch (error) {
    addDevHistory(action, details, 'error');
    console.error('Dev action error:', error);
    return { ok: false, error: error.message };
  }
}

function getDevEndpoint(action) {
  const endpoints = {
    writeFile: '/api/dev/file',
    executeCommand: '/api/dev/command',
    installDependency: '/api/dev/install',
    createBackup: '/api/dev/backup',
    restoreBackup: '/api/dev/restore'
  };
  return endpoints[action] || '';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function parseDevCommand(message) {
  if (!settings.devMode) return null;

  const patterns = [
    {
      regex: /(?:criar|editar|modificar)\s+(?:o\s+)?arquivo\s+(.+?):\s*(.+)/is,
      action: 'writeFile',
      extract: (match) => ({ path: match[1].trim(), content: match[2].trim() })
    },
    {
      regex: /(?:executar|rodar)\s+(?:o\s+)?comando\s+(.+)/is,
      action: 'executeCommand',
      extract: (match) => ({ command: match[1].trim() })
    },
    {
      regex: /(?:instalar|adicionar)\s+(?:a\s+)?depend[êe]ncia\s+(.+)/is,
      action: 'installDependency',
      extract: (match) => ({ package: match[1].trim() })
    },
    {
      regex: /(?:listar|ver)\s+(?:os\s+)?arquivos\s+(?:do\s+)?(?:diret[óo]rio\s+)?(.*)/is,
      action: 'listFiles',
      extract: (match) => ({ path: match[1].trim() || null })
    },
    {
      regex: /(?:ler|ver)\s+(?:o\s+)?arquivo\s+(.+)/is,
      action: 'readFile',
      extract: (match) => ({ path: match[1].trim() })
    },
    {
      regex: /(?:criar|fazer)\s+(?:um\s+)?backup\s+(?:do\s+)?arquivo\s+(.+)/is,
      action: 'createBackup',
      extract: (match) => ({ path: match[1].trim() })
    }
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern.regex);
    if (match) {
      return {
        action: pattern.action,
        details: pattern.extract(match)
      };
    }
  }

  return null;
}

function closeMemory() {
  memoryModal.hidden = true;
  memoryButton.focus();
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey) || "{}");
    return {
      personality: ["equilibrada", "direta", "amiga", "tecnica", "jarvis"].includes(saved.personality)
        ? saved.personality
        : "jarvis",
      mode: ["normal", "estudo", "criativo", "codigo", "rapido"].includes(saved.mode)
        ? saved.mode
        : "normal",
      memory: typeof saved.memory === "string" ? saved.memory.slice(0, 2000) : "",
      devMode: Boolean(saved.devMode)
    };
  } catch {
    return { personality: "jarvis", mode: "normal", memory: "", devMode: false };
  }
}

function saveSettings() {
  localStorage.setItem(settingsKey, JSON.stringify(settings));
}

async function loadFileProfile() {
  try {
    const response = await fetch(`${apiBase}/api/dev/profile`);
    const data = await response.json();
    if (!data.ok || !data.profile) return;

    settings.personality = data.profile.personality || settings.personality;
    settings.memory = data.profile.memory || settings.memory;
    personalitySelect.value = settings.personality;
    memoryInput.value = settings.memory;
    syncModeUI();
    saveSettings();
  } catch {
    // Keep browser settings when the profile file cannot be loaded.
  }
}

async function boot() {
  showApp();
}

function showApp() {
  if (accessGate) accessGate.hidden = true;
  if (appShell) appShell.hidden = false;
  renderSidebarConversations();
  updateWelcomeVisibility();
  loadFileProfile();
  render();
  showWelcomeSplash();
}
function applyAssistantConfig(assistantMessage) {
  const configPattern = /\[\[NOVA_CONFIG:({[\s\S]*?})\]\]/;
  const match = assistantMessage.content.match(configPattern);
  if (!match) return;

  assistantMessage.content = assistantMessage.content.replace(configPattern, "").trim();

  try {
    const config = JSON.parse(match[1]);
    const updates = [];

    if (["equilibrada", "direta", "amiga", "tecnica", "jarvis"].includes(config.personality)) {
      settings.personality = config.personality;
      personalitySelect.value = config.personality;
      updates.push(`personalidade: ${labelPersonality(config.personality)}`);
    }

    if (typeof config.memoryAppend === "string" && config.memoryAppend.trim()) {
      const addition = config.memoryAppend.trim().slice(0, 500);
      settings.memory = [settings.memory, addition].filter(Boolean).join("\n").slice(0, 2000);
      memoryInput.value = settings.memory;
      updates.push("memoria atualizada");
    }

    if (typeof config.memoryReplace === "string") {
      settings.memory = config.memoryReplace.trim().slice(0, 2000);
      memoryInput.value = settings.memory;
      updates.push("memoria substituida");
    }

    saveSettings();

    if (updates.length > 0) {
      assistantMessage.content += `\n\nConfiguracao aplicada: ${updates.join(", ")}.`;
    }
  } catch {
    assistantMessage.content += "\n\nNao consegui aplicar a configuracao automaticamente.";
  }
}

function prepareFileProfileEdit(assistantMessage) {
  const configPattern = /\[\[NOVA_PROFILE_FILE:({[\s\S]*?})\]\]/;
  const match = assistantMessage.content.match(configPattern);
  if (!match) return;

  assistantMessage.content = assistantMessage.content.replace(configPattern, "").trim();

  try {
    const config = JSON.parse(match[1]);
    const profile = {
      name: "Alya",
      personality: settings.personality,
      memory: settings.memory
    };

    if (["equilibrada", "direta", "amiga", "tecnica", "jarvis"].includes(config.personality)) {
      profile.personality = config.personality;
    }

    if (typeof config.memoryAppend === "string" && config.memoryAppend.trim()) {
      profile.memory = [profile.memory, config.memoryAppend.trim().slice(0, 500)]
        .filter(Boolean)
        .join("\n")
        .slice(0, 2000);
    }

    if (typeof config.memoryReplace === "string") {
      profile.memory = config.memoryReplace.trim().slice(0, 2000);
    }

    pendingFileProfile = profile;
    filePreview.textContent = JSON.stringify(profile, null, 2);
    fileApprovalModal.hidden = false;
  } catch {
    assistantMessage.content += "\n\nNao consegui preparar a alteracao de arquivo.";
  }
}

async function applyPendingFileProfile() {
  if (!pendingFileProfile) return;

  applyFileEditButton.disabled = true;

  try {
    const response = await fetch(`${apiBase}/api/dev/apply-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmed: true,
        profile: pendingFileProfile
      })
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Nao consegui gravar o arquivo.");
    }

    settings.personality = data.profile.personality;
    settings.memory = data.profile.memory;
    personalitySelect.value = settings.personality;
    memoryInput.value = settings.memory;
    saveSettings();

    history.push({
      role: "assistant",
      content: `Arquivo seguro atualizado: ${data.file}. Backup: ${data.backup || "nao precisava"}.`
    });
    saveHistory();
    render();
    closeFileApproval();
  } catch (error) {
    history.push({
      role: "assistant",
      content: error.message || "Nao consegui gravar o arquivo com seguranca."
    });
    saveHistory();
    render();
  } finally {
    applyFileEditButton.disabled = false;
  }
}

function closeFileApproval() {
  fileApprovalModal.hidden = true;
  pendingFileProfile = null;
  filePreview.textContent = "";
  devModeButton.focus();
}

function labelPersonality(value) {
  return {
    equilibrada: "Equilibrada",
    direta: "Direta",
    amiga: "Amiga",
    tecnica: "Tecnica",
    jarvis: "Jarvis"
  }[value] || value;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const temporary = document.createElement("textarea");
  temporary.value = text;
  temporary.style.position = "fixed";
  temporary.style.opacity = "0";
  document.body.append(temporary);
  temporary.select();
  document.execCommand("copy");
  temporary.remove();
}

function flashButton(button, text) {
  const original = button.textContent;
  button.textContent = text;
  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

function speakText(text) {
  if (!("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();
  const speech = new SpeechSynthesisUtterance(text.slice(0, 1200));
  speech.lang = "pt-BR";
  speech.rate = 1;
  window.speechSynthesis.speak(speech);
}

function exportConversation() {
  const format = prompt("Escolha o formato: txt, json, md, pdf");
  if (!format) return;

  const stamp = new Date().toISOString().slice(0, 10);
  let content, mimeType, filename;

  switch (format.toLowerCase()) {
    case 'json':
      content = JSON.stringify(history, null, 2);
      mimeType = 'application/json';
      filename = `conversa-alya-${stamp}.json`;
      break;
    case 'md':
      content = history.map((message) => {
        const label = message.role === "user" ? "### Você" : "### " + (loadAppSettings().aiName || "Alya");
        return `${label}\n\n${message.content}\n\n---`;
      }).join('\n');
      mimeType = 'text/markdown';
      filename = `conversa-alya-${stamp}.md`;
      break;
    case 'pdf':
      exportToPDF(stamp);
      return;
    case 'txt':
    default:
      content = history.map((message) => {
        const label = message.role === "user" ? "Voce" : (loadAppSettings().aiName || "Alya");
        return `${label}: ${message.content}`;
      }).join('\n\n');
      mimeType = 'text/plain';
      filename = `conversa-alya-${stamp}.txt`;
  }

  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportToPDF(stamp) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  let y = 20;
  doc.setFontSize(16);
  doc.text('Conversa com ' + (loadAppSettings().aiName || 'Alya'), 20, y);
  y += 15;

  doc.setFontSize(12);
  history.forEach((message) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }

    const label = message.role === "user" ? "Você:" : (loadAppSettings().aiName || "Alya") + ":";
    doc.setFont(undefined, 'bold');
    doc.text(label, 20, y);
    y += 7;

    doc.setFont(undefined, 'normal');
    const lines = doc.splitTextToSize(message.content, 170);
    lines.forEach((line) => {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      doc.text(line, 20, y);
      y += 5;
    });
    y += 5;
  });

  doc.save(`conversa-alya-${stamp}.pdf`);
}

// WhatsApp approval system
const whatsappPanel = document.querySelector("#whatsappPanel");
const whatsappQueue = document.querySelector("#whatsappQueue");
const closeWhatsappButton = document.querySelector("#closeWhatsappButton");
const refreshWhatsappButton = document.querySelector("#refreshWhatsappButton");
const viewWhatsappLogButton = document.querySelector("#viewWhatsappLogButton");
const whatsappLogModal = document.querySelector("#whatsappLogModal");
const whatsappLogContent = document.querySelector("#whatsappLogContent");
const closeWhatsappLogButton = document.querySelector("#closeWhatsappLogButton");
const whatsappButton = document.querySelector("#whatsappButton");
const discordPanel = document.querySelector("#discordPanel");
const discordQueueEl = document.querySelector("#discordQueue");
const closeDiscordButton = document.querySelector("#closeDiscordButton");
const refreshDiscordButton = document.querySelector("#refreshDiscordButton");
const viewDiscordLogButton = document.querySelector("#viewDiscordLogButton");
const discordLogModal = document.querySelector("#discordLogModal");
const discordLogContent = document.querySelector("#discordLogContent");
const closeDiscordLogButton = document.querySelector("#closeDiscordLogButton");
const discordButton = document.querySelector("#discordButton");
const themeButton = document.querySelector("#themeButton");
const apiStatus = document.querySelector("#apiStatus");
const searchButton = document.querySelector("#searchButton");
const newConversationButton = document.querySelector("#newConversationButton");
const searchPanel = document.querySelector("#searchPanel");
const searchInput = document.querySelector("#searchInput");
const searchResults = document.querySelector("#searchResults");
const closeSearchButton = document.querySelector("#closeSearchButton");
const conversationsPanel = document.querySelector("#conversationsPanel");
const conversationsList = document.querySelector("#conversationsList");
const closeConversationsButton = document.querySelector("#closeConversationsButton");
const devApprovalModal = document.querySelector("#devApprovalModal");
const closeDevApprovalButton = document.querySelector("#closeDevApprovalButton");
const approveDevAction = document.querySelector("#approveDevAction");
const rejectDevAction = document.querySelector("#rejectDevAction");
const devHistoryPanel = document.querySelector("#devHistoryPanel");
const devHistoryList = document.querySelector("#devHistoryList");
const closeDevHistoryButton = document.querySelector("#closeDevHistoryButton");
const settingsModal = document.querySelector("#settingsModal");
const closeSettingsButton = document.querySelector("#closeSettingsButton");
const saveSettingsButton = document.querySelector("#saveSettingsButton");
const settingsLanguage = document.querySelector("#settingsLanguage");
const settingsAiName = document.querySelector("#settingsAiName");
const settingsUserName = document.querySelector("#settingsUserName");
const settingsWelcomeToggle = document.querySelector("#settingsWelcomeToggle");
const settingsSoundToggle = document.querySelector("#settingsSoundToggle");
const settingsNavItems = document.querySelectorAll(".settings-nav-item");
const settingsTabs = document.querySelectorAll(".settings-tab");

let whatsappMessages = [];
let isDarkTheme = true;
let devHistory = loadDevHistory();
let pendingDevAction = null;

function loadAppSettings() {
  try {
    const raw = localStorage.getItem("nova-app-settings");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAppSettings(updates) {
  const current = loadAppSettings();
  Object.assign(current, updates);
  localStorage.setItem("nova-app-settings", JSON.stringify(current));
}

function openSettings() {
  if (!settingsModal) return;
  const appSettings = loadAppSettings();
  if (settingsLanguage) settingsLanguage.value = appSettings.language || "pt-BR";
  if (settingsAiName) settingsAiName.value = appSettings.aiName || "Alya";
  if (settingsUserName) settingsUserName.value = appSettings.userName || getUserName();
  if (settingsWelcomeToggle) settingsWelcomeToggle.checked = getWelcomeEnabled();
  if (settingsSoundToggle) settingsSoundToggle.checked = appSettings.soundEnabled !== false;
  switchSettingsTab("general");
  settingsModal.hidden = false;
}

function closeSettings() {
  if (settingsModal) settingsModal.hidden = true;
}

function switchSettingsTab(tabId) {
  settingsNavItems.forEach(btn => btn.classList.toggle("active", btn.dataset.settingsTab === tabId));
  settingsTabs.forEach(tab => tab.hidden = tab.dataset.tab !== tabId);
}

function applySettings() {
  const updates = {
    language: settingsLanguage?.value || "pt-BR",
    aiName: settingsAiName?.value?.trim() || "Alya",
    userName: settingsUserName?.value?.trim() || "Pedro",
    welcomeEnabled: settingsWelcomeToggle?.checked ?? true,
    soundEnabled: settingsSoundToggle?.checked ?? true
  };
  saveAppSettings(updates);
  if (settingsUserName?.value?.trim()) localStorage.setItem("nova-username", settingsUserName.value.trim());
  setWelcomeEnabled(updates.welcomeEnabled);
  closeSettings();
}

closeWhatsappButton.addEventListener("click", () => {
  whatsappPanel.hidden = true;
});

whatsappButton.addEventListener("click", () => {
  whatsappPanel.hidden = false;
  loadWhatsappQueue();
});

discordButton.addEventListener("click", () => {
  discordPanel.hidden = false;
  loadDiscordQueue();
});

closeDiscordButton.addEventListener("click", () => {
  discordPanel.hidden = true;
});

refreshDiscordButton.addEventListener("click", loadDiscordQueue);
viewDiscordLogButton.addEventListener("click", loadDiscordLog);

closeDiscordLogButton.addEventListener("click", () => {
  discordLogModal.hidden = true;
});

discordLogModal.addEventListener("click", (event) => {
  if (event.target === discordLogModal) discordLogModal.hidden = false;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !whatsappLogModal.hidden) whatsappLogModal.hidden = true;
  if (event.key === "Escape" && !discordLogModal.hidden) discordLogModal.hidden = true;
});

themeButton.addEventListener("click", toggleTheme);

searchButton.addEventListener("click", () => {
  searchPanel.hidden = false;
  searchInput.focus();
});

closeSearchButton.addEventListener("click", () => {
  searchPanel.hidden = true;
});

searchInput.addEventListener("input", () => {
  const query = searchInput.value.toLowerCase().trim();
  if (!query) {
    searchResults.innerHTML = '<p class="whatsapp-empty">Digite para buscar...</p>';
    return;
  }

  const results = history.filter((message) =>
    message.content.toLowerCase().includes(query)
  );

  if (results.length === 0) {
    searchResults.innerHTML = '<p class="whatsapp-empty">Nenhum resultado encontrado.</p>';
    return;
  }

  searchResults.innerHTML = results.map((message, index) => `
    <div class="search-result">
      <span class="search-role">${message.role === 'user' ? 'Você' : (loadAppSettings().aiName || 'Alya')}:</span>
      <p class="search-content">${message.content.slice(0, 200)}${message.content.length > 200 ? '...' : ''}</p>
    </div>
  `).join('');
});

searchPanel.addEventListener("click", (event) => {
  if (event.target === searchPanel) searchPanel.hidden = true;
});

newConversationButton.addEventListener("click", () => {
  conversationsPanel.hidden = false;
  renderConversationsList();
});

closeConversationsButton.addEventListener("click", () => {
  conversationsPanel.hidden = true;
});

closeDevApprovalButton.addEventListener("click", () => {
  devApprovalModal.hidden = true;
  pendingDevAction = null;
});

approveDevAction.addEventListener("click", async () => {
  if (!pendingDevAction) return;
  const result = await executeDevAction(pendingDevAction.action, pendingDevAction.details, true);
  devApprovalModal.hidden = true;
  pendingDevAction = null;
  if (result) {
    history.push({
      role: "assistant",
      content: result.ok ? "Ação executada com sucesso." : `Erro ao executar ação: ${result.error}`
    });
    render();
  }
});

rejectDevAction.addEventListener("click", () => {
  devApprovalModal.hidden = true;
  pendingDevAction = null;
  history.push({
    role: "assistant",
    content: "Ação rejeitada pelo usuário."
  });
  render();
});

closeDevHistoryButton.addEventListener("click", () => {
  devHistoryPanel.hidden = true;
});

devHistoryPanel.addEventListener("click", (event) => {
  if (event.target === devHistoryPanel) devHistoryPanel.hidden = true;
});

conversationsPanel.addEventListener("click", (event) => {
  if (event.target === conversationsPanel) conversationsPanel.hidden = true;
});

function renderConversationsList() {
  if (conversations.length === 0) {
    conversationsList.innerHTML = '<p class="whatsapp-empty">Nenhuma conversa salva.</p>';
    return;
  }

  conversationsList.innerHTML = conversations.map((conv) => `
    <div class="conversation-item ${conv.id === currentConversationId ? 'active' : ''}" data-id="${conv.id}">
      <div class="conversation-title">${conv.title}</div>
      <div class="conversation-date">${new Date(conv.updatedAt).toLocaleDateString('pt-BR')}</div>
      <button class="delete-conversation" data-id="${conv.id}" title="Excluir">&#215;</button>
    </div>
  `).join('');

  conversationsList.querySelectorAll('.conversation-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-conversation')) return;
      switchConversation(item.dataset.id);
    });
  });

  conversationsList.querySelectorAll('.delete-conversation').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(btn.dataset.id);
    });
  });
}

function renderDevHistory() {
  if (devHistory.length === 0) {
    devHistoryList.innerHTML = '<p class="whatsapp-empty">Nenhuma ação Dev registrada.</p>';
    return;
  }

  devHistoryList.innerHTML = devHistory.map(item => `
    <div class="dev-history-item ${item.status}">
      <div class="dev-history-action">${item.action}</div>
      <div class="dev-history-details">${JSON.stringify(item.details)}</div>
      <div class="dev-history-timestamp">${new Date(item.timestamp).toLocaleString('pt-BR')}</div>
      ${item.status === 'success' ? `
        <div class="dev-history-rollback">
          <button onclick="rollbackDevAction('${item.id}')">Rollback</button>
        </div>
      ` : ''}
    </div>
  `).join('');
}

async function rollbackDevAction(id) {
  const action = devHistory.find(a => a.id === id);
  if (!action) return;

  if (action.action === 'writeFile') {
    const backupResult = await executeDevAction('createBackup', { path: action.details.path });
    if (backupResult && backupResult.ok) {
      addDevHistory('rollback', { originalId: id }, 'success');
      alert('Backup criado antes de rollback.');
    }
  }
}

function switchConversation(conversationId) {
  currentConversationId = conversationId;
  conversationsPanel.hidden = true;
  renderConversationsList();
  renderSidebarConversations();
  scrollToBottom();
  input.focus();
}

function deleteConversation(conversationId) {
  if (!confirm('Tem certeza que deseja excluir esta conversa?')) return;

  conversations = conversations.filter(c => c.id !== conversationId);
  saveConversations();

  if (currentConversationId === conversationId) {
    if (conversations.length > 0) {
      currentConversationId = conversations[0].id;
    } else {
      currentConversationId = createNewConversation();
    }
  }

  renderConversationsList();
  renderSidebarConversations();
}

async function checkApiStatus() {
  try {
    const response = await fetch(`${apiBase}/health`);
    const data = await response.json();
    apiStatus.textContent = data.ok ? "API OK" : "API Error";
    apiStatus.style.color = data.ok ? "var(--accent)" : "var(--danger)";
  } catch {
    apiStatus.textContent = "API Offline";
    apiStatus.style.color = "var(--danger)";
  }
}

function toggleTheme() {
  isDarkTheme = !isDarkTheme;
  document.documentElement.style.setProperty('--bg', isDarkTheme ? '#090b10' : '#f5f7fb');
  document.documentElement.style.setProperty('--surface', isDarkTheme ? 'rgba(17, 21, 30, 0.92)' : 'rgba(255, 255, 255, 0.92)');
  document.documentElement.style.setProperty('--ink', isDarkTheme ? '#f5f7fb' : '#1a1a2e');
  document.documentElement.style.setProperty('--muted', isDarkTheme ? '#a8b0c0' : '#6b7280');
  document.documentElement.style.colorScheme = isDarkTheme ? 'dark' : 'light';
  themeButton.querySelector('span').textContent = isDarkTheme ? '&#9728;' : '&#127769;';
}

closeWhatsappLogButton.addEventListener("click", () => {
  whatsappLogModal.hidden = true;
});

whatsappLogModal.addEventListener("click", (event) => {
  if (event.target === whatsappLogModal) whatsappLogModal.hidden = false;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !whatsappLogModal.hidden) whatsappLogModal.hidden = true;
});

async function loadWhatsappQueue() {
  try {
    const response = await fetch(`${apiBase}/api/whatsapp/queue`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Nao consegui carregar a fila.");
    }

    whatsappMessages = data.queue || [];
    renderWhatsappQueue();
  } catch (error) {
    whatsappQueue.innerHTML = `<p class="whatsapp-empty">Erro ao carregar: ${error.message}</p>`;
  }
}

function renderWhatsappQueue() {
  if (whatsappMessages.length === 0) {
    whatsappQueue.innerHTML = '<p class="whatsapp-empty">Nenhuma mensagem pendente.</p>';
    return;
  }

  whatsappQueue.innerHTML = "";

  for (const message of whatsappMessages) {
    const div = document.createElement("div");
    div.className = "whatsapp-message";
    div.dataset.id = message.id;

    const header = document.createElement("div");
    header.className = "whatsapp-message-header";

    const contactDiv = document.createElement("div");
    contactDiv.className = "whatsapp-contact";
    contactDiv.textContent = message.contactName || "Contato desconhecido";

    const phoneDiv = document.createElement("div");
    phoneDiv.className = "whatsapp-phone";
    phoneDiv.textContent = message.from;

    const timeDiv = document.createElement("div");
    timeDiv.className = "whatsapp-time";
    timeDiv.textContent = new Date(message.receivedAt).toLocaleString("pt-BR");

    const contactInfo = document.createElement("div");
    contactInfo.append(contactDiv, phoneDiv, timeDiv);

    header.append(contactInfo);

    const messageContent = document.createElement("div");
    messageContent.className = "whatsapp-message-content";
    messageContent.textContent = message.message;

    const replyDiv = document.createElement("div");
    replyDiv.className = "whatsapp-reply";
    replyDiv.textContent = message.aiReply;

    const editTextarea = document.createElement("textarea");
    editTextarea.className = "whatsapp-reply-edit";
    editTextarea.rows = "3";
    editTextarea.placeholder = "Editar resposta antes de enviar...";
    editTextarea.value = message.aiReply;

    const actions = document.createElement("div");
    actions.className = "whatsapp-message-actions";

    const approveButton = document.createElement("button");
    approveButton.type = "button";
    approveButton.className = "tool-button primary";
    approveButton.textContent = "Aprovar";
    approveButton.onclick = () => approveWhatsappMessage(message.id, editTextarea.value);

    const editApproveButton = document.createElement("button");
    editApproveButton.type = "button";
    editApproveButton.className = "tool-button";
    editApproveButton.textContent = "Aprovar Editado";
    editApproveButton.onclick = () => approveWhatsappMessage(message.id, editTextarea.value);

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "tool-button";
    cancelButton.textContent = "Cancelar";
    cancelButton.style.color = "var(--danger)";
    cancelButton.onclick = () => cancelWhatsappMessage(message.id);

    actions.append(approveButton, editApproveButton, cancelButton);

    div.append(header, messageContent, replyDiv, editTextarea, actions);
    whatsappQueue.append(div);
  }
}

async function approveWhatsappMessage(id, reply) {
  try {
    const response = await fetch(`${apiBase}/api/whatsapp/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, reply })
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Nao consegui aprovar a mensagem.");
    }

    loadWhatsappQueue();
  } catch (error) {
    alert(`Erro: ${error.message}`);
  }
}

async function cancelWhatsappMessage(id) {
  if (!confirm("Tem certeza que deseja cancelar este envio?")) return;

  try {
    const response = await fetch(`${apiBase}/api/whatsapp/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Nao consegui cancelar o envio.");
    }

    loadWhatsappQueue();
  } catch (error) {
    alert(`Erro: ${error.message}`);
  }
}

async function loadWhatsappLog() {
  try {
    const response = await fetch(`${apiBase}/api/whatsapp/log`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Nao consegui carregar o log.");
    }

    const log = data.log || [];
    whatsappLogContent.textContent = JSON.stringify(log, null, 2) || "Nenhum registro encontrado.";
    whatsappLogModal.hidden = false;
  } catch (error) {
    whatsappLogContent.textContent = `Erro: ${error.message}`;
    whatsappLogModal.hidden = false;
  }
}

let discordMessages = [];

async function loadDiscordQueue() {
  try {
    const response = await fetch(`${apiBase}/api/discord/queue`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Nao consegui carregar a fila.");
    }

    discordMessages = data.queue || [];
    renderDiscordQueue();
  } catch (error) {
    discordQueueEl.innerHTML = `<p class="whatsapp-empty">Erro ao carregar: ${error.message}</p>`;
  }
}

function renderDiscordQueue() {
  if (discordMessages.length === 0) {
    discordQueueEl.innerHTML = '<p class="whatsapp-empty">Nenhuma mensagem pendente.</p>';
    return;
  }

  discordQueueEl.innerHTML = "";

  for (const message of discordMessages) {
    const div = document.createElement("div");
    div.className = "whatsapp-message";
    div.dataset.id = message.id;

    const header = document.createElement("div");
    header.className = "whatsapp-message-header";

    const contactDiv = document.createElement("div");
    contactDiv.className = "whatsapp-contact";
    contactDiv.textContent = message.author || "Usuario";

    const channelDiv = document.createElement("div");
    channelDiv.className = "whatsapp-phone";
    channelDiv.textContent = message.channelId;

    const timeDiv = document.createElement("div");
    timeDiv.className = "whatsapp-time";
    timeDiv.textContent = new Date(message.receivedAt).toLocaleString("pt-BR");

    const contactInfo = document.createElement("div");
    contactInfo.append(contactDiv, channelDiv, timeDiv);

    header.append(contactInfo);

    const messageContent = document.createElement("div");
    messageContent.className = "whatsapp-message-content";
    messageContent.textContent = message.message;

    const replyDiv = document.createElement("div");
    replyDiv.className = "whatsapp-reply";
    replyDiv.textContent = message.aiReply;

    const editTextarea = document.createElement("textarea");
    editTextarea.className = "whatsapp-reply-edit";
    editTextarea.rows = "3";
    editTextarea.placeholder = "Editar resposta antes de enviar...";
    editTextarea.value = message.aiReply;

    const actions = document.createElement("div");
    actions.className = "whatsapp-message-actions";

    const approveButton = document.createElement("button");
    approveButton.type = "button";
    approveButton.className = "tool-button primary";
    approveButton.textContent = "Aprovar";
    approveButton.onclick = () => approveDiscordMessage(message.id, editTextarea.value);

    const editApproveButton = document.createElement("button");
    editApproveButton.type = "button";
    editApproveButton.className = "tool-button";
    editApproveButton.textContent = "Aprovar Editado";
    editApproveButton.onclick = () => approveDiscordMessage(message.id, editTextarea.value);

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "tool-button";
    cancelButton.textContent = "Cancelar";
    cancelButton.style.color = "var(--danger)";
    cancelButton.onclick = () => cancelDiscordMessage(message.id);

    actions.append(approveButton, editApproveButton, cancelButton);

    div.append(header, messageContent, replyDiv, editTextarea, actions);
    discordQueueEl.append(div);
  }
}

async function approveDiscordMessage(id, reply) {
  try {
    const response = await fetch(`${apiBase}/api/discord/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, reply })
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Nao consegui aprovar a mensagem.");
    }

    loadDiscordQueue();
  } catch (error) {
    alert(`Erro: ${error.message}`);
  }
}

async function cancelDiscordMessage(id) {
  if (!confirm("Tem certeza que deseja cancelar este envio?")) return;

  try {
    const response = await fetch(`${apiBase}/api/discord/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Nao consegui cancelar o envio.");
    }

    loadDiscordQueue();
  } catch (error) {
    alert(`Erro: ${error.message}`);
  }
}

async function loadDiscordLog() {
  try {
    const response = await fetch(`${apiBase}/api/discord/log`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Nao consegui carregar o log.");
    }

    const log = data.log || [];
    discordLogContent.textContent = JSON.stringify(log, null, 2) || "Nenhum registro encontrado.";
    discordLogModal.hidden = false;
  } catch (error) {
    discordLogContent.textContent = `Erro: ${error.message}`;
    discordLogModal.hidden = false;
  }
}

function renderSidebarConversations() {
  if (!sidebarConversationsList) return;

  if (conversations.length === 0) {
    sidebarConversationsList.innerHTML = '<p class="whatsapp-empty">Nenhuma conversa salva.</p>';
    return;
  }

  sidebarConversationsList.innerHTML = conversations.map((conv) => `
    <div class="conversation-item ${conv.id === currentConversationId ? 'active' : ''}" data-id="${conv.id}">
      <div class="conversation-title">${conv.title}</div>
      <div class="conversation-date">${new Date(conv.updatedAt).toLocaleDateString('pt-BR')}</div>
      <button class="delete-conversation" data-id="${conv.id}" title="Excluir">&#215;</button>
    </div>
  `).join('');

  sidebarConversationsList.querySelectorAll('.conversation-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-conversation')) return;
      switchConversation(item.dataset.id);
    });
  });

  sidebarConversationsList.querySelectorAll('.delete-conversation').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(btn.dataset.id);
    });
  });
}

searchConversationsInput.addEventListener("input", () => {
  const query = searchConversationsInput.value.toLowerCase().trim();
  if (!query) {
    renderSidebarConversations();
    return;
  }

  const filtered = conversations.filter(c => c.title.toLowerCase().includes(query));

  if (filtered.length === 0) {
    sidebarConversationsList.innerHTML = '<p class="whatsapp-empty">Nenhuma conversa encontrada.</p>';
    return;
  }

  sidebarConversationsList.innerHTML = filtered.map((conv) => `
    <div class="conversation-item ${conv.id === currentConversationId ? 'active' : ''}" data-id="${conv.id}">
      <div class="conversation-title">${conv.title}</div>
      <div class="conversation-date">${new Date(conv.updatedAt).toLocaleDateString('pt-BR')}</div>
    </div>
  `).join('');

  sidebarConversationsList.querySelectorAll('.conversation-item').forEach(item => {
    item.addEventListener('click', () => switchConversation(item.dataset.id));
  });
});

if (attachFileButton) {
  attachFileButton.addEventListener("click", () => {
    alert("Clique aqui para selecionar um arquivo.");
  });
}

if (imageButton) {
  imageButton.addEventListener("click", () => {
    alert("Clique aqui para enviar uma imagem.");
  });
}

if (voiceButton) {
  voiceButton.addEventListener("click", () => {
    alert("Clique aqui para usar o microfone.");
  });
}

document.querySelectorAll('.welcome-card').forEach(card => {
  card.addEventListener("click", () => {
    const prompt = card.dataset.prompt || "";
    input.value = prompt + " ";
    input.focus();
    welcomeScreen.hidden = true;
  });
});



function updateWelcomeVisibility() {
  if (welcomeScreen) {
    const hasMessages = history.some(m => m.role === "user" || m.role === "assistant");
    welcomeScreen.hidden = hasMessages;
  }
}

const originalRender = render;
render = function() {
  originalRender();
  updateWelcomeVisibility();
  renderSidebarConversations();
};

settingsButton = document.querySelector("#settingsButton");
if (settingsButton) {
  settingsButton.addEventListener("click", openSettings);
}

if (closeSettingsButton) {
  closeSettingsButton.addEventListener("click", closeSettings);
}

if (saveSettingsButton) {
  saveSettingsButton.addEventListener("click", applySettings);
}

if (settingsModal) {
  settingsModal.addEventListener("click", (event) => {
    if (event.target === settingsModal) closeSettings();
  });
}

settingsNavItems.forEach(btn => {
  btn.addEventListener("click", () => switchSettingsTab(btn.dataset.settingsTab));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsModal?.hidden) closeSettings();
});

helpButton = document.querySelector("#helpButton");
if (helpButton) {
  helpButton.addEventListener("click", () => {
    alert("Alya - Assistente IA\n\nRecursos:\n- Chat com IA\n- Memoria persistente\n- Modo Dev\n- Integracao WhatsApp\n- Integracao Discord\n- Exportacao de conversas\n\nUse os botoes no topo para acessar as funcionalidades.");
  });
}

// --- DEV PANEL IMPLEMENTATION ---
let devCurrentPath = "";
let devEditingFile = "";

// 1. Toggle visibility and load root folder
if (devPanelButton) {
  devPanelButton.addEventListener("click", () => {
    devCurrentPath = "";
    devEditingFile = "";
    devPanelModal.hidden = false;
    loadDevFolder("");
    loadDevBackups();
  });
}

if (closeDevPanelButton) {
  closeDevPanelButton.addEventListener("click", () => {
    devPanelModal.hidden = true;
  });
}

if (devPanelModal) {
  devPanelModal.addEventListener("click", (event) => {
    if (event.target === devPanelModal) {
      devPanelModal.hidden = true;
    }
  });
}

// Wire history button click listener
if (devHistoryButton) {
  devHistoryButton.addEventListener("click", () => {
    renderDevHistory();
    devHistoryPanel.hidden = false;
  });
}

// 2. Load folders using API
async function loadDevFolder(subPath) {
  try {
    devFilesList.innerHTML = '<p class="whatsapp-empty">Carregando...</p>';
    const url = `${apiBase}/api/dev/files?path=${encodeURIComponent(subPath)}`;
    const response = await fetch(url);
    const result = await response.json();

    if (result.ok) {
      devCurrentPath = subPath || "";
      devCurrentDir.textContent = devCurrentPath || "/ (raiz)";

      if (result.files.length === 0) {
        devFilesList.innerHTML = '<p class="whatsapp-empty">Pasta vazia.</p>';
        return;
      }

      devFilesList.innerHTML = result.files.map(file => `
        <div class="dev-file-item ${file.path === devEditingFile ? 'active' : ''}" data-path="${file.path}" data-type="${file.type}">
          <span class="icon">${file.type === 'directory' ? '📁' : '📄'}</span>
          <span class="name">${file.name}</span>
        </div>
      `).join('');

      // Wire click events
      devFilesList.querySelectorAll('.dev-file-item').forEach(item => {
        item.addEventListener('click', () => {
          const path = item.dataset.path;
          const type = item.dataset.type;
          if (type === 'directory') {
            loadDevFolder(path);
          } else {
            openDevFile(path);
          }
        });
      });
    } else {
      devFilesList.innerHTML = `<p class="access-error">Erro: ${result.error}</p>`;
    }
  } catch (error) {
    devFilesList.innerHTML = `<p class="access-error">Erro ao listar: ${error.message}</p>`;
  }
}

// Nav back to parent folder
if (devParentDirButton) {
  devParentDirButton.addEventListener("click", () => {
    if (!devCurrentPath) return; // Already at root
    const parts = devCurrentPath.split(/[\/\\]/);
    parts.pop();
    const parentPath = parts.join('/');
    loadDevFolder(parentPath);
  });
}

// 3. Open file in editor
async function openDevFile(filePath) {
  try {
    devCodeEditor.placeholder = "Carregando arquivo...";
    devCodeEditor.value = "";
    devCodeEditor.disabled = true;
    devSaveFileButton.disabled = true;

    // Toggle active state in sidebar
    devFilesList.querySelectorAll('.dev-file-item').forEach(item => {
      item.classList.toggle('active', item.dataset.path === filePath);
    });

    const url = `${apiBase}/api/dev/file?path=${encodeURIComponent(filePath)}`;
    const response = await fetch(url);
    const result = await response.json();

    if (result.ok) {
      devEditingFile = filePath;
      devEditingFilePath.textContent = filePath;
      devCodeEditor.value = result.content;
      devCodeEditor.disabled = false;
      devSaveFileButton.disabled = false;

      // Switch tab to editor
      switchDevTab("editor");
    } else {
      alert("Erro ao ler arquivo: " + result.error);
      devEditingFilePath.textContent = "Erro ao carregar";
    }
  } catch (error) {
    alert("Erro ao abrir arquivo: " + error.message);
  }
}

// 4. Save file
if (devSaveFileButton) {
  devSaveFileButton.addEventListener("click", async () => {
    if (!devEditingFile) return;

    try {
      devSaveFileButton.disabled = true;
      devSaveFileButton.textContent = "Salvando...";

      const response = await fetch(`${apiBase}/api/dev/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: devEditingFile,
          content: devCodeEditor.value
        })
      });

      const result = await response.json();

      if (result.ok) {
        alert("Arquivo salvo com sucesso!");
      } else if (result.requiresApproval) {
        // Show file approval modal
        filePreview.textContent = devCodeEditor.value;
        pendingDevAction = {
          action: 'writeFile',
          details: { path: devEditingFile, content: devCodeEditor.value }
        };
        fileApprovalModal.hidden = false;
      } else {
        alert("Erro ao salvar: " + result.error);
      }
    } catch (error) {
      alert("Erro de conexão: " + error.message);
    } finally {
      devSaveFileButton.disabled = false;
      devSaveFileButton.textContent = "Salvar";
    }
  });
}

// New File and Folder creation
if (devNewFileButton) {
  devNewFileButton.addEventListener("click", async () => {
    const filename = prompt("Digite o nome do novo arquivo:");
    if (!filename) return;
    const newPath = devCurrentPath ? `${devCurrentPath}/${filename}` : filename;
    try {
      const response = await fetch(`${apiBase}/api/dev/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: newPath, content: "" })
      });
      const result = await response.json();
      if (result.ok) {
        loadDevFolder(devCurrentPath);
        openDevFile(newPath);
      } else {
        alert("Erro ao criar arquivo: " + result.error);
      }
    } catch (error) {
      alert("Erro ao criar arquivo: " + error.message);
    }
  });
}

if (devNewFolderButton) {
  devNewFolderButton.addEventListener("click", () => {
    alert("Para criar uma pasta, basta criar um arquivo dentro dela (ex: pasta/arquivo.txt). O servidor criará os diretórios necessários automaticamente!");
  });
}

// 5. Console Command Execution
if (devConsoleForm) {
  devConsoleForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const command = devConsoleInput.value.trim();
    if (!command) return;

    appendTerminal(`$ ${command}\n`);
    devConsoleInput.value = "";
    devConsoleSubmit.disabled = true;

    try {
      const response = await fetch(`${apiBase}/api/dev/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command })
      });
      const result = await response.json();

      if (result.ok) {
        appendTerminal(result.output || "(Comando executado sem retorno)\n");
      } else if (result.requiresApproval) {
        appendTerminal("⚠️ Comando requer aprovação. Verifique a tela principal.\n");
        // Show approval modal
        showDevApproval("executeCommand", { command });
      } else {
        appendTerminal(`❌ Erro: ${result.error}\n${result.output || ''}\n`);
      }
    } catch (error) {
      appendTerminal(`❌ Erro de conexão: ${error.message}\n`);
    } finally {
      devConsoleSubmit.disabled = false;
    }
  });
}

function appendTerminal(text) {
  devTerminalOutput.textContent += text;
  // Auto scroll
  const container = document.querySelector(".dev-terminal-container");
  if (container) container.scrollTop = container.scrollHeight;
}

// Command shortcuts
devConsoleShortcuts.forEach(btn => {
  btn.addEventListener("click", () => {
    const cmd = btn.dataset.cmd;
    if (cmd) {
      devConsoleInput.value = cmd;
      devConsoleInput.focus();
    }
  });
});

// 6. Backups Management
if (devCreateBackupButton) {
  devCreateBackupButton.addEventListener("click", async () => {
    if (!devEditingFile) {
      alert("Selecione um arquivo primeiro para fazer backup.");
      return;
    }

    try {
      devCreateBackupButton.disabled = true;
      devCreateBackupButton.textContent = "Criando...";
      const response = await fetch(`${apiBase}/api/dev/backup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: devEditingFile })
      });
      const result = await response.json();
      if (result.ok) {
        alert(`Backup criado: ${result.backupPath}`);
        loadDevBackups();
      } else {
        alert("Erro ao criar backup: " + result.error);
      }
    } catch (error) {
      alert("Erro: " + error.message);
    } finally {
      devCreateBackupButton.disabled = false;
      devCreateBackupButton.textContent = "Criar Backup do Projeto";
    }
  });
}

async function loadDevBackups() {
  try {
    devBackupsList.innerHTML = '<p class="whatsapp-empty">Carregando backups...</p>';
    const url = `${apiBase}/api/dev/files?path=${encodeURIComponent('nova-data/backups')}`;
    const response = await fetch(url);
    const result = await response.json();

    if (result.ok && result.files) {
      const backups = result.files.filter(f => f.type === 'file');
      if (backups.length === 0) {
        devBackupsList.innerHTML = '<p class="whatsapp-empty">Nenhum backup disponível.</p>';
        return;
      }

      devBackupsList.innerHTML = backups.map(file => `
        <div class="dev-backup-item">
          <span class="dev-backup-name">${file.name}</span>
          <button class="tool-button dev-backup-restore-btn" data-path="${file.path}" type="button">Restaurar</button>
        </div>
      `).join('');

      devBackupsList.querySelectorAll('.dev-backup-restore-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const backupPath = btn.dataset.path;
          const original = prompt("Digite o caminho relativo do arquivo original para restaurar (ex: nova-data/profile.json):");
          if (!original) return;

          try {
            const response = await fetch(`${apiBase}/api/dev/restore`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ backupPath, originalPath: original })
            });
            const result = await response.json();
            if (result.ok) {
              alert("Backup restaurado com sucesso!");
              loadDevFolder(devCurrentPath);
            } else {
              alert("Erro ao restaurar: " + result.error);
            }
          } catch (error) {
            alert("Erro: " + error.message);
          }
        });
      });
    } else {
      devBackupsList.innerHTML = '<p class="whatsapp-empty">Erro ao carregar backups.</p>';
    }
  } catch (error) {
    devBackupsList.innerHTML = `<p class="whatsapp-empty">Erro: ${error.message}</p>`;
  }
}

// 8. Users Management
const usersButton = document.getElementById("usersButton");
const usersModal = document.getElementById("usersModal");
const closeUsersButton = document.getElementById("closeUsersButton");
const createUserForm = document.getElementById("createUserForm");
const usersList = document.getElementById("usersList");

if (usersButton) {
  usersButton.addEventListener("click", async () => {
    usersModal.hidden = false;
    await loadUsers();
  });
}

if (closeUsersButton) {
  closeUsersButton.addEventListener("click", () => {
    usersModal.hidden = true;
  });
}

if (createUserForm) {
  createUserForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("newUsername").value.trim();
    const password = document.getElementById("newPassword").value;

    if (!username || !password) {
      alert("Nome de usuário e senha são obrigatórios");
      return;
    }

    try {
      const response = await fetch(`${apiBase}/api/users/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();

      if (data.ok) {
        document.getElementById("newUsername").value = "";
        document.getElementById("newPassword").value = "";
        await loadUsers();
        alert("Usuário criado com sucesso!");
      } else {
        alert(`Erro: ${data.error}`);
      }
    } catch (error) {
      alert("Erro ao criar usuário");
    }
  });
}

async function loadUsers() {
  try {
    const response = await fetch(`${apiBase}/api/users/list`);
    const data = await response.json();

    if (data.users && data.users.length > 0) {
      usersList.innerHTML = data.users.map(user => `
        <div class="user-item">
          <span class="user-name">${user.username}</span>
          <span class="user-created">Criado em: ${new Date(user.createdAt).toLocaleDateString('pt-BR')}</span>
          <button class="tool-button delete-user-btn" data-username="${user.username}">Remover</button>
        </div>
      `).join('');

      // Add event listeners to delete buttons
      document.querySelectorAll(".delete-user-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const username = btn.dataset.username;
          if (confirm(`Tem certeza que deseja remover o usuário ${username}?`)) {
            await deleteUser(username);
          }
        });
      });
    } else {
      usersList.innerHTML = `<p class="whatsapp-empty">Nenhum usuário cadalyado</p>`;
    }
  } catch (error) {
    usersList.innerHTML = `<p class="whatsapp-empty">Erro ao carregar usuários</p>`;
  }
}

async function deleteUser(username) {
  try {
    const response = await fetch(`${apiBase}/api/users/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username })
    });
    const data = await response.json();

    if (data.ok) {
      await loadUsers();
      alert("Usuário removido com sucesso!");
    } else {
      alert(`Erro: ${data.error}`);
    }
  } catch (error) {
    alert("Erro ao remover usuário");
  }
}

// 9. Tabs switching logic
devTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    const tabId = tab.dataset.devTab;
    switchDevTab(tabId);
  });
});

function switchDevTab(tabId) {
  devTabs.forEach(btn => btn.classList.toggle("active", btn.dataset.devTab === tabId));
  devTabPanes.forEach(pane => {
    const isTarget = pane.id === `devTab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`;
    pane.style.display = isTarget ? "flex" : "none";
  });
}

// 8. Public Link Sharing Fetching
async function initShareLink() {
  if (!shareLinkButton) return;
  shareLinkButton.style.display = "inline-flex";

  shareLinkButton.addEventListener("click", async () => {
    const originalText = shareLinkButton.innerHTML;
    shareLinkButton.innerHTML = "⏳ Obtendo link...";
    shareLinkButton.disabled = true;

    try {
      // Primeiro tenta pegar o link atual
      let response = await fetch(`${apiBase}/api/aly-link`);
      let data = await response.json();

      // Se o link é local (túnel caiu), tenta reiniciar
      if (data.local) {
        shareLinkButton.innerHTML = "🔄 Reconectando túnel...";
        const restartRes = await fetch(`${apiBase}/api/tunnel-restart`, { method: 'POST' });
        const restartData = await restartRes.json();
        if (restartData.success) {
          data = { chatUrl: restartData.chatUrl };
        } else {
          shareLinkButton.innerHTML = "⚠️ Túnel indisponível";
          setTimeout(() => { shareLinkButton.innerHTML = originalText; shareLinkButton.disabled = false; }, 3000);
          return;
        }
      }

      if (data.chatUrl) {
        await navigator.clipboard.writeText(data.chatUrl);
        shareLinkButton.innerHTML = "✅ Link copiado!";
        setTimeout(() => { shareLinkButton.innerHTML = originalText; shareLinkButton.disabled = false; }, 2000);
      } else {
        shareLinkButton.innerHTML = "⚠️ Sem link público";
        setTimeout(() => { shareLinkButton.innerHTML = originalText; shareLinkButton.disabled = false; }, 3000);
      }
    } catch (err) {
      console.error("Share link error:", err);
      shareLinkButton.innerHTML = "❌ Erro";
      setTimeout(() => { shareLinkButton.innerHTML = originalText; shareLinkButton.disabled = false; }, 3000);
    }
  });
}

// Run public link checker on boot
initShareLink();

/* ══════════════════════════════════════════════════════════
   SISTEMA DE NOTIFICAÇÕES EXCLUSIVO DA ALYA PRIVADA (FRONTEND)
   ══════════════════════════════════════════════════════════ */

const notificationBellBtn = document.getElementById('notificationBellButton');
const notificationBadge = document.getElementById('notificationBadge');
const notificationOverlay = document.getElementById('notificationOverlay');
const closeNotifDrawerBtn = document.getElementById('closeNotificationDrawer');
const unreadCountPill = document.getElementById('unreadCountPill');
const notificationsList = document.getElementById('notificationsList');
const notifSearchInput = document.getElementById('notificationSearchInput');
const notifCategoryFilter = document.getElementById('notifCategoryFilter');
const notifPriorityFilter = document.getElementById('notifPriorityFilter');
const markAllReadBtn = document.getElementById('markAllReadBtn');
const clearAllNotifsBtn = document.getElementById('clearAllNotifsBtn');
const toastContainer = document.getElementById('toastContainer');

let allNotifications = [];
let knownNotifIds = new Set();
let isFirstNotifLoad = true;

// Alternar Painel Lateral
if (notificationBellBtn && notificationOverlay) {
  notificationBellBtn.addEventListener('click', () => {
    notificationOverlay.hidden = false;
    fetchNotifications();
  });

  closeNotifDrawerBtn.addEventListener('click', () => {
    notificationOverlay.hidden = true;
  });

  notificationOverlay.addEventListener('click', (e) => {
    if (e.target === notificationOverlay) {
      notificationOverlay.hidden = true;
    }
  });
}

// Filtros & Buscas
if (notifSearchInput) notifSearchInput.addEventListener('input', applyNotifFilters);
if (notifCategoryFilter) notifCategoryFilter.addEventListener('change', applyNotifFilters);
if (notifPriorityFilter) notifPriorityFilter.addEventListener('change', applyNotifFilters);

// Ações Globais
if (markAllReadBtn) {
  markAllReadBtn.addEventListener('click', async () => {
    try {
      const res = await fetch(`${apiBase}/api/notifications/mark-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'ALL' })
      });
      const data = await res.json();
      if (data.notifications) {
        allNotifications = data.notifications;
        updateNotifUI(data.unreadCount);
        applyNotifFilters();
      }
    } catch (err) {
      console.error('Erro ao marcar todas como lidas:', err);
    }
  });
}

if (clearAllNotifsBtn) {
  clearAllNotifsBtn.addEventListener('click', async () => {
    if (!confirm('Deseja realmente apagar todas as notificações?')) return;
    try {
      const res = await fetch(`${apiBase}/api/notifications`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'ALL' })
      });
      const data = await res.json();
      if (data.notifications) {
        allNotifications = data.notifications;
        updateNotifUI(data.unreadCount);
        applyNotifFilters();
      }
    } catch (err) {
      console.error('Erro ao limpar notificações:', err);
    }
  });
}

// Buscar Notificações do Servidor
async function fetchNotifications() {
  try {
    const res = await fetch(`${apiBase}/api/notifications`);
    if (!res.ok) return;

    const data = await res.json();
    const newItems = data.notifications || [];
    const unread = data.unreadCount || 0;

    // Detectar novos itens para Toast Popup
    if (!isFirstNotifLoad) {
      newItems.forEach(item => {
        if (!knownNotifIds.has(item.id) && !item.read) {
          showNotifToast(item);
        }
      });
    }

    knownNotifIds = new Set(newItems.map(i => i.id));
    allNotifications = newItems;
    isFirstNotifLoad = false;

    updateNotifUI(unread);
    applyNotifFilters();
  } catch (err) {
    console.warn('Erro ao buscar notificações:', err.message);
  }
}

function updateNotifUI(unreadCount) {
  if (notificationBadge) {
    notificationBadge.textContent = unreadCount;
    notificationBadge.hidden = unreadCount === 0;
  }
  if (unreadCountPill) {
    unreadCountPill.textContent = `${unreadCount} não lida${unreadCount === 1 ? '' : 's'}`;
  }
}

function applyNotifFilters() {
  if (!notificationsList) return;

  const query = (notifSearchInput?.value || '').toLowerCase().trim();
  const catFilter = notifCategoryFilter?.value || 'ALL';
  const prioFilter = notifPriorityFilter?.value || 'ALL';

  const filtered = allNotifications.filter(item => {
    const matchesSearch = !query ||
      item.title.toLowerCase().includes(query) ||
      item.message.toLowerCase().includes(query) ||
      (item.details && item.details.toLowerCase().includes(query));

    const matchesCat = catFilter === 'ALL' || item.category === catFilter;
    const matchesPrio = prioFilter === 'ALL' || item.priority === prioFilter;

    return matchesSearch && matchesCat && matchesPrio;
  });

  renderNotifList(filtered);
}

function renderNotifList(items) {
  if (!notificationsList) return;

  if (items.length === 0) {
    notificationsList.innerHTML = '<p class="whatsapp-empty">Nenhuma notificação encontrada.</p>';
    return;
  }

  notificationsList.innerHTML = items.map(item => {
    const catClass = `cat-${item.category.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const prioClass = `priority-${item.priority.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const timeStr = new Date(item.createdAt).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

    return `
      <div class="notif-card ${item.read ? 'read' : 'unread'} ${prioClass}" data-id="${item.id}">
        <div class="notif-card-header">
          <div class="notif-tags">
            <span class="notif-tag ${catClass}">${item.category}</span>
            <span class="notif-tag" style="background: rgba(255,255,255,0.06); color: var(--muted);">${item.priority}</span>
          </div>
          <span class="notif-time">${timeStr}</span>
        </div>
        <h4 class="notif-card-title">${escapeNotif(item.title)}</h4>
        <p class="notif-card-msg">${escapeNotif(item.message)}</p>
        ${item.details ? `<p class="notif-card-msg" style="font-family: var(--font-code); font-size: 0.75rem; opacity: 0.8;">${escapeNotif(item.details)}</p>` : ''}
        <div class="notif-card-actions">
          ${!item.read ? `<button class="notif-item-btn btn-read" data-id="${item.id}">✓ Lida</button>` : ''}
          <button class="notif-item-btn btn-del" data-id="${item.id}">🗑️ Excluir</button>
        </div>
      </div>
    `;
  }).join('');

  // Wire click handlers for card actions
  notificationsList.querySelectorAll('.btn-read').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      await fetch(`${apiBase}/api/notifications/mark-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      fetchNotifications();
    });
  });

  notificationsList.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      await fetch(`${apiBase}/api/notifications`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      fetchNotifications();
    });
  });
}

function showNotifToast(item) {
  if (!toastContainer) return;

  const prioClass = `priority-${item.priority.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const toast = document.createElement('div');
  toast.className = `toast-item ${prioClass}`;
  toast.innerHTML = `
    <div class="toast-title">🔔 ${escapeNotif(item.title)}</div>
    <div class="toast-msg">${escapeNotif(item.message)}</div>
  `;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 6000);
}

function escapeNotif(text) {
  return String(text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Boot notification poller (every 10 seconds)
fetchNotifications();
setInterval(fetchNotifications, 10000);

