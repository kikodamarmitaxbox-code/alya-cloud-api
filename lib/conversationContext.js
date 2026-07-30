const store = require('./persistentStore');
const logger = require('./logger');

const DEFAULT_RECENT_MESSAGES = 6;
const DEFAULT_MAX_CONTEXT_CHARS = 8000;
const STOP_WORDS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos',
  'e', 'ela', 'ele', 'em', 'eu', 'isso', 'me', 'meu', 'minha', 'na', 'nas',
  'no', 'nos', 'o', 'os', 'para', 'por', 'que', 'se', 'sem', 'um', 'uma',
  'voce', 'você'
]);

function safeId(value, fallback = 'default') {
  const clean = String(value || fallback)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 100);
  return clean || fallback;
}

function cleanContent(value, maxChars = 4000) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

function normalizeMessages(messages, maxMessages = 100) {
  const normalized = [];
  const source = Array.isArray(messages) ? messages.slice(-maxMessages) : [];

  for (const message of source) {
    if (!message || !['user', 'assistant'].includes(message.role)) continue;
    const content = cleanContent(message.content);
    if (!content) continue;

    const previous = normalized[normalized.length - 1];
    if (previous && previous.role === message.role && previous.content === content) {
      continue;
    }
    normalized.push({ role: message.role, content });
  }

  return normalized;
}

function tokenize(value) {
  return cleanContent(value, 6000)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9_+#.-]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function classifyIntent(value) {
  const text = cleanContent(value, 5000).toLowerCase();
  if (!text) return 'conversation';

  const rules = [
    ['debugging', /\b(erro|bug|falha|não funciona|nao funciona|corrig|consert|exception|stack trace|traceback|crash)\b/i],
    ['code', /\b(código|codigo|program|função|funcao|classe|api|backend|frontend|javascript|typescript|python|node|sql|git|terminal|arquivo .+\.(js|ts|py|json|html|css))\b/i],
    ['summary', /\b(resum|síntese|sintese|principais pontos|em poucas palavras)\b/i],
    ['planning', /\b(plano|planej|roteiro|cronograma|etapas|organizar|rotina)\b/i],
    ['decision', /\b(compare|comparar|comparação|comparacao|qual (é|e) melhor|recomenda|escolher|decidir|vale a pena)\b/i],
    ['writing', /\b(escrev|reescrev|texto|mensagem|carta|currículo|curriculo|redação|redacao|e-mail|email)\b/i],
    ['explanation', /\b(explique|explica|como funciona|o que (é|e)|por que|porque|ensine|aprender)\b/i]
  ];

  return rules.find(([, pattern]) => pattern.test(text))?.[0] || 'conversation';
}

function estimateComplexity(value, intent) {
  const text = cleanContent(value, 8000);
  const longRequest = text.length > 900;
  const multiPart = (text.match(/(?:^|\s)(?:\d+[.)]|[-*])\s/g) || []).length >= 3;
  const hardIntent = ['debugging', 'code', 'planning', 'decision'].includes(intent);
  return longRequest || multiPart || (hardIntent && text.length > 420) ? 'complex' : 'standard';
}

function scoreMessage(message, queryTokens, index, total) {
  const tokens = new Set(tokenize(message.content));
  let score = 0;
  for (const token of queryTokens) {
    if (tokens.has(token)) score += 3;
    else if ([...tokens].some((candidate) => candidate.includes(token) || token.includes(candidate))) score += 1;
  }
  score += Math.max(0, 2 - Math.floor((total - index) / 8));
  return score;
}

function summarizeOlderMessages(messages, currentQuery, maxChars = 2400) {
  if (!messages.length) return '';
  const queryTokens = tokenize(currentQuery);
  const scored = messages.map((message, index) => ({
    message,
    index,
    score: scoreMessage(message, queryTokens, index, messages.length)
  }));

  const selectedIndexes = new Set(
    scored
      .sort((a, b) => b.score - a.score || b.index - a.index)
      .slice(0, 8)
      .map((item) => item.index)
  );

  const lines = messages
    .map((message, index) => ({ message, index }))
    .filter(({ index }) => selectedIndexes.has(index))
    .sort((a, b) => a.index - b.index)
    .map(({ message }) => {
      const speaker = message.role === 'user' ? 'Usuário' : 'Sofia';
      return `- ${speaker}: ${cleanContent(message.content, 260)}`;
    });

  return lines.join('\n').slice(0, maxChars);
}

function summaryKey(userId, conversationId) {
  return `conversation-summary:${safeId(userId)}:${safeId(conversationId)}`;
}

function prepareConversation(messages, options = {}) {
  const normalized = normalizeMessages(messages);
  const lastUser = [...normalized].reverse().find((message) => message.role === 'user');
  const currentQuery = lastUser?.content || normalized[normalized.length - 1]?.content || '';
  const intent = classifyIntent(currentQuery);
  const complexity = estimateComplexity(currentQuery, intent);
  const recentLimit = Math.max(
    4,
    Math.min(20, Number(process.env.ALYA_CONTEXT_RECENT_MESSAGES || DEFAULT_RECENT_MESSAGES))
  );
  const maxChars = Math.max(
    4000,
    Math.min(30000, Number(process.env.ALYA_CONTEXT_MAX_CHARS || DEFAULT_MAX_CONTEXT_CHARS))
  );
  const older = normalized.slice(0, Math.max(0, normalized.length - recentLimit));
  const recent = normalized.slice(-recentLimit);
  const hasConversationId = Boolean(options.conversationId && options.conversationId !== 'default');
  const key = hasConversationId ? summaryKey(options.userId, options.conversationId) : '';

  let summary = summarizeOlderMessages(older, currentQuery);
  if (!summary && key) {
    summary = cleanContent(store.get(key, ''), 2400);
  } else if (summary && key) {
    try {
      store.set(key, summary);
    } catch (error) {
      logger.warn('Não foi possível persistir o resumo da conversa:', error.message);
    }
  }

  const bounded = [];
  let usedChars = 0;
  for (const message of [...recent].reverse()) {
    if (usedChars + message.content.length > maxChars && bounded.length >= 4) continue;
    bounded.unshift(message);
    usedChars += message.content.length;
  }

  return {
    messages: bounded,
    summary,
    intent,
    complexity,
    currentQuery
  };
}

module.exports = {
  classifyIntent,
  estimateComplexity,
  normalizeMessages,
  prepareConversation,
  summarizeOlderMessages
};
