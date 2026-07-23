const fs = require('fs');
const path = require('path');

const MEMORY_DIR = path.join(__dirname, '..', 'nova-data', 'memory');

function ensureDir() {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

function filePath(userId) {
  return path.join(MEMORY_DIR, `${String(userId).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

function loadMemory(userId) {
  try {
    ensureDir();
    const data = fs.readFileSync(filePath(userId), 'utf8');
    return JSON.parse(data);
  } catch {
    return {
      permanent: [],
      knowledge: [],
      pinned: []
    };
  }
}

function saveMemory(userId, memory) {
  try {
    ensureDir();
    fs.writeFileSync(filePath(userId), JSON.stringify(memory, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function addPermanentMemory(userId, text, category = 'general') {
  const memory = loadMemory(userId);
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    text: String(text).trim(),
    category: String(category).trim() || 'general',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  memory.permanent = memory.permanent || [];
  memory.permanent.push(entry);
  saveMemory(userId, memory);
  return entry;
}

function removePermanentMemory(userId, memoryId) {
  const memory = loadMemory(userId);
  memory.permanent = (memory.permanent || []).filter(m => m.id !== memoryId);
  saveMemory(userId, memory);
}

function searchPermanentMemory(userId, query) {
  const memory = loadMemory(userId);
  const q = String(query).trim().toLowerCase();
  if (!q) return memory.permanent || [];
  return (memory.permanent || []).filter(m => (m.text || '').toLowerCase().includes(q));
}

function getAllPermanentMemory(userId) {
  return loadMemory(userId).permanent || [];
}

function addKnowledge(userId, title, content, type = 'note') {
  const memory = loadMemory(userId);
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    title: String(title).trim(),
    content: String(content),
    type: String(type).trim() || 'note',
    createdAt: new Date().toISOString()
  };
  memory.knowledge = memory.knowledge || [];
  memory.knowledge.push(entry);
  saveMemory(userId, memory);
  return entry;
}

function removeKnowledge(userId, knowledgeId) {
  const memory = loadMemory(userId);
  memory.knowledge = (memory.knowledge || []).filter(k => k.id !== knowledgeId);
  saveMemory(userId, memory);
}

function searchKnowledge(userId, query) {
  const memory = loadMemory(userId);
  const q = String(query).trim().toLowerCase();
  if (!q) return memory.knowledge || [];
  return (memory.knowledge || []).filter(k => 
    (k.title || '').toLowerCase().includes(q) || 
    (k.content || '').toLowerCase().includes(q)
  );
}

function getAllKnowledge(userId) {
  return loadMemory(userId).knowledge || [];
}

function togglePinMemory(userId, memoryId) {
  const memory = loadMemory(userId);
  const all = [...(memory.permanent || []), ...(memory.knowledge || [])];
  const item = all.find(m => m.id === memoryId);
  if (!item) return false;
  
  const pinned = memory.pinned || [];
  const idx = pinned.findIndex(p => p.id === memoryId);
  if (idx >= 0) {
    pinned.splice(idx, 1);
  } else {
    pinned.push({ id: item.id, text: item.text || item.title, type: item.category || item.type });
  }
  memory.pinned = pinned;
  saveMemory(userId, memory);
  return true;
}

function getPinnedMemory(userId) {
  return loadMemory(userId).pinned || [];
}

function getMemoryContext(userId, query = '') {
  const memory = loadMemory(userId);
  const pinned = memory.pinned || [];
  const allMemories = [...(memory.permanent || []), ...(memory.knowledge || [])];
  
  let context = [];
  
  if (pinned.length > 0) {
    context.push('[MEMÓRIAS FIXADAS]');
    pinned.forEach(p => context.push(`- ${p.text || p.title}`));
  }
  
  let relevant = allMemories;
  if (query) {
    const q = query.toLowerCase();
    relevant = allMemories.filter(m => 
      (m.text || '').toLowerCase().includes(q) || 
      (m.title || '').toLowerCase().includes(q)
    );
  }
  
  if (relevant.length > 0) {
    context.push('[MEMÓRIAS RELEVANTES]');
    relevant.slice(0, 10).forEach(m => {
      context.push(`- ${m.text || m.title}`);
    });
  }
  
  return context.join('\n');
}

function deleteUserMemory(userId) {
  try {
    fs.unlinkSync(filePath(userId));
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  addPermanentMemory,
  removePermanentMemory,
  searchPermanentMemory,
  getAllPermanentMemory,
  addKnowledge,
  removeKnowledge,
  searchKnowledge,
  getAllKnowledge,
  togglePinMemory,
  getPinnedMemory,
  getMemoryContext,
  deleteUserMemory
};
