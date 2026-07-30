const apiBase = (window.location.protocol === 'file:' || ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port !== '3000'))
  ? 'http://localhost:3000'
  : '';
const isSimpleMobileLink = new URLSearchParams(window.location.search).get('mobile') === '1';
if (isSimpleMobileLink) document.body.classList.add('simple-mobile-link');
const messagesEl = document.querySelector('#messages');
const chatForm = document.querySelector('#chatForm');
const messageInput = document.querySelector('#messageInput');
const sendButton = document.querySelector('#sendButton');
const voiceInputButton = document.querySelector('#voiceInputButton');
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
const settingsSoundVolume = document.querySelector('#settingsSoundVolume');
const helpButton = document.querySelector('#helpButton');
const searchConversationsInput = document.querySelector('#searchConversationsInput');
const newConversationButton = document.querySelector('#newConversationButton');
const conversationsListSidebar = document.querySelector('#conversationsListSidebar');
const publicLinkBanner = document.querySelector('#publicLinkBanner');
const publicLinkStatus = document.querySelector('#publicLinkStatus');
const publicLinkText = document.querySelector('#publicLinkText');
const copyPublicLink = document.querySelector('#copyPublicLink');
const restartTunnel = document.querySelector('#restartTunnel');
const loadingScreen = document.querySelector('#loadingScreen');
const loadingStatus = document.querySelector('#loadingStatus');
const loadingBar = document.querySelector('#loadingBar');
const composeIconButton = document.querySelector('#composeIconButton');
const userProfileButton = document.querySelector('#userProfileButton');
const searchButton = document.querySelector('#searchButton');
const shareLinkButton = document.querySelector('#shareLinkButton');
const mobileMenuButton = document.querySelector('.mobile-menu-button');
const sidebar = document.querySelector('#sidebar');
const conversationHeading = document.querySelector('.conversation-heading span:last-child');
const imageStudioButton = document.querySelector('#imageStudioButton');
const imageStudioModal = document.querySelector('#imageStudioModal');
const closeImageStudioButton = document.querySelector('#closeImageStudioButton');
const imagePrompt = document.querySelector('#imagePrompt');
const generateImageButton = document.querySelector('#generateImageButton');
const imageStudioStatus = document.querySelector('#imageStudioStatus');
const imageStudioResult = document.querySelector('#imageStudioResult');
const computerButton = document.querySelector('#computerButton');
const computerModal = document.querySelector('#computerModal');
const closeComputerButton = document.querySelector('#closeComputerButton');
const computerRequest = document.querySelector('#computerRequest');
const prepareComputerAction = document.querySelector('#prepareComputerAction');
const computerApproval = document.querySelector('#computerApproval');
const computerApprovalText = document.querySelector('#computerApprovalText');
const approveComputerAction = document.querySelector('#approveComputerAction');
const computerStatus = document.querySelector('#computerStatus');
const toolsButton = document.querySelector('#toolsButton');
const toolsModal = document.querySelector('#toolsModal');
const closeToolsButton = document.querySelector('#closeToolsButton');
const attachButton = document.querySelector('#attachButton');
const fileInput = document.querySelector('#fileInput');
const attachmentChip = document.querySelector('#attachmentChip');
const attachmentName = document.querySelector('#attachmentName');
const removeAttachmentButton = document.querySelector('#removeAttachmentButton');
const modelStatusPill = document.querySelector('#modelStatusPill');
const modelStatusText = document.querySelector('#modelStatusText');
const toastContainer = document.querySelector('#toastContainer');
const systemButton = document.querySelector('#systemButton');
const codeAlyaButton = document.querySelector('#codeAlyaButton');
const systemModal = document.querySelector('#systemModal');
const closeSystemButton = document.querySelector('#closeSystemButton');
const refreshSystemButton = document.querySelector('#refreshSystemButton');
const systemOverview = document.querySelector('#systemOverview');
const systemProviders = document.querySelector('#systemProviders');
const systemModelSelect = document.querySelector('#systemModelSelect');
const saveSystemModelButton = document.querySelector('#saveSystemModelButton');
const systemModelStatus = document.querySelector('#systemModelStatus');
const installAppButton = document.querySelector('#installAppButton');
const authModal = document.querySelector('#authModal');
const authForm = document.querySelector('#authForm');
const authUsernameLabel = document.querySelector('#authUsernameLabel');
const authUsername = document.querySelector('#authUsername');
const authPassword = document.querySelector('#authPassword');
const authPasswordConfirmation = document.querySelector('#authPasswordConfirmation');
const authPasswordConfirmationLabel = document.querySelector('#authPasswordConfirmationLabel');
const authTitle = document.querySelector('#authTitle');
const authDescription = document.querySelector('#authDescription');
const authSubmitButton = document.querySelector('#authSubmitButton');
const authSwitchButton = document.querySelector('#authSwitchButton');
const authStatus = document.querySelector('#authStatus');
const logoutButton = document.querySelector('#logoutButton');
const profileName = document.querySelector('.profile-name');
const profileRole = document.querySelector('.profile-role');
const welcomeUserName = document.querySelector('.welcome-title span');

const storageKey = 'nova-chat-history';
const settingsKey = 'nova-settings';
const preferredProviderKey = 'alya-preferred-provider';
const appSettingsKey = 'nova-app-settings';
const usernameKey = 'nova-username';
const conversationsKey = 'nova-conversations';

let currentSessionUsername = '';
let currentSessionRole = '';
let currentSessionGuest = false;
let history = [];
let settings = loadSettings();
let conversations = loadConversations();
let currentConversationId = conversations.length > 0 ? conversations[0].id : null;
if (!currentConversationId) {
  currentConversationId = createNewConversation();
}
let pendingFileProfile = null;
let selectedImageType = 'avatar';
let selectedImageStyle = 'cinematico';
let pendingComputerApproval = null;
let voiceRecognition = null;
let pendingAttachment = null;
let previousProviderSignature = '';
let deferredInstallPrompt = null;
let authMode = 'users';
let authScreenMode = 'login';

const providerLabels = {
  openrouter: 'OpenRouter',
  gemini: 'Gemini',
  groq: 'Groq',
  nvidia: 'NVIDIA',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  cerebras: 'Cerebras',
  together: 'Together'
};

