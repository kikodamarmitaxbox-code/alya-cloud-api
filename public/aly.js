const apiBase = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
const messagesEl = document.querySelector('#messages');
const chatForm = document.querySelector('#chatForm');
const messageInput = document.querySelector('#messageInput');
const sendButton = document.querySelector('#sendButton');
const welcomeScreen = document.querySelector('#welcomeScreen');
const typingIndicator = document.querySelector('#typingIndicator');
const personalitySelect = document.querySelector('#personalitySelect');
const modeSelect = document.querySelector('#modeSelect');
const memoryInput = document.querySelector('#memoryInput');
const themeButton = document.querySelector('#themeButton');
const settingsButton = document.querySelector('#settingsButton');
const closeSettingsButton = document.querySelector('#closeSettingsButton');
const saveSettingsButton = document.querySelector('#saveSettingsButton');
const settingsModal = document.querySelector('#settingsModal');
const settingsLanguage = document.querySelector('#settingsLanguage');
const settingsAiName = document.querySelector('#settingsAiName');
const settingsUserName = document.querySelector('#settingsUserName');
const settingsWelcomeToggle = document.querySelector('#settingsWelcomeToggle');
const settingsSoundToggle = document.querySelector('#settingsSoundToggle');
const helpButton = document.querySelector('#helpButton');
const searchConversationsInput = document.querySelector('#searchConversationsInput');
const newConversationButton = document.querySelector('#newConversationButton');
const conversationsListSidebar = document.querySelector('#conversationsListSidebar');

const storageKey = 'nova-chat-history';
const settingsKey = 'nova-settings';
const appSettingsKey = 'nova-app-settings';
const usernameKey = 'nova-username';
const conversationsKey = 'nova-conversations';

let history = [];
let settings = loadSettings();
let conversations = loadConversations();
let currentConversationId = conversations.length > 0 ? conversations[0].id : null;
if (!currentConversationId) {
  currentConversationId = createNewConversation();
}
let pendingFileProfile = null;

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom() {
  if (!messagesEl) return;
  messagesEl.scrollTo({
    top: messagesEl.scrollHeight,
    behavior: 'auto'
  });
}

function showTypingIndicator() {
  if (!typingIndicator) return;
  typingIndicator.hidden = false;
  typingIndicator.setAttribute('aria-hidden', 'false');
  scrollToBottom();
}

function hideTypingIndicator() {
  if (!typingIndicator) return;
  typingIndicator.hidden = true;
  typingIndicator.setAttribute('aria-hidden', 'true');
}

function appendMessage(role, content) {
  const article = document.createElement('article');
  article.className = `message ${role}`;

  const label = document.createElement('span');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'Voce' : 'Alya';

  const text = document.createElement('div');
  text.className = 'message-content';
  text.textContent = content || 'Pensando...';

  article.append(label, text);
  messagesEl.appendChild(article);
  scrollToBottom();
}

function setBusy(isBusy) {
  sendButton.disabled = isBusy;
  messageInput.disabled = isBusy;
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey) || '{}');
    return {
      personality: ['equilibrada', 'direta', 'amiga', 'tecnica', 'jarvis'].includes(saved.personality)
        ? saved.personality
        : 'jarvis',
      mode: ['normal', 'estudo', 'criativo', 'codigo', 'rapido'].includes(saved.mode)
        ? saved.mode
        : 'normal',
      memory: typeof saved.memory === 'string' ? saved.memory.slice(0, 2000) : ''
    };
  } catch {
    return { personality: 'jarvis', mode: 'normal', memory: '' };
  }
}

function saveSettings() {
  localStorage.setItem(settingsKey, JSON.stringify(settings));
}

function loadAppSettings() {
  try {
    return JSON.parse(localStorage.getItem(appSettingsKey) || '{}');
  } catch {
    return {};
  }
}

function saveAppSettings(updates) {
  const current = loadAppSettings();
  Object.assign(current, updates);
  localStorage.setItem(appSettingsKey, JSON.stringify(current));
}

function getWelcomeEnabled() {
  const appSettings = loadAppSettings();
  return appSettings.welcomeEnabled !== false && settingsWelcomeToggle?.checked !== false;
}

function setWelcomeEnabled(enabled) {
  saveAppSettings({ welcomeEnabled: enabled });
}

function getUserName() {
  try {
    return localStorage.getItem(usernameKey) || 'Pedro';
  } catch {
    return 'Pedro';
  }
}

function compress(text) {
  try {
    if (typeof LZString !== 'undefined' && LZString.compressToUTF16) {
      return LZString.compressToUTF16(text);
    }
  } catch {
    // ignore
  }
  return text;
}

function decompress(text) {
  try {
    if (typeof LZString !== 'undefined' && LZString.decompressFromUTF16) {
      const result = LZString.decompressFromUTF16(text);
      if (result) return result;
    }
  } catch {
    // ignore
  }
  return text;
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
    console.error('Error saving history:', error);
  }
}

