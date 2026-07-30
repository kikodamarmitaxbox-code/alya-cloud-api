'use strict';

const crypto = require('crypto');

const IMAGE_COMMAND = /\b(?:cria|crie|criar|faz|faça|fazer|gera|gere|gerar|desenha|desenhe|desenhar|tira|tire|tirar|manda|mande|mandar|envia|envie|enviar|mostra|mostre|mostrar|produz|produza|produzir)\b/i;
const IMAGE_NOUN = /\b(?:imagem|imagens|foto|fotos|avatar|banner|arte|desenho|ilustração|ilustracao|pôster|poster|capa|papel de parede|wallpaper|logo|logotipo|ícone|icone|figurinha|meme|gráfico|grafico|infográfico|infografico|diagrama|mapa|card|thumbnail|miniatura|print)\b/i;
const NEGATED_COMMAND = /\b(?:não|nao)\s+(?:cria|crie|criar|faz|faça|fazer|gera|gere|gerar|manda|mande|mandar|envia|envie|enviar)\b/i;
const HOW_TO_QUESTION = /\b(?:como|onde)\s+(?:eu\s+)?(?:crio|criar|faço|faco|fazer|gero|gerar|mando|mandar)\b/i;

class ImageGenerationError extends Error {
  constructor(message, statusCode = 502, code = 'IMAGE_PROVIDER_ERROR') {
    super(message);
    this.name = 'ImageGenerationError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanImagePrompt(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

function isRealScreenshotRequest(text) {
  return /\b(?:print|captura)\b[\s\S]{0,35}\b(?:minha|desta|essa|da minha|do meu)\s+(?:tela|área de trabalho|area de trabalho|computador|pc)\b/i.test(text);
}

function inferImageOptions(text) {
  const normalized = cleanImagePrompt(text).toLowerCase();
  let type = 'personagem';
  if (/\b(?:banner|capa|wallpaper|papel de parede|paisagem|panorâmica|panoramica)\b/.test(normalized)) {
    type = 'banner';
  } else if (/\b(?:avatar|perfil|logo|logotipo|ícone|icone|figurinha|thumbnail|miniatura)\b/.test(normalized)) {
    type = 'avatar';
  }

  let style = 'cinematico';
  if (/\b(?:anime|mangá|manga|luffy|one piece|naruto|dragon ball)\b/.test(normalized)) style = 'anime';
  else if (/\b(?:realista|realística|realistica|fotografia|foto real|fotorrealista)\b/.test(normalized)) style = 'realista';
  else if (/\b(?:3d|render|pixar|jogo moderno)\b/.test(normalized)) style = '3d';

  return { type, style };
}

function parseImageRequest(value) {
  const text = cleanImagePrompt(value)
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/^(?:sofia|alya|alia)[,:\s-]*/i, '')
    .replace(/^(?:por favor|pfv|por gentileza)[,:\s-]*/i, '')
    .trim();

  if (
    !text ||
    !IMAGE_COMMAND.test(text) ||
    !IMAGE_NOUN.test(text) ||
    NEGATED_COMMAND.test(text) ||
    HOW_TO_QUESTION.test(text) ||
    isRealScreenshotRequest(text)
  ) {
    return null;
  }

  let prompt = text
    .replace(/^(?:eu\s+)?(?:quero|queria|gostaria)\s+(?:que\s+)?(?:você|voce|a sofia|a alya)?\s*/i, '')
    .replace(/^(?:me\s+)?(?:cria|crie|faz|faça|gera|gere|desenha|desenhe|tira|tire|manda|mande|envia|envie|mostra|mostre|produz|produza)\s*/i, '')
    .trim();

  if (!prompt || !IMAGE_NOUN.test(prompt)) prompt = text;
  const { type, style } = inferImageOptions(text);
  return { prompt: cleanImagePrompt(prompt), type, style };
}

function getFormat(type) {
  const formats = {
    avatar: {
      width: 1024,
      height: 1024,
      label: 'square composition with a strong centered subject, suitable for an avatar, icon, logo, card or social post'
    },
    banner: {
      width: 1344,
      height: 768,
      label: 'wide horizontal panoramic composition, suitable for a banner, cover or wallpaper'
    },
    personagem: {
      width: 768,
      height: 1344,
      label: 'detailed vertical composition with an expressive main subject and a well-designed background'
    }
  };
  return formats[type] || formats.personagem;
}

function buildProviderPrompt(request) {
  const prompt = cleanImagePrompt(request?.prompt);
  if (!prompt) throw new ImageGenerationError('Descreva a imagem que você quer criar.', 400, 'EMPTY_IMAGE_PROMPT');

  const format = getFormat(request.type);
  const styles = {
    anime: 'premium anime illustration, clean line art, vibrant colors, expressive lighting and professional finish',
    cinematico: 'cinematic professional artwork, dramatic lighting, balanced colors and polished details',
    realista: 'high quality realistic photography, natural textures, studio lighting and sharp focus',
    '3d': 'premium 3D artwork, detailed materials, studio lighting, depth and modern game-quality finish'
  };
  const style = styles[request.style] || styles.cinematico;
  const wantsText = /\b(?:texto|título|titulo|nome|frase|legenda|relatório|relatorio|gráfico|grafico|infográfico|infografico)\b/i.test(prompt);
  const textInstruction = wantsText
    ? 'If the request includes words or labels, keep them short, legible and written in Brazilian Portuguese.'
    : 'Do not add captions, logos, watermarks or random readable text.';

  return [
    prompt,
    `Create a ${format.label}.`,
    style,
    'High quality, polished details, coherent anatomy, balanced composition and a complete visible image.',
    textInstruction
  ].join(' ');
}

function detectImageMime(buffer, reportedType = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
  const type = String(reportedType || '').split(';')[0].trim().toLowerCase();
  if (type.startsWith('image/')) return type;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) return 'image/gif';
  return '';
}

