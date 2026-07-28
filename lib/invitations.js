'use strict';

const crypto = require('crypto');
const store = require('./persistentStore');
const { createUser, normalizeUsername } = require('./users');

const STORE_KEY = 'registrationInvites';
const DEFAULT_VALID_DAYS = 7;
let redemptionQueue = Promise.resolve();

function hashCode(code) {
  return crypto
    .createHash('sha256')
    .update(String(code || '').trim().toUpperCase())
    .digest('hex');
}

function loadInvitations() {
  const invitations = store.get(STORE_KEY, []);
  return Array.isArray(invitations)
    ? invitations.filter((invitation) => invitation && typeof invitation === 'object')
    : [];
}

function saveInvitations(invitations) {
  store.set(STORE_KEY, invitations);
}

function createInvitation(username, options = {}) {
  const normalizedUsername = normalizeUsername(username);
  if (normalizedUsername.length < 3) {
    return { ok: false, error: 'O usuário deve ter pelo menos 3 caracteres.' };
  }

  const validDays = Math.min(
    30,
    Math.max(1, Number(options.validDays || process.env.REGISTRATION_INVITE_DAYS) || DEFAULT_VALID_DAYS)
  );
  const code = `ALYA-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
  const now = Date.now();
  const invitations = loadInvitations()
    .filter((invitation) => !invitation.usedAt && Number(invitation.expiresAt) > now);

  invitations.push({
    id: crypto.randomUUID(),
    username: normalizedUsername,
    codeHash: hashCode(code),
    createdAt: new Date(now).toISOString(),
    expiresAt: now + (validDays * 24 * 60 * 60 * 1000),
    usedAt: null
  });
  saveInvitations(invitations);

  return {
    ok: true,
    code,
    username: normalizedUsername,
    expiresAt: new Date(now + (validDays * 24 * 60 * 60 * 1000)).toISOString()
  };
}

async function redeemInvitationUnsafe(code, username, password) {
  const normalizedUsername = normalizeUsername(username);
  const providedHash = hashCode(code);
  const now = Date.now();
  const invitations = loadInvitations();
  const invitation = invitations.find((candidate) => (
    !candidate.usedAt &&
    Number(candidate.expiresAt) > now &&
    candidate.username === normalizedUsername &&
    typeof candidate.codeHash === 'string' &&
    candidate.codeHash.length === providedHash.length &&
    crypto.timingSafeEqual(Buffer.from(candidate.codeHash), Buffer.from(providedHash))
  ));

  if (!invitation) {
    return { ok: false, error: 'Convite inválido ou expirado.' };
  }

  invitation.usedAt = new Date(now).toISOString();
  saveInvitations(invitations);
  const result = await createUser(normalizedUsername, password, { role: 'user' });

  if (!result.ok) {
    invitation.usedAt = null;
    saveInvitations(invitations);
    return result;
  }

  return { ok: true, user: result.user };
}

function redeemInvitation(code, username, password) {
  const operation = redemptionQueue.then(() => redeemInvitationUnsafe(code, username, password));
  redemptionQueue = operation.catch(() => {});
  return operation;
}

module.exports = {
  createInvitation,
  redeemInvitation
};
