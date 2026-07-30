'use strict';

const assert = require('assert');

process.env.ALYA_DEVICE_SECRET = 'teste-seguro-para-a-ponte-local-1234567890';
process.env.DISCORD_SCREENSHOT_CHANNELS = 'global:123456789012345678,privado:987654321098765432';
process.env.DISCORD_ENABLED = 'false';

const store = require('../lib/persistentStore');
const deviceBridge = require('../lib/deviceBridge');
const computerControl = require('../lib/computerControl');
const { DiscordManager } = require('../lib/discord');

async function main() {
  await store.init();

  assert.strictEqual(
    computerControl.screenshotDestination('Sofia, tira uma print da tela e mande no global'),
    'global'
  );
  const proposal = computerControl.createProposal(
    'Sofia, tira uma print da minha tela e mande no global',
    { screenshotOnly: true }
  );
  assert.strictEqual(proposal.ok, true);
  const action = computerControl.executeProposal(proposal.approvalId, { allowLocalActions: false });
  assert.strictEqual(action.action, 'screenshot');
  assert.strictEqual(action.destination, 'global');

  const blocked = computerControl.createProposal('abra a calculadora', { screenshotOnly: true });
  assert.strictEqual(blocked.ok, false);

  const validRequest = { headers: { authorization: `Bearer ${process.env.ALYA_DEVICE_SECRET}` } };
  const invalidRequest = { headers: { authorization: 'Bearer errado' } };
  assert.strictEqual(deviceBridge.authenticateDevice(validRequest), true);
  assert.strictEqual(deviceBridge.authenticateDevice(invalidRequest), false);

  const queued = deviceBridge.createScreenshotTask('global', 'admin');
  assert.strictEqual(queued.ok, true);
  const task = deviceBridge.claimNextTask('pc-teste');
  assert.strictEqual(task.id, queued.taskId);
  assert.strictEqual(deviceBridge.getClaimedTask(task.id, 'outro-pc'), null);
  assert.ok(deviceBridge.getClaimedTask(task.id, 'pc-teste'));
  assert.strictEqual(deviceBridge.completeTask(task.id, 'pc-teste', true), true);

  const discord = new DiscordManager({ storage: { init: async () => {} }, enabled: false });
  assert.strictEqual(discord.resolveScreenshotChannel('global'), '123456789012345678');
  assert.strictEqual(discord.resolveScreenshotChannel('desconhecido'), '');

  const privateDiscord = new DiscordManager({
    storage: { init: async () => {} },
    enabled: false,
    privateOwnerUsernames: 'pedrinn0198_'
  });
  const ownerDm = {
    author: { id: '111', username: 'pedrinn0198_', bot: false },
    guild: null,
    channel: { id: 'dm-owner' }
  };
  const otherDm = {
    author: { id: '222', username: 'outra_pessoa', bot: false },
    guild: null,
    channel: { id: 'dm-other' }
  };
  const guildMessage = {
    author: ownerDm.author,
    guild: { id: 'guild' },
    channel: { id: 'canal' },
    mentions: { has: () => false }
  };
  assert.strictEqual(privateDiscord._isAllowed(ownerDm), true);
  assert.strictEqual(privateDiscord._isAllowed(otherDm), false);
  assert.strictEqual(discord._isAllowed(ownerDm), true);
  assert.strictEqual(discord._isAllowed(otherDm), false);
  assert.strictEqual(privateDiscord._shouldRespond(ownerDm, 'oi, tudo bem?'), true);
  assert.strictEqual(privateDiscord._shouldRespond(guildMessage, 'oi, tudo bem?'), false);
  assert.strictEqual(privateDiscord._shouldRespond(guildMessage, 'Sofia, tudo bem?'), true);

  process.stdout.write('Ponte local verificada: aprovação, isolamento, segredo e destinos Discord seguros.\n');
}

main().catch((error) => {
  process.stderr.write(`Falha no teste da ponte local: ${error.message}\n`);
  process.exitCode = 1;
});