function extensionForMime(mime) {
  return {
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/jpeg': 'jpg'
  }[mime] || 'img';
}

async function readImageResponse(response, fetchImpl = fetch) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const providerMessage = String(body?.error?.message || body?.error || '');
    if (response.status === 401) {
      throw new ImageGenerationError('A chave do gerador de imagens está ausente ou inválida.', 503, 'IMAGE_AUTH_ERROR');
    }
    if (response.status === 402) {
      throw new ImageGenerationError('O gerador de imagens está sem cota no momento.', 503, 'IMAGE_QUOTA_ERROR');
    }
    if (response.status === 429) {
      throw new ImageGenerationError('O gerador recebeu muitos pedidos. Tente novamente em instantes.', 429, 'IMAGE_RATE_LIMIT');
    }
    throw new ImageGenerationError(
      providerMessage ? 'O serviço de imagens recusou o pedido.' : 'O serviço de imagens está indisponível.',
      502
    );
  }

  const contentType = response.headers.get('content-type') || '';
  let buffer;
  let reportedType = contentType;

  if (contentType.includes('application/json')) {
    const data = await response.json().catch(() => ({}));
    const item = data?.data?.[0] || data;
    if (item?.b64_json) {
      buffer = Buffer.from(String(item.b64_json), 'base64');
    } else if (item?.url) {
      const mediaResponse = await fetchImpl(item.url, { signal: AbortSignal.timeout(30000) });
      if (!mediaResponse.ok) throw new ImageGenerationError('A imagem foi criada, mas não pôde ser baixada.');
      reportedType = mediaResponse.headers.get('content-type') || '';
      buffer = Buffer.from(await mediaResponse.arrayBuffer());
    }
  } else {
    buffer = Buffer.from(await response.arrayBuffer());
  }

  if (!buffer?.length) throw new ImageGenerationError('O gerador não devolveu um arquivo de imagem válido.');
  if (buffer.length > 8 * 1024 * 1024) throw new ImageGenerationError('A imagem gerada ficou grande demais para enviar.');
  const mime = detectImageMime(buffer, reportedType);
  if (!mime) throw new ImageGenerationError('O gerador devolveu um arquivo que não é uma imagem.');
  return { buffer, mime, extension: extensionForMime(mime) };
}

async function generateImage(request, options = {}) {
  const pollinationsKey = String(options.apiKey || process.env.POLLINATIONS_API_KEY || '').trim();
  const togetherKey = String(options.togetherApiKey || process.env.TOGETHER_API_KEY || '').trim();
  if (!pollinationsKey && !togetherKey) {
    throw new ImageGenerationError(
      'O gerador de imagens precisa de POLLINATIONS_API_KEY ou TOGETHER_API_KEY.',
      503,
      'IMAGE_NOT_CONFIGURED'
    );
  }

  const format = getFormat(request?.type);
  const providerPrompt = buildProviderPrompt(request);
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Math.max(10000, Number(options.timeoutMs || process.env.IMAGE_GENERATION_TIMEOUT_MS) || 90000);
  const preferredProvider = String(options.provider || process.env.IMAGE_PROVIDER || '').trim().toLowerCase();
  const providers = [
    pollinationsKey ? {
      name: 'pollinations',
      key: pollinationsKey,
      model: String(options.model || process.env.POLLINATIONS_IMAGE_MODEL || 'flux').trim() || 'flux'
    } : null,
    togetherKey ? {
      name: 'together',
      key: togetherKey,
      model: String(options.togetherModel || process.env.TOGETHER_IMAGE_MODEL || 'black-forest-labs/FLUX.1-schnell-Free').trim()
    } : null
  ].filter(Boolean).sort((a, b) => {
    if (a.name === preferredProvider) return -1;
    if (b.name === preferredProvider) return 1;
    return 0;
  });

  let lastError = null;
  for (const provider of providers) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const endpoint = provider.name === 'together'
        ? 'https://api.together.xyz/v1/images/generations'
        : 'https://gen.pollinations.ai/v1/images/generations';
      const body = provider.name === 'together'
        ? {
            prompt: providerPrompt,
            model: provider.model,
            n: 1,
            width: format.width,
            height: format.height,
            steps: 4,
            response_format: 'base64',
            output_format: 'jpeg',
            negative_prompt: 'blurry, low quality, distorted, pixelated, watermark, random text'
          }
        : {
            prompt: providerPrompt,
            model: provider.model,
            n: 1,
            size: `${format.width}x${format.height}`,
            quality: 'high',
            response_format: 'b64_json',
            safe: true,
            user: crypto.createHash('sha256').update(String(options.userId || 'sofia')).digest('hex').slice(0, 32)
          };
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const image = await readImageResponse(response, fetchImpl);
      return {
        ...image,
        provider: provider.name,
        model: provider.model,
        prompt: cleanImagePrompt(request.prompt),
        type: request.type || 'personagem',
        style: request.style || 'cinematico'
      };
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        lastError = new ImageGenerationError('A imagem demorou demais. Tente novamente.', 504, 'IMAGE_TIMEOUT');
      } else if (!(error instanceof ImageGenerationError)) {
        lastError = new ImageGenerationError('O gerador de imagens está indisponível agora. Tente novamente em alguns minutos.');
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new ImageGenerationError('O gerador de imagens está indisponível agora.');
}

module.exports = {
  ImageGenerationError,
  parseImageRequest,
  inferImageOptions,
  buildProviderPrompt,
  detectImageMime,
  extensionForMime,
  generateImage,
  isRealScreenshotRequest
};
