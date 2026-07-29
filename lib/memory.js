const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const store = require('./persistentStore');

const MEMORY_DIR = path.join(__dirname, '..', 'nova-data', 'memory');
const MEMORY_CATEGORIES = ['identity', 'preferences', 'projects', 'facts', 'knowledge'];
const MEMORY_LIMIT_PER_CATEGORY = 100;

function safeUserId(userId) {
  return String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'anonymous';
}

function containsSensitiveMemory(text) {
  const value = String(text || '');
  return [
    /\b(?:senha|password|token|chave de api|api key|secret)\b\s*[:=]/i,
    /\bsk-(?:or-v1-)?[A-Za-z0-9_-]{16,}\b/i,
    /\b(?:nvapi|csk|gsk|cfat)-[A-Za-z0-9_-]{16,}\b/i,
    /\bAIza[A-Za-z0-9_-]{20,}\b/,
    /\b(?:cart[aã]o|cvv|cpf)\b\s*[:=]?\s*\d{3,}/i
  ].some((pattern) => pattern.test(value));
}

function memoryTokens(value) {
  return new Set(
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .match(/[a-z0-9_]{3,}/g) || []
  );
}

function memorySimilarity(first, second) {
  const a = memoryTokens(first);
  const b = memoryTokens(second);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / Math.max(a.size, b.size);
}

function memoryImportance(category, options = {}) {
  const base = {
    identity: 0.95,
    projects: 0.85,
    preferences: 0.78,
    knowledge: 0.72,
    facts: 0.65
  }[category] || 0.6;
  return Math.min(1, base + (options.explicit ? 0.05 : 0) + (options.confirmed ? 0.04 : 0));
}

function memoryExpiry(text) {
  const value = String(text || '');
  if (!/\b(hoje|amanhã|amanha|agora|por enquanto|esta conversa|essa conversa|temporariamente)\b/i.test(value)) {
    return null;
  }
  return new Date(Date.now() + (7 * 24 * 60 * 60 * 1000)).toISOString();
}

function isExpiredMemory(item, now = Date.now()) {
  if (!item?.expiresAt) return false;
  const expiresAt = Date.parse(item.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

function pruneExpired(memory) {
  let changed = false;
  for (const category of [...MEMORY_CATEGORIES, 'pinned']) {
    const before = memory[category] || [];
    const after = before.filter((item) => !isExpiredMemory(item));
    if (after.length !== before.length) changed = true;
    memory[category] = after;
  }
  return changed;
}

function ensureDir() {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

function filePath(userId) {
  return path.join(MEMORY_DIR, `${safeUserId(userId)}.json`);
}

function loadMemory(userId) {
  try {
    const normalizedUserId = safeUserId(userId);
    const persisted = store.get(`memory:${normalizedUserId}`);
    if (persisted) {
      return {
        identity: persisted.identity || [],
        preferences: persisted.preferences || [],
        projects: persisted.projects || [],
        facts: persisted.facts || [],
        knowledge: persisted.knowledge || [],
        pinned: persisted.pinned || []
      };
    }
    ensureDir();
    const data = fs.readFileSync(filePath(userId), 'utf8');
    const parsed = JSON.parse(data);
    return {
      identity: parsed.identity || [],       // Apelidos, nome, forma de tratamento
      preferences: parsed.preferences || [], // Gostos e preferências de estilo
      projects: parsed.projects || [],       // Projetos em andamento
      facts: parsed.facts || [],             // Fatos importantes
      knowledge: parsed.knowledge || [],     // Notas e conhecimentos salvos
      pinned: parsed.pinned || []            // Memórias fixadas
    };
  } catch {
    return {
      identity: [],
      preferences: [],
      projects: [],
      facts: [],
      knowledge: [],
      pinned: []
    };
  }
}

function saveMemory(userId, memory) {
  try {
    const normalizedUserId = safeUserId(userId);
    store.set(`memory:${normalizedUserId}`, memory);
    ensureDir();
    fs.writeFileSync(filePath(userId), JSON.stringify(memory, null, 2), 'utf8');
    return true;
  } catch (err) {
    logger.error('Erro ao salvar memória:', err);
    return false;
  }
}

/**
 * Adiciona uma memória categorizada
 */
function addMemoryItem(userId, text, category = 'facts', options = {}) {
  const memory = loadMemory(userId);
  const cleanText = String(text).replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!cleanText || containsSensitiveMemory(cleanText)) return null;

  const cat = MEMORY_CATEGORIES.includes(category) ? category : 'facts';

  // Atualiza uma lembrança equivalente em vez de acumular versões repetidas.
  const list = memory[cat] || [];
  const existing = list.find((item) => (
    (item.text || '').toLowerCase() === cleanText.toLowerCase() ||
    memorySimilarity(item.text, cleanText) >= 0.82
  ));
  if (existing) {
    existing.text = cleanText;
    existing.updatedAt = new Date().toISOString();
    existing.importance = Math.max(
      Number(existing.importance || 0),
      memoryImportance(cat, options)
    );
    existing.expiresAt = memoryExpiry(cleanText);
    saveMemory(userId, memory);
    return existing;
  }

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    text: cleanText,
    category: cat,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    importance: memoryImportance(cat, options),
    lastUsedAt: null,
    useCount: 0,
    expiresAt: memoryExpiry(cleanText),
    source: options.explicit ? 'explicit' : options.confirmed ? 'confirmed' : 'manual'
  };

  memory[cat].push(entry);
  if (memory[cat].length > MEMORY_LIMIT_PER_CATEGORY) {
    memory[cat] = memory[cat]
      .sort((a, b) => (
        Number(b.importance || 0) - Number(a.importance || 0) ||
        Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0)
      ))
      .slice(0, MEMORY_LIMIT_PER_CATEGORY);
  }
  saveMemory(userId, memory);
  logger.info('Memória permanente salva.', { userId: safeUserId(userId), category: cat, memoryId: entry.id });

  return entry;
}

