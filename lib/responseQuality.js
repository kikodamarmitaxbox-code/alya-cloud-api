'use strict';

const SECRET_PATTERNS = [
  /\bsk-(?:or-v1-)?[A-Za-z0-9_-]{16,}\b/gi,
  /\b(?:nvapi|csk|gsk|cfat)-[A-Za-z0-9_-]{16,}\b/gi,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /\bAQ\.[A-Za-z0-9_-]{16,}\b/g,
  /\bkey_[A-Za-z0-9_-]{16,}\b/gi
];

function redactSecrets(value) {
  let text = String(value || '');
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, '[segredo oculto]');
  }
  return text;
}

function getLastUserMessage(messages) {
  return [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) => message?.role === 'user')?.content || '';
}

function countRepeatedParagraphs(text) {
  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((part) => part.length > 35);
  return paragraphs.length - new Set(paragraphs).size;
}

function assessResponseQuality(reply, settings = {}, messages = []) {
  const original = String(reply || '').trim();
  const text = redactSecrets(original).trim();
  const intent = String(settings.taskIntent || 'conversation');
  const complexity = String(settings.taskComplexity || 'standard');
  const userRequest = String(getLastUserMessage(messages));
  const issues = [];
  let score = 100;
  let hardFailure = false;

  if (!text) {
    issues.push('resposta vazia');
    score = 0;
    hardFailure = true;
  }
  if (SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(original);
  })) {
    issues.push('possível segredo exposto');
    score -= 80;
    hardFailure = true;
  }
  if (/<think>|<\/think>|\b(my response should|the user is asking|chain of thought)\b/i.test(original)) {
    issues.push('raciocínio interno exposto');
    score -= 80;
    hardFailure = true;
  }
  if (
    /^(não consigo ajudar|não posso responder|ocorreu um erro|deu erro|tente novamente)/i.test(text) &&
    !/\b(não posso|nao posso|não consegue|nao consegue)\b/i.test(userRequest)
  ) {
    issues.push('resposta genérica sem resolver o pedido');
    score -= 35;
  }
  if (complexity === 'complex' && text.length < 120) {
    issues.push('resposta curta demais para uma tarefa complexa');
    score -= 30;
  }
  if (
    ['code', 'debugging'].includes(intent) &&
    /\b(corrij|consert|implemente|altere|analise|erro|bug|falha)\b/i.test(userRequest) &&
    !/\b(arquivo|causa|teste|verific|código|codigo|comando|linha|hipótese|hipotese)\b/i.test(text)
  ) {
    issues.push('resposta técnica sem diagnóstico ou verificação');
    score -= 25;
  }
  const repeated = countRepeatedParagraphs(text);
  if (repeated > 0) {
    issues.push('trechos repetidos');
    score -= Math.min(25, repeated * 10);
  }

  return {
    text,
    score: Math.max(0, score),
    issues,
    hardFailure,
    needsRevision: hardFailure || score < 72
  };
}

function buildRevisionSettings(settings, assessment, draft) {
  return {
    ...settings,
    qualityRevision: true,
    revisionIssues: assessment.issues.join('; ').slice(0, 500),
    revisionDraft: redactSecrets(draft).slice(0, 6000)
  };
}

function chooseBetterResponse(original, candidate, settings = {}, messages = []) {
  const first = assessResponseQuality(original, settings, messages);
  const second = assessResponseQuality(candidate, settings, messages);
  if (second.hardFailure && !first.hardFailure) return first;
  if (!second.hardFailure && first.hardFailure) return second;
  return second.score >= first.score ? second : first;
}

function requiresBufferedReview(settings = {}) {
  if (String(process.env.ALYA_QUALITY_REVIEW || 'true').toLowerCase() === 'false') return false;
  return settings.taskComplexity === 'complex' ||
    ['code', 'debugging'].includes(String(settings.taskIntent || ''));
}

module.exports = {
  redactSecrets,
  assessResponseQuality,
  buildRevisionSettings,
  chooseBetterResponse,
  requiresBufferedReview
};
