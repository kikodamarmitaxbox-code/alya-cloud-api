const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const logger = require('./logger');
const { getUser } = require('./users');

const authCookieName = 'alya_session';
const SALT_ROUNDS = 10;

function getAuthSecret() {
  return process.env.SITE_PASSWORD || process.env.FRIEND_USERS || 'alya-local';
}

function createAuthToken(username) {
  const safeUsername = normalizeUsername(username || 'visitante');
  const signature = crypto
    .createHmac('sha256', getAuthSecret())
    .update(`alya-browser-access:${safeUsername}`)
    .digest('hex');

  return `${safeUsername}.${signature}`;
}

function validateAuthToken(token) {
  const [username, signature] = String(token || '').split('.');
  if (!username || !signature) return false;

  const expected = createAuthToken(username);
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

function setAuthCookie(res, username) {
  const token = createAuthToken(username);
  const isSecure = process.env.NODE_ENV === 'production';
  const cookieOptions = [
    `${authCookieName}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=604800'
  ];
  
  if (isSecure) {
    cookieOptions.push('Secure');
  }
  
  res.setHeader('Set-Cookie', cookieOptions.join('; '));
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${authCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = cookieHeader.split(';').map((part) => part.trim());
  const cookie = cookies.find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : '';
}

function normalizeUsername(username) {
  return String(username || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32);
}

function hasSitePassword() {
  return false;
}

function isAuthenticated(req) {
  return true;
}

function readSiteUsers() {
  const rawUsers = String(process.env.FRIEND_USERS || '').trim();
  if (!rawUsers) return [];

  return rawUsers
    .split(',')
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator === -1) return null;

      const username = normalizeUsername(entry.slice(0, separator));
      const password = entry.slice(separator + 1).trim();
      if (!username || !password) return null;
      return { username, password };
    })
    .filter(Boolean);
}

async function hashPassword(password) {
  try {
    return await bcrypt.hash(password, SALT_ROUNDS);
  } catch (error) {
    logger.error('Error hashing password:', error);
    throw error;
  }
}

async function verifyPassword(password, hash) {
  try {
    if (!hash || typeof hash !== 'string') return false;
    if (!hash.startsWith('$2a$') && !hash.startsWith('$2b$') && !hash.startsWith('$2y$')) {
      return password === hash;
    }
    return await bcrypt.compare(password, hash);
  } catch (error) {
    logger.error('Error verifying password:', error);
    return false;
  }
}

async function validateLogin(username, password) {
  const users = readSiteUsers();
  const normalizedUsername = normalizeUsername(username);

  // Check users from .env (FRIEND_USERS)
  if (users.length > 0) {
    const user = users.find((item) => item.username === normalizedUsername);
    
    if (!user) {
      logger.warn(`Login attempt with invalid username: ${normalizedUsername}`);
      return { success: false, error: 'Usuario ou senha incorretos.' };
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      logger.warn(`Login attempt with invalid password for user: ${normalizedUsername}`);
      return { success: false, error: 'Usuario ou senha incorretos.' };
    }

    logger.info(`User logged in: ${normalizedUsername}`);
    return { success: true, user: normalizedUsername };
  }

  // Check users from users.json (new system)
  const dbUser = getUser(normalizedUsername);
  if (dbUser) {
    logger.info(`Found user in database: ${normalizedUsername}`);
    const isValid = await verifyPassword(password, dbUser.password);
    logger.info(`Password verification result for ${normalizedUsername}: ${isValid}`);
    if (!isValid) {
      logger.warn(`Login attempt with invalid password for user: ${normalizedUsername}`);
      return { success: false, error: 'Usuario ou senha incorretos.' };
    }

    logger.info(`User logged in: ${normalizedUsername}`);
    return { success: true, user: normalizedUsername };
  }

  // Check SITE_PASSWORD
  if (String(password || '') !== process.env.SITE_PASSWORD) {
    logger.warn('Login attempt with invalid site password');
    return { success: false, error: 'Senha incorreta.' };
  }

  logger.info('User logged in with site password');
  return { success: true, user: 'visitante' };
}

module.exports = {
  authCookieName,
  createAuthToken,
  validateAuthToken,
  setAuthCookie,
  clearAuthCookie,
  getCookie,
  normalizeUsername,
  hasSitePassword,
  isAuthenticated,
  readSiteUsers,
  hashPassword,
  verifyPassword,
  validateLogin
};
