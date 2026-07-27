const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const logger = require('./logger');
const { getUser, listUsers } = require('./users');

const authCookieName = 'alya_session';
const SALT_ROUNDS = 10;

function getAuthSecret() {
  return process.env.AUTH_SECRET || process.env.SITE_PASSWORD || process.env.FRIEND_USERS || 'alya-local';
}

function createAuthToken(username) {
  const safeUsername = normalizeUsername(username || 'visitante');
  const payload = Buffer.from(JSON.stringify({
    u: safeUsername,
    exp: Date.now() + (7 * 24 * 60 * 60 * 1000)
  })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getAuthSecret())
    .update(`alya-browser-access:${payload}`)
    .digest('base64url');

  return `${payload}.${signature}`;
}

function validateAuthToken(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return false;
  try {
    const expected = crypto
      .createHmac('sha256', getAuthSecret())
      .update(`alya-browser-access:${payload}`)
      .digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Boolean(normalizeUsername(parsed.u) && Number(parsed.exp) > Date.now());
  } catch {
    return false;
  }
}

function getAuthenticatedUsername(req) {
  const token = getCookie(req, authCookieName);
  if (!validateAuthToken(token)) return '';
  try {
    const payload = token.split('.')[0];
    return normalizeUsername(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).u);
  } catch {
    return '';
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
  return Boolean(
    String(process.env.SITE_PASSWORD || '').trim() ||
    readSiteUsers().length ||
    listUsers().length
  );
}

function isAuthenticated(req) {
  if (!hasSitePassword()) return true;
  return Boolean(getAuthenticatedUsername(req));
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

    if (user) {
      const isValid = await verifyPassword(password, user.password);
      if (isValid) {
        logger.info(`User logged in: ${normalizedUsername}`);
        return { success: true, user: normalizedUsername };
      }
    }
  }

  // Check users from users.json (new system)
  const dbUser = getUser(normalizedUsername);
  if (dbUser) {
    logger.info(`Found user in database: ${normalizedUsername}`);
    const isValid = await verifyPassword(password, dbUser.password);
    logger.info(`Password verification result for ${normalizedUsername}: ${isValid}`);
    if (isValid) {
      logger.info(`User logged in: ${normalizedUsername}`);
      return { success: true, user: normalizedUsername };
    }
  }

  // Check SITE_PASSWORD
  if (!process.env.SITE_PASSWORD || String(password || '') !== process.env.SITE_PASSWORD) {
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
  getAuthenticatedUsername,
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
