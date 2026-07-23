const logger = require('./logger');

async function askOpenRouter(messages, settings, memoryContext = '') {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('Coloque sua chave OPENROUTER_API_KEY no arquivo .env.');
  }

  const systemContent = assistantIdentity(settings, memoryContext);
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Assistente IA Leve'
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'openrouter/free',
      messages: [
        { role: 'system', content: systemContent },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: Number(process.env.MAX_TOKENS || 500)
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    logger.error('OpenRouter API error:', data.error);
    throw new Error(data.error?.message || 'A API gratuita recusou a resposta agora. Tente de novo em alguns segundos.');
  }

  return data.choices?.[0]?.message?.content?.trim() || 'Nao recebi uma resposta da IA.';
}

async function askOpenRouterStream(messages, settings, res, memoryContext = '') {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('Coloque sua chave OPENROUTER_API_KEY no arquivo .env.');
  }

  const systemContent = assistantIdentity(settings, memoryContext);
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Assistente IA Leve'
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'openrouter/free',
      messages: [
        { role: 'system', content: systemContent },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: Number(process.env.MAX_TOKENS || 500),
      stream: true
    })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    logger.error('OpenRouter stream error:', data.error);
    throw new Error(data.error?.message || 'A API gratuita recusou a resposta agora. Tente de novo em alguns segundos.');
  }

  startTextStream(res);
  await pipeSseText(response, res, (data) => data.choices?.[0]?.delta?.content || '');
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
        maxOutputTokens: Number(process.env.MAX_TOKENS || 500)
      }
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    logger.error('Gemini API error:', data.error);
    throw new Error(data.error?.message || 'A API gratuita recusou a resposta agora. Tente de novo em alguns segundos.');
  }

  return data.candidates?.[0]?.content?.parts?.map((part) => part.text).join('').trim() || 'Nao recebi uma resposta da IA.';
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
        maxOutputTokens: Number(process.env.MAX_TOKENS || 500)
      }
    })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    logger.error('Gemini stream error:', data.error);
    throw new Error(data.error?.message || 'A API gratuita recusou a resposta agora. Tente de novo em alguns segundos.');
  }

  startTextStream(res);
  await pipeSseText(response, res, (data) => {
    const parts = data.candidates?.[0]?.content?.parts || [];
    return parts.map((part) => part.text || '').join('');
  });
}

function startTextStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
}

async function pipeSseText(response, res, pickText) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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
        if (text) res.write(text);
      } catch (error) {
        logger.debug('Stream fragment error:', error);
      }
    }
  }

  res.end();
}

function assistantIdentity(settings = {}, memoryContext = '') {
  const personalityText = {
    equilibrada: 'Personalidade: equilibrada, clara, simpatica e objetiva.',
    direta: 'Personalidade: direta, rapida, pratica e sem enrolacao.',
    amiga: 'Personalidade: acolhedora, leve, encorajadora e natural.',
    tecnica: 'Personalidade: tecnica, precisa, organizada e boa para explicar passos.',
    jarvis: 'Personalidade: futurista, inteligente, proativa e elegante, como uma assistente pessoal de alta tecnologia.'
  }[settings.personality || 'jarvis'];

  const modeText = {
    normal: 'Modo atual: normal. Responda de forma equilibrada e util.',
    estudo: 'Modo atual: estudo. Explique passo a passo, use exemplos simples e ajude o usuario a aprender.',
    criativo: 'Modo atual: criativo. Gere ideias variadas, nomes, textos, historias e alternativas.',
    codigo: 'Modo atual: codigo. Ajude com programacao, erros, estrutura de projetos e passos praticos.',
    rapido: 'Modo atual: rapido. Seja curto, direto e entregue a resposta essencial primeiro.'
  }[settings.mode || 'normal'];

  const identity = [
    'Voce e um assistente pessoal chamado Astra.',
    'Fale em portugues do Brasil, com clareza, simpatia e objetividade.',
    personalityText,
    modeText,
    'Ajude com organizacao, estudos, ideias, textos e pequenas decisoes do dia a dia.',
    'Responda primeiro o essencial e evite textos longos quando o usuario nao pedir detalhes.',
    'Quando algo for incerto, diga isso de forma simples.',
    'Nao finja ter feito acoes no computador; explique o proximo passo quando precisar.'
  ];

  if (settings.devMode) {
    identity.push(
      'Modo Dev esta ativo.',
      'Nesse modo, ajude o usuario a configurar e melhorar a propria Astra.',
      'Voce pode propor ajustes de personalidade, memoria e comportamento.',
      'Quando o usuario pedir para voce se configurar, voce pode aplicar configuracoes seguras usando uma unica linha no final da resposta no formato [[NOVA_CONFIG:{\"personality\":\"jarvis\",\"memoryAppend\":\"texto\"}]].',
      'Quando o usuario pedir para voce mexer nos arquivos dela, use tambem uma unica linha no formato [[NOVA_PROFILE_FILE:{\"personality\":\"jarvis\",\"memoryAppend\":\"texto\",\"reason\":\"motivo curto\"}]].',
      'Use apenas as chaves personality, memoryAppend ou memoryReplace.',
      'Valores validos para personality: equilibrada, direta, amiga, tecnica, jarvis.',
      'O arquivo permitido e apenas nova-data/profile.json, e o app vai pedir aprovacao do usuario antes de gravar.',
      'Nao coloque chaves de API, senhas ou dados sensiveis na memoria.',
      'Nao prometa alterar arquivos, instalar programas ou executar comandos pelo usuario.'
    );
  }

  if (settings.memory) {
    identity.push(`Memoria salva pelo usuario: ${settings.memory}`);
    identity.push('Use essa memoria para personalizar respostas, sem repetir a memoria inteira sem necessidade.');
  }

  if (memoryContext) {
    identity.push(`Contexto de memoria permanente:`);
    identity.push(memoryContext);
  }

  return identity.join(' ');
}

async function askAssistant(messages, settings, memoryContext = '') {
  const provider = (process.env.AI_PROVIDER || 'openrouter').toLowerCase();

  if (provider === 'gemini') {
    return askGemini(messages, settings, memoryContext);
  }

  return askOpenRouter(messages, settings, memoryContext);
}

async function askAssistantStream(messages, settings, res, memoryContext = '') {
  const provider = (process.env.AI_PROVIDER || 'openrouter').toLowerCase();

  try {
    if (provider === 'gemini') {
      await askGeminiStream(messages, settings, res, memoryContext);
      return;
    }

    await askOpenRouterStream(messages, settings, res, memoryContext);
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
  const allowedPersonalities = new Set(['equilibrada', 'direta', 'amiga', 'tecnica', 'jarvis']);
  const allowedModes = new Set(['normal', 'estudo', 'criativo', 'codigo', 'rapido']);
  const personality = allowedPersonalities.has(settings?.personality)
    ? settings.personality
    : 'jarvis';
  const mode = allowedModes.has(settings?.mode)
    ? settings.mode
    : 'normal';
  const memory = String(settings?.memory || '').slice(0, 2000).trim();
  const devMode = Boolean(settings?.devMode);

  return { personality, mode, memory, devMode };
}

module.exports = {
  askAssistant,
  askAssistantStream,
  normalizeSettings,
  assistantIdentity
};
