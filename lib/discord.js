const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');
const { askAssistant } = require('./chat');
const memory = require('./memory');
const { searchWeb, shouldSearchWeb } = require('./webSearch');
const { NaturalVoice } = require('./voice');

const DEFAULT_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.MessageContent
];

class DiscordManager {
  constructor(options = {}) {
    this.storage = options.storage;
    this.token = options.token || process.env.DISCORD_BOT_TOKEN || '';
    this.clientId = options.clientId || process.env.DISCORD_CLIENT_ID || '';
    this.allowedChannels = (options.allowedChannels || process.env.DISCORD_ALLOWED_CHANNELS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    this.allowedUsers = (options.allowedUsers || process.env.DISCORD_ALLOWED_USERS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    this.deleteUsernames = String(options.deleteUsernames || process.env.DISCORD_DELETE_USERNAMES || '')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);
    this.enabled = options.enabled !== false && process.env.DISCORD_ENABLED !== 'false';
    this.approvalRequired = options.approvalRequired !== false && process.env.DISCORD_APPROVAL_REQUIRED !== 'false';
    this.voice = options.voice || new NaturalVoice();
    this.voiceAutoReply = process.env.DISCORD_VOICE_AUTO_REPLY !== 'false';
    this.client = null;
    this.ready = false;
    this.botReplyCooldowns = new Map();
  }

  async init() {
    if (!this.enabled) {
      logger.info('Discord integration disabled');
      return;
    }
    if (!this.token) {
      logger.warn('DISCORD_BOT_TOKEN missing; Discord integration will be disabled');
      this.enabled = false;
      return;
    }
    if (!this.storage) {
      throw new Error('DiscordManager requires a storage instance');
    }
    await this.storage.init();
    this._createClient();
    logger.info('Discord manager initialized');
  }

  _createClient() {
    this.client = new Client({ intents: DEFAULT_INTENTS, partials: [Partials.Channel] });
    this.client.once('clientReady', () => {
      this.ready = true;
      const tag = this.client.user ? this.client.user.tag : 'unknown';
      logger.info(`Discord bot ready as ${tag}`);
    });
    this.client.on('messageCreate', async (message) => this._handleMessage(message));
    this.client.on('error', (error) => {
      logger.error('Discord client error:', error);
    });
  }

  async start() {
    if (!this.enabled || !this.token) return;
    if (!this.client) this._createClient();
    await this.client.login(this.token);
  }

  async stop() {
    for (const guildId of this.voice.players.keys()) this.voice.leave(guildId);
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (error) {
        logger.error('Error stopping Discord client:', error);
      }
      this.client = null;
      this.ready = false;
    }
  }

  isReady() {
    return this.enabled && this.ready;
  }

  async sendMessage(channelId, content) {
    if (!this.client || !this.ready) {
      throw new Error('Discord client is not ready');
    }
    const channel = await this.client.channels.fetch(channelId);
    if (!channel) throw new Error('Canal Discord nao encontrado');
    await channel.send(content);
  }

  _isAllowed(message) {
    if (message.author?.bot) {
      // Só responde a outro bot se ele marcar a Alya, com espera para evitar loop.
      if (!this.client?.user || message.author.id === this.client.user.id || !message.mentions.has(this.client.user)) return false;
      const key = `${message.channel.id}:${message.author.id}`;
      const lastReply = this.botReplyCooldowns.get(key) || 0;
      if (Date.now() - lastReply < 60_000) return false;
      this.botReplyCooldowns.set(key, Date.now());
    }
    if (this.allowedUsers.length > 0 && !this.allowedUsers.includes(message.author.id)) return false;
    if (message.guild && this.allowedChannels.length > 0 && !this.allowedChannels.includes(message.channel.id)) return false;
    return true;
  }

