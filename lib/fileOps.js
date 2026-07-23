const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('./logger');

const projectRoot = path.join(__dirname, '..');
const allowedPaths = [
  projectRoot,
  path.join(projectRoot, 'lib'),
  path.join(projectRoot, 'public'),
  path.join(projectRoot, 'nova-data')
];

const dangerousCommands = ['rm -rf', 'del /', 'format', 'shutdown', 'reboot'];
const dangerousFiles = ['.env', 'package-lock.json', 'node_modules'];

function isPathAllowed(filePath) {
  const resolvedPath = path.resolve(filePath);
  return allowedPaths.some(allowed => 
    resolvedPath.startsWith(path.resolve(allowed))
  );
}

function isDangerousCommand(command) {
  const lowerCommand = command.toLowerCase();
  return dangerousCommands.some(dangerous => 
    lowerCommand.includes(dangerous)
  );
}

function isDangerousFile(filePath) {
  const fileName = path.basename(filePath);
  return dangerousFiles.includes(fileName) || fileName.endsWith('.key');
}

function listFiles(dirPath = projectRoot) {
  try {
    if (!isPathAllowed(dirPath)) {
      return { ok: false, error: 'Caminho não permitido' };
    }

    if (!fs.existsSync(dirPath)) {
      return { ok: false, error: 'Diretório não encontrado' };
    }

    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    const files = items.map(item => ({
      name: item.name,
      type: item.isDirectory(dirPath) ? 'directory' : 'file',
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

    const content = fs.readFileSync(filePath, 'utf8');
    return { ok: true, content };
  } catch (error) {
    logger.error('Error reading file:', error);
    return { ok: false, error: error.message };
  }
}

function writeFile(filePath, content, requiresApproval = false) {
  try {
    if (!isPathAllowed(filePath)) {
      return { ok: false, error: 'Caminho não permitido' };
    }

    const isDangerous = isDangerousFile(filePath);
    
    if (isDangerous && !requiresApproval) {
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

function executeCommand(command, requiresApproval = false) {
  try {
    if (isDangerousCommand(command) && !requiresApproval) {
      return { 
        ok: false, 
        requiresApproval: true,
        warning: 'Comando perigoso detectado e requer aprovação',
        command 
      };
    }

    const allowedCommands = ['npm', 'git', 'node'];
    const commandStart = command.split(' ')[0];
    
    if (!allowedCommands.includes(commandStart)) {
      return { ok: false, error: 'Comando não permitido' };
    }

    const output = execSync(command, { 
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10
    });

    logger.info(`Command executed: ${command}`);
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

function installDependency(packageName) {
  try {
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