function showToast(message, kind = 'info') {
  if (!toastContainer || !message) return;
  const toast = document.createElement('div');
  toast.className = `alya-toast ${kind}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 5200);
}

function showAuthModal(message = '') {
  if (!authModal) return;
  authModal.hidden = false;
  authStatus.textContent = message;
  authUsernameLabel.hidden = false;
  setTimeout(() => authUsername?.focus(), 50);
}

function setAuthScreenMode(mode) {
  authScreenMode = mode === 'register' ? 'register' : 'login';
  const registering = authScreenMode === 'register';
  authTitle.textContent = registering ? 'Criar minha conta' : 'Entrar na Sofia';
  authDescription.textContent = registering
    ? 'Escolha seu usuário e crie uma senha segura.'
    : 'Entre com sua conta para continuar.';
  authSubmitButton.textContent = registering ? 'Criar conta' : 'Entrar';
  authSwitchButton.textContent = registering ? 'Voltar para entrar' : 'Cadastrar';
  authPassword.autocomplete = registering ? 'new-password' : 'current-password';
  authPasswordConfirmationLabel.hidden = !registering;
  authPasswordConfirmation.required = registering;
  authStatus.textContent = '';
  authPassword.value = '';
  authPasswordConfirmation.value = '';
  setTimeout(() => authUsername?.focus(), 50);
}

function scopedStorageKey(key) {
  return `${key}:${currentSessionUsername || 'sem-sessao'}`;
}

function activateSession(user) {
  currentSessionUsername = String(user?.username || '').toLowerCase();
  currentSessionRole = user?.role === 'admin' ? 'admin' : 'user';
  const isGuest = user?.guest === true;
  currentSessionGuest = isGuest;
  settings = loadSettings();
  conversations = loadConversations();
  currentConversationId = conversations[0]?.id || null;
  if (!currentConversationId) currentConversationId = createNewConversation();
  history = loadConversationHistory(currentConversationId);
  if (personalitySelect) personalitySelect.value = settings.personality;
  if (modeSelect) modeSelect.value = settings.mode;
  if (memoryInput) memoryInput.value = settings.memory;
  if (profileName) profileName.textContent = isGuest ? 'Visitante' : currentSessionUsername;
  if (profileRole) profileRole.textContent = currentSessionRole === 'admin'
    ? 'Administrador'
    : isGuest ? 'Visitante' : 'Conta Privada';
  if (welcomeUserName) welcomeUserName.textContent = `${getUserName()}.`;
  if (settingsUserName) settingsUserName.value = getUserName();
  const isAdmin = currentSessionRole === 'admin';
  [systemButton, codeAlyaButton, computerButton, publicLinkBanner].forEach((element) => {
    if (element) element.hidden = !isAdmin;
  });
  if (logoutButton) logoutButton.hidden = isGuest;
}

async function checkAuthentication() {
  try {
    const response = await fetch(`${apiBase}/api/auth/status`, {
      cache: 'no-store',
      credentials: 'include'
    });
    const data = await response.json();
    authMode = data.loginMode || 'guest';
    if (!data.authenticated) {
      showAuthModal(data.setupRequired ? 'O administrador ainda precisa configurar a primeira conta.' : '');
      return false;
    }
    activateSession(data.user);
    if (authModal) authModal.hidden = true;
    return true;
  } catch {
    if (authModal) authModal.hidden = true;
    showToast('Não consegui conectar agora. Atualize a página em alguns segundos.', 'error');
    return false;
  }
}

async function submitAuthentication(event) {
  event.preventDefault();
  const registering = authScreenMode === 'register';
  if (registering && authPassword.value !== authPasswordConfirmation.value) {
    authStatus.textContent = 'As senhas não são iguais.';
    return;
  }
  authSubmitButton.disabled = true;
  authStatus.textContent = registering ? 'Criando sua conta...' : 'Verificando...';
  try {
    const response = await fetch(`${apiBase}/api/auth/${registering ? 'register' : 'login'}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: authUsername.value.trim(),
        password: authPassword.value
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'Não foi possível entrar.');
    activateSession(data.user);
    authModal.hidden = true;
    authPassword.value = '';
    authPasswordConfirmation.value = '';
    showToast(registering ? 'Conta criada. Bem-vindo à Sofia.' : 'Acesso liberado. Bem-vindo à Sofia.', 'success');
    refreshProviderStatus(false);
  } catch (error) {
    authStatus.textContent = error.message || 'Usuário ou senha inválidos';
  } finally {
    authSubmitButton.disabled = false;
  }
}

