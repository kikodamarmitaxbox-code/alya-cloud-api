const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');
const DATA_DIR = path.join(__dirname, '..', 'nova-data', 'plugins');

class PluginManager {
  constructor() {
    this.plugins = new Map(); // id -> { manifest, instance, api, enabled, path, settings }
    this.tools = new Map(); // toolName -> { pluginId, description, parameters, execute }
    this.hooks = {
      beforeMessage: [],
      afterMessage: [],
      onSystemPrompt: []
    };
  }

  ensureDirs() {
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /**
   * Escaneia e carrega todos os plugins da pasta /plugins
   */
  async init() {
    this.ensureDirs();
    logger.info('Iniciando o Gerenciador de Plugins...');
    await this.loadAll();
  }

  async loadAll() {
    this.plugins.clear();
    this.tools.clear();
    this.hooks = { beforeMessage: [], afterMessage: [], onSystemPrompt: [] };

    if (!fs.existsSync(PLUGINS_DIR)) return;

    const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pluginPath = path.join(PLUGINS_DIR, entry.name);
        await this.loadPlugin(pluginPath);
      }
    }

    logger.info(`Plugins carregados: ${this.plugins.size} ativados/detectados.`);
  }

  /**
   * Carrega um plugin individual com isolamento de erros
   */
  async loadPlugin(pluginPath) {
    const manifestPath = path.join(pluginPath, 'manifest.json');
    const indexPath = path.join(pluginPath, 'index.js');

    if (!fs.existsSync(manifestPath) || !fs.existsSync(indexPath)) {
      return;
    }

    try {
      const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(manifestRaw);
      const pluginId = manifest.id || path.basename(pluginPath);

      // Carregar configurações locais se existirem
      const configPath = path.join(pluginPath, 'config.json');
      let settings = manifest.defaultSettings || {};
      if (fs.existsSync(configPath)) {
        try {
          settings = { ...settings, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
        } catch {}
      }

      const enabled = manifest.enabled !== false;

      // Criar API nativa escopada para este plugin
      const api = this.createPluginApi(pluginId, pluginPath, settings);

      let instance = null;
      if (enabled) {
        try {
          delete require.cache[require.resolve(indexPath)];
          const pluginModule = require(indexPath);

          instance = typeof pluginModule === 'function' ? new pluginModule() : pluginModule;

          if (instance && typeof instance.init === 'function') {
            await instance.init(api);
          }

          logger.info(`Plugin "${manifest.name || pluginId}" [${pluginId}] carregado com sucesso.`);
        } catch (err) {
          logger.error(`Erro ao inicializar plugin ${pluginId}:`, err);
        }
      }

      this.plugins.set(pluginId, {
        id: pluginId,
        manifest,
        instance,
        api,
        enabled,
        path: pluginPath,
        settings
      });
    } catch (err) {
      logger.error(`Erro ao ler manifest do plugin em ${pluginPath}:`, err);
    }
  }

  /**
   * Cria a API nativa que é passada para o plugin
   */
  createPluginApi(pluginId, pluginPath, settings) {
    const pluginDataDir = path.join(DATA_DIR, pluginId);
    const writePluginLog = (level, args) => {
      const message = args
        .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
        .join(' ');
      logger.log(level, `[Plugin:${pluginId}] ${message}`);
    };

    const api = {
      id: pluginId,
      path: pluginPath,
      logger: {
        info: (...args) => writePluginLog('info', args),
        warn: (...args) => writePluginLog('warn', args),
        error: (...args) => writePluginLog('error', args)
      },

      // Storage escopado do plugin
      storage: {
        get: (key) => {
          try {
            const file = path.join(pluginDataDir, `${key}.json`);
            return JSON.parse(fs.readFileSync(file, 'utf8'));
          } catch {
            return null;
          }
        },
        set: (key, value) => {
          try {
            fs.mkdirSync(pluginDataDir, { recursive: true });
            fs.writeFileSync(path.join(pluginDataDir, `${key}.json`), JSON.stringify(value, null, 2), 'utf8');
            return true;
          } catch {
            return false;
          }
        }
      },

      // Registrar ferramenta para IA/Chat
      registerTool: ({ name, description, parameters, execute }) => {
        if (!name || typeof execute !== 'function') return;
        this.tools.set(name, {
          pluginId,
          description: description || '',
          parameters: parameters || {},
          execute: async (...args) => {
            try {
              return await execute(...args);
            } catch (err) {
              logger.error(`Erro ao executar ferramenta ${name} do plugin ${pluginId}:`, err);
              return { error: err.message };
            }
          }
        });
      },

      // Registrar hooks de eventos
      registerHook: (event, handler) => {
        if (this.hooks[event] && typeof handler === 'function') {
          this.hooks[event].push({ pluginId, handler });
        }
      },

      getSettings: () => {
        const plugin = this.plugins.get(pluginId);
        return plugin ? plugin.settings : settings;
      },

      saveSettings: (newSettings) => {
        const plugin = this.plugins.get(pluginId);
        if (plugin) {
          plugin.settings = { ...plugin.settings, ...newSettings };
          try {
            fs.writeFileSync(path.join(pluginPath, 'config.json'), JSON.stringify(plugin.settings, null, 2), 'utf8');
          } catch (err) {
            logger.error(`Erro ao salvar config do plugin ${pluginId}:`, err);
          }
        }
      }
    };

    return api;
  }

  /**
   * Executa um hook de forma segura para todos os plugins ativos
   */
  async runHook(event, payload) {
    const list = this.hooks[event] || [];
    let currentPayload = payload;

    for (const { pluginId, handler } of list) {
      const plugin = this.plugins.get(pluginId);
      if (plugin && plugin.enabled) {
        try {
          const res = await Promise.race([
            handler(currentPayload),
            new Promise((_, r) => setTimeout(() => r(new Error('Timeout no hook')), 2000))
          ]);
          if (res !== undefined) {
            currentPayload = res;
          }
        } catch (err) {
          logger.warn(`Erro/Timeout no hook '${event}' do plugin ${pluginId}:`, err.message);
        }
      }
    }

    return currentPayload;
  }

  /**
   * Ativa ou desativa um plugin
   */
  async togglePlugin(pluginId, enable) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    plugin.enabled = Boolean(enable);
    plugin.manifest.enabled = plugin.enabled;

    // Atualizar no manifest.json
    try {
      const manifestPath = path.join(plugin.path, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(plugin.manifest, null, 2), 'utf8');
    } catch {}

    await this.loadAll();
    return true;
  }

  /**
   * Retorna informações dos plugins para a API HTTP/Frontend
   */
  getPluginsList() {
    const list = [];
    for (const [id, plugin] of this.plugins.entries()) {
      list.push({
        id,
        name: plugin.manifest.name || id,
        version: plugin.manifest.version || '1.0.0',
        description: plugin.manifest.description || '',
        author: plugin.manifest.author || 'Desconhecido',
        enabled: plugin.enabled,
        settings: plugin.settings
      });
    }
    return list;
  }
}

const pluginManager = new PluginManager();

module.exports = pluginManager;
