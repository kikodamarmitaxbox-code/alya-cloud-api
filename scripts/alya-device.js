'use strict';

const os = require('os');
const { loadLocalEnv } = require('../lib/utils');
const { captureScreenshot } = require('../lib/computerControl');

loadLocalEnv();

function normalizeServerUrl(value) {
  const url = new URL(String(value || 'http://localhost:3000'));
  url.pathname = url.pathname.replace(/\/aly\/?$/i, '').replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/+$/, '');
}

const serverUrl = normalizeServerUrl(process.env.ALYA_DEVICE_URL || 'http://localhost:3000');
const secret = String(process.env.ALYA_DEVICE_SECRET || '');
const deviceId = String(process.env.ALYA_DEVICE_ID || os.hostname() || 'windows-pc')
  .replace(/[^a-zA-Z0-9_-]/g, '')
  .slice(0, 64);
let stopped = false;

function headers(extra = {}) {
  return {
    Authorization: `Bearer ${secret}`,
    ...extra
  };
}

async function requestTask() {
  const response = await fetch(
    `${serverUrl}/api/device/tasks?deviceId=${encodeURIComponent(deviceId)}`,
    { headers: headers(), signal: AbortSignal.timeout(20000) }
  );
  if (response.status === 401) throw new Error('Segredo da ponte local recusado pelo servidor.');
  if (!response.ok) throw new Error(`Servidor respondeu ${response.status}.`);
  return response.json();
}

async function returnResult(task, result) {
  const response = await fetch(`${serverUrl}/api/device/result`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      taskId: task.id,
      deviceId,
      ok: result.ok,
      image: result.image || '',
      error: result.error || ''
    }),
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Não foi possível devolver a captura (${response.status}).`);
  }
  return data;
}

async function processTask(task) {
  if (task.type !== 'screenshot') {
    await returnResult(task, { ok: false, error: 'Ação não permitida pela ponte local.' });
    return;
  }
  try {
    process.stdout.write(`Capturando a tela para o Discord “${task.destination}”...\n`);
    const image = await captureScreenshot();
    const response = await returnResult(task, { ok: true, image: image.toString('base64') });
    process.stdout.write(`${response.message || 'Captura enviada.'}\n`);
  } catch (error) {
    await returnResult(task, { ok: false, error: error.message }).catch(() => {});
    process.stderr.write(`Falha na captura: ${error.message}\n`);
  }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('A ponte de captura precisa rodar no computador Windows.');
  if (secret.length < 32) throw new Error('ALYA_DEVICE_SECRET precisa ter no mínimo 32 caracteres.');
  process.stdout.write(`Ponte segura da Sofia conectando em ${serverUrl} como ${deviceId}.\n`);
  process.stdout.write('Deixe esta janela aberta para receber pedidos de captura.\n');

  while (!stopped) {
    try {
      const data = await requestTask();
      if (data.task) await processTask(data.task);
    } catch (error) {
      process.stderr.write(`Ponte aguardando: ${error.message}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
}

process.on('SIGINT', () => { stopped = true; });
process.on('SIGTERM', () => { stopped = true; });

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
