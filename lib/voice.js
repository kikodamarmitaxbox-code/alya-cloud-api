const { Readable } = require('stream');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel
} = require('@discordjs/voice');

const logger = require('./logger');

const ELEVEN_V3 = 'eleven_v3';

class NaturalVoice {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.ELEVENLABS_API_KEY_NEW || process.env.ELEVENLABS_API_KEY || '';
    this.voiceId = options.voiceId || process.env.ELEVENLABS_VOICE_ID || '';
    this.model = options.model || process.env.ELEVENLABS_MODEL || ELEVEN_V3;
    this.provider = options.provider || process.env.VOICE_PROVIDER || 'edge';
    this.edgeVoice = options.edgeVoice || process.env.EDGE_TTS_VOICE || 'pt-BR-ThalitaNeural';
    this.pythonExecutable = options.pythonExecutable || process.env.PYTHON_EXECUTABLE || 'python';
    this.enabled = options.enabled !== false && process.env.DISCORD_VOICE_ENABLED !== 'false';
    this.players = new Map();
  }

  isConfigured() {
    if (!this.enabled) return false;
    if (this.provider === 'edge') return true;
    return Boolean(this.apiKey && this.voiceId);
  }

  async join(channel) {
    if (!channel?.guild || !channel?.isVoiceBased?.()) {
      throw new Error('Entre em um canal de voz antes de chamar a Sofia.');
    }

    let connection = getVoiceConnection(channel.guild.id);
    const alreadyInChannel = connection
      && connection.state.status === VoiceConnectionStatus.Ready
      && connection.joinConfig.channelId === channel.id;

    if (alreadyInChannel) return connection;
    if (connection) connection.destroy();

    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
      debug: true
    });

    connection.on('stateChange', (oldState, newState) => {
      logger.info(`Discord voice state: ${oldState.status} -> ${newState.status}`);
    });
    connection.on('error', (error) => {
      logger.error('Discord voice connection event error:', error);
    });
    connection.on('debug', (message) => {
      logger.info(`Discord voice debug: ${message}`);
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      return connection;
    } catch (error) {
      connection.destroy();
      throw error;
    }
  }

  leave(guildId) {
    const connection = getVoiceConnection(guildId);
    if (connection) connection.destroy();
    this.players.delete(guildId);
  }

  isConnected(channel) {
    if (!channel?.guild?.id) return false;
    const connection = getVoiceConnection(channel.guild.id);
    return Boolean(
      connection
      && connection.state.status === VoiceConnectionStatus.Ready
      && connection.joinConfig.channelId === channel.id
    );
  }

  async speak(channel, text) {
    if (!this.isConfigured()) {
      throw new Error('A voz natural ainda não foi configurada. Adicione ELEVENLABS_API_KEY e ELEVENLABS_VOICE_ID ao arquivo .env.');
    }

    const cleanText = String(text || '').replace(/<[^>]+>/g, '').trim().slice(0, 2_800);
    if (!cleanText) return;

    const connection = await this.join(channel);
    const audio = this.provider === 'edge'
      ? await this._synthesizeEdge(cleanText)
      : await this._synthesize(cleanText);
    const player = this._getPlayer(channel.guild.id);
    const resource = createAudioResource(Readable.from(audio));

    player.play(resource);
    connection.subscribe(player);
    await entersState(player, AudioPlayerStatus.Idle, 120_000);
  }

  _getPlayer(guildId) {
    if (this.players.has(guildId)) return this.players.get(guildId);

    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
    });
    player.on('error', (error) => logger.error('Discord voice playback error:', error));
    this.players.set(guildId, player);
    return player;
  }

  async _synthesize(text) {
    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voiceId)}/stream?output_format=mp3_44100_128`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.apiKey
      },
      body: JSON.stringify({
        text,
        model_id: this.model,
        language_code: 'pt',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          style: 0.25,
          use_speaker_boost: true,
          speed: 1
        }
      })
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Não foi possível gerar a voz da Sofia (${response.status}): ${detail}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async _synthesizeEdge(text) {
    const outputPath = path.join(os.tmpdir(), `alya-${crypto.randomUUID()}.mp3`);
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(this.pythonExecutable, [
          '-m', 'edge_tts',
          '--voice', this.edgeVoice,
          '--text', text,
          '--write-media', outputPath
        ], { windowsHide: true });

        let errorText = '';
        child.stderr.on('data', (chunk) => { errorText += chunk.toString(); });
        child.on('error', (error) => reject(error));
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(errorText.trim() || `Edge TTS terminou com código ${code}.`));
        });
      });

      return await fs.readFile(outputPath);
    } finally {
      await fs.unlink(outputPath).catch(() => {});
    }
  }
}

module.exports = { ELEVEN_V3, NaturalVoice };
