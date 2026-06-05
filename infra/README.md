# Infra — Evolution Chat

Stack de produção (Evolution API + Chatwoot + Postgres + Redis) que roda num
servidor Hetzner. O dashboard Next.js (na Vercel) é só o painel de controle —
**esta pasta é a infra de verdade**, agora versionada no repo para nunca mais
se perder com o servidor.

> **Por que isso existe:** o servidor original foi perdido e o `docker-compose`
> vivia só nele, sem backup. Reconstruído a partir do que o dashboard exige.

## Arquitetura

```
Vercel (dashboard Next.js)
   │  HTTP (IP público)
   ├─────────────► http://SERVER_IP:8080  Evolution API
   └─────────────► http://SERVER_IP:3000  Chatwoot
                          │
   Servidor Hetzner (rede docker `evolution-net`):
     evolution-api  ──► chatwoot-rails:3000   (integração)
     chatwoot-rails ──► evolution-api:8080    (webhooks)
     ambos          ──► postgres / redis
```

Os nomes `evolution-api` e `chatwoot-rails` são **contratuais** — o dashboard
injeta `http://evolution-api:8080` e `http://chatwoot-rails:3000` como URLs
internas container-a-container. **Não renomear os serviços.**

Proxy: o IPRoyal é configurado **por instância** pelo próprio dashboard via
`/proxy/set` do Evolution (sticky `_country-br_session-<chip>`). Não há
dependência de infra extra pra isso.

## Pré-requisitos locais

- `hcloud` CLI (Hetzner) — instruções abaixo
- Um par de chaves SSH **que vamos salvar desta vez** (o anterior se perdeu)
- Token da API Hetzner (criado no painel → Security → API Tokens, com Read & Write)

## Passo a passo da reconstrução

### 1. Chave SSH (guardar a privada!)

```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\hetzner-evolution -N '""' -C "evolution-chat"
```

Isso gera `hetzner-evolution` (privada — **NÃO PERDER**) e `.pub` (pública).

### 2. hcloud CLI + token

```powershell
winget install Hetzner.hcloud        # ou: scoop install hcloud
hcloud context create evolution      # cola o token quando pedir
hcloud ssh-key create --name hetzner-evolution --public-key-from-file $HOME\.ssh\hetzner-evolution.pub
```

### 3. Criar o servidor (cx33, Helsinki, com cloud-init)

```powershell
hcloud server create `
  --name evolution `
  --type cx33 `
  --image ubuntu-24.04 `
  --location hel1 `
  --ssh-key hetzner-evolution `
  --user-data-from-file infra/cloud-init.yaml
```

Anote o **IP** retornado. O cloud-init instala Docker, swap, firewall (22/8080/3000).

### 4. Preencher os segredos

No `.env` e no `chatwoot.env`, trocar `CHANGE_ME` pelo IP do servidor.
(`POSTGRES_PASSWORD`, `SECRET_KEY_BASE` e `EVOLUTION_API_KEY` já vêm preenchidos.)

### 5. Copiar a stack e subir

```powershell
scp -i $HOME\.ssh\hetzner-evolution -r infra/* root@SERVER_IP:/opt/evolution-chat/
ssh -i $HOME\.ssh\hetzner-evolution root@SERVER_IP "cd /opt/evolution-chat && chmod +x bootstrap.sh && ./bootstrap.sh"
```

O `bootstrap.sh` sobe Postgres/Redis, roda as migrations do Chatwoot e levanta tudo.

### 6. Criar a conta admin do Chatwoot

1. Abrir `http://SERVER_IP:3000` → criar conta admin (e-mail/senha).
2. Profile Settings → **Access Token** → copiar.
3. A conta nova terá um `account_id` (provavelmente `1`).

> ⚠️ O `CHATWOOT_API_TOKEN` e o `CHATWOOT_ACCOUNT_ID` **mudam** numa instalação
> nova — os antigos morreram com o servidor.

### 7. Atualizar o dashboard (Vercel)

Variáveis que **mudam** (novo IP / nova conta Chatwoot):

| Variável | Novo valor |
|---|---|
| `EVOLUTION_API_URL` | `http://SERVER_IP:8080` |
| `CHATWOOT_API_URL` | `http://SERVER_IP:3000` |
| `CHATWOOT_API_TOKEN` | token do passo 6 |
| `CHATWOOT_ACCOUNT_ID` | account_id do passo 6 (ex: `1`) |

Que **continuam iguais** (não mexer): `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_BASE`,
`CHATWOOT_INTERNAL_URL`, `MARKETBET_API_KEY`, `MARKETBET_PROXY_*`, `CRON_SECRET`,
`NEXTAUTH_*`. (O proxy agora é a API marketbet, externa — independe do servidor.)

```powershell
# da raiz do projeto:
vercel env rm EVOLUTION_API_URL production ; vercel env add EVOLUTION_API_URL production
# repetir p/ CHATWOOT_API_URL, CHATWOOT_API_TOKEN, CHATWOOT_ACCOUNT_ID
vercel --prod   # redeploy
```

### 8. Re-parear os chips

Como as sessões WhatsApp se perderam, cada chip precisa reconectar pelo
dashboard (QR/pairing → setup cria inbox + proxy + chatwoot). Sem atalho aqui.

## Operação

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs -f evolution-api chatwoot-rails
docker compose --env-file .env restart evolution-api
docker compose --env-file .env down        # para tudo (dados ficam nos volumes)
```

Backup dos volumes (fazer rotina!):
```bash
docker run --rm -v postgres_data:/data -v $PWD:/backup alpine \
  tar czf /backup/postgres-$(date +%F).tar.gz -C /data .
```

## Componentes NÃO reconstruídos (confirmar se precisa)

- **redsocks / serviço `:9090/exclude`**: era um sidecar custom de proxy
  transparente cujo fonte se perdeu. O dashboard só o chama em
  `setup/route.ts` para proxies **manuais**, e a chamada é fire-and-forget
  (`.catch(() => null)`) — então a stack sobe e funciona sem ele. O proxy real
  dos chips é feito pelo Evolution per-instância. **Só vale reconstruir se você
  usa proxies manuais** e precisa excluí-los do redirecionamento. Me avise que
  eu monto o sidecar.
