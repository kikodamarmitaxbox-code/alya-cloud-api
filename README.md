# Alya - Assistente IA

Alya é uma assistente pessoal leve que usa APIs gratuitas de IA com interface web moderna.

## Deploy Rápido

### Railway (Recomendado)

```bash
# Instale o Railway CLI
npm install -g @railway/cli

# Faça login
railway login

# Inicie o projeto
railway init

# Faça o deploy
railway up
```

Após o deploy, o Railway fornecerá um link público permanente como:
`https://alya-ia-production.up.railway.app`

### Render

1. Crie uma conta em https://render.com
2. Conecte seu repositório GitHub/GitLab
3. Use as configurações do `render.yaml`
4. Configure as variáveis de ambiente:
   - `OPENROUTER_API_KEY`
   - `AI_PROVIDER=openrouter`
   - `MAX_TOKENS=500`

### Vercel (Alternativo)

```bash
npm install -g vercel
vercel login
vercel --yes
```

## Configuração Local

1. Clone o repositório
2. Instale as dependências:
```bash
npm install
```

3. Crie um arquivo `.env`:
```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sua_chave_aqui
OPENROUTER_MODEL=openrouter/free
MAX_TOKENS=500
FRIEND_USERS=user1:senha1,user2:senha2
SITE_PASSWORD=senha_de_acesso
```

4. Inicie o servidor:
```bash
npm start
```

5. Acesse http://localhost:3000

## Variáveis de Ambiente

| Variável | Descrição | Obrigatória |
|----------|-----------|-------------|
| `AI_PROVIDER` | Provedor de IA (`openrouter` ou `gemini`) | Não |
| `OPENROUTER_API_KEY` | Chave da API OpenRouter | Sim (se usar openrouter) |
| `GEMINI_API_KEY` | Chave da API Gemini | Sim (se usar gemini) |
| `FRIEND_USERS` | Lista de usuários autorizados (formato `user:hash`) | Não |
| `SITE_PASSWORD` | Senha única de acesso | Não |
| `PORT` | Porta do servidor | Não (padrão: 3000) |

## Discord Bot (Opcional)

```env
DISCORD_BOT_TOKEN=seu_token_discord
DISCORD_CLIENT_ID=id_do_app
DISCORD_ENABLED=true
DISCORD_APPROVAL_REQUIRED=false
```

## Estrutura do Projeto

```
├── server.js          # Servidor HTTP principal
├── package.json       # Dependências
├── render.yaml        # Configuração Render
├── Dockerfile         # Container Docker
├── lib/
│   ├── chat.js        # Integração com APIs de IA
│   ├── auth.js        # Autenticação
│   ├── whatsapp.js    # Integração WhatsApp
│   ├── discord.js     # Integração Discord
│   ├── history.js     # Histórico de conversas
│   └── logger.js      # Sistema de logs
├── public/
│   ├── index.html     # Interface HTML
│   ├── app.js         # Lógica do frontend
│   └── styles.css     # Estilos
└── nova-data/         # Dados persistentes
```

## Funcionalidades

- Chat com IA usando OpenRouter ou Gemini
- Múltiplas personalidades (Jarvis, Equilibrada, Direta, Amiga, Técnica)
- Modos de operação (Normal, Estudo, Criativo, Código, Rápido)
- Memória persistente
- Histórico de conversas
- Modo Dev com aprovação de ações
- Integração com WhatsApp
- Integração com Discord
- Exportação de conversas (TXT, JSON, PDF)