function loadConversations() {
  try {
    const saved = localStorage.getItem(conversationsKey);
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
    localStorage.setItem(conversationsKey, compress(toSave));
  } catch (error) {
    console.error('Error saving conversations:', error);
  }
}

function createNewConversation() {
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
  const conversation = {
    id,
    title: 'Nova conversa',
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
  if (conversation && conversation.title === 'Nova conversa') {
    conversation.title = firstMessage.slice(0, 30) + (firstMessage.length > 30 ? '...' : '');
    conversation.updatedAt = new Date().toISOString();
    saveConversations();
  }
}

function switchConversation(conversationId) {
  if (currentConversationId === conversationId) return;
  currentConversationId = conversationId;
  history = loadConversationHistory(conversationId);
  render();
  renderSidebarConversations();
  scrollToBottom();
}

function loadConversationHistory(conversationId) {
  try {
    const saved = localStorage.getItem(`${storageKey}-${conversationId}`);
    if (!saved) return [];
    const decompressed = decompress(saved);
    return Array.isArray(JSON.parse(decompressed)) ? JSON.parse(decompressed) : [];
  } catch {
    return [];
  }
}

function saveConversationHistory(conversationId, messages) {
  try {
    const toSave = JSON.stringify(messages.slice(-50));
    localStorage.setItem(`${storageKey}-${conversationId}`, compress(toSave));
  } catch (error) {
    console.error('Error saving conversation history:', error);
  }
}

function deleteConversation(conversationId) {
  conversations = conversations.filter(c => c.id !== conversationId);
  saveConversations();
  localStorage.removeItem(`${storageKey}-${conversationId}`);

  if (conversations.length === 0) {
    currentConversationId = createNewConversation();
  } else if (currentConversationId === conversationId) {
    currentConversationId = conversations[0].id;
  }

  history = loadConversationHistory(currentConversationId);
  render();
  renderSidebarConversations();
}

function renderSidebarConversations() {
  if (!conversationsListSidebar) return;

  if (conversations.length === 0) {
    conversationsListSidebar.innerHTML = '<p class="whatsapp-empty">Nenhuma conversa salva.</p>';
    return;
  }

  conversationsListSidebar.innerHTML = conversations.map((conv) => `
    <div class="conversation-item ${conv.id === currentConversationId ? 'active' : ''}" data-id="${conv.id}">
      <div class="conversation-title">${escapeHtml(conv.title)}</div>
      <div class="conversation-date">${new Date(conv.updatedAt).toLocaleDateString('pt-BR')}</div>
      <button class="delete-conversation" data-id="${conv.id}" title="Excluir">&#215;</button>
    </div>
  `).join('');

  conversationsListSidebar.querySelectorAll('.conversation-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-conversation')) return;
      switchConversation(item.dataset.id);
    });
  });

  conversationsListSidebar.querySelectorAll('.delete-conversation').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(btn.dataset.id);
    });
  });
}

searchConversationsInput.addEventListener('input', () => {
  const query = searchConversationsInput.value.toLowerCase().trim();
  if (!query) {
    renderSidebarConversations();
    return;
  }

  const filtered = conversations.filter(c => c.title.toLowerCase().includes(query));

  if (filtered.length === 0) {
    conversationsListSidebar.innerHTML = '<p class="whatsapp-empty">Nenhuma conversa encontrada.</p>';
    return;
  }

  conversationsListSidebar.innerHTML = filtered.map((conv) => `
    <div class="conversation-item ${conv.id === currentConversationId ? 'active' : ''}" data-id="${conv.id}">
      <div class="conversation-title">${escapeHtml(conv.title)}</div>
      <div class="conversation-date">${new Date(conv.updatedAt).toLocaleDateString('pt-BR')}</div>
    </div>
  `).join('');

  conversationsListSidebar.querySelectorAll('.conversation-item').forEach(item => {
    item.addEventListener('click', () => switchConversation(item.dataset.id));
  });
});

function render() {
  if (typingIndicator && typingIndicator.parentNode) {
    typingIndicator.parentNode.removeChild(typingIndicator);
  }
  messagesEl.innerHTML = '';

  if (history.length === 0) {
    welcomeScreen.hidden = !getWelcomeEnabled();
  } else {
    welcomeScreen.hidden = true;
  }

  for (const [index, message] of history.entries()) {
    const article = document.createElement('article');
    article.className = `message ${message.role}`;

    const label = document.createElement('span');
    label.className = 'message-label';
    label.textContent = message.role === 'user' ? 'Voce' : 'Alya';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = message.content || '...';

    article.append(label, content);
    messagesEl.appendChild(article);
  }

  scrollToBottom();
}