  async _handleMessage(message) {
    if (!this._isAllowed(message)) return;
    if (message.partial) {
      try { await message.fetch(); } catch (error) { return; }
    }

    const rawContent = (message.content || '').trim();

    if (/^!sair$/i.test(rawContent)) {
      if (message.guild) this.voice.leave(message.guild.id);
      await message.reply('Alya saiu da call.');
      return;
    }

    if (/^!call$/i.test(rawContent)) {
      const voiceChannel = message.member?.voice?.channel;
      if (!voiceChannel) {
        await message.reply('Entre em uma call e depois mande `!call`.');
        return;
      }
      if (!this.voice.isConfigured()) {
        await message.reply('A voz da Alya ainda não está configurada no arquivo .env.');
        return;
      }
      try {
        await this.voice.join(voiceChannel);
      } catch (error) {
        logger.error('Discord voice connection error:', error);
        await message.reply('Não consegui conectar na call. Como a Alya já é ADM, reinicie a Alya e tente de novo. Se continuar, pode ser a rede ou firewall do computador.');
        return;
      }
      try {
        await this.voice.speak(voiceChannel, 'Oi! Eu sou a Alya. Pode me chamar quando precisar.');
        await message.reply('Entrei na call com a voz natural da Alya.');
      } catch (error) {
        logger.error('Discord voice playback error:', error);
        await message.reply('Entrei na call, mas não consegui gerar a fala. Reinicie a Alya e mande `!call` novamente.');
      }
      return;
    }

    const userId = message.author.id;
    const channelId = message.channel.id;
    const historyKey = this._historyKey(channelId, userId);

    // Comando de Reiniciar / Resetar histórico no Discord
    if (/^(?:\/reset|!reset|\/reiniciar|!reiniciar)\b/i.test(rawContent)) {
      try {
        await this.storage.set(historyKey, []);
        await message.reply('🔄 **Histórico e memória da Alya reiniciados neste canal!** Pode começar uma nova conversa.');
      } catch {}
      return;
    }

    // Aceita comando, menção com @ ou o nome "Alya" escrito no canal.
    const isCommand = /^(?:\/conversa|!conversa|!c)\b/i.test(rawContent);
    const isMention = this.client.user && message.mentions.has(this.client.user);
    const isNameMention = /\balya\b/i.test(rawContent);

    if (!isCommand && !isMention && !isNameMention) {
      return; // Ignora conversas livres normais no servidor
    }

    // Limpar o comando do texto
    let userPrompt = rawContent
      .replace(/^(?:\/conversa|!conversa|!c)\s*/i, '')
      .replace(new RegExp(`<@!?${this.client?.user?.id}>`, 'g'), '')
      .trim();

    if (!userPrompt) {
      try {
        await message.reply(' Digite uma mensagem junto com o comando! Exemplo: `/conversa Oi Alya` ou `!conversa Quem é você?`');
      } catch {}
      return;
    }

    let context = (await this.storage.get(historyKey)) || [];

    const attachmentNotes = await this._processAttachments(message.attachments);
    const userContent = [
      userPrompt,
      attachmentNotes ? `\n[Anexos: ${attachmentNotes}]` : ''
    ].join('\n').trim();

    // Extrair memórias inteligentes
    memory.extractSmartMemories(`discord_${userId}`, userContent);

    context.push({ role: 'user', content: userContent, author: message.author.username, timestamp: Date.now() });
    if (context.length > 20) context.splice(0, context.length - 20);
    await this.storage.set(historyKey, context);

    try {
      const settings = (await this.storage.get('settings')) || {};
      let systemPrompt = memory.getMemoryContext(`discord_${userId}`, userContent);

      if (shouldSearchWeb(userContent)) {
        try {
          const searchResult = await searchWeb(userContent);
          if (searchResult && searchResult.text) {
            systemPrompt += `\n\n[DADOS PESQUISADOS NA INTERNET EM TEMPO REAL]:\n${searchResult.text}\nUse estas informações verdadeiras da web para responder sobre "${userContent}".`;
          }
        } catch {}
      }

      const discordSettings = { ...settings, isDiscord: true, rivalMode: Boolean(message.author.bot) };
      // A API de IA aceita apenas role e content. Metadados do Discord (autor e horário)
      // ficam salvos no histórico, mas não são enviados ao modelo.
      const aiMessages = context.map(({ role, content }) => ({ role, content }));
      let aiResponse = await askAssistant(aiMessages, discordSettings, systemPrompt);

      // Limpar rascunhos de raciocínio e truncar para o limite de 2000 caracteres do Discord
      if (typeof aiResponse === 'string') {
        if (aiResponse.includes('</think>')) {
          aiResponse = aiResponse.split('</think>').pop();
        }
        aiResponse = aiResponse.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        if (/^okay,\s*the\s*user/i.test(aiResponse)) {
          aiResponse = aiResponse.replace(/^okay,\s*the\s*user[\s\S]*?\n\n/i, '').trim();
        }
        if (aiResponse.length > 1950) {
          aiResponse = aiResponse.slice(0, 1950) + '...';
        }
      }

      if (!aiResponse) aiResponse = 'Recebi sua mensagem!';

      context.push({ role: 'assistant', content: aiResponse, timestamp: Date.now() });
      if (context.length > 20) context.splice(0, context.length - 20);
      await this.storage.set(historyKey, context);

      if (this.approvalRequired) {
        const queue = (await this.storage.get('queue')) || [];
        const entry = {
          id: crypto.randomUUID(),
          channelId,
          userId,
          author: message.author.username,
          message: userContent,
          aiReply: aiResponse,
          receivedAt: new Date().toISOString(),
          status: 'pending'
        };
        queue.push(entry);
        await this.storage.set('queue', queue);
        try {
          await message.reply('Mensagem recebida e aguardando aprovacao no painel da Alya.');
        } catch (replyError) {
          logger.error('Cannot send approval notice to Discord:', replyError);
        }
      } else {
        try {
          const shouldHideOriginal = this.deleteUsernames.includes(String(message.author.username || '').toLowerCase());
          if (shouldHideOriginal) {
            // Envia uma mensagem comum para não deixar um trecho da pergunta visível como "resposta a".
            await message.channel.send(aiResponse);
            await message.delete().catch((deleteError) => {
              logger.warn(`Cannot hide configured user's message: ${deleteError.message}`);
            });
          } else {
            await message.reply(aiResponse);
          }
          const voiceChannel = message.member?.voice?.channel;
          if (voiceChannel && this.voiceAutoReply && this.voice.isConfigured() && this.voice.isConnected(voiceChannel)) {
            this.voice.speak(voiceChannel, aiResponse).catch((voiceError) => {
              logger.error('Discord voice reply error:', voiceError);
            });
          }
        } catch (replyError) {
          logger.error('Cannot send reply to Discord:', replyError);
        }
      }
    } catch (error) {
      logger.error('Discord chat error:', error);
      try {
        await message.reply('Erro ao processar sua mensagem.');
      } catch (replyError) {
        logger.error('Cannot send error reply to Discord:', replyError);
      }
    }
  }

  async _processAttachments(attachments) {
    if (!attachments || attachments.size === 0) return null;
    const uploadsDir = path.join(__dirname, '..', 'nova-data', 'discord-uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const parts = [];
    for (const attachment of attachments.values()) {
      const safeName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const savePath = path.join(uploadsDir, safeName);
      try {
        const response = await fetch(attachment.url);
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          fs.writeFileSync(savePath, buffer);
          const size = (buffer.length / 1024).toFixed(1);
          const type = attachment.contentType || 'arquivo';
          parts.push(`${attachment.name} (${type}, ${size}KB)`);
        }
      } catch (error) {
        logger.error('Error downloading Discord attachment:', error);
      }
    }
    return parts.join(', ');
  }

  async getQueue() {
    return (await this.storage.get('queue')) || [];
  }

  async setQueue(queue) {
    await this.storage.set('queue', queue);
  }

  async getLog() {
    return (await this.storage.get('log')) || [];
  }

  async addLog(action, entry) {
    const log = await this.getLog();
    log.push({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), action, ...entry });
    await this.storage.set('log', log.slice(-100));
  }

  _historyKey(channelId, userId) {
    return `history:${channelId}:${userId}`;
  }
}

module.exports = { DiscordManager };
