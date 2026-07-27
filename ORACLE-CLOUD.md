# Alya online 24 horas na Oracle Cloud

Este projeto já pode ser executado em uma máquina gratuita da Oracle Cloud.

## O que você precisa fazer primeiro

1. Crie uma conta em https://www.oracle.com/cloud/free/
2. Na criação, escolha com cuidado a região inicial (a máquina gratuita fica nessa região).
3. Quando chegar ao painel da Oracle, crie uma instância **Always Free** com Ubuntu.

Não envie nem publique o arquivo `.env`: ele contém as chaves privadas da Alya.

## Como ela vai rodar no servidor

Na máquina da Oracle, com os arquivos do projeto e um `.env` preenchido, rode:

```bash
docker compose up -d --build
```

O Docker reinicia a Alya automaticamente se a máquina reiniciar. Os dados ficam na pasta `nova-data`.

## Segurança

- Abra somente as portas necessárias: 22 (administração) e 3000 (Alya), ou use um domínio/reverse proxy depois.
- Cadastre as variáveis privadas diretamente no servidor, nunca em um repositório público.
- O recurso de abrir programas do computador continua apenas no computador local e com confirmação. Um servidor na internet não receberá controle livre do seu PC.