async function logout() {
  logoutButton.disabled = true;
  try {
    await fetch(`${apiBase}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include'
    });
  } finally {
    window.location.reload();
  }
}

function formatUptime(seconds) {
  const value = Number(seconds || 0);
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}min`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}min`;
}

async function loadSystemDashboard() {
  if (!systemOverview || !systemProviders) return;
  systemOverview.innerHTML = '<div class="system-loading">Verificando o sistema...</div>';
  systemProviders.replaceChildren();
  try {
    const response = await fetch(`${apiBase}/api/system-dashboard`, {
      cache: 'no-store',
      credentials: 'include'
    });
    if (response.status === 401) {
      showAuthModal('Entre novamente para abrir o painel.');
      throw new Error('Acesso protegido.');
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Painel indisponível.');

    const activeProvider = data.providers.active || data.providers.preferred;
    const storageReady = data.storage.durable;
    systemOverview.innerHTML = `
      <article class="system-stat good"><span>IA principal</span><strong>${escapeHtml(providerLabels[activeProvider] || activeProvider || 'Aguardando')}</strong><small>${data.providers.switched ? 'Reserva ativada' : 'Funcionando normalmente'}</small></article>
      <article class="system-stat ${storageReady ? 'good' : 'warning'}"><span>Banco de dados</span><strong>${storageReady ? 'Permanente' : 'Temporário'}</strong><small>${storageReady ? `${data.storage.records} registros protegidos` : 'Adicione DATABASE_URL no Render'}</small></article>
      <article class="system-stat good"><span>Tempo online</span><strong>${formatUptime(data.service.uptimeSeconds)}</strong><small>${escapeHtml(data.service.environment)}</small></article>
      <article class="system-stat"><span>Uso do chat</span><strong>${Number(data.usage.chatRequests || 0)}</strong><small>${Number(data.usage.chatErrors || 0)} falhas registradas</small></article>
      <article class="system-stat"><span>Arquivos</span><strong>${Number(data.usage.fileUploads || 0)}</strong><small>envios processados</small></article>
      <article class="system-stat ${data.discord.ready ? 'good' : ''}"><span>Discord</span><strong>${data.discord.ready ? 'Online' : data.discord.enabled ? 'Conectando' : 'Desativado'}</strong><small>situação do bot</small></article>
    `;

    systemModelSelect.replaceChildren();
    const configuredProviders = (data.providers.providers || []).filter((provider) => provider.configured);
    for (const provider of configuredProviders) {
      const option = document.createElement('option');
      option.value = provider.name;
      option.textContent = providerLabels[provider.name] || provider.name;
      systemModelSelect.appendChild(option);
    }
    systemModelSelect.value = data.providers.preferred;
    saveSystemModelButton.disabled = configuredProviders.length === 0;
    systemModelStatus.textContent = configuredProviders.length
      ? 'Escolha um modelo e confirme.'
      : 'Nenhum outro modelo está configurado no momento.';

    for (const provider of data.providers.providers || []) {
      const row = document.createElement('div');
      row.className = `system-provider ${provider.configured ? (provider.ok === false ? 'down' : 'ready') : 'off'}`;
      const label = providerLabels[provider.name] || provider.name;
      row.innerHTML = `<i></i><span>${escapeHtml(label)}</span><small>${provider.configured ? (provider.ok === false ? 'Em espera automática' : provider.name === activeProvider ? 'Ativo agora' : 'Reserva pronta') : 'Não configurado'}</small>`;
      systemProviders.appendChild(row);
    }
  } catch (error) {
    systemOverview.innerHTML = `<div class="system-loading">${escapeHtml(error.message || 'Não consegui carregar o painel.')}</div>`;
  }
}

async function saveSystemModel() {
  const provider = systemModelSelect?.value;
  if (!provider) return;
  saveSystemModelButton.disabled = true;
  systemModelStatus.textContent = 'Alterando o modelo...';
  try {
    const response = await fetch(`${apiBase}/api/system/model`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      showAuthModal('Entre novamente para mudar o modelo.');
      throw new Error('Sua sessão terminou.');
    }
    if (!response.ok || !data.ok) throw new Error(data.error || 'Não consegui mudar o modelo.');
    localStorage.setItem(scopedStorageKey(preferredProviderKey), provider);
    systemModelStatus.textContent = `${providerLabels[provider] || provider} selecionado. Reabrindo a Sofia...`;
    setTimeout(() => window.location.reload(), 650);
  } catch (error) {
    systemModelStatus.textContent = error.message || 'Não consegui mudar o modelo.';
    saveSystemModelButton.disabled = false;
  }
}

async function syncSavedProviderPreference() {
  const provider = localStorage.getItem(scopedStorageKey(preferredProviderKey));
  if (!provider) return;
  try {
    const statusResponse = await fetch(`${apiBase}/api/ai-status`, { cache: 'no-store' });
    const status = await statusResponse.json();
    const available = (status.providers || []).some((item) => item.name === provider && item.configured);
    if (!available || status.preferred === provider) return;
    await fetch(`${apiBase}/api/system/model`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    });
  } catch {}
}

function openSystemDashboard() {
  if (!systemModal) return;
  systemModal.hidden = false;
  loadSystemDashboard();
}

async function installAlyaApp() {
  if (window.matchMedia('(display-mode: standalone)').matches) {
    showToast('A Sofia já está instalada neste aparelho.', 'success');
    return;
  }
  if (!deferredInstallPrompt) {
    showToast('No celular, abra o menu do navegador e escolha “Adicionar à tela inicial”.');
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
}

async function refreshProviderStatus(notify = false) {
  try {
    const response = await fetch(`${apiBase}/api/ai-status`, { cache: 'no-store' });
    if (!response.ok) return;
    const status = await response.json();
    const configured = (status.providers || []).filter((item) => item.configured);
    const active = status.active || status.preferred;
    const label = providerLabels[active] || active || 'IA';
    const hasFallback = configured.length > 1;
    if (modelStatusText) modelStatusText.textContent = `${label}${hasFallback ? ' · proteção ativa' : ''}`;
    if (modelStatusPill) {
      modelStatusPill.classList.toggle('provider-fallback', Boolean(status.switched));
      modelStatusPill.title = status.switched
        ? `O modelo principal caiu. A Sofia trocou automaticamente para ${label}.`
        : `${label} está pronto.`;
    }

    const signature = `${status.preferred}:${active}:${status.switched}`;
    if (notify && previousProviderSignature && signature !== previousProviderSignature) {
      showToast(
        status.switched
          ? `O modelo principal ficou indisponível. A Sofia mudou automaticamente para ${label}.`
          : `${label} voltou a funcionar como modelo principal.`,
        status.switched ? 'warning' : 'success'
      );
    }
    previousProviderSignature = signature;
  } catch {
    if (modelStatusText) modelStatusText.textContent = 'IA reconectando';
  }
}

function clearAttachment() {
  pendingAttachment = null;
  if (fileInput) fileInput.value = '';
  if (attachmentChip) attachmentChip.hidden = true;
  if (attachmentName) attachmentName.textContent = '';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

async function prepareAttachment(file) {
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    showToast('Escolha um arquivo de até 4 MB.', 'warning');
    clearAttachment();
    return;
  }

  pendingAttachment = { name: file.name, loading: true, context: '' };
  attachmentChip.hidden = false;
  attachmentName.textContent = `Lendo ${file.name}...`;
  attachButton.disabled = true;

  try {
    const data = await fileToBase64(file);
    const response = await fetch(`${apiBase}/api/aly-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: file.name,
        mime: file.type || 'application/octet-stream',
        data,
        question: messageInput.value.trim()
      })
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) showAuthModal('Entre para enviar arquivos.');
    if (!response.ok || !result.ok) throw new Error(result.error || 'Não consegui ler o arquivo.');

    const context = result.kind === 'image'
      ? `[ANÁLISE DA IMAGEM "${result.name}"]\n${result.analysis}`
      : `[CONTEÚDO DO ARQUIVO "${result.name}"${result.truncated ? ' — trecho inicial' : ''}]\n${result.text}`;
    pendingAttachment = { name: result.name, loading: false, context };
    attachmentName.textContent = `📎 ${result.name}`;
    showToast('Arquivo pronto. Agora envie sua pergunta.', 'success');
    messageInput.focus();
  } catch (error) {
    showToast(error.message || 'Não consegui ler o arquivo.', 'warning');
    clearAttachment();
  } finally {
    attachButton.disabled = false;
  }
}

function setupVoiceInput() {
  if (!voiceInputButton) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceInputButton.hidden = true;
    return;
  }

  voiceRecognition = new SpeechRecognition();
  voiceRecognition.lang = 'pt-BR';
  voiceRecognition.interimResults = true;
  voiceRecognition.continuous = false;
  let baseText = '';

  voiceRecognition.onstart = () => {
    baseText = messageInput.value.trim();
    voiceInputButton.classList.add('listening');
    voiceInputButton.textContent = '■';
    voiceInputButton.title = 'Parar de ouvir';
  };
  voiceRecognition.onresult = (event) => {
    let spoken = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) spoken += event.results[i][0].transcript;
    messageInput.value = `${baseText}${baseText && spoken ? ' ' : ''}${spoken}`.trimStart();
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
  };
  voiceRecognition.onend = () => {
    voiceInputButton.classList.remove('listening');
    voiceInputButton.textContent = '🎙';
    voiceInputButton.title = 'Falar com a Sofia';
  };
  voiceRecognition.onerror = () => {
    voiceInputButton.classList.remove('listening');
    voiceInputButton.textContent = '🎙';
  };
  voiceInputButton.addEventListener('click', () => {
    if (voiceInputButton.classList.contains('listening')) voiceRecognition.stop();
    else {
      try { voiceRecognition.start(); } catch {}
    }
  });
}

