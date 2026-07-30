'use strict';

const assert = require('assert');
const {
  ImageGenerationError,
  parseImageRequest,
  buildProviderPrompt,
  detectImageMime,
  generateImage
} = require('../lib/imageGeneration');

function fakePng() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32, 1)
  ]);
}

async function testIntentRecognition() {
  assert.deepStrictEqual(
    parseImageRequest('Sofia, crie uma foto do Luffy em anime'),
    {
      prompt: 'uma foto do Luffy em anime',
      type: 'personagem',
      style: 'anime'
    }
  );
  assert.deepStrictEqual(
    parseImageRequest('Faça um relatório de vendas e mande como gráfico'),
    {
      prompt: 'um relatório de vendas e mande como gráfico',
      type: 'personagem',
      style: 'cinematico'
    }
  );
  assert.strictEqual(parseImageRequest('Como criar uma imagem no computador?'), null);
  assert.strictEqual(parseImageRequest('Não crie uma imagem agora'), null);
  assert.strictEqual(parseImageRequest('Tire um print da minha tela e mande no global'), null);
}

async function testRealImageValidation() {
  const png = fakePng();
  assert.strictEqual(detectImageMime(png), 'image/png');
  assert.match(
    buildProviderPrompt({
      prompt: 'um gráfico de vendas com o título Resultado',
      type: 'banner',
      style: 'realista'
    }),
    /Brazilian Portuguese/i
  );

  let requestBody;
  let authorization;
  const generated = await generateImage({
    prompt: 'uma cidade futurista',
    type: 'banner',
    style: 'cinematico'
  }, {
    apiKey: 'test-key-not-real',
    userId: 'image-test',
    fetchImpl: async (_url, init) => {
      authorization = init.headers.Authorization;
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        data: [{ b64_json: png.toString('base64') }]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  assert.strictEqual(authorization, 'Bearer test-key-not-real');
  assert.strictEqual(requestBody.response_format, 'b64_json');
  assert.strictEqual(requestBody.size, '1344x768');
  assert.strictEqual(generated.mime, 'image/png');
  assert.strictEqual(generated.extension, 'png');
  assert.ok(generated.buffer.equals(png));
}

async function testTogetherFallback() {
  const png = fakePng();
  let endpoint = '';
  let body;
  const generated = await generateImage({
    prompt: 'um robô brasileiro simpático',
    type: 'avatar',
    style: '3d'
  }, {
    togetherApiKey: 'together-test-key',
    fetchImpl: async (url, init) => {
      endpoint = url;
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        data: [{ b64_json: png.toString('base64') }]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });
  assert.match(endpoint, /api\.together\.xyz\/v1\/images\/generations/);
  assert.strictEqual(body.model, 'black-forest-labs/FLUX.1-schnell-Free');
  assert.strictEqual(body.response_format, 'base64');
  assert.strictEqual(generated.provider, 'together');
  assert.strictEqual(generated.mime, 'image/png');
}

async function testFriendlyProviderErrors() {
  await assert.rejects(
    generateImage({
      prompt: 'uma imagem de teste',
      type: 'avatar',
      style: '3d'
    }, {
      apiKey: 'test-key-not-real',
      fetchImpl: async () => new Response(JSON.stringify({ error: 'balance exhausted' }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' }
      })
    }),
    (error) => (
      error instanceof ImageGenerationError &&
      error.code === 'IMAGE_QUOTA_ERROR' &&
      /sem cota/i.test(error.message)
    )
  );
}

(async () => {
  await testIntentRecognition();
  await testRealImageValidation();
  await testTogetherFallback();
  await testFriendlyProviderErrors();
  console.log('Teste de imagens concluído: pedidos, arquivos reais e falhas estão protegidos.');
})().catch((error) => {
  console.error(`Teste de imagens falhou: ${error.message}`);
  process.exitCode = 1;
});
