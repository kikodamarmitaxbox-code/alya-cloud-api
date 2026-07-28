const { searchWeb, shouldSearchWeb } = require('../../lib/webSearch');

class WebSearchPlugin {
  async init(api) {
    this.api = api;
    this.api.logger.info('Plugin de Pesquisa Web inicializado com sucesso.');

    // Registrar ferramenta de busca executável pela IA
    this.api.registerTool({
      name: 'web_search',
      description: 'Pesquisa fatos atuais, esportes, notícias e resultados na internet.',
      parameters: { query: 'string' },
      execute: async ({ query }) => {
        const results = await searchWeb(query);
        return results;
      }
    });

    // Registrar hook antes de enviar a mensagem para a IA
    this.api.registerHook('beforeMessage', async (ctx) => {
      const userMessage = ctx.lastUserMessage;
      if (!userMessage) return ctx;

      const settings = this.api.getSettings();
      if (settings.autoSearch && shouldSearchWeb(userMessage)) {
        this.api.logger.info('Pesquisa automática acionada para uma pergunta atual.');
        const searchResult = await searchWeb(userMessage);

        if (searchResult && searchResult.text) {
          ctx.systemPrompt = (ctx.systemPrompt || '') +
            `\n\n[DADOS PESQUISADOS NA INTERNET EM TEMPO REAL DA SUA BUSCA]:\n${searchResult.text}\nUse essas informações atualizadas para responder com precisão ao usuário!`;
        }
      }

      return ctx;
    });
  }
}

module.exports = WebSearchPlugin;