function openComputerControl() {
  if (!computerModal) return;
  pendingComputerApproval = null;
  computerModal.hidden = false;
  computerApproval.hidden = true;
  computerStatus.textContent = 'Ações perigosas, instalações, exclusões e terminal não são permitidos.';
  computerRequest?.focus();
}

async function prepareComputerControl() {
  const request = computerRequest?.value.trim();
  if (!request) return;
  prepareComputerAction.disabled = true;
  computerStatus.textContent = 'Verificando a ação...';
  try {
    const response = await fetch(`${apiBase}/api/computer/propose`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request }) });
    const data = await response.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.message || data.error || 'Não foi possível preparar esta ação.');
    pendingComputerApproval = data.approvalId;
    computerApprovalText.textContent = `Sofia quer: ${data.label}. A aprovação expira em 60 segundos.`;
    computerApproval.hidden = false;
    computerStatus.textContent = 'Nada foi feito ainda.';
  } catch (error) {
    computerApproval.hidden = true;
    computerStatus.textContent = error.message || 'Não foi possível preparar esta ação.';
  } finally {
    prepareComputerAction.disabled = false;
  }
}

async function approveComputerControl() {
  if (!pendingComputerApproval) return;
  approveComputerAction.disabled = true;
  try {
    const response = await fetch(`${apiBase}/api/computer/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approvalId: pendingComputerApproval }) });
    const data = await response.json().catch(() => ({}));
    computerStatus.textContent = data.message || data.error || 'Ação concluída.';
    computerApproval.hidden = true;
    pendingComputerApproval = null;
  } catch {
    computerStatus.textContent = 'Não foi possível executar a ação.';
  } finally {
    approveComputerAction.disabled = false;
  }
}

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
  label.textContent = role === 'user' ? 'Voce' : 'Sofia';

  const text = document.createElement('div');
  text.className = 'message-content';
  text.textContent = content || 'Pensando...';

  article.append(label, text);
  messagesEl.appendChild(article);
  scrollToBottom();
}

function getImageRequestFromChat(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/^(?:sofia|alya|alia)[,:\s-]*/i, '')
    .replace(/^(?:por favor|pfv|por gentileza)[,:\s-]*/i, '')
    .trim();
  const command = /\b(?:cria|crie|criar|faz|faça|fazer|gera|gere|gerar|desenha|desenhe|desenhar|tira|tire|tirar|manda|mande|mandar|envia|envie|enviar|mostra|mostre|mostrar|produz|produza|produzir)\b/i;
  const imageKind = /\b(?:imagem|imagens|foto|fotos|avatar|banner|arte|desenho|ilustração|ilustracao|pôster|poster|capa|papel de parede|wallpaper|logo|logotipo|ícone|icone|figurinha|meme|gráfico|grafico|infográfico|infografico|diagrama|mapa|card|thumbnail|miniatura|print)\b/i;
  const negated = /\b(?:não|nao)\s+(?:cria|crie|criar|faz|faça|fazer|gera|gere|gerar|manda|mande|mandar|envia|envie|enviar)\b/i;
  const howTo = /\b(?:como|onde)\s+(?:eu\s+)?(?:crio|criar|faço|faco|fazer|gero|gerar|mando|mandar)\b/i;
  const realScreenshot = /\b(?:print|captura)\b[\s\S]{0,35}\b(?:minha|desta|essa|da minha|do meu)\s+(?:tela|área de trabalho|area de trabalho|computador|pc)\b/i;
  if (
    !cleaned ||
    !command.test(cleaned) ||
    !imageKind.test(cleaned) ||
    negated.test(cleaned) ||
    howTo.test(cleaned) ||
    realScreenshot.test(cleaned)
  ) return null;

  const prompt = cleaned
    .replace(/^(?:eu\s+)?(?:quero|queria|gostaria)\s+(?:que\s+)?(?:você|voce|a sofia|a alya)?\s*/i, '')
    .replace(/^(?:me\s+)?(?:cria|crie|faz|faça|gera|gere|desenha|desenhe|tira|tire|manda|mande|envia|envie|mostra|mostre|produz|produza)\s*/i, '')
    .trim() || cleaned;
  const normalized = `${cleaned} ${prompt}`.toLowerCase();
  const type = /banner|capa|wallpaper|papel de parede|paisagem|panorâmica|panoramica/.test(normalized)
    ? 'banner'
    : /avatar|perfil|logo|logotipo|ícone|icone|figurinha|thumbnail|miniatura/.test(normalized)
      ? 'avatar'
      : 'personagem';
  const style = /anime|mangá|manga|luffy|one piece|naruto|dragon ball/.test(normalized)
    ? 'anime'
    : /realista|realística|realistica|fotografia|foto real|fotorrealista/.test(normalized)
      ? 'realista'
      : /\b3d\b|render|pixar|jogo moderno/.test(normalized)
        ? '3d'
        : 'cinematico';
  return { prompt, type, style };
}

async function createImageFromChat(request) {
  appendMessage('assistant', '✦ Estou criando sua imagem...');
  try {
    const response = await fetch(`${apiBase}/api/aly-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) showAuthModal('Entre para criar imagens.');
    if (!response.ok || !data.imageUrl) throw new Error(data.error || 'Não consegui criar a imagem agora.');

    history.push({ role: 'assistant', content: '✦ Pronta! Aqui está sua imagem.', imageUrl: data.imageUrl, imagePrompt: request.prompt });
    saveConversationHistory(currentConversationId, history);
    renderSidebarConversations();
    render();
  } catch (error) {
    history.push({
      role: 'assistant',
      content: error.message || 'Não consegui criar a imagem agora. Tente novamente daqui a pouco.'
    });
    saveConversationHistory(currentConversationId, history);
    renderSidebarConversations();
    render();
  }
}

function addChatMessageActions(article, message, index) {
  const actions = document.createElement('div');
  actions.className = 'chat-message-actions';

  if (message.role === 'assistant') {
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copiar';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(message.content || ''); copy.textContent = 'Copiado'; } catch { copy.textContent = 'Não deu'; }
      setTimeout(() => { copy.textContent = 'Copiar'; }, 1200);
    });
    actions.appendChild(copy);

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Refazer';
    retry.addEventListener('click', () => {
      const question = history[index - 1];
      if (!question || question.role !== 'user') return;
      history = history.slice(0, index - 1);
      saveConversationHistory(currentConversationId, history);
      render();
      sendMessage(question.content);
    });
    actions.appendChild(retry);
  } else {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'Editar';
    edit.addEventListener('click', () => {
      history = history.slice(0, index);
      saveConversationHistory(currentConversationId, history);
      messageInput.value = message.content || '';
      messageInput.focus();
      messageInput.style.height = 'auto';
      messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
      render();
    });
    actions.appendChild(edit);
  }
  article.appendChild(actions);
}

