const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');

const pending = new Map();
const execFileAsync = promisify(execFile);
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

function screenshotDestination(text) {
  const match = String(text || '').match(
    /\b(?:mande|mandar|envie|enviar)\b[\s\S]{0,45}?\b(?:no|para o|pro)\s+([a-z0-9_-]{2,32})\b/i
  );
  return String(match?.[1] || 'global').toLowerCase();
}

function createProposal(request, options = {}) {
  const text = String(request || '').trim();
  const lower = text.toLowerCase();
  let action = null;

  if (/\b(?:print|screenshot|captura da tela|foto da tela)\b/i.test(lower) &&
      /\b(?:tira|tirar|tire|faça|fazer|capture|captura|mande|enviar|envie)\b/i.test(lower)) {
    action = { type: 'screenshot', destination: screenshotDestination(text) };
  }
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

  if (!action) return { ok: false, message: 'Posso capturar a tela e enviar ao Discord, abrir a Calculadora, Bloco de Notas, Explorador, um site ou criar um arquivo vazio.' };
  if (options.screenshotOnly && action.type !== 'screenshot') {
    return { ok: false, message: 'Pelo link privado, o único controle remoto permitido é capturar a tela com sua confirmação.' };
  }

  const id = crypto.randomBytes(18).toString('hex');
  const label = action.type === 'program'
    ? programs[action.value].label
    : action.type === 'website'
      ? `Abrir o site ${action.value}`
      : action.type === 'file'
        ? `Criar o arquivo “${action.value}.txt” na pasta segura da Alya`
        : action.type === 'shortcut'
          ? `Abrir o aplicativo ${action.name}`
          : `Capturar sua tela e enviar ao Discord “${action.destination}”`;
  pending.set(id, { action, expiresAt: Date.now() + 60_000 });
  return { ok: true, approvalId: id, label, expiresInSeconds: 60 };
}

function executeProposal(approvalId, options = {}) {
  const proposal = pending.get(String(approvalId || ''));
  pending.delete(String(approvalId || ''));
  if (!proposal || proposal.expiresAt < Date.now()) return { ok: false, message: 'Essa aprovação expirou. Peça a ação novamente.' };

  const { action } = proposal;
  if (action.type === 'screenshot') {
    return {
      ok: true,
      action: 'screenshot',
      destination: action.destination,
      message: 'Captura aprovada.'
    };
  }
  if (options.allowLocalActions === false) {
    return { ok: false, message: 'Essa ação só pode ser executada diretamente no seu computador.' };
  }
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

async function captureScreenshot() {
  if (process.platform !== 'win32') {
    throw new Error('A captura local está disponível somente no Windows.');
  }
  const output = path.join(os.tmpdir(), `alya-screen-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.png`);
  const escapedOutput = output.replace(/'/g, "''");
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$screen = [System.Windows.Forms.SystemInformation]::VirtualScreen',
    '$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)',
    '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
    '$graphics.CopyFromScreen($screen.Left, $screen.Top, 0, 0, $bitmap.Size)',
    `$bitmap.Save('${escapedOutput}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    '$graphics.Dispose()',
    '$bitmap.Dispose()'
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    encoded
  ], {
    windowsHide: true,
    timeout: 20000,
    maxBuffer: 1024 * 1024
  });
  const buffer = fs.readFileSync(output);
  fs.unlinkSync(output);
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
    throw new Error('A captura ficou vazia ou grande demais.');
  }
  return buffer;
}

module.exports = {
  localOnly,
  createProposal,
  executeProposal,
  captureScreenshot,
  screenshotDestination
};
