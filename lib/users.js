const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const logger = require('./logger');
const store = require('./persistentStore');

function normalizeUsername(username) {
  return String(username || '').toLowerCase().trim().replace(/[^a-z0-9_]/g, '');
}

const usersFile = path.join(__dirname, '..', 'nova-data', 'users.json');

function loadUsers() {
  try {
    const persisted = store.get('users');
    if (Array.isArray(persisted)) return persisted;
    if (!fs.existsSync(usersFile)) {
      return [];
    }
    const data = fs.readFileSync(usersFile, 'utf8');
    const users = JSON.parse(data);
    return Array.isArray(users) ? users : [];
  } catch (error) {
    logger.error('Error loading users:', error);
    return [];
  }
}

function saveUsers(users) {
  try {
    store.set('users', users);
    const dataDir = path.join(__dirname, '..', 'nova-data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf8');
    return true;
  } catch (error) {
    logger.error('Error saving users:', error);
    return false;
  }
}

async function createUser(username, password) {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername || !password) {
    return { ok: false, error: 'Nome de usuário e senha são obrigatórios.' };
  }

  const users = loadUsers();

  if (users.find(u => u.username === normalizedUsername)) {
    return { ok: false, error: 'Usuário já existe.' };
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const newUser = {
    username: normalizedUsername,
    password: hashedPassword,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);

  if (saveUsers(users)) {
    logger.info(`User created: ${normalizedUsername}`);
    return { ok: true, user: { username: normalizedUsername, createdAt: newUser.createdAt } };
  }

  return { ok: false, error: 'Erro ao salvar usuário.' };
}

function deleteUser(username) {
  const normalizedUsername = normalizeUsername(username);
  const users = loadUsers();

  const index = users.findIndex(u => u.username === normalizedUsername);

  if (index === -1) {
    return { ok: false, error: 'Usuário não encontrado.' };
  }

  users.splice(index, 1);

  if (saveUsers(users)) {
    logger.info(`User deleted: ${normalizedUsername}`);
    return { ok: true, username: normalizedUsername };
  }

  return { ok: false, error: 'Erro ao remover usuário.' };
}

function listUsers() {
  const users = loadUsers();
  return users.map(u => ({
    username: u.username,
    createdAt: u.createdAt
  }));
}

function getUser(username) {
  const normalizedUsername = normalizeUsername(username);
  const users = loadUsers();
  return users.find(u => u.username === normalizedUsername);
}

module.exports = {
  createUser,
  deleteUser,
  listUsers,
  getUser,
  loadUsers
};