function appendComputerApproval(label, approvalId) {
  const article = document.createElement('article');
  article.className = 'message assistant computer-message';
  const title = document.createElement('span');
  title.className = 'message-label';
  title.textContent = 'Sofia · computador seguro';
  const text = document.createElement('div');
  text.className = 'message-content';
  text.textContent = `Posso ${label.charAt(0).toLowerCase()}${label.slice(1)}. Você confirma?`;
  const approve = document.createElement('button');
  approve.className = 'computer-approve-chat';
  approve.type = 'button';
  approve.textContent = 'Sim, pode abrir';
  approve.addEventListener('click', async () => {
    approve.disabled = true;
    try {
      const response = await fetch(`${apiBase}/api/computer/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approvalId }) });
      const data = await response.json().catch(() => ({}));
      text.textContent = data.message || data.error || 'Ação concluída.';
    } catch {
      text.textContent = 'Não consegui executar essa ação.';
    }
    approve.remove();
  });
  article.append(title, text, approve);
  messagesEl.appendChild(article);
  scrollToBottom();
}

async function tryComputerCommand(content) {
  const command = content.trim();
  const opensSomething = /^(abra|abrir|abre)\b/i.test(command);
  const requestsScreenshot =
    /\b(?:print|screenshot|captura da tela|foto da tela)\b/i.test(command) &&
    /\b(?:tira|tirar|tire|faça|fazer|capture|captura|mande|mandar|envie|enviar)\b/i.test(command);
  if (!opensSomething && !requestsScreenshot) return false;
  try {
    const response = await fetch(`${apiBase}/api/computer/propose`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: content }) });
    const data = await response.json().catch(() => ({}));
    if (!data.ok) {
      appendMessage('assistant', data.message || data.error || 'Não consegui preparar essa ação.');
      return true;
    }
    appendComputerApproval(data.label, data.approvalId);
    return true;
  } catch {
    return false;
  }
}

function setBusy(isBusy) {
  sendButton.disabled = isBusy;
  messageInput.disabled = isBusy;
  if (attachButton) attachButton.disabled = isBusy;
  if (isBusy) showTypingIndicator();
  else hideTypingIndicator();
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(scopedStorageKey(settingsKey)) || '{}');
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
  localStorage.setItem(scopedStorageKey(settingsKey), JSON.stringify(settings));
}

function loadAppSettings() {
  try {
    return JSON.parse(localStorage.getItem(scopedStorageKey(appSettingsKey)) || '{}');
  } catch {
    return {};
  }
}

function saveAppSettings(updates) {
  const current = loadAppSettings();
  Object.assign(current, updates);
  localStorage.setItem(scopedStorageKey(appSettingsKey), JSON.stringify(current));
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
    return localStorage.getItem(scopedStorageKey(usernameKey)) ||
      (currentSessionGuest ? 'Visitante' : currentSessionUsername) ||
      'Pedro';
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
    const saved = localStorage.getItem(scopedStorageKey(storageKey));
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
    localStorage.setItem(scopedStorageKey(storageKey), compress(toSave));
  } catch (error) {
    console.error('Error saving history:', error);
  }
}

function loadConversations() {
  try {
    const saved = localStorage.getItem(scopedStorageKey(conversationsKey));
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
    localStorage.setItem(scopedStorageKey(conversationsKey), compress(toSave));
  } catch (error) {
    console.error('Error saving conversations:', error);
  }
}

function createNewConversation() {
  const id = Date.now().toString(36) + Math.random().toString(36).substring(2);
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
    updateConversationHeading();
  }
}

function updateConversationHeading() {
  if (!conversationHeading) return;
  const conversation = conversations.find((item) => item.id === currentConversationId);
  conversationHeading.textContent = conversation?.title || 'Nova conversa';
}

function switchConversation(conversationId) {
  if (currentConversationId === conversationId) return;
  currentConversationId = conversationId;
  history = loadConversationHistory(conversationId);
  render();
  renderSidebarConversations();
  updateConversationHeading();
  scrollToBottom();
}

function loadConversationHistory(conversationId) {
  try {
    const saved = localStorage.getItem(scopedStorageKey(`${storageKey}-${conversationId}`));
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
    localStorage.setItem(scopedStorageKey(`${storageKey}-${conversationId}`), compress(toSave));
  } catch (error) {
    console.error('Error saving conversation history:', error);
  }
}

function deleteConversation(conversationId) {
  conversations = conversations.filter(c => c.id !== conversationId);
  saveConversations();
  localStorage.removeItem(scopedStorageKey(`${storageKey}-${conversationId}`));

  if (conversations.length === 0) {
    currentConversationId = createNewConversation();
  } else if (currentConversationId === conversationId) {
    currentConversationId = conversations[0].id;
  }

  history = loadConversationHistory(currentConversationId);
  render();
  renderSidebarConversations();
  updateConversationHeading();
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
      <button class="rename-conversation" data-id="${conv.id}" title="Renomear">✎</button>
      <button class="delete-conversation" data-id="${conv.id}" title="Excluir">&#215;</button>
    </div>
  `).join('');

  conversationsListSidebar.querySelectorAll('.conversation-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-conversation') || e.target.classList.contains('rename-conversation')) return;
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
    label.textContent = message.role === 'user' ? 'Voce' : 'Sofia';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = message.content || '...';

    if (message.imageUrl) {
      const image = document.createElement('img');
      image.className = 'chat-generated-image';
      image.src = message.imageUrl;
      image.alt = message.imagePrompt || 'Imagem criada pela Sofia';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => {
        const error = document.createElement('p');
        error.className = 'chat-image-error';
        error.textContent = 'A imagem não carregou. Tente criar de novo daqui a pouco.';
        image.replaceWith(error);
      }, { once: true });
      content.append(image);
    }

    article.append(label, content);
    addChatMessageActions(article, message, index);
    messagesEl.appendChild(article);
  }

  scrollToBottom();
}

