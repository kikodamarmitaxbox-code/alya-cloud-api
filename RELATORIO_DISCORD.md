# Relatório de Integração com Discord — Astra v2.0

## 1. Como a integração com o Discord deve ser implementada

A integração com Discord seguirá o mesmo padrão arquitetural já usado para WhatsApp (`lib/whatsapp.js`), adaptado para usar a API do Discord via WebSocket/gateway (discord.js) em vez de webhooks externos.

**Abordagem:** Um módulo `lib/discord.js` responsável por:
- Gerenciar a conexão com o Discord via `discord.js`
- Receber mensagens de DMs e canais autorizados
- Gerar respostas com IA através do chat existente (`lib/chat.js`)
- Manter fila de aprovação integrada à UI existente (reuso do painel de whatsApp com adaptações)
- Ler anexos enviados e expô-los para a IA

**Fluxo:**
```
Usuário Discord → Discord Gateway → discord.js → /api/discord/receive
                                              ↓
                                         lib/discord.js
                                              ↓
                                    lib/chat.js (IA)
                                              ↓
                                    Resposta → Discord / Fila UI
```

## 2. Quais arquivos existentes precisarão ser modificados

**`server.js`**
- Adicionar novas rotas no route table (linhas 42-207):
  - `POST /api/discord/receive` — receber mensagens do bot do Discord e gerar resposta
  - `POST /api/discord/approve` — aprovar envio de mensagem do Discord
  - `POST /api/discord/cancel` — cancelar mensagem da fila
  - `GET /api/discord/queue` — listar mensagens pendentes
  - `GET /api/discord/log` — visualizar log de mensagens enviadas
  - `WS /api/discord/status` — status da conexão do bot

**`package.json`**
- Adicionar `discord.js` às dependências
- Adicionar `@discordjs/rest` e `discord-api-types/v10` se necessário

**`public/app.js`**
- Adicionar parsing de comando de ativação do Discord via regex (ex: `/discord on`, `/discord off`)
- Adicionar handler para eventos de fila do Discord
- Reaproveitar lógica do painel whatsApp para novo painel `discordPanel`
- Adicionar suporte a menções/arquivos vindos do Discord na renderização de mensagens

**`public/index.html`**
- Adicionar botão do Discord na top bar (similar ao botão do WhatsApp)
- Adicionar `<section id="discordPanel">` similar à `whatsAppPanel`
- Adicionar modal de log do Discord (similar ao `whatsAppLogModal`)

**`render.yaml`**
- Adicionar secret `DISCORD_BOT_TOKEN`
- Adicionar `DISCORD_CLIENT_ID` e `DISCORD_GUILD_ID` se necessário
- Garantir que healthcheck `/health` continue funcionando

**`.env` (já existe no .gitignore)**
- Adicionar variáveis novas (ver seção 7)

## 3. Quais novos arquivos deverão ser criados

**`lib/discord.js`** — Módulo principal da integração
- Classe `DiscordManager` que gerencia cliente discord.js
- Métodos para: `start()`, `stop()`, `sendMessage()`, `handleMessageCreate()`
- Integração com `lib/chat.js` para gerar respostas de IA
- Integração com `lib/fileOps.js` para ler anexos
- Fila de mensagens pendentes (`nova-data/discord-queue.json`)
- Log de mensagens enviadas (`nova-data/discord-log.json`)
- Permissões de acesso: lista de IDs de usuários Discord autorizados

**`lib/discordHistory.js`** — Histórico de conversas do Discord
- Mapear `userId` → conversa
- Salvar em `nova-data/discord-history/<userId>.json`
- Interface similar a `lib/history.js`

**`public/discord-panel.html` (opcional)** — Painel dedicado
- Se for separado do painel principal, senão reusar estrutura do WhatsApp já existente

## 4. Como a Astra irá se comunicar com o Discord

**Via discord.js (WebSocket Gateway):**
- O bot se conecta ao gateway do Discord usando `DISCORD_BOT_TOKEN`
- Escuta eventos: `messageCreate`, `interactionCreate`
- Para DMs: responde diretamente no canal privado
- Para servidores: responde apenas em canais autorizados (`DISCORD_ALLOWED_CHANNELS`)
- Para grupos/DMs: mantém contexto por `userId`

**Comandos de Slash (alternativa):**
- Registrar comandos `/chat`, `/memory`, `/clear` para interação mais rica
- Porém, para simplicidade inicial, usar apenas mensagens diretas (prefixo opcional, ou responder a todas as DMs)

**Rate limiting:**
- Discord tem rate limits próprios (5 req/s por canal, 50 req/s global)
- O bot deve implementar fila interna e respeitar `Retry-After` headers
- Reutilizar o `RateLimiter` existente do backend para controlar requisições de IA

