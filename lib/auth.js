const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const logger = require('./logger');
const { getUser, listUsers, normalizeUsername, sanitizeUser } = require('./users');

const authCookieName = 'alya_session';
const guestCookieName = 'alya_guest';
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
const GUEST_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const INVALID_LOGIN_MESSAGE = 'Usuário ou senha inválidos';
const DUMMY_PASSWORD_HASH = '$2b$12$H6m2D5vmZH7hpma4R/wl2.6xZkFmmR1jkzNtpGMWPmyC/MLbpY4za';
const ephemeralGuestSecret = crypto.randomBytes(48).toString('hex');

function isGuestMode() {
  return String(process.env.AUTH_REQUIRED || 'false').toLowerCase() !== 'true';
}

function getSessionSecret() {
  const secret = String(process.env.SESSION_SECRET || '');
  return secret.length >= 32 ? secret : '';
}

function isAuthConfigured() {
  if (isGuestMode()) return true;
  return Boolean(getSessionSecret() && listUsers().length);
}

function guestSecret() {
  return getSessionSecret() || ephemeralGuestSecret;
}

function createGuestToken(guestId = crypto.randomBytes(18).toString('hex')) {
  const id = String(guestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (!id) throw new Error('Identidade de visitante inválida.');
  const payload = Buffer.from(JSON.stringify({
    g: id,
    exp: Date.now() + (GUEST_MAX_AGE_SECONDS * 1000)
  })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', guestSecret())
    .update(`alya-guest-v1:${payload}`)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function parseGuestToken(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  try {
    const expected = crypto
      .createHmac('sha256', guestSecret())
      .update(`alya-guest-v1:${payload}`)
      .digest('base64url');
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    ) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const id = String(parsed.g || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    if (!id || Number(parsed.exp) <= Date.now()) return null;
    return {
      username: `visitante_${id.slice(0, 16).toLowerCase()}`,
      role: 'user',
      blocked: false,
      guest: true,
      createdAt: null
    };
  } catch {
    return null;
  }
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
  if (req?._guestUser) return req._guestUser;
  if (isGuestMode()) return parseGuestToken(getCookie(req, guestCookieName));
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

function ensureGuestSession(req, res) {
  if (req?._guestUser) return req._guestUser;
  const existing = parseGuestToken(getCookie(req, guestCookieName));
  if (existing) {
    req._guestUser = existing;
    return existing;
  }
  const token = createGuestToken();
  const guest = parseGuestToken(token);
  req._guestUser = guest;
  const options = [
    `${guestCookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${GUEST_MAX_AGE_SECONDS}`
  ];
  if (isSecureRequest(req)) options.push('Secure');
  res.setHeader('Set-Cookie', options.join('; '));
  return guest;
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

function clearGuestCookie(req, res) {
  const options = [
    `${guestCookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
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
  guestCookieName,
  INVALID_LOGIN_MESSAGE,
  isGuestMode,
  createGuestToken,
  parseGuestToken,
  ensureGuestSession,
  createAuthToken,
  validateAuthToken,
  parseAuthToken,
  getAuthenticatedUser,
  getAuthenticatedUsername,
  setAuthCookie,
  clearAuthCookie,
  clearGuestCookie,
  getCookie,
  hasSitePassword,
  isAuthConfigured,
  isAuthenticated,
  verifyPassword,
  validateLogin
};
