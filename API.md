# API Documentation - Astra v2.0

## Base URL

```
http://localhost:3000
```

## Autenticação

A maioria dos endpoints requer autenticação. Use o cookie `astra_session` gerado após login.

## Endpoints

### Health Check

Verifica o status do servidor e das dependências.

```http
GET /health
```

**Response:**
```json
{
  "ok": true,
  "name": "Astra",
  "version": "2.0.0",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "dependencies": {
    "openrouter": true,
    "gemini": false
  }
}
```

### Autenticação

#### Status da Autenticação

Verifica se o usuário está autenticado.

```http
GET /api/auth/status
```

**Response:**
```json
{
  "protected": true,
  "authenticated": false,
  "loginMode": "users"
}
```

#### Login

Autentica o usuário.

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "pedro",
  "password": "astra123"
}
```

**Response:**
```json
{
  "ok": true,
  "protected": true,
  "loginMode": "users",
  "user": "pedro"
}
```

#### Logout

Encerra a sessão do usuário.

```http
POST /api/auth/logout
```

**Response:**
```json
{
  "ok": true
}
```

### Chat

#### Enviar Mensagem

Envia uma mensagem para a IA e recebe a resposta completa.

```http
POST /api/chat
Content-Type: application/json

{
  "messages": [
    {
      "role": "user",
      "content": "Olá, como você está?"
    }
  ],
  "settings": {
    "personality": "jarvis",
    "mode": "normal",
    "memory": "",
    "devMode": false
  }
}
```

**Response:**
```json
{
  "reply": "Olá! Estou funcionando perfeitamente. Como posso ajudar você hoje?"
}
```

#### Enviar Mensagem (Streaming)

Envia uma mensagem para a IA e recebe a resposta em streaming.

```http
POST /api/chat-stream
Content-Type: application/json

{
  "messages": [
    {
      "role": "user",
      "content": "Conte uma história curta"
    }
  ],
  "settings": {
    "personality": "criativo",
    "mode": "criativo",
    "memory": "",
    "devMode": false
  }
}
```

**Response:**
```
Content-Type: text/plain; charset=utf-8

Era uma vez...
```

### Perfil (Modo Dev)

#### Ler Perfil

Lê o perfil atual da Astra.

```http
GET /api/dev/profile
```

**Response:**
```json
{
  "ok": true,
  "profile": {
    "name": "Astra",
    "personality": "jarvis",
    "memory": "Usuário gosta de tecnologia",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Aplicar Perfil

Aplica alterações ao perfil da Astra.

```http
POST /api/dev/apply-profile
Content-Type: application/json

{
  "confirmed": true,
  "profile": {
    "personality": "amiga",
    "memory": "Usuário prefere respostas curtas"
  }
}
```

**Response:**
```json
{
  "ok": true,
  "file": "nova-data/profile.json",
  "backup": "nova-data/backups/profile-2024-01-01.json",
  "profile": {
    "name": "Astra",
    "personality": "amiga",
    "memory": "Usuário prefere respostas curtas",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### WhatsApp

#### Receber Mensagem

Recebe uma mensagem do WhatsApp e gera resposta para aprovação.

```http
POST /api/whatsapp/receive
Content-Type: application/json

{
  "from": "5511999999999",
  "contactName": "João",
  "message": "Olá!",
  "settings": {
    "personality": "amiga",
    "mode": "normal"
  }
}
```

**Response:**
```json
{
  "ok": true,
  "id": "uuid-da-mensagem",
  "message": "Mensagem recebida e aguardando aprovação.",
  "aiReply": "Olá! Como posso ajudar?"
}
```

#### Listar Fila

Lista todas as mensagens na fila de aprovação.

```http
GET /api/whatsapp/queue
```

**Response:**
```json
{
  "queue": [
    {
      "id": "uuid-da-mensagem",
      "from": "5511999999999",
      "contactName": "João",
      "message": "Olá!",
      "aiReply": "Olá! Como posso ajudar?",
      "receivedAt": "2024-01-01T00:00:00.000Z",
      "status": "pending"
    }
  ]
}
```

#### Aprovar Mensagem

Aprova o envio de uma mensagem.

```http
POST /api/whatsapp/approve
Content-Type: application/json

{
  "id": "uuid-da-mensagem",
  "reply": null
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Resposta aprovada e pronta para envio.",
  "id": "uuid-da-mensagem",
  "from": "5511999999999",
  "contactName": "João",
  "reply": "Olá! Como posso ajudar?"
}
```

#### Cancelar Mensagem

Cancela o envio de uma mensagem.

```http
POST /api/whatsapp/cancel
Content-Type: application/json

{
  "id": "uuid-da-mensagem"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Envio cancelado.",
  "id": "uuid-da-mensagem"
}
```

#### Ver Log

Ver o histórico de ações do WhatsApp.

```http
GET /api/whatsapp/log
```

**Response:**
```json
{
  "log": [
    {
      "id": "uuid-do-log",
      "timestamp": "2024-01-01T00:00:00.000Z",
      "action": "approved",
      "from": "5511999999999",
      "contactName": "João",
      "originalReply": "Olá! Como posso ajudar?",
      "sentReply": "Olá! Tudo bem?",
      "wasEdited": true
    }
  ]
}
```

### Histórico

#### Salvar Histórico

Salva o histórico de uma conversa no servidor.

```http
POST /api/history/save
Content-Type: application/json

{
  "conversationId": "conversation-uuid",
  "messages": [
    {
      "role": "user",
      "content": "Olá"
    },
    {
      "role": "assistant",
      "content": "Olá! Como posso ajudar?"
    }
  ]
}
```

**Response:**
```json
{
  "ok": true
}
```

#### Carregar Histórico

Carrega o histórico de uma conversa.

```http
GET /api/history/load?conversationId=conversation-uuid
```

**Response:**
```json
{
  "ok": true,
  "messages": [
    {
      "role": "user",
      "content": "Olá"
    },
    {
      "role": "assistant",
      "content": "Olá! Como posso ajudar?"
    }
  ]
}
```

#### Deletar Histórico

Deleta o histórico de uma conversa.

```http
DELETE /api/history/delete?conversationId=conversation-uuid
```

**Response:**
```json
{
  "ok": true
}
```

#### Listar Conversas

Lista todas as conversas salvas.

```http
GET /api/history/list
```

**Response:**
```json
{
  "ok": true,
  "conversations": [
    {
      "id": "conversation-uuid",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "messageCount": 10
    }
  ]
}
```

## Códigos de Status

- `200` - Sucesso
- `400` - Requisição inválida
- `401` - Não autenticado/a
- `404` - Recurso não encontrado
- `429` - Rate limit excedido
- `500` - Erro interno do servidor

## Rate Limiting

- **API geral**: 100 requisições por 15 minutos por IP
- **Login**: 5 tentativas por 15 minutos por IP

## CORS

Configure `CORS_ORIGIN` no `.env` para definir origens permitidas. Padrão: `*`.

## Erros

Todos os erros retornam JSON:

```json
{
  "error": "Mensagem de erro em português"
}
```