async function sendMessage(content) {
  if (pendingAttachment?.loading) {
    showToast('Espere o arquivo terminar de carregar.', 'warning');
    return;
  }
  const typedContent = String(content || '').trim();
  if (!typedContent && !pendingAttachment) return;
  const visibleContent = typedContent || 'Analise este arquivo para mim.';
  const attachmentForRequest = pendingAttachment;

  if (welcomeScreen) welcomeScreen.hidden = true;
  history.push({
    role: 'user',
    content: attachmentForRequest ? `${visibleContent}\n📎 ${attachmentForRequest.name}` : visibleContent
  });
  appendMessage('user', attachmentForRequest ? `${visibleContent}\n📎 ${attachmentForRequest.name}` : visibleContent);
  messageInput.value = '';
  messageInput.style.height = 'auto';
  // No celular, fecha o teclado para a resposta da Sofia ficar visível.
  if (isSimpleMobileLink) messageInput.blur();
  setBusy(true);

  updateConversationTitle(currentConversationId, visibleContent);
  saveConversationHistory(currentConversationId, history);
  renderSidebarConversations();

  if (!attachmentForRequest && await tryComputerCommand(visibleContent)) {
    setBusy(false);
    saveConversationHistory(currentConversationId, history);
    return;
  }

  const imageRequest = !attachmentForRequest && getImageRequestFromChat(visibleContent);
  if (imageRequest) {
    await createImageFromChat(imageRequest);
    setBusy(false);
    return;
  }

  const messagesForRequest = history.slice(-6).map((message, index, list) => {
    if (!attachmentForRequest || index !== list.length - 1 || message.role !== 'user') return message;
    return {
      role: 'user',
      content: `${visibleContent}\n\n${attachmentForRequest.context}\n\nResponda à pergunta usando o arquivo. Se for trabalho escolar, explique para a pessoa aprender em vez de apenas dar uma resposta sem explicação.`
    };
  });
  clearAttachment();

  const body = {
    messages: messagesForRequest,
    conversationId: currentConversationId,
    settings: {
      personality: personalitySelect.value,
      mode: modeSelect.value,
      memory: memoryInput.value.trim()
    }
  };

  try {
    let fullReply = '';
    let response;

    try {
      response = await fetch(`${apiBase}/api/aly-chat-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (response.status === 401) {
        showAuthModal('Sua sessão terminou. Entre novamente.');
        throw new Error('Acesso protegido.');
      }
    } catch (fetchErr) {
      console.warn('Streaming HTTP falhou, usando fallback normal:', fetchErr);
    }

    if (response && response.ok) {
      const article = document.createElement('article');
      article.className = 'message assistant';
      const label = document.createElement('span');
      label.className = 'message-label';
      label.textContent = 'Sofia';
      const contentEl = document.createElement('div');
      contentEl.className = 'message-content';
      contentEl.textContent = '';
      article.append(label, contentEl);
      messagesEl.appendChild(article);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullReply += chunk;
        contentEl.textContent = fullReply;
        scrollToBottom();
      }
    }

    // Se o streaming falhou ou veio vazio, usar fallback seguro /api/aly-chat
    if (!fullReply.trim()) {
      const fallbackRes = await fetch(`${apiBase}/api/aly-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const fallbackData = await fallbackRes.json().catch(() => ({}));
      fullReply = fallbackData.reply || 'Recebi sua mensagem!';

      const lastAssistantEl = messagesEl.querySelector('article.assistant:last-child .message-content');
      if (lastAssistantEl && !lastAssistantEl.textContent.trim()) {
        lastAssistantEl.textContent = fullReply;
      } else if (!lastAssistantEl) {
        appendMessage('assistant', fullReply);
      }
    }

    history.push({ role: 'assistant', content: fullReply });
    saveConversationHistory(currentConversationId, history);
    renderSidebarConversations();
    render();
  } catch (error) {
    console.error('Aly chat error:', error);
    appendMessage('assistant', 'Estou com dificuldade de responder agora. Tente de novo em alguns segundos.');
  } finally {
    setBusy(false);
    refreshProviderStatus(true);
    messageInput.focus();
  }
}

function openImageStudio() {
  if (!imageStudioModal) return;
  imageStudioModal.hidden = false;
  imagePrompt?.focus();
}

function closeImageStudio() {
  if (imageStudioModal) imageStudioModal.hidden = true;
}

function setImageType(type) {
  selectedImageType = type;
  document.querySelectorAll('.image-type-option').forEach((button) => {
    button.classList.toggle('active', button.dataset.imageType === type);
  });
  conversationsListSidebar.querySelectorAll('.rename-conversation').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const conversation = conversations.find((item) => item.id === btn.dataset.id);
      const title = window.prompt('Novo nome da conversa:', conversation?.title || '');
      if (!title?.trim() || !conversation) return;
      conversation.title = title.trim().slice(0, 60);
      conversation.updatedAt = new Date().toISOString();
      saveConversations();
      renderSidebarConversations();
      updateConversationHeading();
    });
  });
}

function setImageStyle(style) {
  selectedImageStyle = style;
  document.querySelectorAll('.image-style-option').forEach((button) => {
    button.classList.toggle('active', button.dataset.imageStyle === style);
  });
}

