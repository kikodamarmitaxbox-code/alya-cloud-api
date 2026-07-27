const logger = require('./logger');

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

function recordProviderSuccess(provider, preferred) {
  providerHealth.set(provider, { ok: true, failures: 0, retryAt: 0, lastError: '', updatedAt: new Date().toISOString() });
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
  const retryDelay = Math.min(300000, 15000 * (2 ** Math.min(failures - 1, 4)));
  providerHealth.set(provider, {
    ok: false,
    failures,
    retryAt: Date.now() + retryDelay,
    lastError: safeProviderMessage(error?.message || error),
    updatedAt: new Date().toISOString()
  });
}

function getProviderStatus() {
  const preferred = (process.env.AI_PROVIDER || 'openrouter').toLowerCase();
  const providers = Object.entries(providerKeys).map(([name, envKey]) => {
    const health = providerHealth.get(name) || {};
    return {
      name,
      configured: Boolean(process.env[envKey]),
      ok: health.ok ?? null,
      failures: health.failures || 0,
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

async function askOpenRouter(messages, settings, memoryContext = '') {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('Coloque sua chave OPENROUTER_API_KEY no arquivo .env.');
  }

  const models = getOpenRouterModels();

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
          temperature: 0.7,
          max_tokens: Number(process.env.MAX_TOKENS || 600)
        }),
        signal: AbortSignal.timeout(12000)
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
      logger.warn(`Modelo ${model} no OpenRouter falhou: ${err.message}`);
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

  const models = getOpenRouterModels();

  const systemContent = assistantIdentity(settings, memoryContext);

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
          temperature: 0.7,
          max_tokens: Number(process.env.MAX_TOKENS || 600),
          stream: true
        }),
        signal: AbortSignal.timeout(12000)
      });

      if (response.ok) {
        startTextStream(res);
        const hasText = await pipeSseText(response, res, (data) => data.choices?.[0]?.delta?.content || '');
        if (hasText) return;
      }
    } catch (err) {
      logger.warn(`Modelo ${model} no stream OpenRouter falhou: ${err.message}`);
    }
  }

  // Fallback não-stream se streaming falhar ou vier vazio
  const reply = await askAssistant(messages, settings, memoryContext);
  if (!res.headersSent) {
    startTextStream(res);
  }
  res.write(reply || 'Olá! Como posso te ajudar hoje?');
  res.end();
}

function getOpenRouterModels() {
  const mainModel = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free';
  // A Alya tenta primeiro o modelo escolhido. Só se ele estiver indisponível,
  // usa o roteador gratuito do OpenRouter como plano B.
  return [...new Set([mainModel, 'openrouter/free'])];
}

