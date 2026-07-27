const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const pending = new Map();
const workspace = path.join(__dirname, '..', 'nova-data', 'alya-files');
const programs = {
  calculadora: { label: 'Abrir a Calculadora', command: 'calc.exe', args: [] },
  bloco: { label: 'Abrir o Bloco de Notas', command: 'notepad.exe', args: [] },
  explorador: { label: 'Abrir o Explorador de Arquivos', command: 'explorer.exe', args: [] }
};
const blockedProgramWords = /^(cmd|prompt de comando|powershell|terminal|regedit|editor de registro|format|msconfig)$/i;

function findStartMenuShortcut(name) {
  const needle = name.toLowerCase().replace(/\.(exe|lnk)$/i, '').trim();
  if (!needle || blockedProgramWords.test(needle)) return null;
  const roots = [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ].filter(Boolean);
  const found = [];
  const visit = (dir) => {
    try {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) visit(full);
        if (item.isFile() && /\.lnk$/i.test(item.name)) found.push(full);
      }
    } catch {}
  };
  roots.forEach(visit);
  return found.find((file) => path.basename(file, '.lnk').toLowerCase() === needle)
    || found.find((file) => path.basename(file, '.lnk').toLowerCase().includes(needle));
}

function localOnly(req) {
  const address = req.socket?.remoteAddress || '';
  return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

function createProposal(request) {
  const text = String(request || '').trim();
  const lower = text.toLowerCase();
  let action = null;

  if (/calculadora/.test(lower)) action = { type: 'program', value: 'calculadora' };
  if (/bloco de notas|notepad/.test(lower)) action = { type: 'program', value: 'bloco' };
  if (/explorador|pasta|arquivos/.test(lower)) action = { type: 'program', value: 'explorador' };

  const url = text.match(/https?:\/\/[^\s]+/i)?.[0];
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') action = { type: 'website', value: parsed.href };
    } catch {}
  }

  const file = text.match(/(?:criar|faça|fazer) (?:um )?(?:arquivo|texto) (?:chamado |com nome )?([\w .-]{1,60})/i)?.[1]?.trim();
  if (file) action = { type: 'file', value: file.replace(/[<>:"/\\|?*]/g, '').replace(/\.+$/g, '') || 'novo-arquivo' };

  const appName = text.match(/^(?:abra|abrir|abre) (?:o |a )?(.{2,80})$/i)?.[1]?.trim();
  if (appName && !action) {
    const shortcut = findStartMenuShortcut(appName);
    if (shortcut) action = { type: 'shortcut', value: shortcut, name: path.basename(shortcut, '.lnk') };
    else return { ok: false, message: `Não achei “${appName}” entre os aplicativos instalados, ou ele não é permitido por segurança.` };
  }

  if (!action) return { ok: false, message: 'Posso abrir a Calculadora, Bloco de Notas, Explorador, um site com link ou criar um arquivo vazio. Escreva uma dessas ações.' };

  const id = crypto.randomBytes(18).toString('hex');
  const labels = {
    program: programs[action.value].label,
    website: `Abrir o site ${action.value}`,
    file: `Criar o arquivo “${action.value}.txt” na pasta segura da Alya`,
    shortcut: `Abrir o aplicativo ${action.name}`
  };
  pending.set(id, { action, expiresAt: Date.now() + 60_000 });
  return { ok: true, approvalId: id, label: labels[action.type], expiresInSeconds: 60 };
}

function executeProposal(approvalId) {
  const proposal = pending.get(String(approvalId || ''));
  pending.delete(String(approvalId || ''));
  if (!proposal || proposal.expiresAt < Date.now()) return { ok: false, message: 'Essa aprovação expirou. Peça a ação novamente.' };

  const { action } = proposal;
  if (action.type === 'program') {
    const program = programs[action.value];
    spawn(program.command, program.args, { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, message: `${program.label.replace('Abrir ', '')} foi aberto.` };
  }
  if (action.type === 'website') {
    spawn('rundll32.exe', ['url.dll,FileProtocolHandler', action.value], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, message: 'O site foi aberto no navegador.' };
  }
  if (action.type === 'shortcut') {
    spawn('explorer.exe', [action.value], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, message: `${action.name} foi aberto.` };
  }
  if (action.type === 'file') {
    fs.mkdirSync(workspace, { recursive: true });
    const output = path.join(workspace, `${action.value}.txt`);
    fs.writeFileSync(output, '', { encoding: 'utf8', flag: 'wx' });
    return { ok: true, message: `Arquivo criado na pasta segura da Alya: ${path.basename(output)}.` };
  }
  return { ok: false, message: 'Ação não permitida.' };
}

module.exports = { localOnly, createProposal, executeProposal };