/**
 * Atualiza uma memória existente por ID
 */
function updateMemoryItem(userId, memoryId, newText, newCategory) {
  const memory = loadMemory(userId);
  let found = false;
  const cleanText = newText ? String(newText).replace(/\s+/g, ' ').trim().slice(0, 500) : '';
  if (cleanText && containsSensitiveMemory(cleanText)) return false;

  const categories = MEMORY_CATEGORIES;
  for (const cat of categories) {
    const list = memory[cat] || [];
    const item = list.find(m => m.id === memoryId);
    if (item) {
      if (cleanText) {
        item.text = cleanText;
        item.expiresAt = memoryExpiry(cleanText);
      }
      item.updatedAt = new Date().toISOString();
      found = true;

      // Se a categoria mudou, mover o item
      if (newCategory && newCategory !== cat && categories.includes(newCategory)) {
        memory[cat] = list.filter(m => m.id !== memoryId);
        item.category = newCategory;
        memory[newCategory].push(item);
      }
      break;
    }
  }

  if (found) {
    saveMemory(userId, memory);
  }
  return found;
}

/**
 * Remove qualquer memória por ID
 */
function removeMemoryItem(userId, memoryId) {
  const memory = loadMemory(userId);
  const categories = ['identity', 'preferences', 'projects', 'facts', 'knowledge', 'pinned'];
  let removed = false;

  for (const cat of categories) {
    const initialLen = (memory[cat] || []).length;
    memory[cat] = (memory[cat] || []).filter(m => m.id !== memoryId);
    if ((memory[cat] || []).length < initialLen) {
      removed = true;
    }
  }

  if (removed) {
    saveMemory(userId, memory);
  }
  return removed;
}

/**
 * Extração Automática de Memórias Importantes sem Salvar Conversas Banais
 */
function detectMemoryCandidate(text) {
  const q = String(text || '').trim();
  if (q.length < 5 || containsSensitiveMemory(q)) return null;

  const lower = q.toLowerCase();

  // Filtros de exclusão: ignorar cumprimentos, dúvidas banais e comandos comuns
  const banList = [
    'oi', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'tudo bem',
    'como funciona', 'ajuda com', 'o que é', 'quem é', 'pesquise',
    'como faz', 'codigo para', 'explicar', 'resumo de', 'conte uma'
  ];
  if (banList.some(b => lower === b || lower.startsWith(b + ' '))) {
    return null;
  }

  const explicitMatch = q.match(/^(?:lembre(?:-se)?(?: de)? que|guarde que|anote que|memorize que)\s+(.{3,300})/i);
  if (explicitMatch) {
    return { text: explicitMatch[1].trim(), category: inferCategory(explicitMatch[1]), explicit: true };
  }

  const identityMatch = q.match(/(?:me chame de|meu apelido e|meu apelido é|pode me chamar de|sou o|sou a)\s+([A-Za-z0-9_ -]{2,30})/i);
  if (identityMatch && identityMatch[1]) {
    const name = identityMatch[1].trim();
    return { text: `Prefere ser chamado(a) de ${name}`, category: 'identity', explicit: false };
  }

  const prefMatch = q.match(/(?:eu gosto de|eu prefiro|minha preferencia e|minha preferência é|odeio|nao gosto de|não gosto de)\s+([^.!?]{3,60})/i);
  if (prefMatch && prefMatch[0]) {
    return { text: prefMatch[0].trim(), category: 'preferences', explicit: false };
  }

  const projectMatch = q.match(/(?:estou trabalhando no projeto|estou criando o|estou desenvolvendo o|meu projeto e|meu projeto é)\s+([^.!?]{3,80})/i);
  if (projectMatch && projectMatch[0]) {
    return { text: projectMatch[0].trim(), category: 'projects', explicit: false };
  }

  return null;
}

