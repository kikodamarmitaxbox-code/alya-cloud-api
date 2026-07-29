'use strict';

const path = require('path');

const STOP_WORDS = new Set([
  'para', 'como', 'mais', 'uma', 'isso', 'esse', 'essa', 'quero', 'fazer',
  'deixe', 'melhorar', 'corrigir', 'criar', 'adicione', 'projeto', 'arquivo',
  'com', 'sem', 'que', 'dos', 'das', 'por', 'não', 'nao'
]);

function tokenizeQuery(value) {
  return [...new Set(
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .match(/[a-z0-9_+#.-]{3,}/g) || []
  )].filter((word) => !STOP_WORDS.has(word));
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n');
}

function countOccurrences(text, token) {
  let count = 0;
  let start = 0;
  while (count < 12) {
    const index = text.indexOf(token, start);
    if (index < 0) break;
    count += 1;
    start = index + token.length;
  }
  return count;
}

function extractRelevantExcerpt(content, tokens, maxChars = 2600) {
  const text = normalizeText(content);
  if (!text) return '';
  const lower = text.toLowerCase();
  let bestIndex = -1;
  let bestToken = '';
  for (const token of tokens) {
    const index = lower.indexOf(token);
    if (index >= 0 && (bestIndex < 0 || index < bestIndex)) {
      bestIndex = index;
      bestToken = token;
    }
  }
  if (bestIndex < 0) return text.slice(0, Math.min(maxChars, 1200));

  const radius = Math.floor(maxChars / 2);
  const start = Math.max(0, bestIndex - radius);
  const end = Math.min(text.length, start + maxChars);
  const prefix = start > 0 ? '…\n' : '';
  const suffix = end < text.length ? '\n…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`.trim();
}

function retrieveProjectKnowledge(options = {}) {
  const query = String(options.query || '');
  const files = Array.isArray(options.files) ? options.files : [];
  const readFile = typeof options.readFile === 'function' ? options.readFile : () => '';
  const explicitFiles = new Set(options.explicitFiles || []);
  const tokens = tokenizeQuery(query);
  const scanLimit = Math.max(10, Math.min(160, Number(options.scanLimit || 80)));
  const resultLimit = Math.max(1, Math.min(8, Number(options.limit || 4)));
  const candidates = [];

  for (const file of files.slice(0, scanLimit)) {
    if (explicitFiles.has(file)) continue;
    const normalizedPath = String(file).replace(/\\/g, '/').toLowerCase();
    const basename = path.basename(normalizedPath, path.extname(normalizedPath));
    let content = '';
    try {
      content = normalizeText(readFile(file)).slice(0, 16000);
    } catch {
      continue;
    }
    if (!content || content.length > 12000 && content.split('\n').length < 3) continue;

    const lowerContent = content.toLowerCase();
    let score = 0;
    const matchedTokens = [];
    for (const token of tokens) {
      let tokenScore = 0;
      if (basename.includes(token)) tokenScore += 45;
      else if (normalizedPath.includes(token)) tokenScore += 20;
      tokenScore += Math.min(30, countOccurrences(lowerContent, token) * 5);
      if (tokenScore > 0) {
        score += tokenScore;
        matchedTokens.push(token);
      }
    }
    if (['package.json', 'server.js', 'src/index.js', 'src/app.js'].includes(normalizedPath)) {
      score += 6;
    }
    if (score <= 6 && tokens.length > 0) continue;
    candidates.push({
      path: file,
      score,
      matchedTokens,
      excerpt: extractRelevantExcerpt(content, matchedTokens.length ? matchedTokens : tokens)
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, resultLimit);
}

function formatProjectKnowledge(entries, maxChars = 12000) {
  const blocks = (Array.isArray(entries) ? entries : [])
    .map((entry) => `--- ${entry.path} (relevância ${entry.score}) ---\n${entry.excerpt}`);
  return blocks.join('\n\n').slice(0, maxChars);
}

module.exports = {
  tokenizeQuery,
  extractRelevantExcerpt,
  retrieveProjectKnowledge,
  formatProjectKnowledge
};
