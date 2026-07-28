const readline = require('readline');
const bcrypt = require('bcryptjs');
const { loadLocalEnv } = require('../lib/utils');
const store = require('../lib/persistentStore');
const {
  SALT_ROUNDS,
  MIN_PASSWORD_LENGTH,
  createUser,
  normalizeUsername
} = require('../lib/users');

loadLocalEnv();

function readVisible(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

function readHidden(prompt) {
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
  const args = process.argv.slice(2);
  const role = args.includes('--admin') ? 'admin' : 'user';
  const renderMode = args.includes('--render');
  const namedArgument = args.find((arg) => !arg.startsWith('--'));
  const username = normalizeUsername(namedArgument || await readVisible('Usuário: '));
  const password = await readHidden('Senha (não será exibida): ');
  const confirmation = process.env.ALYA_CLI_PASSWORD
    ? password
    : await readHidden('Confirme a senha: ');

  if (password !== confirmation) throw new Error('As senhas não são iguais.');
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }

  await store.init();
  const result = await createUser(username, password, { role });
  if (!result.ok) throw new Error(result.error);
  await store.flush();
  process.stdout.write(`Conta ${role === 'admin' ? 'administradora' : 'de usuário'} criada: ${result.user.username}\n`);

  if (renderMode && role === 'admin') {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    process.stdout.write('\nCopie estas duas variáveis para o Render:\n');
    process.stdout.write(`ADMIN_USERNAME=${result.user.username}\n`);
    process.stdout.write(`ADMIN_PASSWORD_HASH=${hash}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message || 'Não foi possível criar a conta.'}\n`);
  process.exitCode = 1;
});
