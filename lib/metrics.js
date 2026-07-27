const store = require('./persistentStore');

const startedAt = new Date().toISOString();
const defaults = {
  chatRequests: 0,
  chatSuccesses: 0,
  chatErrors: 0,
  fileUploads: 0,
  imageRequests: 0,
  loginSuccesses: 0,
  loginFailures: 0
};

function load() {
  return { ...defaults, ...(store.get('system:metrics', {}) || {}) };
}

function increment(name) {
  if (!(name in defaults)) return;
  const current = load();
  current[name] = Number(current[name] || 0) + 1;
  store.set('system:metrics', current);
}

function snapshot() {
  return { startedAt, ...load() };
}

module.exports = { increment, snapshot };