function inferCategory(text) {
  const value = String(text || '').toLowerCase();
  if (/(me chame|meu nome|apelido)/i.test(value)) return 'identity';
  if (/(gosto|prefiro|não gosto|nao gosto|odeio)/i.test(value)) return 'preferences';
  if (/(projeto|estou criando|estou desenvolvendo|objetivo)/i.test(value)) return 'projects';
  return 'facts';
}

function pendingKey(userId) {
  return `memory-pending:${safeUserId(userId)}`;
}

function isAffirmative(text) {
  return /^(sim|pode|pode salvar|pode guardar|confirma|confirmo|guarde|lembre disso)[.! ]*$/i.test(String(text || '').trim());
}

function isNegative(text) {
  return /^(não|nao|não salve|nao salve|cancela|cancelar|esquece)[.! ]*$/i.test(String(text || '').trim());
}

function processMemoryTurn(userId, text) {
  const key = pendingKey(userId);
  const pending = store.get(key);
  const explicitMemoryRequest = /^(?:lembre(?:-se)?(?: de)? que|guarde que|anote que|memorize que)\b/i.test(String(text || '').trim());

  if (explicitMemoryRequest && containsSensitiveMemory(text)) {
    return {
      saved: false,
      instruction: 'O pedido contém uma credencial ou dado sensível. Não salve e diga brevemente que senhas, tokens e chaves não devem ser guardados na memória.'
    };
  }

  if (pending && Date.now() - Number(pending.createdAt || 0) > 10 * 60 * 1000) {
    store.remove(key);
  } else if (pending && isAffirmative(text)) {
    const saved = addMemoryItem(userId, pending.text, pending.category, {
      confirmed: true,
      explicit: Boolean(pending.explicit)
    });
    store.remove(key);
    return {
      saved: Boolean(saved),
      instruction: saved
        ? 'O usuário confirmou a memória. Confirme de forma breve que ela foi guardada.'
        : 'A memória já existia ou não pôde ser salva. Não afirme que salvou se ela falhou.'
    };
  } else if (pending && isNegative(text)) {
    store.remove(key);
    return { saved: false, instruction: 'O usuário recusou a memória. Confirme brevemente que ela não foi guardada.' };
  }

  const candidate = detectMemoryCandidate(text);
  if (!candidate) return { saved: false, instruction: '' };

  if (candidate.explicit) {
    const saved = addMemoryItem(userId, candidate.text, candidate.category, {
      explicit: true,
      confirmed: true
    });
    return {
      saved: Boolean(saved),
      instruction: saved
        ? 'O usuário pediu explicitamente para lembrar. Confirme de forma breve que a informação foi guardada.'
        : 'Não foi possível guardar essa informação. Diga isso sem expor detalhes internos.'
    };
  }

  store.set(key, { ...candidate, createdAt: Date.now() });
  return {
    saved: false,
    pending: true,
    instruction: `Antes de guardar esta informação como memória permanente, pergunte de forma curta: "Quer que eu guarde isso para as próximas conversas?" Não diga que já salvou.`
  };
}

function extractSmartMemories(userId, text) {
  return processMemoryTurn(userId, text);
}

/**
 * Recuperação de Memória Relevante por Pontuação (Relevant Retrieval)
 */