## 5. Como manter o contexto das conversas

**Estrutura de contexto:**
```
Cada usuário Discord terá:
  - Histórico próprio (similar a `nova-data/history/<id>.json`)
  - Chave de contexto: userId do Discord
  - Limite: últimas 10 mensagens (mesmo padrão do frontend atual)
```

**Fluxo de contexto:**
1. Usuário envia mensagem → bot recupera `nova-data/discord-history/{userId}.json`
2. Bot envia últimas 10 mensagens + nova mensagem para `lib/chat.js`
3. `lib/chat.js` gera resposta com system prompt incluindo:
   - Personalidade configurada em `profile.json`
   - Memória da Astra
   - Histórico recente
4. Após resposta, salva par user+assistant no histórico
5. Limpa arquivos com mais de 100 mensagens (igual WhatsApp)

**Switch de contexto:**
- Em servidores, contexto por canal (`channelId`) para conversas públicas
- Em DMs, contexto por `userId` para conversas privadas

## 6. Como ler arquivos enviados no Discord

**Análise de anexos:**
```javascript
// No evento messageCreate do discord.js
if (message.attachments.size > 0) {
  for (const attachment of message.attachments.values()) {
    // attachment.url, attachment.name, attachment.contentType
    // Baixar arquivo usando axios/node-fetch (ou https do Node)
    // Salvar em nova-data/discord-uploads/<tempId>/
    // Adicionar ao contexto da mensagem:
    // "Usuário enviou arquivo: NOME (TIPO_SIZE)"
    // Se for texto legível (.txt, .md, .json, .csv, .js, .py):
    //    incluir conteúdo truncado no prompt
    // Se for imagem: enviar URL para multimodal (se provider suportar)
  }
}
```

**Validação de segurança:**
- Usar `containsSensitiveText` (já existe em `lib/utils.js`)
- Verificar tamanho do arquivo (máx 500KB por enquanto)
- Permitir apenas extensões seguras: `.txt`, `.md`, `.json`, `.csv`, `.js`, `.py`, `.ts`, `.pdf` (texto), `.png`, `.jpg`, `.gif`
- Bloquear: `.exe`, `.dll`, `.sh`, `.bat`, arquivos compactados potencialmente perigosos

**Integração com IA:**
- Arquivos de texto são anexados ao prompt como "Anexo: [conteúdo]"
- Se o provider suportar multimodal (ex: Gemini Vision, GPT-4o), enviar imagem diretamente
- Caso contrário, apenas referenciar que há imagem

## 7. Como configurar tudo usando um arquivo .env

Adicionar ao `.env` existente:

```env
# Discord Bot
DISCORD_BOT_TOKEN=seu_token_aqui
DISCORD_CLIENT_ID=id_do_app_discord
DISCORD_ALLOWED_CHANNELS=IDs_separados_por_virgula
DISCORD_ALLOWED_USERS=IDs_permitidos (vazio = todos)
DISCORD_ENABLED=false

# Comportamento do bot
DISCORD_PREFIX=!
DISCORD_REPLY_IN_SERVERS=true
DISCORD_REPLY_IN_DMS=true
DISCORD_APPROVAL_REQUIRED=false

# Limites
DISCORD_MAX_FILE_SIZE_MB=5
DISCORD_HISTORY_LIMIT=10
```

**Variáveis já existentes que continuam:**
- `AI_PROVIDER` — funciona para respostas no Discord
- `OPENROUTER_API_KEY` / `GEMINI_API_KEY` — providers para o bot
- `nova-data/profile.json` — personalidade compartilhada com o bot

## 8. Quais dependências precisarão ser instaladas

**Novas dependências (adicionar ao `package.json`):**
```
discord.js: ^14.14.0            
# Biblioteca principal do Discord, lida com gateway, eventos e API

@discordjs/rest: ^2.0.0         
# (se usar slash commands; opcional na versão inicial)

discord-api-types/v10: ^0.1.0   
# Tipos para tipos TypeScript (opcional, não necessário em JS puro)
```

**Dependências a remover (opcional):**
- `express-rate-limit` — declarada mas não usada (já existe rate limiter customizado)

**Total de novas dependências: 1-3 pacotes**
- O `discord.js` já traz as dependências de websocket e API embutidas
- Não precisa de frameworks adicionais, mantendo filosofia lightweight do projeto

**Instalação:**
```
npm install discord.js
```

**Node.js:**
- `discord.js` 14.x requer Node >= 16.9.0, mas o projeto já requer Node >= 18, então compatível.