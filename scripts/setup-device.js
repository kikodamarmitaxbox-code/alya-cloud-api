'use strict';

const crypto = require('crypto');

const secret = crypto.randomBytes(40).toString('base64url');

process.stdout.write('Configuração segura da ponte local da Alya\n\n');
process.stdout.write('1. No Render, adicione:\n');
process.stdout.write(`ALYA_DEVICE_SECRET=${secret}\n\n`);
process.stdout.write('2. No arquivo .env deste computador, adicione o MESMO valor:\n');
process.stdout.write(`ALYA_DEVICE_SECRET=${secret}\n`);
process.stdout.write('ALYA_DEVICE_URL=https://alya-gnz7.onrender.com\n\n');
process.stdout.write('3. Se houver mais de um canal chamado global, adicione no Render:\n');
process.stdout.write('DISCORD_SCREENSHOT_CHANNELS=global:ID_DO_CANAL\n\n');
process.stdout.write('Não envie esse segredo para outras pessoas.\n');
