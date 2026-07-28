const readline = require('readline');
const { loadLocalEnv } = require('../lib/utils');
const store = require('../lib/persistentStore');
const {
  MIN_PASSWORD_LENGTH,
  changePassword,
  deleteUser,
  normalizeUsername,
  setUserBlocked
} = require('../lib/users');
const { deleteAllUserHistory } = require('../lib/history');
const memory = require('../lib/memory');
const userFiles = require('../lib/userFiles');

loadLocalEnv();

function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

function askHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve(String(process.env.ALYA_CLI_PASSWORD || ''));
  }
  return new Promise((resolve) => {
    let value = '';
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (character) => {
      if (character === '\u0003') process.exit(130);
      if (character === '\r' || character === '\n') {
        process.stdin.off('data', onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        resolve(value);
        return;
      }
      if (character === '\u0008' || character === '\u007f') {
        value = value.slice(0, -1);
        return;
      }
      if (character >= ' ') value += character;
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const action = process.argv[2];
  const username = normalizeUsername(process.argv[3] || await ask('Usuário: '));
  if (!username) throw new Error('Informe o usuário.');
  await store.init();

  if (action === 'password') {
    const password = await askHidden('Nova senha (não será exibida): ');
    const confirmation = process.env.ALYA_CLI_PASSWORD
      ? password
      : await askHidden('Confirme a nova senha: ');
    if (password !== confirmation) throw new Error('As senhas não são iguais.');
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    }
    const result = await changePassword(username, password);
    if (!result.ok) throw new Error(result.error);
    process.stdout.write(`Senha alterada para: ${username}\n`);
  } else if (action === 'block' || action === 'unblock') {
    const result = setUserBlocked(username, action === 'block');
    if (!result.ok) throw new Error(result.error);
    process.stdout.write(action === 'block' ? `Conta bloqueada: ${username}\n` : `Conta desbloqueada: ${username}\n`);
  } else if (action === 'delete') {
    const confirmation = process.env.ALYA_CLI_CONFIRM || await ask(`Digite APAGAR para remover ${username} e todos os dados: `);
    if (confirmation !== 'APAGAR') throw new Error('Operação cancelada.');
    const result = deleteUser(username);
    if (!result.ok) throw new Error(result.error);
    deleteAllUserHistory(username);
    memory.deleteAllUserMemory(username);
    userFiles.deleteAllUserFiles(username);
    process.stdout.write(`Conta e dados apagados: ${username}\n`);
  } else {
    throw new Error('Ação de conta inválida.');
  }

  await store.flush();
}

main().catch((error) => {
  process.stderr.write(`${error.message || 'Não foi possível atualizar a conta.'}\n`);
  process.exitCode = 1;
});
