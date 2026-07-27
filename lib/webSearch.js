const logger = require('./logger');

/**
 * Realiza pesquisa em tempo real na internet para perguntas atuais.
 * @param {string} query Termo de busca
 * @returns {Promise<{success: boolean, results: Array<{title: string, snippet: string, link: string}>, text: string}>}
 */
async function searchWeb(query) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    return { success: false, results: [], text: '' };
  }

  logger.info(`Iniciando pesquisa na web ao vivo para: "${cleanQuery}"`);

  const providers = [searchDuckDuckGoLite, searchDuckDuckGoApi, searchWikipedia];

  for (const provider of providers) {
    try {
      const data = await provider(cleanQuery);
      if (data && data.results && data.results.length > 0) {
        logger.info(`Pesquisa web obteve ${data.results.length} resultados.`);
        return data;
      }
    } catch (err) {
      logger.warn(`Provider de busca falhou: ${err.message}`);
    }
  }

  return { success: false, results: [], text: '' };
}

/**
 * Busca via DuckDuckGo Lite (HTML real de busca web)
 */
async function searchDuckDuckGoLite(query) {
  try {
    const response = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      body: 'q=' + encodeURIComponent(query),
      signal: AbortSignal.timeout(4500)
    });

    if (!response.ok) return null;

    const html = await response.text();
    const results = [];

    // Split HTML by table rows
    const rows = html.split(/<tr/i);
    let currentTitle = '';
    let currentLink = '';

    for (const row of rows) {
      // Find result link and title
      const linkMatch = row.match(/href="([^"]+)"[^>]*class=['"]result-link['"]>(.*?)<\/a>/i);
      if (linkMatch) {
        currentLink = linkMatch[1];
        currentTitle = linkMatch[2].replace(/<[^>]+>/g, '').trim();
      }

      // Find result snippet
      const snippetMatch = row.match(/class=['"]result-snippet['"]>(.*?)<\/td>/is);
      if (snippetMatch && currentTitle) {
        const snippet = snippetMatch[1].replace(/<[^>]+>/g, '').trim();
        if (snippet) {
          results.push({
            title: currentTitle,
            snippet: snippet.slice(0, 400),
            link: currentLink
          });
          currentTitle = '';
          currentLink = '';
        }
      }
    }

    if (results.length === 0) return null;

    const formattedText = results
      .slice(0, 5)
      .map((r, idx) => `[Resultado ${idx + 1}: ${r.title}]\n${r.snippet}`)
      .join('\n\n')
      .slice(0, 1600);

    return { success: true, results, text: formattedText };
  } catch (err) {
    logger.warn(`DuckDuckGo Lite error: ${err.message}`);
    return null;
  }
}

/**
 * Busca via API pública DuckDuckGo Instant Answer
 */
async function searchDuckDuckGoApi(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(3500)
  });

  if (!response.ok) return null;

  const data = await response.json();
  const results = [];

  if (data.AbstractText) {
    results.push({
      title: data.Heading || query,
      snippet: String(data.AbstractText).slice(0, 400),
      link: data.AbstractURL || ''
    });
  }

  if (Array.isArray(data.RelatedTopics)) {
    for (const item of data.RelatedTopics) {
      if (item.Text && results.length < 5) {
        results.push({
          title: String(item.Text.split(' - ')[0] || item.Text).slice(0, 100),
          snippet: String(item.Text).slice(0, 300),
          link: item.FirstURL || ''
        });
      }
    }
  }

  if (results.length === 0) return null;

  const formattedText = results
    .map((r, idx) => `[Fonte ${idx + 1}: ${r.title}]\n${r.snippet}`)
    .join('\n\n')
    .slice(0, 1200);

  return { success: true, results, text: formattedText };
}

/**
 * Busca via API da Wikipedia (em Português)
 */
async function searchWikipedia(query) {
  const url = `https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(3500)
  });

  if (!response.ok) return null;

  const data = await response.json();
  const items = data.query?.search || [];

  if (items.length === 0) return null;

  const results = items.slice(0, 4).map(item => ({
    title: item.title,
    snippet: String(item.snippet || '').replace(/<[^>]+>/g, '').slice(0, 300),
    link: `https://pt.wikipedia.org/wiki/${encodeURIComponent(item.title)}`
  }));

  const formattedText = results
    .map((r, idx) => `[Wikipedia - ${r.title}]: ${r.snippet}`)
    .join('\n\n')
    .slice(0, 1200);

  return { success: true, results, text: formattedText };
}

/**
 * Detecta se a mensagem do usuário necessita de busca ao vivo na web.
 * @param {string} text
 * @returns {boolean}
 */
function shouldSearchWeb(text) {
  const q = String(text || '').toLowerCase().trim();
  if (q.length < 3) return false;

  const explicitSearch = /^(?:pesquise|procure|busque|pesquisa|veja na internet|olhe na internet)\b/.test(q);
  const currentKeywords = [
    'ganhou', 'venceu', 'campeao', 'campea', 'primeiro', 'primeira', 'mundial',
    'super bowl', 'champions', 'copa', 'brasileirao', 'libertadores', 'cs', 'csgo',
    'counter strike', 'valorant', 'lol', 'league of legends', 'dota', 'ufc',
    'santos', 'chapecoense', 'flamengo', 'palmeiras', 'corinthians', 'sao paulo', 'gremio', 'internacional', 'jogo', 'partida',
    'hoje', 'noticias', 'noticia', 'cotacao', 'preco', 'clima', 'tempo', 'atual', 'resultado', 'agora', 'recente', 'ultima', 'última'
  ];

  const hasCurrentKeyword = currentKeywords.some(k => q.includes(k));
  return explicitSearch || hasCurrentKeyword;
}

module.exports = {
  searchWeb,
  shouldSearchWeb
};
