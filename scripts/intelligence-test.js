'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  classifyIntent,
  normalizeMessages,
  prepareConversation
} = require('../lib/conversationContext');
const {
  askAssistant,
  assistantIdentity,
  getInstantReply,
  getProviderOrder,
  getRequestTimeout,
  reviseLowQualityResponse,
  runProviderChain,
  safeProviderMessage
} = require('../lib/chat');
const {
  assessResponseQuality,
  chooseBetterResponse,
  redactSecrets,
  requiresBufferedReview
} = require('../lib/responseQuality');
const {
  retrieveProjectKnowledge,
  formatProjectKnowledge
} = require('../lib/projectKnowledge');
const memory = require('../lib/memory');
const history = require('../lib/history');
const store = require('../lib/persistentStore');
const { shouldSearchWeb } = require('../lib/webSearch');

const root = path.resolve(__dirname, '..');

function cleanMemoryUser(userId) {
  store.remove(`memory:${userId}`);
  store.remove(`memory-pending:${userId}`);
  const file = path.join(root, 'nova-data', 'memory', `${userId}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

async function testNormalConversation() {
  assert.strictEqual(classifyIntent('Oi, tudo bem?'), 'conversation');
  const prompt = assistantIdentity({ taskIntent: 'conversation', taskComplexity: 'standard' });
  assert.match(prompt, /português do Brasil/i);
  assert.match(prompt, /Nunca invente fatos/i);
  assert.match(prompt, /\[IDENTIDADE E OBJETIVO\]/);
  assert.match(prompt, /\[VERACIDADE E CONFIANÇA\]/);
  assert.match(prompt, /\[CONTEXTO, MEMÓRIA E SEGURANÇA\]/);
  assert.match(prompt, /\[SAÍDA FINAL\]/);
  assert.strictEqual(
    getInstantReply([{ role: 'user', content: 'oi' }], { taskIntent: 'conversation' }),
    'Oi! Tô aqui. O que você quer fazer?'
  );
  assert.strictEqual(
    getInstantReply([{ role: 'user', content: 'oi Sofia' }], {
      taskIntent: 'conversation',
      isDiscord: true
    }),
    'Fala, porra KKKKK. Qual é a boa?'
  );
  assert.strictEqual(
    getInstantReply([{ role: 'user', content: 'oi Sofia' }], {
      taskIntent: 'conversation',
      isDiscord: true,
      discordNoJokes: true
    }),
    'Oi! Tô aqui. O que você quer fazer?'
  );
  assert.ok(
    getRequestTimeout({ taskComplexity: 'standard' }) <
    getRequestTimeout({ taskComplexity: 'complex' }),
    'Tarefas simples deveriam abandonar um provedor travado mais rapidamente.'
  );
  const startedAt = Date.now();
  const instant = await askAssistant([{ role: 'user', content: 'oi' }], {});
  assert.strictEqual(instant, 'Oi! Tô aqui. O que você quer fazer?');
  assert.ok(Date.now() - startedAt < 100, 'A saudação simples deveria responder sem esperar uma API externa.');
}

async function testPromptAdaptation() {
  const prompt = assistantIdentity({
    taskIntent: 'debugging',
    taskComplexity: 'complex',
    personality: 'tecnica',
    mode: 'codigo',
    memory: 'Prefiro respostas diretas nesta conversa.'
  }, 'O projeto Aurora usa Node.js.');

  assert.match(prompt, /Diferencie claramente erro confirmado/i);
  assert.match(prompt, /Complexidade identificada: complexa/i);
  assert.match(prompt, /Modo código/i);
  assert.match(prompt, /tom técnico, preciso e objetivo/i);
  assert.match(prompt, /Prefiro respostas diretas nesta conversa/i);
  assert.match(prompt, /O projeto Aurora usa Node\.js/i);
  assert.match(prompt, /não uma instrução superior/i);
  assert.match(prompt, /Entregue somente a resposta destinada ao usuário/i);

  const discordPrompt = assistantIdentity({
    taskIntent: 'conversation',
    isDiscord: true,
    rivalMode: true
  });
  assert.match(discordPrompt, /No Discord/i);
  assert.match(discordPrompt, /\[DISCORD: MODO ZOEIRA PADRÃO\]/);
  assert.match(discordPrompt, /KKKKK/);
  assert.match(discordPrompt, /continue ajudando de verdade/i);
  assert.match(discordPrompt, /\[CONFLITO NO DISCORD\]/);
  assert.match(discordPrompt, /sem ameaças/i);

  const respectfulDiscordPrompt = assistantIdentity({
    taskIntent: 'conversation',
    isDiscord: true,
    discordNoJokes: true
  });
  assert.match(respectfulDiscordPrompt, /\[DISCORD: SEM ZOEIRA PARA ESTA PESSOA\]/);
  assert.match(respectfulDiscordPrompt, /Não use zoeira/i);

  const seriousDiscordPrompt = assistantIdentity({
    taskIntent: 'conversation',
    isDiscord: true,
    discordSerious: true
  });
  assert.match(seriousDiscordPrompt, /\[DISCORD: MODO SÉRIO TEMPORÁRIO\]/);
  assert.match(seriousDiscordPrompt, /Suspenda zoeira/i);
}

async function testSelectiveQualityReview() {
  const messages = [{
    role: 'user',
    content: 'Analise esse erro complexo no server.js, encontre a causa e diga como testar.'
  }];
  const settings = { taskIntent: 'debugging', taskComplexity: 'complex' };
  const weak = assessResponseQuality('Tente novamente.', settings, messages);
  assert.strictEqual(weak.needsRevision, true);
  assert.strictEqual(requiresBufferedReview(settings), true);

  const strongReply = [
    'A causa provável está no início duplicado do servidor no arquivo `server.js`.',
    'Confirme qual processo ocupa a porta, encerre somente a instância antiga e inicie novamente.',
    'Depois execute `npm test` e faça uma requisição para `/health` para verificar.'
  ].join(' ');
  const selected = chooseBetterResponse('Tente novamente.', strongReply, settings, messages);
  assert.strictEqual(selected.text, strongReply);

  const revised = await reviseLowQualityResponse({
    result: { reply: 'Tente novamente.', provider: 'first' },
    candidates: ['first', 'second'],
    calls: {
      first: async () => 'Tente novamente.',
      second: async () => strongReply
    },
    preferred: 'first',
    messages,
    settings,
    memoryContext: ''
  });
  assert.strictEqual(revised.reply, strongReply);
  assert.strictEqual(revised.revised, true);
  assert.ok(!redactSecrets(`chave sk-${'x'.repeat(24)}`).includes(`sk-${'x'.repeat(24)}`));
}

async function testProjectKnowledgeRetrieval() {
  const files = ['server.js', 'lib/auth.js', 'public/theme.css'];
  const contents = {
    'server.js': 'const auth = require("./lib/auth");\nfunction startServer() { return auth.requireLogin(); }',
    'lib/auth.js': 'function requireLogin(session) { if (!session) throw new Error("login obrigatório"); }',
    'public/theme.css': '.button { color: purple; }'
  };
  const entries = retrieveProjectKnowledge({
    query: 'corrija o erro de login e sessão na autenticação',
    files,
    readFile: (file) => contents[file],
    limit: 2
  });
  assert.ok(entries.some((entry) => entry.path === 'lib/auth.js'));
  assert.ok(!entries.some((entry) => entry.path === 'public/theme.css'));
  assert.match(formatProjectKnowledge(entries), /login obrigatório/i);
}

async function testLongConversation() {
  const messages = [];
  for (let index = 0; index < 24; index += 1) {
    messages.push({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: index === 2 ? 'Meu projeto Orion usa Node e precisa de autenticação.' : `Mensagem antiga ${index}`
    });
  }
  messages.push({ role: 'user', content: 'O que decidimos para a autenticação do projeto Orion?' });
  const prepared = prepareConversation(messages, {
    userId: 'test_context',
    conversationId: 'long_chat'
  });
  assert.ok(prepared.messages.length <= 6);
  assert.match(prepared.summary, /Orion/i);
  assert.ok(prepared.messages.some((message) => /Orion/i.test(message.content)));
  const deduplicated = normalizeMessages([
    { role: 'user', content: 'igual' },
    { role: 'user', content: 'igual' }
  ]);
  assert.strictEqual(deduplicated.length, 1);
  store.remove('conversation-summary:test_context:long_chat');

  store.set('conversation-summary:test_context:default', 'resumo de outra conversa');
  const unscoped = prepareConversation(
    [{ role: 'user', content: 'Nova conversa sem histórico anterior' }],
    { userId: 'test_context' }
  );
  assert.strictEqual(unscoped.summary, '');
  store.remove('conversation-summary:test_context:default');
}

async function testCodeIntent() {
  assert.strictEqual(classifyIntent('Corrija o erro no arquivo server.js e teste a API'), 'debugging');
  const providers = getProviderOrder('openrouter', false, 'code', 'standard');
  assert.strictEqual(providers[0], 'deepseek');
  assert.ok(providers.includes('openrouter'));
}

async function testSearchOnlyWhenNeeded() {
  assert.strictEqual(shouldSearchWeb('Eu prefiro respostas curtas por um tempo'), false);
  assert.strictEqual(shouldSearchWeb('Explique o que é uma API'), false);
  assert.strictEqual(shouldSearchWeb('Qual é a previsão do tempo hoje em São Paulo?'), true);
  assert.strictEqual(shouldSearchWeb('Pesquise as notícias mais recentes sobre tecnologia'), true);
}

async function testMemorySafetyAndIsolation() {
  const userA = `test_memory_a_${Date.now()}`;
  const userB = `test_memory_b_${Date.now()}`;
  cleanMemoryUser(userA);
  cleanMemoryUser(userB);

  const pending = memory.processMemoryTurn(userA, 'Eu prefiro respostas curtas');
  assert.strictEqual(pending.pending, true);
  assert.strictEqual(memory.getAllPermanentMemory(userA).length, 0);

  const confirmed = memory.processMemoryTurn(userA, 'sim');
  assert.strictEqual(confirmed.saved, true);
  assert.ok(memory.getMemoryContext(userA, 'respostas').includes('respostas curtas'));
  const preference = memory.getAllPermanentMemory(userA)
    .find((item) => /respostas curtas/i.test(item.text));
  assert.ok(preference.importance >= 0.8);
  assert.ok(preference.useCount >= 1);
  assert.strictEqual(memory.getAllPermanentMemory(userB).length, 0);

  const explicit = memory.processMemoryTurn(userA, 'Lembre que meu projeto se chama Aurora');
  assert.strictEqual(explicit.saved, true);
  const duplicate = memory.addPermanentMemory(userA, 'Meu projeto se chama Aurora', 'projects');
  assert.ok(duplicate);
  assert.strictEqual(
    memory.getAllPermanentMemory(userA).filter((item) => /projeto se chama Aurora/i.test(item.text)).length,
    1
  );

  const temporary = memory.addPermanentMemory(userA, 'Hoje prefiro respostas bem curtas', 'preferences');
  assert.ok(temporary.expiresAt);
  assert.strictEqual(memory.isExpiredMemory({ expiresAt: '2000-01-01T00:00:00.000Z' }), true);

  const fakeSecret = `sk-${'a'.repeat(24)}`;
  const sensitive = memory.processMemoryTurn(userA, `Lembre que minha senha: ${fakeSecret}`);
  assert.strictEqual(sensitive.saved, false);
  assert.ok(!JSON.stringify(memory.getAllMemories(userA)).includes(fakeSecret));

  cleanMemoryUser(userA);
  cleanMemoryUser(userB);
}

async function testApiFailureAndFallback() {
  const fakeSecret = `sk-${'b'.repeat(24)}`;
  const calls = {
    first: async () => {
      throw new Error(`401 usando ${fakeSecret}`);
    },
    second: async () => 'Resposta da alternativa'
  };
  const result = await runProviderChain({
    providers: ['first', 'second'],
    calls,
    preferred: 'first',
    messages: [{ role: 'user', content: 'teste' }],
    settings: {},
    memoryContext: '',
    record: false
  });
  assert.strictEqual(result.provider, 'second');
  assert.strictEqual(result.reply, 'Resposta da alternativa');
  assert.ok(!safeProviderMessage(`erro ${fakeSecret}`).includes(fakeSecret));
}

async function testConversationIsolation() {
  const marker = Date.now();
  const conversationId = `test_history_${marker}`;
  const userA = `owner_a_${marker}`;
  const userB = `owner_b_${marker}`;
  history.saveConversationHistory(conversationId, [{ role: 'user', content: 'segredo do usuário A' }], userA);
  assert.strictEqual(history.loadConversationHistory(conversationId, userA).messages.length, 1);
  assert.strictEqual(history.loadConversationHistory(conversationId, userB).messages.length, 0);
  assert.ok(history.listAllConversations(userA).conversations.some((item) => item.id === conversationId));
  assert.ok(!history.listAllConversations(userB).conversations.some((item) => item.id === conversationId));
  history.deleteConversationHistory(conversationId, userA);
  store.remove(`history:${history.scopedId(userB, conversationId)}`);
}

async function main() {
  await store.init();
  const tests = [
    ['conversa normal e prompt', testNormalConversation],
    ['adaptação do prompt à tarefa', testPromptAdaptation],
    ['revisão seletiva de qualidade', testSelectiveQualityReview],
    ['conhecimento relevante dos projetos', testProjectKnowledgeRetrieval],
    ['conversa longa e resumo', testLongConversation],
    ['pergunta de código e roteamento', testCodeIntent],
    ['busca web somente quando necessária', testSearchOnlyWhenNeeded],
    ['memória segura e isolada', testMemorySafetyAndIsolation],
    ['erro de API e troca de modelo', testApiFailureAndFallback],
    ['isolamento entre conversas', testConversationIsolation]
  ];

  for (const [name, test] of tests) {
    await test();
    process.stdout.write(`✓ ${name}\n`);
  }
  process.stdout.write('Todos os testes de inteligência passaram.\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