async function sendMessage(content) {
  if (!content.trim()) return;

  history.push({ role: 'user', content: content.trim() });
  appendMessage('user', content.trim());
  messageInput.value = '';
  messageInput.style.height = 'auto';
  setBusy(true);

  updateConversationTitle(currentConversationId, content.trim());
  saveConversationHistory(currentConversationId, history);
  renderSidebarConversations();

  const body = {
    messages: history.slice(-8),
    settings: {
      personality: personalitySelect.value,
      mode: modeSelect.value,
      memory: memoryInput.value.trim()
    }
  };

  try {
    const response = await fetch(`${apiBase}/api/aly-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erro ao enviar mensagem.');

    const reply = data.reply || 'Sem resposta.';
    history.push({ role: 'assistant', content: reply });
    appendMessage('assistant', reply);
    saveConversationHistory(currentConversationId, history);
    renderSidebarConversations();
  } catch (error) {
    appendMessage('assistant', `Erro: ${error.message}`);
  } finally {
    setBusy(false);
    messageInput.focus();
  }
}

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await sendMessage(messageInput.value);
});

messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage(messageInput.value);
  }
});

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
});

document.querySelectorAll('.welcome-card').forEach(card => {
  card.addEventListener('click', () => {
    const prompt = card.dataset.prompt || '';
    messageInput.value = prompt + ' ';
    messageInput.focus();
    welcomeScreen.hidden = true;
  });
});

newConversationButton.addEventListener('click', () => {
  currentConversationId = createNewConversation();
  history = [];
  render();
  scrollToBottom();
});

function openSettings() {
  if (!settingsModal) return;
  const appSettings = loadAppSettings();
  if (settingsLanguage) settingsLanguage.value = appSettings.language || 'pt-BR';
  if (settingsAiName) settingsAiName.value = appSettings.aiName || 'Alya';
  if (settingsUserName) settingsUserName.value = appSettings.userName || getUserName();
  if (settingsWelcomeToggle) settingsWelcomeToggle.checked = getWelcomeEnabled();
  if (settingsSoundToggle) settingsSoundToggle.checked = appSettings.soundEnabled !== false;
  settingsModal.hidden = false;
}

function closeSettings() {
  if (settingsModal) settingsModal.hidden = true;
}

function applySettings() {
  const updates = {
    language: settingsLanguage?.value,
    aiName: settingsAiName?.value?.trim(),
    userName: settingsUserName?.value?.trim(),
    welcomeEnabled: settingsWelcomeToggle?.checked ?? true,
    soundEnabled: settingsSoundToggle?.checked ?? true
  };

  saveAppSettings(updates);
  if (updates.userName) localStorage.setItem(usernameKey, updates.userName);
  closeSettings();
}

settingsButton.addEventListener('click', openSettings);
closeSettingsButton.addEventListener('click', closeSettings);
saveSettingsButton.addEventListener('click', applySettings);
settingsModal.addEventListener('click', (event) => {
  if (event.target === settingsModal) closeSettings();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !settingsModal?.hidden) closeSettings();
});

helpButton.addEventListener('click', () => {
  alert('Alya Assistente\n\nRecursos:\n- Chat com IA\n- Memoria persistente\n- Multiplas conversas\n- Configuracoes\n\nUse os botoes na barra lateral para acessar as funcionalidades.');
});

let isDarkTheme = true;

function applyTheme() {
  document.documentElement.style.setProperty('color-scheme', isDarkTheme ? 'dark' : 'light');
}

function toggleTheme() {
  isDarkTheme = !isDarkTheme;
  applyTheme();
  saveAppSettings({ theme: isDarkTheme ? 'dark' : 'light' });
}

themeButton.addEventListener('click', toggleTheme);

function init() {
  const appSettings = loadAppSettings();
  if (appSettings.theme === 'light') {
    isDarkTheme = false;
    applyTheme();
  }

  const saved = loadAppSettings();
  if (saved.personality && personalitySelect) personalitySelect.value = saved.personality;
  if (saved.mode && modeSelect) modeSelect.value = saved.mode;

  if (history.length === 0) {
    history = [
      {
        role: 'assistant',
        content: 'Ola! Eu sou a Alya. Posso te ajudar com ideias, estudos, textos e organizacao.'
      }
    ];
  }

  render();
  renderSidebarConversations();
  updateWelcomeVisibility();
}

function updateWelcomeVisibility() {
  if (!welcomeScreen) return;
  const hasMessages = history.some(m => m.role === 'user' || m.role === 'assistant');
  welcomeScreen.hidden = hasMessages || !getWelcomeEnabled();
}

personalitySelect.addEventListener('change', () => {
  settings.personality = personalitySelect.value;
  saveSettings();
});

modeSelect.addEventListener('change', () => {
  settings.mode = modeSelect.value;
  saveSettings();
});

memoryInput.addEventListener('input', () => {
  settings.memory = memoryInput.value.slice(0, 2000);
  saveSettings();
});

init();
