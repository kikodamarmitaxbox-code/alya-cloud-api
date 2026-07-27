const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const NOTIFICATIONS_FILE = path.join(__dirname, '..', 'nova-data', 'notifications.json');

const VALID_CATEGORIES = ['Sistema', 'IA', 'Projeto', 'Segurança', 'Memória', 'Plugins', 'Atualizações'];
const VALID_PRIORITIES = ['Baixa', 'Média', 'Alta', 'Crítica'];

const PRIORITY_WEIGHTS = {
  'Crítica': 4,
  'Alta': 3,
  'Média': 2,
  'Baixa': 1
};

function ensureFileExists() {
  const dir = path.dirname(NOTIFICATIONS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(NOTIFICATIONS_FILE)) {
    fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

function loadNotifications() {
  try {
    ensureFileExists();
    const raw = fs.readFileSync(NOTIFICATIONS_FILE, 'utf8');
    const items = JSON.parse(raw);
    return Array.isArray(items) ? items : [];
  } catch (err) {
    logger.error('Erro ao ler notificações:', err);
    return [];
  }
}

function saveNotifications(items) {
  try {
    ensureFileExists();
    fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(items, null, 2), 'utf8');
    return true;
  } catch (err) {
    logger.error('Erro ao salvar notificações:', err);
    return false;
  }
}

/**
 * Cria uma nova notificação com prioridade, categoria e persistência
 */
function createNotification({ title, message, category = 'Sistema', priority = 'Média', details = null }) {
  const items = loadNotifications();

  const cleanCategory = VALID_CATEGORIES.includes(category) ? category : 'Sistema';
  const cleanPriority = VALID_PRIORITIES.includes(priority) ? priority : 'Média';

  const newNotif = {
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
    title: String(title || 'Notificação').slice(0, 150),
    message: String(message || '').slice(0, 800),
    category: cleanCategory,
    priority: cleanPriority,
    details: details ? String(details).slice(0, 500) : null,
    read: false,
    createdAt: new Date().toISOString()
  };

  items.unshift(newNotif);

  // Manter limite de 150 notificações armazenadas
  if (items.length > 150) {
    items.pop();
  }

  saveNotifications(items);
  logger.info(`Notificação gerada [${cleanCategory} | ${cleanPriority}]: "${newNotif.title}"`);
  return newNotif;
}

/**
 * Retorna as notificações ordenadas por prioridade e data
 */
function getNotifications() {
  const items = loadNotifications();

  // Ordenar por Peso da Prioridade (descendente) e Data (descendente)
  items.sort((a, b) => {
    const weightA = PRIORITY_WEIGHTS[a.priority] || 1;
    const weightB = PRIORITY_WEIGHTS[b.priority] || 1;

    if (weightB !== weightA) {
      return weightB - weightA;
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const unreadCount = items.filter(n => !n.read).length;

  return {
    notifications: items,
    unreadCount
  };
}

/**
 * Marca uma ou todas as notificações como lidas
 */
function markAsRead(id = null) {
  const items = loadNotifications();
  let updated = false;

  if (id === 'ALL' || id === null) {
    items.forEach(n => { n.read = true; });
    updated = true;
  } else {
    const target = items.find(n => n.id === id);
    if (target) {
      target.read = true;
      updated = true;
    }
  }

  if (updated) {
    saveNotifications(items);
  }
  return updated;
}

/**
 * Exclui uma notificação ou limpa todas
 */
function deleteNotification(id = null) {
  let items = loadNotifications();
  const initialCount = items.length;

  if (id === 'ALL' || id === null) {
    items = [];
  } else {
    items = items.filter(n => n.id !== id);
  }

  if (items.length !== initialCount) {
    saveNotifications(items);
    return true;
  }
  return false;
}

// Criar notificação inicial de boot se o arquivo for limpo
ensureFileExists();

module.exports = {
  createNotification,
  getNotifications,
  markAsRead,
  deleteNotification
};
