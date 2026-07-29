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
  runProviderChain,
  safeProviderMessage
} = require('../lib/chat');
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
  assert.strictEqual(
    getInstantReply([{ role: 'user', content: 'oi' }], { taskIntent: 'conversation' }),
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
  assert.strictEqual(memory.getAllPermanentMemory(userB).length, 0);

  const explicit = memory.processMemoryTurn(userA, 'Lembre que meu projeto se chama Aurora');
  assert.strictEqual(explicit.saved, true);

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
