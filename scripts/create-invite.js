'use strict';

const readline = require('readline');
const { loadLocalEnv } = require('../lib/utils');
const store = require('../lib/persistentStore');
const { createInvitation } = require('../lib/invitations');

loadLocalEnv();

function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

async function main() {
  const username = process.argv[2] || await ask('Usuário do amigo: ');
  await store.init();
  const result = createInvitation(username);
  if (!result.ok) throw new Error(result.error);
  await store.flush();

  process.stdout.write(`\nConvite criado para ${result.username}.\n`);
  process.stdout.write(`Código: ${result.code}\n`);
  process.stdout.write(`Válido até: ${new Date(result.expiresAt).toLocaleString('pt-BR')}\n`);
  process.stdout.write('Envie somente esse código para a pessoa cadastrada.\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message || 'Não foi possível criar o convite.'}\n`);
  process.exitCode = 1;
});
