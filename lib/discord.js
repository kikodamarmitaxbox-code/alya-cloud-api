const { Client, GatewayIntentBits, Partials, Attachment } = require('discord.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');
const { askAssistant } = require('./chat');

const DEFAULT_INTENTS = [
  GatewayIntentBits.Guilds,
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
    this.enabled = options.enabled !== false && process.env.DISCORD_ENABLED !== 'false';
    this.approvalRequired = options.approvalRequired !== false && process.env.DISCORD_APPROVAL_REQUIRED !== 'false';
    this.client = null;
    this.ready = false;
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
    this.client.once('ready', () => {
      this.ready = true;
      logger.info(`Discord bot ready as ${this.client.user.tag}`);
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
    if (message.author?.bot) return false;
    if (this.allowedUsers.length > 0 && !this.allowedUsers.includes(message.author.id)) return false;
    if (message.guild && this.allowedChannels.length > 0 && !this.allowedChannels.includes(message.channel.id)) return false;
    return true;
  }

  async _handleMessage(message) {
    if (!this._isAllowed(message)) return;
    if (message.partial) {
      try { await message.fetch(); } catch (error) { return; }
    }

    const userId = message.author.id;
    const channelId = message.channel.id;
    const historyKey = this._historyKey(channelId, userId);
    let context = (await this.storage.get(historyKey)) || [];

    const attachmentNotes = await this._processAttachments(message.attachments);
    const userContent = [
      message.content || '(sem texto)',
      attachmentNotes ? `\n[Anexos: ${attachmentNotes}]` : ''
    ].join('\n').trim();

    context.push({ role: 'user', content: userContent, author: message.author.username, timestamp: Date.now() });
    if (context.length > 20) context.splice(0, context.length - 20);
    await this.storage.set(historyKey, context);

    try {
      const settings = (await this.storage.get('settings')) || {};
      const aiResponse = await askAssistant(context, settings);
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
          await message.reply('Mensagem recebida e aguardando aprovacao no painel da Astra.');
        } catch (replyError) {
          logger.error('Cannot send approval notice to Discord:', replyError);
        }
      } else {
        try {
          await message.reply(aiResponse);
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
