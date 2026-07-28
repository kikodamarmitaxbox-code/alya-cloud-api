# Alya Assistente - Versao Publica

## Como usar

1. Execute o arquivo `start-alya.ps1`
2. O servidor iniciara automaticamente
3. O Cloudflare Tunnel criara um link publico automaticamente
4. O link aparecera no topo da tela da Alya
5. Clique em "Copiar" para compartilhar com seus amigos

## Funcionalidades

- Chat com IA
- Alya Code no terminal para ler, editar e testar projetos com confirmação
- Code Alya: painel visual com chat, editor, arquivos e terminal seguro
- Multiplas conversas
- Personalidade e modo configurados
- Memoria persistente
- Tema claro/escuro
- Link publico automatico via Cloudflare Tunnel

## Acesso local

- http://localhost:3000/aly

## Acesso publico

- O link e gerado automaticamente pelo Cloudflare Tunnel
- O link fica disponivel enquanto o programa estiver aberto
- Nao precisa configurar nada adicional

## Alya Code no terminal

Abra o terminal na pasta do projeto e execute:

```powershell
npm run code
```

O modelo principal e `gemini-3.5-flash`. Crie uma chave gratuita em
https://aistudio.google.com/app/apikey e coloque `GEMINI_API_KEY` no arquivo
`.env`. Sem essa chave, a Alya Code tenta automaticamente o Mistral configurado.

A Alya Code pede confirmacao antes de alterar arquivos ou executar testes.
Use `/help` para ver os comandos e `/undo` para desfazer a ultima tarefa.

## Code Alya (painel visual)

Abra `http://localhost:3000/code-alya` ou use o botão **Code Alya** dentro da Alya.
Ela mostra os arquivos do projeto, um editor e um terminal com comandos permitidos.
No chat, descreva o que quer criar: a Code Alya prepara um plano e só aplica as
mudanças após você revisar a prévia e clicar em **Aplicar com backup**. O painel
guarda a conversa neste navegador, registra as ações e oferece o botão **↶** para
desfazer a última alteração. Se uma escrita falhar no meio, os arquivos já
tocados voltam automaticamente à versão anterior.

A Code Alya tenta primeiro o provedor escolhido em `AI_PROVIDER` ou
`ALYA_CODE_PROVIDER` e troca automaticamente quando ele não responde. `.env`,
chaves e pastas internas permanecem bloqueados. Use `npm run verify` para
conferir a integridade do projeto e das proteções.
