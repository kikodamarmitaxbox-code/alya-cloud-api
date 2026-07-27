const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const MEMORY_DIR = path.join(__dirname, '..', 'nova-data', 'memory');

function ensureDir() {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

function filePath(userId) {
  return path.join(MEMORY_DIR, `${String(userId).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

function loadMemory(userId) {
  try {
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
  const cleanText = String(text).trim();
  if (!cleanText) return null;

  const validCategories = ['identity', 'preferences', 'projects', 'facts', 'knowledge'];
  const cat = validCategories.includes(category) ? category : 'facts';

  // Evitar duplicatas exatas
  const list = memory[cat] || [];
  const exists = list.some(item => (item.text || '').toLowerCase() === cleanText.toLowerCase());
  if (exists) return null;

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    text: cleanText,
    category: cat,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  memory[cat].push(entry);
  saveMemory(userId, memory);
  logger.info(`Memória inteligente salva [${cat}]: "${cleanText}" para o usuário ${userId}`);

  try {
    const notifications = require('./notifications');
    notifications.createNotification({
      title: 'Atualização de Memória',
      message: `Alya registrou automaticamente: "${cleanText}"`,
      category: 'Memória',
      priority: 'Baixa',
      details: `Categoria: ${cat}`
    });
  } catch {}

  return entry;
}

/**
 * Atualiza uma memória existente por ID
 */
function updateMemoryItem(userId, memoryId, newText, newCategory) {
  const memory = loadMemory(userId);
  let found = false;

  const categories = ['identity', 'preferences', 'projects', 'facts', 'knowledge'];
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
function extractSmartMemories(userId, text) {
  const q = String(text || '').trim();
  if (q.length < 5) return;

  const lower = q.toLowerCase();

  // Filtros de exclusão: ignorar cumprimentos, dúvidas banais e comandos comuns
  const banList = [
    'oi', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'tudo bem',
    'como funciona', 'ajuda com', 'o que é', 'quem é', 'pesquise',
    'como faz', 'codigo para', 'explicar', 'resumo de', 'conte uma'
  ];
  if (banList.some(b => lower === b || lower.startsWith(b + ' '))) {
    return;
  }

  // 1. Apelidos e Formas de Tratamento (identity)
  const identityMatch = q.match(/(?:me chame de|meu apelido e|meu apelido é|pode me chamar de|sou o|sou a)\s+([A-Za-z0-9_ -]{2,30})/i);
  if (identityMatch && identityMatch[1]) {
    const name = identityMatch[1].trim();
    addMemoryItem(userId, `Prefere ser chamado(a) de ${name}`, 'identity');
    return;
  }

  // 2. Preferências do Usuário (preferences)
  const prefMatch = q.match(/(?:eu gosto de|eu prefiro|minha preferencia e|minha preferência é|odeio|nao gosto de|não gosto de)\s+([^.!?]{3,60})/i);
  if (prefMatch && prefMatch[0]) {
    addMemoryItem(userId, prefMatch[0].trim(), 'preferences');
    return;
  }

  // 3. Projetos em Andamento (projects)
  const projectMatch = q.match(/(?:estou trabalhando no projeto|estou criando o|estou desenvolvendo o|meu projeto e|meu projeto é)\s+([^.!?]{3,80})/i);
  if (projectMatch && projectMatch[0]) {
    addMemoryItem(userId, projectMatch[0].trim(), 'projects');
    return;
  }
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

module.exports = {
  loadMemory,
  saveMemory,
  addMemoryItem,
  updateMemoryItem,
  removeMemoryItem,
  extractSmartMemories,
  getMemoryContext,
  getAllMemories
};
