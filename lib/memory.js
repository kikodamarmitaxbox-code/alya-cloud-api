const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const store = require('./persistentStore');

const MEMORY_DIR = path.join(__dirname, '..', 'nova-data', 'memory');
const MEMORY_CATEGORIES = ['identity', 'preferences', 'projects', 'facts', 'knowledge'];

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
function addMemoryItem(userId, text, category = 'facts') {
  const memory = loadMemory(userId);
  const cleanText = String(text).replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!cleanText || containsSensitiveMemory(cleanText)) return null;

  const cat = MEMORY_CATEGORIES.includes(category) ? category : 'facts';

  // Evitar duplicatas exatas
  const list = memory[cat] || [];
  const existing = list.find(item => (item.text || '').toLowerCase() === cleanText.toLowerCase());
  if (existing) return existing;

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    text: cleanText,
    category: cat,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  memory[cat].push(entry);
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

  const categories = MEMORY_CATEGORIES;
  for (const cat of categories) {
    const list = memory[cat] || [];
    const item = list.find(m => m.id === memoryId);
    if (item) {
      if (newText) item.text = String(newText).trim();
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
    const saved = addMemoryItem(userId, pending.text, pending.category);
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
    const saved = addMemoryItem(userId, candidate.text, candidate.category);
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
    const qLower = String(query).toLowerCase();
    const queryTokens = qLower.split(/\s+/).filter(t => t.length > 3);

    // Calcular pontuação de relevância
    const scored = allOther.map(item => {
      const itemText = (item.text || item.title || '').toLowerCase();
      let score = 0;

      for (const token of queryTokens) {
        if (itemText.includes(token)) {
          score += 2;
        }
      }

      return { item, score };
    });

    // Filtrar apenas com relevância > 0 se houver busca, ou pegar as 5 mais recentes
    let relevant = [];
    if (queryTokens.length > 0) {
      relevant = scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(s => s.item);
    }

    if (relevant.length > 0) {
      contextLines.push('[MEMÓRIAS RELEVANTES PARA ESTA PERGUNTA]:');
      relevant.slice(0, 3).forEach(m => contextLines.push(`- ${compact(m)}`));
    }
  }

  return contextLines.join('\n').slice(0, 1400);
}

function getAllMemories(userId) {
  return loadMemory(userId);
}

function addPermanentMemory(userId, text, category = 'facts') {
  return addMemoryItem(userId, text, category);
}

function getAllPermanentMemory(userId) {
  const memory = loadMemory(userId);
  return [...memory.identity, ...memory.preferences, ...memory.projects, ...memory.facts];
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
  const entry = addMemoryItem(userId, text, 'knowledge');
  if (entry) entry.type = String(type || 'note').slice(0, 40);
  return entry;
}

function getAllKnowledge(userId) {
  return loadMemory(userId).knowledge;
}

function removeKnowledge(userId, memoryId) {
  return removeMemoryItem(userId, memoryId);
}

function getPinnedMemory(userId) {
  return loadMemory(userId).pinned;
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
  getMemoryContext,
  getAllMemories,
  addPermanentMemory,
  getAllPermanentMemory,
  searchPermanentMemory,
  removePermanentMemory,
  addKnowledge,
  getAllKnowledge,
  removeKnowledge,
  getPinnedMemory
};
