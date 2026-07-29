const logger = require('./logger');
const persistentStore = require('./persistentStore');
const { prepareConversation } = require('./conversationContext');
const { buildSystemPrompt } = require('./systemPrompt');
const {
  redactSecrets,
  assessResponseQuality,
  buildRevisionSettings,
  chooseBetterResponse,
  requiresBufferedReview
} = require('./responseQuality');

const assistantIdentity = buildSystemPrompt;

const providerKeys = {
  openrouter: 'OPENROUTER_API_KEY',
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  together: 'TOGETHER_API_KEY'
};
const providerHealth = new Map();
let lastProviderEvent = {
  active: null,
  preferred: (process.env.AI_PROVIDER || 'openrouter').toLowerCase(),
  switched: false,
  updatedAt: null
};

function getPreferredProvider() {
  const configured = String(process.env.AI_PROVIDER || 'openrouter').toLowerCase();
  const saved = String(persistentStore.get('system:preferred-provider', '') || '').toLowerCase();
  if (providerKeys[saved] && process.env[providerKeys[saved]]) return saved;
  if (providerKeys[configured] && process.env[providerKeys[configured]]) return configured;
  return Object.keys(providerKeys).find((provider) => process.env[providerKeys[provider]]) || configured;
}

function setPreferredProvider(provider) {
  const normalized = String(provider || '').trim().toLowerCase();
  const envKey = providerKeys[normalized];
  if (!envKey) return { ok: false, error: 'Modelo desconhecido.' };
  if (!process.env[envKey]) return { ok: false, error: 'Esse modelo ainda não está configurado.' };

  persistentStore.set('system:preferred-provider', normalized);
  lastProviderEvent = {
    ...lastProviderEvent,
    preferred: normalized,
    switched: Boolean(lastProviderEvent.active && lastProviderEvent.active !== normalized),
    updatedAt: new Date().toISOString()
  };
  return { ok: true, provider: normalized };
}

function recordProviderSuccess(provider, preferred, latency = 0) {
  const latencyMs = Math.max(0, Number(latency) || 0);
  const previous = providerHealth.get(provider) || {};
  const averageLatencyMs = latencyMs
    ? Math.round(previous.averageLatencyMs
      ? (Number(previous.averageLatencyMs) * 0.65) + (latencyMs * 0.35)
      : latencyMs)
    : Number(previous.averageLatencyMs) || 0;
  providerHealth.set(provider, {
    ok: true,
    failures: 0,
    retryAt: 0,
    lastError: '',
    averageLatencyMs,
    updatedAt: new Date().toISOString()
  });
  lastProviderEvent = {
    active: provider,
    preferred,
    switched: provider !== preferred,
    updatedAt: new Date().toISOString()
  };
}

function recordProviderFailure(provider, error) {
  const previous = providerHealth.get(provider) || { failures: 0 };
  const failures = Number(previous.failures || 0) + 1;
  const baseDelay = Math.max(15000, Number(process.env.ALYA_PROVIDER_FAILURE_COOLDOWN_MS) || 60000);
  const retryDelay = Math.min(600000, baseDelay * (2 ** Math.min(failures - 1, 3)));
  providerHealth.set(provider, {
    ok: false,
    failures,
    retryAt: Date.now() + retryDelay,
    lastError: safeProviderMessage(error?.message || error),
    updatedAt: new Date().toISOString()
  });
}

function getProviderStatus() {
  const preferred = getPreferredProvider();
  const providers = Object.entries(providerKeys).map(([name, envKey]) => {
    const health = providerHealth.get(name) || {};
    return {
      name,
      configured: Boolean(process.env[envKey]),
      ok: health.ok ?? null,
      failures: health.failures || 0,
      averageLatencyMs: health.averageLatencyMs || 0,
      retryAt: health.retryAt || 0,
      updatedAt: health.updatedAt || null
    };
  });
  return { ...lastProviderEvent, preferred, providers };
}

