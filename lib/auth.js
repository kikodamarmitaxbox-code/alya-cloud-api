const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const logger = require('./logger');
const { getUser, listUsers, normalizeUsername, sanitizeUser } = require('./users');

const authCookieName = 'alya_session';
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
const INVALID_LOGIN_MESSAGE = 'Usuário ou senha inválidos';
const DUMMY_PASSWORD_HASH = '$2b$12$H6m2D5vmZH7hpma4R/wl2.6xZkFmmR1jkzNtpGMWPmyC/MLbpY4za';

function getSessionSecret() {
  const secret = String(process.env.SESSION_SECRET || '');
  return secret.length >= 32 ? secret : '';
}

function isAuthConfigured() {
  return Boolean(getSessionSecret() && listUsers().length);
}

function createAuthToken(user) {
  const account = typeof user === 'string' ? getUser(user) : user;
  if (!account) throw new Error('Conta de acesso não encontrada.');
  const secret = getSessionSecret();
  if (!secret) throw new Error('SESSION_SECRET não configurado.');
  const payload = Buffer.from(JSON.stringify({
    u: normalizeUsername(account.username),
    r: account.role === 'admin' ? 'admin' : 'user',
    v: Math.max(1, Number(account.sessionVersion) || 1),
    exp: Date.now() + (SESSION_MAX_AGE_SECONDS * 1000)
  })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`alya-session-v2:${payload}`)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function parseAuthToken(token) {
  const [payload, signature] = String(token || '').split('.');
  const secret = getSessionSecret();
  if (!payload || !signature || !secret) return null;
  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`alya-session-v2:${payload}`)
      .digest('base64url');
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (providedBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const username = normalizeUsername(parsed.u);
    if (!username || Number(parsed.exp) <= Date.now()) return null;
    const user = getUser(username);
    if (!user || user.blocked ||
        Math.max(1, Number(user.sessionVersion) || 1) !== Math.max(1, Number(parsed.v) || 1)) return null;
    return sanitizeUser(user);
  } catch {
    return null;
  }
}

function validateAuthToken(token) {
  return Boolean(parseAuthToken(token));
}

function getAuthenticatedUser(req) {
  return parseAuthToken(getCookie(req, authCookieName));
}

function getAuthenticatedUsername(req) {
  return getAuthenticatedUser(req)?.username || '';
}

function isSecureRequest(req) {
  return process.env.NODE_ENV === 'production' ||
    String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function setAuthCookie(req, res, user) {
  const token = createAuthToken(user);
  const options = [
    `${authCookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`
  ];
  if (isSecureRequest(req)) options.push('Secure');
  res.setHeader('Set-Cookie', options.join('; '));
}

function clearAuthCookie(req, res) {
  const options = [
    `${authCookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ];
  if (isSecureRequest(req)) options.push('Secure');
  res.setHeader('Set-Cookie', options.join('; '));
}

function getCookie(req, name) {
  const header = String(req?.headers?.cookie || '');
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    try {
      return decodeURIComponent(trimmed.slice(name.length + 1));
    } catch {
      return '';
    }
  }
  return '';
}

function hasSitePassword() {
  return true;
}

function isAuthenticated(req) {
  return Boolean(getAuthenticatedUser(req));
}

async function verifyPassword(password, hash) {
  try {
    if (!String(hash || '').startsWith('$2')) return false;
    return await bcrypt.compare(String(password || ''), hash);
  } catch {
    return false;
  }
}

async function validateLogin(username, password) {
  const normalizedUsername = normalizeUsername(username);
  const account = getUser(normalizedUsername);
  const hash = account?.password || DUMMY_PASSWORD_HASH;
  const validPassword = await verifyPassword(password, hash);
  if (!account || account.blocked || !validPassword || !getSessionSecret()) {
    logger.warn('Tentativa de login recusada.');
    return { success: false, error: INVALID_LOGIN_MESSAGE };
  }
  logger.info('Login concluído com segurança.');
  return { success: true, user: sanitizeUser(account) };
}

module.exports = {
  authCookieName,
  INVALID_LOGIN_MESSAGE,
  createAuthToken,
  validateAuthToken,
  parseAuthToken,
  getAuthenticatedUser,
  getAuthenticatedUsername,
  setAuthCookie,
  clearAuthCookie,
  getCookie,
  hasSitePassword,
  isAuthConfigured,
  isAuthenticated,
  verifyPassword,
  validateLogin
};
