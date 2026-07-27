const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('./logger');

const projectRoot = path.resolve(__dirname, '..');

const dangerousCommands = ['rm -rf', 'del /', 'format', 'shutdown', 'reboot', 'remove-item', 'erase ', 'rmdir '];
const protectedPath = /(^|[\\/])(\.env(?:\..*)?|\.vault|\.git|node_modules|credentials?(?:\..*)?|secrets?(?:\..*)?|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))($|[\\/])/i;
const protectedFile = /(^|[\\/])(\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/i;

function isPathAllowed(filePath) {
  const resolvedPath = path.resolve(filePath);
  const relative = path.relative(projectRoot, resolvedPath);
  return Boolean(relative) === false || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isDangerousCommand(command) {
  const lowerCommand = command.toLowerCase();
  return dangerousCommands.some(dangerous => 
    lowerCommand.includes(dangerous)
  );
}

function isDangerousFile(filePath) {
  return protectedPath.test(String(filePath)) || protectedFile.test(String(filePath));
}

function listFiles(dirPath = projectRoot) {
  try {
    if (!isPathAllowed(dirPath)) {
      return { ok: false, error: 'Caminho não permitido' };
    }

    if (!fs.existsSync(dirPath)) {
      return { ok: false, error: 'Diretório não encontrado' };
    }

    if (isDangerousFile(path.relative(projectRoot, dirPath))) {
      return { ok: false, error: 'Pasta protegida' };
    }

    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    const files = items
      .filter((item) => !isDangerousFile(path.join(path.relative(projectRoot, dirPath), item.name)))
      .map(item => ({
      name: item.name,
      type: item.isDirectory() ? 'directory' : 'file',
      path: path.join(dirPath, item.name)
    }));

    return { ok: true, files };
  } catch (error) {
    logger.error('Error listing files:', error);
    return { ok: false, error: error.message };
  }
}

function readFile(filePath) {
  try {
    if (!isPathAllowed(filePath)) {
      return { ok: false, error: 'Caminho não permitido' };
    }

    if (!fs.existsSync(filePath)) {
      return { ok: false, error: 'Arquivo não encontrado' };
    }

    if (isDangerousFile(path.relative(projectRoot, filePath))) {
      return { ok: false, error: 'Arquivo protegido' };
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return { ok: true, content };
  } catch (error) {
    logger.error('Error reading file:', error);
    return { ok: false, error: error.message };
  }
}

function writeFile(filePath, content, approved = false) {
  try {
    if (!isPathAllowed(filePath)) {
      return { ok: false, error: 'Caminho não permitido' };
    }

    const isDangerous = isDangerousFile(path.relative(projectRoot, filePath));
    
    if (isDangerous && !approved) {
      return { 
        ok: false, 
        requiresApproval: true,
        warning: 'Este arquivo é sensível e requer aprovação',
        filePath 
      };
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, content, 'utf8');
    logger.info(`File written: ${filePath}`);
    return { ok: true, filePath };
  } catch (error) {
    logger.error('Error writing file:', error);
    return { ok: false, error: error.message };
  }
}

function executeCommand(command, approved = false) {
  try {
    const text = String(command || '').trim();
    if (!text || /[;&|><`]/.test(text) || text.includes('$(')) {
      return { ok: false, error: 'Comando combinado ou inválido bloqueado.' };
    }
    if (isDangerousCommand(text)) {
      return { ok: false, error: 'Comando perigoso bloqueado.' };
    }
    if (!approved) {
      return { 
        ok: false, 
        requiresApproval: true,
        warning: 'Confirme o comando antes de executar.',
        command: text
      };
    }

    const allowedCommands = ['npm', 'git', 'node'];
    const commandStart = text.split(' ')[0];
    
    if (!allowedCommands.includes(commandStart)) {
      return { ok: false, error: 'Comando não permitido' };
    }

    const output = execSync(text, {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10
    });

    logger.info(`Command executed: ${text}`);
    return { ok: true, output };
  } catch (error) {
    logger.error('Error executing command:', error);
    return { 
      ok: false, 
      error: error.message,
      output: error.stdout || ''
    };
  }
}

function installDependency(packageName, approved = false) {
  try {
    if (!approved) {
      return { ok: false, requiresApproval: true, warning: 'Confirme a instalação antes de continuar.', package: packageName };
    }
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(String(packageName || ''))) {
      return { ok: false, error: 'Nome de pacote inválido.' };
    }
    const command = `npm install ${packageName}`;
    return executeCommand(command, true);
  } catch (error) {
    logger.error('Error installing dependency:', error);
    return { ok: false, error: error.message };
  }
}

function createBackup(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: 'Arquivo não encontrado' };
    }

    const backupPath = `${filePath}.backup-${Date.now()}`;
    fs.copyFileSync(filePath, backupPath);
    logger.info(`Backup created: ${backupPath}`);
    return { ok: true, backupPath };
  } catch (error) {
    logger.error('Error creating backup:', error);
    return { ok: false, error: error.message };
  }
}

function restoreBackup(backupPath, originalPath) {
  try {
    if (!fs.existsSync(backupPath)) {
      return { ok: false, error: 'Backup não encontrado' };
    }

    fs.copyFileSync(backupPath, originalPath);
    logger.info(`Backup restored: ${backupPath} -> ${originalPath}`);
    return { ok: true, originalPath };
  } catch (error) {
    logger.error('Error restoring backup:', error);
    return { ok: false, error: error.message };
  }
}

module.exports = {
  listFiles,
  readFile,
  writeFile,
  executeCommand,
  installDependency,
  createBackup,
  restoreBackup,
  isDangerousCommand,
  isDangerousFile
};