function safeProviderMessage(value) {
  return String(value || 'Erro no provedor de IA.')
    .replace(/api_key:[^\s'"}]+/gi, 'api_key:[oculta]')
    .replace(/AIza[\w-]+/g, '[chave oculta]')
    .replace(/AQ\.[\w-]+/g, '[chave oculta]')
    .replace(/nvapi-[\w-]+/gi, '[chave oculta]')
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, '[chave oculta]')
    .replace(/csk-[A-Za-z0-9_-]{20,}/g, '[chave oculta]')
    .replace(/key_[A-Za-z0-9_-]{20,}/g, '[chave oculta]')
    .slice(0, 300);
}

function getRequestTimeout(settings = {}) {
  if (settings.taskComplexity === 'complex') {
    return Math.max(8000, Number(process.env.ALYA_COMPLEX_TIMEOUT_MS) || 18000);
  }
  return Math.max(5000, Number(process.env.ALYA_STANDARD_TIMEOUT_MS) || 10000);
}

function getFirstTokenTimeout() {
  return Math.max(3500, Number(process.env.ALYA_FIRST_TOKEN_TIMEOUT_MS) || 6500);
}

function createAbortDeadline(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
    }
  };
}

function getInstantReply(messages, settings = {}) {
  if (settings.taskIntent && settings.taskIntent !== 'conversation') return '';
  const lastUser = [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) => message?.role === 'user');
  const text = String(lastUser?.content || '')
    .trim()
    .toLowerCase()
    .replace(/[!?.,]+$/g, '')
    .replace(/\s+/g, ' ');

  if (/^(oi|olá|ola|e aí|e ai|opa|oi alya|olá alya|ola alya|oi bb)$/.test(text)) {
    return 'Oi! Tô aqui. O que você quer fazer?';
  }
  if (/^(bom dia|boa tarde|boa noite)$/.test(text)) {
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}! Como posso te ajudar?`;
  }
  if (/^(obrigado|obrigada|valeu|vlw)$/.test(text)) {
    return 'Por nada! Quando precisar, é só chamar.';
  }
  return '';
}

async function askOpenRouter(messages, settings, memoryContext = '') {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('Coloque sua chave OPENROUTER_API_KEY no arquivo .env.');
  }

  const models = getOpenRouterModels(settings);

  const systemContent = assistantIdentity(settings, memoryContext);
  let freeLimitReached = false;

  for (const model of models) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost',
          'X-Title': 'Alya AI'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemContent },
            ...messages
          ],
          temperature: getTemperature(settings),
          max_tokens: getMaxTokens(settings)
        }),
        signal: AbortSignal.timeout(getRequestTimeout(settings))
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data.choices?.[0]?.message?.content) {
        const reply = data.choices[0].message.content.trim();
        if (reply.length > 0) return reply;
      }
      if (response.status === 429 && /free-models-per-day/i.test(data.error?.message || '')) {
        freeLimitReached = true;
      }
    } catch (err) {
      logger.warn('Modelo do OpenRouter falhou.', { model, error: safeProviderMessage(err.message) });
    }
  }

  if (freeLimitReached) {
    throw new Error('O limite gratuito de hoje da Alya foi atingido. Ela volta a responder quando o limite do OpenRouter reiniciar.');
  }
  throw new Error('Não foi possível obter resposta dos modelos de IA. Tente novamente.');
}

async function askOpenRouterStream(messages, settings, res, memoryContext = '') {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('Coloque sua chave OPENROUTER_API_KEY no arquivo .env.');
  }

  const models = getOpenRouterModels(settings);

  const systemContent = assistantIdentity(settings, memoryContext);

  for (const model of models) {
    const deadline = createAbortDeadline(getFirstTokenTimeout());
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost',
          'X-Title': 'Alya AI'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemContent },
            ...messages
          ],
          temperature: getTemperature(settings),
          max_tokens: getMaxTokens(settings),
          stream: true
        }),
        signal: deadline.signal
      });

      if (response.ok) {
        const hasText = await pipeSseText(
          response,
          res,
          (data) => data.choices?.[0]?.delta?.content || '',
          deadline.clear
        );
        if (hasText) return true;
      }
    } catch (err) {
      logger.warn('Stream do OpenRouter falhou.', { model, error: safeProviderMessage(err.message) });
    } finally {
      deadline.clear();
    }
  }

  throw new Error('O OpenRouter não iniciou a resposta rápida.');
}

function getOpenRouterModels(settings = {}) {
  const mainModel = getModelForTask(
    'OPENROUTER',
    process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free',
    settings
  );
  // A Alya tenta primeiro o modelo escolhido. Só se ele estiver indisponível,
  // usa o roteador gratuito do OpenRouter como plano B.
  return [...new Set([mainModel, 'openrouter/free'])];
}

function getModelForTask(prefix, fallback, settings = {}) {
  const intent = settings.taskIntent || 'conversation';
  const complexity = settings.taskComplexity || 'standard';
  if (['code', 'debugging'].includes(intent) && process.env[`${prefix}_CODE_MODEL`]) {
    return process.env[`${prefix}_CODE_MODEL`];
  }
  if (complexity === 'complex' && process.env[`${prefix}_REASONING_MODEL`]) {
    return process.env[`${prefix}_REASONING_MODEL`];
  }
  if (['conversation', 'explanation', 'summary', 'writing'].includes(intent) && process.env[`${prefix}_FAST_MODEL`]) {
    return process.env[`${prefix}_FAST_MODEL`];
  }
  return fallback;
}

function getTemperature(settings = {}) {
  if (['code', 'debugging', 'summary'].includes(settings.taskIntent)) return 0.25;
  if (['planning', 'decision', 'explanation'].includes(settings.taskIntent)) return 0.5;
  return 0.7;
}

function getMaxTokens(settings = {}) {
  if (settings.taskComplexity === 'complex') {
    return Number(process.env.ALYA_COMPLEX_MAX_TOKENS || process.env.MAX_TOKENS || 900);
  }
  return Number(process.env.MAX_TOKENS || 600);
}

async function askGemini(messages, settings, memoryContext = '') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Coloque sua chave GEMINI_API_KEY no arquivo .env.');
  }

  const model = getModelForTask('GEMINI', process.env.GEMINI_MODEL || 'gemini-2.5-flash', settings);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: assistantIdentity(settings, memoryContext) }]
      },
      contents: messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }]
      })),
      generationConfig: {
        temperature: getTemperature(settings),
        maxOutputTokens: getMaxTokens(settings)
      }
    }),
    signal: AbortSignal.timeout(getRequestTimeout(settings))
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = safeProviderMessage(data.error?.message);
    logger.error('Gemini API error:', { status: response.status, message });
    throw new Error(message);
  }

  return data.candidates?.[0]?.content?.parts?.map((part) => part.text).join('').trim() || 'Não recebi uma resposta da IA.';
}

async function askGeminiStream(messages, settings, res, memoryContext = '') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Coloque sua chave GEMINI_API_KEY no arquivo .env.');
  }

  const model = getModelForTask('GEMINI', process.env.GEMINI_MODEL || 'gemini-2.5-flash', settings);
  const deadline = createAbortDeadline(getFirstTokenTimeout());
  let response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: assistantIdentity(settings, memoryContext) }]
        },
        contents: messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }]
        })),
        generationConfig: {
          temperature: getTemperature(settings),
          maxOutputTokens: getMaxTokens(settings)
        }
      }),
      signal: deadline.signal
    });
  } catch (error) {
    deadline.clear();
    throw error;
  }

  if (!response.ok) {
    deadline.clear();
    const data = await response.json().catch(() => ({}));
    const message = safeProviderMessage(data.error?.message);
    logger.error('Gemini stream error:', { status: response.status, message });
    throw new Error(message);
  }

  const hasText = await pipeSseText(response, res, (data) => {
    const parts = data.candidates?.[0]?.content?.parts || [];
    return parts.map((part) => part.text || '').join('');
  }, deadline.clear);
  deadline.clear();
  if (!hasText) throw new Error('O Gemini não iniciou a resposta rápida.');
  return true;
}

async function askGroq(messages, settings, memoryContext = '') {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('Coloque sua chave GROQ_API_KEY no arquivo .env.');
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: getModelForTask('GROQ', process.env.GROQ_MODEL || 'openai/gpt-oss-120b', settings),
      messages: [
        { role: 'system', content: assistantIdentity(settings, memoryContext) },
        ...messages
      ],
      temperature: getTemperature(settings),
      max_tokens: getMaxTokens(settings)
    }),
    signal: AbortSignal.timeout(getRequestTimeout(settings))
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = safeProviderMessage(data.error?.message || 'A API do Groq recusou a resposta agora.');
    logger.error('Groq API error:', { status: response.status, message });
    throw new Error(message);
  }

  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('O Groq não retornou uma resposta.');
  return reply;
}

async function askNvidia(messages, settings, memoryContext = '') {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw new Error('Coloque sua chave NVIDIA_API_KEY no arquivo .env.');
  }

  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      // A Alya só chega aqui se as reservas anteriores falharem.
      model: getModelForTask('NVIDIA', process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b', settings),
      messages: [
        { role: 'system', content: assistantIdentity(settings, memoryContext) },
        ...messages
      ],
      temperature: getTemperature(settings),
      max_tokens: getMaxTokens(settings)
    }),
    signal: AbortSignal.timeout(getRequestTimeout(settings))
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = safeProviderMessage(data.error?.message || 'A API da NVIDIA recusou a resposta agora.');
    logger.error('NVIDIA API error:', { status: response.status, message });
    throw new Error(message);
  }

  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('A NVIDIA não retornou uma resposta.');
  return reply;
}

async function askDeepSeek(messages, settings, memoryContext = '') {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('Coloque sua chave DEEPSEEK_API_KEY no arquivo .env.');
  }

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: getModelForTask('DEEPSEEK', process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash', settings),
      messages: [
        { role: 'system', content: assistantIdentity(settings, memoryContext) },
        ...messages
      ],
      temperature: getTemperature(settings),
      max_tokens: getMaxTokens(settings)
    }),
    signal: AbortSignal.timeout(getRequestTimeout(settings))
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = safeProviderMessage(data.error?.message || 'A API da DeepSeek recusou a resposta agora.');
    logger.error('DeepSeek API error:', { status: response.status, message });
    throw new Error(message);
  }

  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('A DeepSeek não retornou uma resposta.');
  return reply;
}

async function askMistral(messages, settings, memoryContext = '') {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('Coloque sua chave MISTRAL_API_KEY no arquivo .env.');
  }

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: getModelForTask('MISTRAL', process.env.MISTRAL_MODEL || 'mistral-small-latest', settings),
      messages: [
        { role: 'system', content: assistantIdentity(settings, memoryContext) },
        ...messages
      ],
      temperature: getTemperature(settings),
      max_tokens: getMaxTokens(settings)
    }),
    signal: AbortSignal.timeout(getRequestTimeout(settings))
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = safeProviderMessage(data.error?.message || 'A API da Mistral recusou a resposta agora.');
    logger.error('Mistral API error:', { status: response.status, message });
    throw new Error(message);
  }

  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('A Mistral não retornou uma resposta.');
  return reply;
}

async function askCerebras(messages, settings, memoryContext = '') {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    throw new Error('Coloque sua chave CEREBRAS_API_KEY no arquivo .env.');
  }

  const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: getModelForTask('CEREBRAS', process.env.CEREBRAS_MODEL || 'gpt-oss-120b', settings),
      messages: [
        { role: 'system', content: assistantIdentity(settings, memoryContext) },
        ...messages
      ],
      temperature: getTemperature(settings),
      max_tokens: getMaxTokens(settings)
    }),
    signal: AbortSignal.timeout(getRequestTimeout(settings))
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = safeProviderMessage(data.error?.message || 'A API da Cerebras recusou a resposta agora.');
    logger.error('Cerebras API error:', { status: response.status, message });
    throw new Error(message);
  }

  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('A Cerebras não retornou uma resposta.');
  return reply;
}

async function askTogether(messages, settings, memoryContext = '') {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    throw new Error('Coloque sua chave TOGETHER_API_KEY no arquivo .env.');
  }

  const response = await fetch('https://api.together.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: getModelForTask('TOGETHER', process.env.TOGETHER_MODEL || 'Qwen/Qwen3.5-9B', settings),
      messages: [
        { role: 'system', content: assistantIdentity(settings, memoryContext) },
        ...messages
      ],
      temperature: getTemperature(settings),
      max_tokens: getMaxTokens(settings)
    }),
    signal: AbortSignal.timeout(getRequestTimeout(settings))
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = safeProviderMessage(data.error?.message || 'A API da Together recusou a resposta agora.');
    logger.error('Together API error:', { status: response.status, message });
    throw new Error(message);
  }

  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('A Together não retornou uma resposta.');
  return reply;
}

const compatibleStreamProviders = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: 'GROQ_API_KEY',
    model: (settings) => getModelForTask('GROQ', process.env.GROQ_MODEL || 'openai/gpt-oss-120b', settings)
  },
  nvidia: {
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    key: 'NVIDIA_API_KEY',
    model: (settings) => getModelForTask('NVIDIA', process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b', settings)
  },
  deepseek: {
    url: 'https://api.deepseek.com/chat/completions',
    key: 'DEEPSEEK_API_KEY',
    model: (settings) => getModelForTask('DEEPSEEK', process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash', settings)
  },
  mistral: {
    url: 'https://api.mistral.ai/v1/chat/completions',
    key: 'MISTRAL_API_KEY',
    model: (settings) => getModelForTask('MISTRAL', process.env.MISTRAL_MODEL || 'mistral-small-latest', settings)
  },
  cerebras: {
    url: 'https://api.cerebras.ai/v1/chat/completions',
    key: 'CEREBRAS_API_KEY',
    model: (settings) => getModelForTask('CEREBRAS', process.env.CEREBRAS_MODEL || 'gpt-oss-120b', settings)
  },
  together: {
    url: 'https://api.together.ai/v1/chat/completions',
    key: 'TOGETHER_API_KEY',
    model: (settings) => getModelForTask('TOGETHER', process.env.TOGETHER_MODEL || 'Qwen/Qwen3.5-9B', settings)
  }
};

async function askCompatibleProviderStream(provider, messages, settings, res, memoryContext = '') {
  const config = compatibleStreamProviders[provider];
  const apiKey = config && process.env[config.key];
  if (!config || !apiKey) throw new Error(`O modelo ${provider} não está configurado.`);

  const deadline = createAbortDeadline(getFirstTokenTimeout());
  let response;
  try {
    response = await fetch(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model(settings),
        messages: [
          { role: 'system', content: assistantIdentity(settings, memoryContext) },
          ...messages
        ],
        temperature: getTemperature(settings),
        max_tokens: getMaxTokens(settings),
        stream: true
      }),
      signal: deadline.signal
    });
  } catch (error) {
    deadline.clear();
    throw error;
  }

  if (!response.ok) {
    deadline.clear();
    const data = await response.json().catch(() => ({}));
    throw new Error(safeProviderMessage(data.error?.message || `${provider} recusou a resposta rápida.`));
  }

  const hasText = await pipeSseText(
    response,
    res,
    (data) => data.choices?.[0]?.delta?.content || '',
    deadline.clear
  );
  deadline.clear();
  if (!hasText) throw new Error(`${provider} não iniciou a resposta rápida.`);
  return true;
}

function startTextStream(res) {
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (!res.hasHeader('Access-Control-Allow-Origin')) res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.statusCode = 200;
  }
}

async function pipeSseText(response, res, pickText, onFirstText = () => {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullAccumulated = '';
  let wroteAnyText = false;
  let inThinkBlock = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      try {
        const data = JSON.parse(payload);
        const text = pickText(data);
        if (text) {
          fullAccumulated += text;

          // Se estiver dentro de <think>...</think>
          if (fullAccumulated.includes('<think>') && !fullAccumulated.includes('</think>')) {
            inThinkBlock = true;
            continue;
          }
          if (inThinkBlock && fullAccumulated.includes('</think>')) {
            inThinkBlock = false;
            const afterThink = fullAccumulated.split('</think>').pop();
            if (afterThink) {
              if (!wroteAnyText) {
                onFirstText();
                startTextStream(res);
              }
              res.write(afterThink);
              wroteAnyText = true;
            }
            continue;
          }

          // Se a resposta começar com raciocínio em inglês ("Okay, the user is asking...")
          if (!wroteAnyText && /^okay,\s*the\s*user/i.test(fullAccumulated.trim())) {
            continue;
          }

          if (!inThinkBlock) {
            if (!wroteAnyText) {
              onFirstText();
              startTextStream(res);
            }
            res.write(text);
            wroteAnyText = true;
          }
        }
      } catch (error) {
        logger.debug('Stream fragment error:', error);
      }
    }
  }

  if (wroteAnyText) {
    res.end();
  }

  return wroteAnyText;
}

function sanitizeFinalReply(reply, settings = {}) {
  let text = redactSecrets(String(reply || '')).trim();
  if (!text) return '';

  // Alguns modelos gratuitos ocasionalmente devolvem o raciocínio junto da resposta.
  // Nunca deixamos esse conteúdo chegar ao usuário.
  if (text.includes('<think>')) {
    text = text.includes('</think>') ? text.split('</think>').pop().trim() : '';
  }
  const looksLikeReasoning = /^(okay|ok|first,|looking at|let me think|wait,|we need to|the user is asking|my response should|possible response:)/i.test(text);
  if (looksLikeReasoning || /\b(my response should|need to make sure|looking at the history|possible response:)\b/i.test(text)) {
    return settings.isDiscord
      ? 'Foi mal, dei uma bugadinha aqui kkk. Manda de novo pra mim.'
      : 'Dei uma bugadinha na resposta. Pode mandar de novo?';
  }
  return text;
}

function getLegacyProviderOrder(preferred, isDiscord = false) {
  return isDiscord
    ? ['mistral', 'groq', 'cerebras', 'nvidia', 'openrouter', 'gemini', 'deepseek', 'together']
    : preferred === 'gemini'
    ? ['gemini', 'openrouter', 'groq', 'nvidia', 'deepseek', 'mistral', 'cerebras', 'together']
    : preferred === 'groq'
      ? ['groq', 'openrouter', 'gemini', 'nvidia', 'deepseek', 'mistral', 'cerebras', 'together']
      : preferred === 'nvidia'
        ? ['nvidia', 'groq', 'openrouter', 'gemini', 'deepseek', 'mistral', 'cerebras', 'together']
      : preferred === 'deepseek'
          ? ['deepseek', 'groq', 'nvidia', 'openrouter', 'gemini', 'mistral', 'cerebras', 'together']
          : preferred === 'mistral'
            ? ['mistral', 'groq', 'nvidia', 'openrouter', 'gemini', 'deepseek', 'cerebras', 'together']
          : preferred === 'cerebras'
              ? ['cerebras', 'groq', 'nvidia', 'mistral', 'openrouter', 'gemini', 'deepseek', 'together']
              : preferred === 'together'
                ? ['together', 'groq', 'nvidia', 'mistral', 'openrouter', 'gemini', 'deepseek', 'cerebras']
                 : ['openrouter', 'gemini', 'groq', 'nvidia', 'deepseek', 'mistral', 'cerebras', 'together'];
}

function getProviderOrder(preferred, isDiscord = false, intent = 'conversation', complexity = 'standard') {
  const legacy = getLegacyProviderOrder(preferred, isDiscord);
  if (isDiscord || String(process.env.ALYA_MODEL_ROUTING || 'smart').toLowerCase() === 'preferred') {
    return legacy;
  }

  let taskOrder;
  if (['code', 'debugging'].includes(intent)) {
    taskOrder = ['deepseek', 'groq', 'nvidia', 'openrouter', 'mistral', 'cerebras', 'gemini', 'together'];
  } else if (complexity === 'complex' || ['planning', 'decision'].includes(intent)) {
    taskOrder = ['nvidia', 'openrouter', 'gemini', 'deepseek', 'mistral', 'groq', 'cerebras', 'together'];
  } else {
    taskOrder = ['groq', 'cerebras', 'mistral', 'gemini', 'openrouter', 'nvidia', 'deepseek', 'together'];
  }

  // Mantém a preferência do usuário perto do início sem anular a escolha por tarefa.
  return [...new Set([taskOrder[0], preferred, ...taskOrder, ...legacy])];
}

function buildPreparedRequest(messages, settings = {}, memoryContext = '', options = {}) {
  if (options.prepared) {
    return { messages, settings, memoryContext };
  }

  const context = prepareConversation(messages, {
    userId: options.userId,
    conversationId: options.conversationId
  });
  const summaryContext = context.summary
    ? `[RESUMO RELEVANTE DE MENSAGENS ANTIGAS DESTA CONVERSA]\n${context.summary}`
    : '';
  return {
    messages: context.messages,
    settings: {
      ...settings,
      taskIntent: context.intent,
      taskComplexity: context.complexity
    },
    memoryContext: [memoryContext, summaryContext].filter(Boolean).join('\n\n')
  };
}

async function runProviderChain({ providers, calls, preferred, messages, settings, memoryContext, record = true }) {
  let lastError = null;
  for (const provider of providers) {
    const startedAt = Date.now();
    try {
      const reply = sanitizeFinalReply(await calls[provider](messages, settings, memoryContext), settings);
      if (!reply) throw new Error('O provedor retornou uma resposta vazia.');
      if (record) recordProviderSuccess(provider, preferred, Date.now() - startedAt);
      return { reply, provider };
    } catch (error) {
      lastError = error;
      if (record) {
        recordProviderFailure(provider, error);
        logger.warn('Provedor de IA falhou; tentando alternativa.', {
          provider,
          error: safeProviderMessage(error?.message)
        });
      }
    }
  }
  if (lastError) throw lastError;
  throw new Error('Nenhum provedor de IA configurado está disponível.');
}

async function reviseLowQualityResponse({
  result,
  candidates,
  calls,
  preferred,
  messages,
  settings,
  memoryContext
}) {
  const assessment = assessResponseQuality(result.reply, settings, messages);
  if (!assessment.needsRevision) {
    return { ...result, qualityScore: assessment.score, revised: false };
  }

  const revisionProviders = [
    ...candidates.filter((provider) => provider !== result.provider),
    result.provider
  ].filter(Boolean);
  if (!revisionProviders.length) {
    return { ...result, qualityScore: assessment.score, revised: false };
  }

  try {
    const revisionSettings = buildRevisionSettings(settings, assessment, result.reply);
    const revised = await runProviderChain({
      providers: revisionProviders,
      calls,
      preferred,
      messages,
      settings: revisionSettings,
      memoryContext
    });
    const selected = chooseBetterResponse(result.reply, revised.reply, settings, messages);
    const usedRevision = selected.text === assessResponseQuality(revised.reply, settings, messages).text;
    logger.info('Revisão seletiva de qualidade concluída.', {
      originalProvider: result.provider,
      revisionProvider: revised.provider,
      originalScore: assessment.score,
      finalScore: selected.score,
      revised: usedRevision
    });
    return usedRevision
      ? { ...revised, reply: selected.text, qualityScore: selected.score, revised: true }
      : { ...result, reply: selected.text, qualityScore: selected.score, revised: false };
  } catch (error) {
    logger.warn('Revisão de qualidade falhou sem interromper o chat.', {
      error: safeProviderMessage(error?.message)
    });
    return { ...result, qualityScore: assessment.score, revised: false };
  }
}

async function askAssistant(messages, settings = {}, memoryContext = '', options = {}) {
  const prepared = buildPreparedRequest(messages, settings, memoryContext, options);
  messages = prepared.messages;
  settings = prepared.settings;
  memoryContext = prepared.memoryContext;
  const instantReply = getInstantReply(messages, settings);
  if (instantReply) return instantReply;
  const preferred = getPreferredProvider();
  const providers = getProviderOrder(preferred, settings.isDiscord, settings.taskIntent, settings.taskComplexity);

  const calls = {
    gemini: askGemini,
    openrouter: askOpenRouter,
    groq: askGroq,
    nvidia: askNvidia,
    deepseek: askDeepSeek,
    mistral: askMistral,
    cerebras: askCerebras,
    together: askTogether
  };

  const configuredProviders = providers.filter((provider) => {
    const envKey = providerKeys[provider];
    return envKey && process.env[envKey];
  });
  const readyProviders = configuredProviders.filter((provider) => {
    const health = providerHealth.get(provider);
    return !health?.retryAt || health.retryAt <= Date.now();
  });

  // Se todos estiverem no período de espera, tentamos novamente o primeiro.
  // Isso evita deixar a Alya travada quando há apenas um provedor configurado.
  const candidates = readyProviders.length ? readyProviders : configuredProviders.slice(0, 1);
  let result = await runProviderChain({
    providers: candidates,
    calls,
    preferred,
    messages,
    settings,
    memoryContext
  });
  if (requiresBufferedReview(settings)) {
    result = await reviseLowQualityResponse({
      result,
      candidates,
      calls,
      preferred,
      messages,
      settings,
      memoryContext
    });
  }
  logger.info('Resposta de IA concluída.', {
    provider: result.provider,
    intent: settings.taskIntent,
    complexity: settings.taskComplexity,
    qualityScore: result.qualityScore,
    revised: Boolean(result.revised)
  });
  return result.reply;
}

async function askAssistantStream(messages, settings = {}, res, memoryContext = '', options = {}) {
  const prepared = buildPreparedRequest(messages, settings, memoryContext, options);
  messages = prepared.messages;
  settings = prepared.settings;
  memoryContext = prepared.memoryContext;
  const instantReply = getInstantReply(messages, settings);
  if (instantReply) {
    startTextStream(res);
    res.end(instantReply);
    return;
  }
  if (requiresBufferedReview(settings)) {
    try {
      const reply = await askAssistant(messages, settings, memoryContext, { prepared: true });
      startTextStream(res);
      res.end(reply);
    } catch (error) {
      logger.error('Resposta revisada em stream falhou:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Erro ao conectar com a API de IA.' }));
      } else if (!res.writableEnded) {
        res.end();
      }
    }
    return;
  }
  const preferred = getPreferredProvider();
  const providers = getProviderOrder(preferred, settings.isDiscord, settings.taskIntent, settings.taskComplexity);
  const streamCalls = {
    openrouter: askOpenRouterStream,
    gemini: askGeminiStream
  };
  const configuredProviders = providers.filter((provider) => {
    const envKey = providerKeys[provider];
    return envKey && process.env[envKey];
  });
  const readyProviders = configuredProviders.filter((provider) => {
    const health = providerHealth.get(provider);
    return !health?.retryAt || health.retryAt <= Date.now();
  });

  try {
    for (const provider of (readyProviders.length ? readyProviders : configuredProviders.slice(0, 1))) {
      const startedAt = Date.now();
      try {
        const streamCall = streamCalls[provider];
        if (streamCall) {
          await streamCall(messages, settings, res, memoryContext);
        } else {
          await askCompatibleProviderStream(provider, messages, settings, res, memoryContext);
        }
        recordProviderSuccess(provider, preferred, Date.now() - startedAt);
        return;
      } catch (error) {
        recordProviderFailure(provider, error);
        logger.warn(`Stream do provedor ${provider} falhou:`, error.message);
        if (res.headersSent) {
          if (!res.writableEnded) res.end();
          return;
        }
      }
    }

    const reply = await askAssistant(messages, settings, memoryContext, { prepared: true });
    if (!res.headersSent) startTextStream(res);
    res.write(reply || 'Olá! Como posso te ajudar hoje?');
    res.end();
  } catch (error) {
    logger.error('Stream error:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Erro ao conectar com a API de IA.' }));
    } else {
      res.end('\nErro ao conectar com a API de IA.');
    }
  }
}

function normalizeSettings(settings) {
  return {
    personality: settings?.personality || 'jarvis',
    mode: settings?.mode || 'normal',
    memory: String(settings?.memory || '').slice(0, 2000).trim(),
    devMode: Boolean(settings?.devMode)
  };
}

module.exports = {
  askAssistant,
  askAssistantStream,
  normalizeSettings,
  assistantIdentity,
  sanitizeFinalReply,
  getProviderStatus,
  setPreferredProvider,
  getProviderOrder,
  getModelForTask,
  runProviderChain,
  safeProviderMessage,
  getInstantReply,
  getRequestTimeout,
  reviseLowQualityResponse
};