async function generateImage() {
  const prompt = imagePrompt?.value.trim() || '';
  if (!prompt) {
    if (imageStudioStatus) imageStudioStatus.textContent = 'Escreva como você quer a imagem.';
    imagePrompt?.focus();
    return;
  }

  generateImageButton.disabled = true;
  generateImageButton.textContent = 'Criando...';
  imageStudioStatus.textContent = 'A Sofia está criando sua imagem...';
  imageStudioResult.hidden = true;
  imageStudioResult.replaceChildren();

  try {
    const response = await fetch(`${apiBase}/api/aly-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, type: selectedImageType, style: selectedImageStyle })
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) showAuthModal('Entre para criar imagens.');
    if (!response.ok || !data.imageUrl) throw new Error(data.error || 'Não consegui criar a imagem agora.');

    const image = document.createElement('img');
    image.src = data.imageUrl;
    image.alt = prompt;
    image.referrerPolicy = 'no-referrer';
    image.onload = () => { imageStudioStatus.textContent = 'Pronta! Você pode salvar a imagem no seu computador.'; };
    image.onerror = () => { imageStudioStatus.textContent = 'A imagem demorou para carregar. Tente criar novamente.'; };

    const download = document.createElement('a');
    download.href = data.imageUrl;
    download.target = '_blank';
    download.rel = 'noopener';
    download.textContent = 'Abrir imagem em tamanho grande ↗';
    imageStudioResult.append(image, download);
    imageStudioResult.hidden = false;
  } catch (error) {
    imageStudioStatus.textContent = error.message || 'Não consegui criar a imagem agora.';
  } finally {
    generateImageButton.disabled = false;
    generateImageButton.textContent = '✦ Criar imagem';
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

document.querySelectorAll('[data-prompt]').forEach(card => {
  card.addEventListener('click', () => {
    const prompt = card.dataset.prompt || '';
    messageInput.value = prompt + ' ';
    messageInput.focus();
    welcomeScreen.hidden = true;
  });
});

attachButton?.addEventListener('click', () => fileInput?.click());
fileInput?.addEventListener('change', () => prepareAttachment(fileInput.files?.[0]));
removeAttachmentButton?.addEventListener('click', clearAttachment);

toolsButton?.addEventListener('click', () => {
  if (toolsModal) toolsModal.hidden = false;
});
closeToolsButton?.addEventListener('click', () => {
  if (toolsModal) toolsModal.hidden = true;
});
toolsModal?.addEventListener('click', (event) => {
  if (event.target === toolsModal) toolsModal.hidden = true;
});
document.querySelectorAll('[data-tool-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    if (toolsModal) toolsModal.hidden = true;
    sendMessage(button.dataset.toolPrompt || '');
  });
});

authForm?.addEventListener('submit', submitAuthentication);
authSwitchButton?.addEventListener('click', () => {
  setAuthScreenMode(authScreenMode === 'login' ? 'register' : 'login');
});
logoutButton?.addEventListener('click', logout);
systemButton?.addEventListener('click', openSystemDashboard);
codeAlyaButton?.addEventListener('click', () => {
  window.location.href = '/code-alya';
});
closeSystemButton?.addEventListener('click', () => { systemModal.hidden = true; });
refreshSystemButton?.addEventListener('click', loadSystemDashboard);
saveSystemModelButton?.addEventListener('click', saveSystemModel);
systemModal?.addEventListener('click', (event) => {
  if (event.target === systemModal) systemModal.hidden = true;
});
installAppButton?.addEventListener('click', installAlyaApp);
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installAppButton) installAppButton.hidden = false;
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  showToast('Sofia instalada com sucesso.', 'success');
});

if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

if (imageStudioButton) imageStudioButton.addEventListener('click', openImageStudio);
if (closeImageStudioButton) closeImageStudioButton.addEventListener('click', closeImageStudio);
if (imageStudioModal) imageStudioModal.addEventListener('click', (event) => {
  if (event.target === imageStudioModal) closeImageStudio();
});
document.querySelectorAll('.image-type-option').forEach((button) => {
  button.addEventListener('click', () => setImageType(button.dataset.imageType));
});
document.querySelectorAll('.image-style-option').forEach((button) => {
  button.addEventListener('click', () => setImageStyle(button.dataset.imageStyle));
});
if (generateImageButton) generateImageButton.addEventListener('click', generateImage);

newConversationButton.addEventListener('click', () => {
  currentConversationId = createNewConversation();
  history = [];
  render();
  updateConversationHeading();
  scrollToBottom();
  messageInput.focus();
});

if (composeIconButton) {
  composeIconButton.addEventListener('click', () => newConversationButton.click());
}

if (userProfileButton) userProfileButton.addEventListener('click', openSettings);

if (searchButton && searchConversationsInput) {
  searchButton.addEventListener('click', () => {
    searchConversationsInput.focus();
    if (window.innerWidth <= 768) sidebar?.classList.add('open');
  });
}

if (mobileMenuButton) {
  mobileMenuButton.addEventListener('click', () => sidebar?.classList.toggle('open'));
}

if (shareLinkButton) {
  shareLinkButton.addEventListener('click', async () => {
    const url = publicLinkText?.textContent?.trim() || window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Sofia', text: 'Converse com a Sofia', url });
      } else {
        await navigator.clipboard.writeText(url);
        shareLinkButton.innerHTML = '<span>✓</span> Copiado';
        setTimeout(() => { shareLinkButton.innerHTML = '<span>↗</span> Compartilhar'; }, 1800);
      }
    } catch {
      // Cancelar o compartilhamento não precisa mostrar um erro.
    }
  });
}

function openSettings() {
  if (!settingsModal) return;
  const appSettings = loadAppSettings();
  if (settingsLanguage) settingsLanguage.value = appSettings.language || 'pt-BR';
  if (settingsAiName) settingsAiName.value = appSettings.aiName || 'Sofia';
  if (settingsUserName) settingsUserName.value = appSettings.userName || getUserName();
  if (settingsWelcomeToggle) settingsWelcomeToggle.checked = getWelcomeEnabled();
  if (settingsSoundToggle) settingsSoundToggle.checked = appSettings.soundEnabled !== false;
  if (settingsSoundVolume) settingsSoundVolume.value = Math.round((appSettings.soundVolume ?? 0.5) * 100);
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
    soundEnabled: settingsSoundToggle?.checked ?? true,
    soundVolume: (Number(settingsSoundVolume?.value ?? 50) / 100)
  };

  saveAppSettings(updates);
  if (updates.userName) localStorage.setItem(scopedStorageKey(usernameKey), updates.userName);
  if (welcomeUserName && updates.userName) welcomeUserName.textContent = `${updates.userName}.`;
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
  alert('Sofia Assistente\n\nRecursos:\n- Chat com IA\n- Memoria persistente\n- Multiplas conversas\n- Configuracoes\n\nUse os botoes na barra lateral para acessar as funcionalidades.');
});

let isDarkTheme = true;

function applyTheme() {
  document.documentElement.style.setProperty('color-scheme', isDarkTheme ? 'dark' : 'light');
  document.body.classList.toggle('light-theme', !isDarkTheme);
}

function toggleTheme() {
  isDarkTheme = !isDarkTheme;
  applyTheme();
  saveAppSettings({ theme: isDarkTheme ? 'dark' : 'light' });
}

if (themeButton) themeButton.addEventListener('click', toggleTheme);

function init() {
  setupVoiceInput();
  const appSettings = loadAppSettings();
  if (String(appSettings.aiName || '').trim().toLowerCase() === 'alya') {
    appSettings.aiName = 'Sofia';
    saveAppSettings({ aiName: 'Sofia' });
  }
  if (appSettings.theme === 'light') {
    isDarkTheme = false;
    applyTheme();
  }

  const saved = loadAppSettings();
  if (saved.personality && personalitySelect) personalitySelect.value = saved.personality;
  if (saved.mode && modeSelect) modeSelect.value = saved.mode;

  const previousAuth = localStorage.getItem(scopedStorageKey('aly-audio-authorized')) === 'true';
  if (previousAuth) {
    audioAuthorized = true;
  }

  const soundEnabled = appSettings.soundEnabled !== false;
  if (soundEnabled && audioAuthorized) {
    hideSoundPrompt();
  } else if (soundEnabled && !audioAuthorized) {
    showSoundPrompt();
  }

  document.addEventListener('click', () => {
    if (!audioAuthorized) {
      iniciarAudio();
      hideSoundPrompt();
    }
  }, { once: true });

  const maxWait = 8000;
  const startTime = Date.now();
  let loadingHidden = false;

  function forceHideLoading() {
    const elapsed = Date.now() - startTime;
    if (loadingHidden) return;

    if (elapsed >= maxWait) {
      loadingHidden = true;
      hideLoadingScreen();
      return;
    }

    setTimeout(forceHideLoading, 1000);
  }

  function safeHideLoading() {
    loadingHidden = true;
    hideLoadingScreen();
  }

  showLoadingScreen('Inicializando...', 20);
  forceHideLoading();

  setTimeout(() => {
    showLoadingScreen('Conectando a IA...', 50);
  }, 400);

  setTimeout(() => {
    showLoadingScreen('Bem-vindo à Sofia', 80);
  }, 900);

  setTimeout(async () => {
    try {
      const authenticated = await checkAuthentication();
      if (authenticated) await syncSavedProviderPreference();
      render();
      renderSidebarConversations();
      updateConversationHeading();
      updateWelcomeVisibility();
      await refreshProviderStatus(false);

      // Não bloquear a inicialização se o link/tunnel falhar
      try { await Promise.race([loadPublicLink(), new Promise(r => setTimeout(r, 3000))]); } catch {}
      try { await Promise.race([checkTunnelStatus(), new Promise(r => setTimeout(r, 3000))]); } catch {}

      showLoadingScreen('Sofia pronta para conversar.', 100);
      playStartupSound();

      setTimeout(() => {
        safeHideLoading();
      }, 1000);

      setInterval(checkTunnelStatus, 5000);
      setInterval(() => refreshProviderStatus(true), 60000);
    } catch (error) {
      safeHideLoading();
      console.error('Erro na inicializacao:', error);
    }
  }, 1400);
}

async function loadPublicLink() {
  const publicLinkBanner = document.querySelector('#publicLinkBanner');
  const publicLinkText = document.querySelector('#publicLinkText');
  const copyPublicLink = document.querySelector('#copyPublicLink');

  if (!publicLinkBanner || !publicLinkText || !copyPublicLink) return;

  try {
    const response = await fetch(`${apiBase}/api/aly-link`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Erro ao carregar link publico.');

    const url = data.chatUrl || (data.publicUrl ? `${data.publicUrl}/aly` : '');
    if (!url) return;

    publicLinkText.textContent = url;
    publicLinkBanner.hidden = false;

    copyPublicLink.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        copyPublicLink.textContent = 'Copiado';
        setTimeout(() => {
          copyPublicLink.textContent = 'Copiar';
        }, 2000);
      } catch {
        copyPublicLink.textContent = 'Erro';
      }
    });
  } catch {
    // silently ignore
  }
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

if (settingsSoundToggle) {
  settingsSoundToggle.addEventListener('change', () => {
    const appSettings = loadAppSettings();
    saveAppSettings({ soundEnabled: settingsSoundToggle.checked });
  });
}

if (settingsSoundVolume) {
  settingsSoundVolume.addEventListener('input', () => {
    const appSettings = loadAppSettings();
    saveAppSettings({ soundVolume: Number(settingsSoundVolume.value) / 100 });
  });
}

const testSoundButton = document.querySelector('#testSoundButton');
if (testSoundButton) {
  testSoundButton.addEventListener('click', () => {
    testStartupSound();
  });
}

function showLoadingScreen(message, progress) {
  if (loadingStatus) loadingStatus.textContent = message || '';
  if (loadingBar) loadingBar.style.width = `${Math.min(100, Math.max(0, progress || 0))}%`;
  if (loadingScreen) {
    loadingScreen.hidden = false;
    loadingScreen.style.display = '';
  }
}

function hideLoadingScreen() {
  if (loadingScreen) {
    loadingScreen.hidden = true;
    loadingScreen.style.display = 'none';
  }
}

let audioContext = null;
let audioAuthorized = false;

function iniciarAudio() {
  if (audioAuthorized) return;

  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    audioContext = new AudioContext();
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    audioAuthorized = true;
    localStorage.setItem(scopedStorageKey('aly-audio-authorized'), 'true');

    const soundPrompt = document.querySelector('#soundPrompt');
    if (soundPrompt) soundPrompt.hidden = true;
  } catch {
    // ignore audio errors
  }
}

function showSoundPrompt() {
  const soundPrompt = document.querySelector('#soundPrompt');
  if (soundPrompt && !audioAuthorized) {
    soundPrompt.hidden = false;
  }
}

function hideSoundPrompt() {
  const soundPrompt = document.querySelector('#soundPrompt');
  if (soundPrompt) soundPrompt.hidden = true;
}

function playStartupSound() {
  try {
    if (sessionStorage.getItem('aly-sound-played') === 'true') return;
    if (!audioAuthorized) return;

    const appSettings = loadAppSettings();
    if (appSettings.soundEnabled === false) return;

    const sound = document.querySelector('#startupSound');
    if (!sound) return;

    const volume = Number(appSettings.soundVolume ?? 0.5);
    sound.volume = Math.max(0, Math.min(1, volume));
    sound.currentTime = 0;

    sound.play().then(() => {
      sessionStorage.setItem('aly-sound-played', 'true');
    }).catch(() => {
      // ignore play errors
    });
  } catch {
    // ignore sound errors
  }
}

function testStartupSound() {
  try {
    iniciarAudio();

    const appSettings = loadAppSettings();
    const sound = document.querySelector('#startupSound');
    if (!sound) return;

    const volume = Number(appSettings.soundVolume ?? 0.5);
    sound.volume = Math.max(0, Math.min(1, volume));
    sound.currentTime = 0;
    sound.play().catch(() => {});
  } catch {
    // ignore
  }
}

async function checkTunnelStatus() {
  if (!publicLinkBanner || !publicLinkStatus || !publicLinkText) return;

  try {
    const response = await fetch(`${apiBase}/api/aly-status`);
    const data = await response.json();
    if (!response.ok) throw new Error();

    if (data.tunnelUp && data.publicUrl) {
      publicLinkText.textContent = `${data.publicUrl}/aly`;
      publicLinkBanner.hidden = false;
      publicLinkStatus.classList.remove('disconnected');
    } else {
      publicLinkText.textContent = data.localUrl || '';
      publicLinkBanner.hidden = false;
      publicLinkStatus.classList.add('disconnected');
    }
  } catch {
    publicLinkStatus.classList.add('disconnected');
  }
}

async function restartTunnelServices() {
  if (!restartTunnel) return;
  restartTunnel.disabled = true;
  restartTunnel.textContent = 'Reiniciando...';

  try {
    const response = await fetch(`${apiBase}/api/tunnel-restart`, { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (data.success && data.chatUrl && publicLinkText) {
      publicLinkText.textContent = data.chatUrl;
      if (publicLinkBanner) publicLinkBanner.hidden = false;
      if (publicLinkStatus) publicLinkStatus.classList.remove('disconnected');
    }
    await checkTunnelStatus();
  } catch {
    if (publicLinkStatus) publicLinkStatus.classList.add('disconnected');
  } finally {
    if (restartTunnel) {
      restartTunnel.disabled = false;
      restartTunnel.textContent = 'Reiniciar';
    }
  }
}

if (restartTunnel) {
  restartTunnel.addEventListener('click', restartTunnelServices);
}

if (computerButton) computerButton.addEventListener('click', openComputerControl);
if (closeComputerButton) closeComputerButton.addEventListener('click', () => { computerModal.hidden = true; });
if (prepareComputerAction) prepareComputerAction.addEventListener('click', prepareComputerControl);
if (approveComputerAction) approveComputerAction.addEventListener('click', approveComputerControl);

init();