function getMemoryContext(userId, query = '') {
  const memory = loadMemory(userId);
  if (pruneExpired(memory)) saveMemory(userId, memory);
  const contextLines = [];
  const compact = (item) => String(item.text || item.title || '').replace(/\s+/g, ' ').trim().slice(0, 180);

  // 1. Identidade e Apelidos SEMPRE são incluídos (para a Alya saber como tratar o usuário)
  if (memory.identity.length > 0) {
    contextLines.push('[IDENTIDADE E FORMA DE TRATAMENTO DO USUÁRIO]:');
    memory.identity.slice(-3).forEach(m => contextLines.push(`- ${compact(m)}`));
  }

  // 2. Memórias Fixadas SEMPRE são incluídas
  if (memory.pinned.length > 0) {
    contextLines.push('[MEMÓRIAS FIXADAS]:');
    memory.pinned.slice(-4).forEach(p => contextLines.push(`- ${compact(p)}`));
  }

  // 3. Outras memórias (preferences, projects, facts, knowledge) filtradas por relevância com a pergunta
  const allOther = [
    ...memory.preferences,
    ...memory.projects,
    ...memory.facts,
    ...memory.knowledge
  ];

  if (allOther.length > 0) {
    const queryTokens = [...memoryTokens(query)];

    // Relevância combina assunto, importância, uso anterior, categoria e atualização.
    const scored = allOther.map(item => {
      const itemText = (item.text || item.title || '').toLowerCase();
      let score = Number(item.importance || memoryImportance(item.category)) * 4;

      for (const token of queryTokens) {
        if (itemText.includes(token)) {
          score += 3;
        }
      }

      if (item.category === 'projects' && /\b(projeto|código|codigo|alya)\b/i.test(query)) score += 2;
      if (item.category === 'preferences' && Number(item.importance || 0) >= 0.85) score += 1.5;
      score += Math.min(1.5, Number(item.useCount || 0) * 0.15);
      const updatedAt = Date.parse(item.updatedAt || item.createdAt || 0);
      if (Number.isFinite(updatedAt)) {
        const ageDays = Math.max(0, (Date.now() - updatedAt) / (24 * 60 * 60 * 1000));
        score += Math.max(0, 1.5 - (ageDays / 180));
      }
      return { item, score };
    });

    const hasTokenMatch = (item) => queryTokens.some((token) => (
      String(item.text || item.title || '').toLowerCase().includes(token)
    ));
    const relevant = scored
      .filter(({ item }) => (
        hasTokenMatch(item) ||
        Number(item.importance || 0) >= 0.88 ||
        (item.category === 'projects' && /\b(projeto|código|codigo|alya)\b/i.test(query))
      ))
      .sort((a, b) => b.score - a.score)
      .map(s => s.item);

    if (relevant.length > 0) {
      contextLines.push('[MEMÓRIAS RELEVANTES PARA ESTA PERGUNTA]:');
      const used = relevant.slice(0, 4);
      used.forEach((item) => {
        contextLines.push(`- ${compact(item)}`);
        item.lastUsedAt = new Date().toISOString();
        item.useCount = Number(item.useCount || 0) + 1;
      });
      saveMemory(userId, memory);
    }
  }

  return contextLines.join('\n').slice(0, 1400);
}

function getAllMemories(userId) {
  const data = loadMemory(userId);
  if (pruneExpired(data)) saveMemory(userId, data);
  return data;
}

function addPermanentMemory(userId, text, category = 'facts') {
  return addMemoryItem(userId, text, category, { explicit: true, confirmed: true });
}

function getAllPermanentMemory(userId) {
  const data = getAllMemories(userId);
  return [...data.identity, ...data.preferences, ...data.projects, ...data.facts];
}

function searchPermanentMemory(userId, query) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter((token) => token.length > 2);
  return getAllPermanentMemory(userId).filter((item) => {
    const value = String(item.text || '').toLowerCase();
    return tokens.length === 0 || tokens.some((token) => value.includes(token));
  });
}

function removePermanentMemory(userId, memoryId) {
  return removeMemoryItem(userId, memoryId);
}

function addKnowledge(userId, title, content, type = 'note') {
  const text = `${String(title).trim()}: ${String(content).trim()}`.slice(0, 500);
  const entry = addMemoryItem(userId, text, 'knowledge', { explicit: true, confirmed: true });
  if (entry) {
    entry.type = String(type || 'note').slice(0, 40);
    const data = loadMemory(userId);
    const stored = data.knowledge.find((item) => item.id === entry.id);
    if (stored) stored.type = entry.type;
    saveMemory(userId, data);
  }
  return entry;
}

function getAllKnowledge(userId) {
  return getAllMemories(userId).knowledge;
}

function removeKnowledge(userId, memoryId) {
  return removeMemoryItem(userId, memoryId);
}

function getPinnedMemory(userId) {
  return getAllMemories(userId).pinned;
}

function deleteAllUserMemory(userId) {
  const normalizedUserId = safeUserId(userId);
  store.remove(`memory:${normalizedUserId}`);
  const target = filePath(normalizedUserId);
  if (fs.existsSync(target)) fs.unlinkSync(target);
  return true;
}

module.exports = {
  loadMemory,
  saveMemory,
  addMemoryItem,
  updateMemoryItem,
  removeMemoryItem,
  extractSmartMemories,
  detectMemoryCandidate,
  processMemoryTurn,
  containsSensitiveMemory,
  memorySimilarity,
  isExpiredMemory,
  getMemoryContext,
  getAllMemories,
  addPermanentMemory,
  getAllPermanentMemory,
  searchPermanentMemory,
  removePermanentMemory,
  addKnowledge,
  getAllKnowledge,
  removeKnowledge,
  getPinnedMemory,
  deleteAllUserMemory
};
