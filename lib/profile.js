const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { containsSensitiveText } = require('./utils');

const dataDir = path.join(__dirname, '..', 'nova-data');
const backupDir = path.join(dataDir, 'backups');
const profileFile = path.join(dataDir, 'profile.json');

function ensureDataDir() {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
}

function backupProfile() {
  if (!fs.existsSync(profileFile)) return null;

  ensureDataDir();
  const safeStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `profile-${safeStamp}.json`);
  fs.copyFileSync(profileFile, backupPath);
  logger.info(`Profile backed up to ${backupPath}`);
  return backupPath;
}

function readDevProfile() {
  try {
    if (!fs.existsSync(profileFile)) {
      return { ok: true, profile: null };
    }

    const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
    return { ok: true, profile: normalizeProfile(profile) };
  } catch (error) {
    logger.error('Error reading dev profile:', error);
    return { ok: false, profile: null };
  }
}

function normalizeProfile(profile) {
  const allowedPersonalities = new Set(['equilibrada', 'direta', 'amiga', 'tecnica', 'jarvis']);
  const personality = allowedPersonalities.has(profile?.personality)
    ? profile.personality
    : 'jarvis';
  const memory = String(profile?.memory || '').slice(0, 2000).trim();
  const updatedAt = new Date().toISOString();

  return {
    name: 'Sofia',
    personality,
    memory,
    updatedAt
  };
}

async function handleApplyProfile(body) {
  const profile = normalizeProfile(body.profile);

  if (!body.confirmed) {
    throw new Error('A alteracao precisa de confirmacao antes de gravar.');
  }

  if (containsSensitiveText(JSON.stringify(profile))) {
    throw new Error('A alteracao foi bloqueada porque parece conter chave, token ou segredo.');
  }

  ensureDataDir();
  const backupPath = backupProfile();
  fs.writeFileSync(profileFile, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  logger.info('Profile updated successfully');

  return {
    ok: true,
    file: 'nova-data/profile.json',
    backup: backupPath ? path.relative(path.join(__dirname, '..'), backupPath) : null,
    profile
  };
}

function rotateBackups(maxBackups = 10) {
  try {
    if (!fs.existsSync(backupDir)) return;

    const files = fs.readdirSync(backupDir)
      .filter((file) => file.startsWith('profile-') && file.endsWith('.json'))
      .map((file) => ({
        name: file,
        path: path.join(backupDir, file),
        time: fs.statSync(path.join(backupDir, file)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    if (files.length > maxBackups) {
      const toDelete = files.slice(maxBackups);
      for (const file of toDelete) {
        fs.unlinkSync(file.path);
        logger.info(`Deleted old backup: ${file.name}`);
      }
    }
  } catch (error) {
    logger.error('Error rotating backups:', error);
  }
}

module.exports = {
  readDevProfile,
  handleApplyProfile,
  normalizeProfile,
  rotateBackups
};