async function askGemini(messages, settings, memoryContext = '') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Coloque sua chave GEMINI_API_KEY no arquivo .env.');
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
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
        temperature: 0.7,
        maxOutputTokens: Number(process.env.MAX_TOKENS || 600)
      }
    })
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

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`, {
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
        temperature: 0.7,
        maxOutputTokens: Number(process.env.MAX_TOKENS || 600)
      }
    })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = safeProviderMessage(data.error?.message);
    logger.error('Gemini stream error:', { status: response.status, message });
    throw new Error(message);
  }

  startTextStream(res);
  const hasText = await pipeSseText(response, res, (data) => {
    const parts = data.candidates?.[0]?.content?.parts || [];
    return parts.map((part) => part.text || '').join('');
  });
  if (!hasText) {
    const reply = await askGemini(messages, settings, memoryContext);
    res.write(reply || 'Olá! Como posso te ajudar hoje?');
    res.end();
  }
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
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: assistantIdentity(settings, memoryContext) },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: Number(process.env.MAX_TOKENS || 600)
    }),
    signal: AbortSignal.timeout(15000)
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
      model: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b',
      messages: [
        { role: 'system', content: assistantIdentity(settings, memoryContext) },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: Number(process.env.MAX_TOKENS || 600)
    }),
    signal: AbortSignal.timeout(15000)
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
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: assistantIdentity(settings, memoryContext) },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: Number(process.env.MAX_TOKENS || 600)
    }),
    signal: AbortSignal.timeout(15000)
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
      model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
      messages: [
        { role: 'system', content: assistantIdentity(settings, memoryContext) },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: Number(process.env.MAX_TOKENS || 600)
    }),
    signal: AbortSignal.timeout(15000)
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
      model: process.env.CEREBRAS_MODEL || 'gpt-oss-120b',
      messages: [
        { role: 'system', content: assistantIdentity(settings, memoryContext) },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: Number(process.env.MAX_TOKENS || 600)
    }),
    signal: AbortSignal.timeout(15000)
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
      model: process.env.TOGETHER_MODEL || 'Qwen/Qwen3.5-9B',
      messages: [
        { role: 'system', content: assistantIdentity(settings, memoryContext) },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: Number(process.env.MAX_TOKENS || 600)
    }),
    signal: AbortSignal.timeout(15000)
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

function startTextStream(res) {
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.statusCode = 200;
  }
}

async function pipeSseText(response, res, pickText) {
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

function assistantIdentity(settings = {}, memoryContext = '') {
  const isDiscord = Boolean(settings.isDiscord);
  const personality = (settings.personality || '').toLowerCase();

  let personalityPrompt = 'Converse de forma amigável, clara, inteligente e prestativa.';

  if (isDiscord || personality === 'discord_miyauchi') {
    personalityPrompt = 'Você está no chat do Discord com os amigos. Fale de forma totalmente informal, engraçada, debochada, sincera e jovem, usando gírias leves (como "mano", "mn", "kkk", "tá doido", "qual foi", "véi"), mantendo o papo reto, curto, direto e com humor irônico de comunidade do Discord.';
  } else if (personality === 'amiga') {
    personalityPrompt = 'Fale como uma amiga muito próxima, carinhosa e atenciosa.';
  } else if (personality === 'tecnica') {
    personalityPrompt = 'Fale de forma técnica, precisa, estruturada e objetiva.';
  } else if (personality === 'deboche' || personality === 'zueira') {
    personalityPrompt = 'Fale com tom irônico, debochado e engraçado.';
  }

  const identity = [
    'Seu nome é Alya.',
    'NUNCA mencione nomes de criadores. NUNCA fale de forma robótica ("como um modelo de linguagem", "sou uma inteligência artificial"). Fale como uma pessoa real.',
    personalityPrompt,
    'NUNCA narre seus pensamentos internos ("Okay, the user is asking..."). Nunca escreva planejamento, análise, passos mentais ou texto em inglês antes da resposta. Dê apenas a resposta final em Português do Brasil.',
    'Se houver informações pesquisadas na internet no contexto, use-as naturalmente no papo.'
  ];

  if (settings.rivalMode) {
    identity.push('Você está respondendo a outra IA que provocou você. Seja séria, firme e curta. Defenda-se com confiança, coloque limites e encerre a discussão sem piadas. Não use ofensas, ameaças, palavrões, ataques pessoais, spam ou provocações repetidas.');
  }

  if (memoryContext) {
    identity.push(`\n${memoryContext}`);
  }

  return identity.join(' ');
}

function sanitizeFinalReply(reply, settings = {}) {
  let text = String(reply || '').trim();
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

async function askAssistant(messages, settings, memoryContext = '') {
  const preferred = (process.env.AI_PROVIDER || 'openrouter').toLowerCase();
  // No Discord priorizamos modelos que respondem direto, sem exibir raciocínio.
  const providers = settings.isDiscord
    ? ['mistral', 'nvidia', 'groq', 'openrouter', 'gemini', 'deepseek', 'cerebras', 'together']
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

  let lastError = null;

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
  for (const provider of (readyProviders.length ? readyProviders : configuredProviders.slice(0, 1))) {

    try {
      const reply = sanitizeFinalReply(await calls[provider](messages, settings, memoryContext), settings);
      recordProviderSuccess(provider, preferred);
      return reply;
    } catch (error) {
      lastError = error;
      recordProviderFailure(provider, error);
      logger.warn(`Provider ${provider} falhou:`, error.message);
    }
  }

  if (lastError) throw lastError;
  throw new Error('Configure OPENROUTER_API_KEY ou GEMINI_API_KEY no arquivo .env.');
}

async function askAssistantStream(messages, settings, res, memoryContext = '') {
  try {
    const reply = await askAssistant(messages, settings, memoryContext);
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
  getProviderStatus
};
