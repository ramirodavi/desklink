# DeskLink

Acesso remoto em tempo real entre dois PCs: **host** com app **Electron** (Windows, portátil) e **controlador** no **navegador**. A sinalização usa **Socket.io**; vídeo e controle (mouse/teclado) usam **WebRTC** (mídia + DataChannel).

| | |
|---|---|
| **Host** | App `DeskLinkHost-*-portable.exe` — compartilha a tela e recebe comandos |
| **Controlador** | Qualquer navegador moderno na mesma URL pública do seu servidor DeskLink |
| **Servidor** | Node (Express + Socket.io) — salas por UUID, troca de SDP/ICE |

---

## Pré-requisitos

| Item | Detalhe |
|------|---------|
| **Node.js** | **18+** ([nodejs.org](https://nodejs.org)) |
| **Host** | **Windows x64** (build portátil testado nesta plataforma) |
| **Build do agente (dev)** | Para `@nut-tree-fork/libnut`, o `postinstall` pode precisar de **Visual Studio Build Tools** com workload *Desktop development with C++* se houver recompilação nativa |

---

## Instalação (raiz do repositório)

```bash
git clone <seu-repositório>
cd DeskLink
npm install
```

---

## Desenvolvimento local

**Terminal 1** — API + UI estática (em dev o Vite faz proxy para o servidor):

```bash
npm run dev
```

- **API / Socket.io:** `http://localhost:3000`
- **Controlador (Vite):** `http://localhost:5173` — use esta URL no navegador; o proxy encaminha `/api` e `/socket.io` para a porta 3000

**Terminal 2** — app host (Electron):

```bash
npm run dev -w agent
```

### Fluxo recomendado (ordem importa)

1. **Servidor** rodando (`npm run dev`).
2. **Host (Electron):** cole o **URL do servidor** (em dev: `http://localhost:3000` ou o que o status indicar), aguarde **Conectado**, copie o **código UUID** e clique em **Iniciar compartilhamento** (escolha a tela se o sistema pedir).
3. **Controlador (navegador):** mesmo **URL do servidor**, mesmo **código da sessão**, **Conectar**.  
   O controlador só entra se o host já tiver **iniciado o compartilhamento**; não há popup de “permitir acesso” no host — o ato de compartilhar já autoriza a sessão.

---

## Produção (servir UI + API)

Compila **client**, **server** e **agent** (código):

```bash
npm run build
```

Sobe só o servidor (serve `client/dist` e `/api`):

```bash
npm run start -w server
```

Abra `http://localhost:3000` (ou o host/porta configurados). O controlador usa **a mesma origem** do servidor em produção.

### Variáveis de ambiente (`server/.env`)

Copie o exemplo e ajuste:

```bash
cp server/.env.example server/.env
```

| Variável | Uso |
|----------|-----|
| `PORT` | Porta HTTP (padrão `3000`) |
| `CLIENT_ORIGIN` | CORS: em produção use a origem real do controlador (ex. `https://desklink.seudominio.com`) ou `*` só em testes |
| `METERED_DOMAIN` / `METERED_API_KEY` | TURN via [Metered](https://www.metered.ca/) — ver secção ICE abaixo |
| `ICE_SERVERS_JSON` | Lista ICE estática (se definida, **substitui** Metered) |

**Não commite** `.env` com API keys reais. O `.env.example` está no repositório sem segredos.

### Windows: scripts na raiz

| Ficheiro | Função |
|----------|--------|
| [desklink-server.bat](desklink-server.bat) | Instala dependências se precisar, compila client/server se faltar `dist`, inicia o servidor |
| [desklink-build-agent.bat](desklink-build-agent.bat) | Build client + server + `npm run pack -w agent` → `agent/release/` (`DeskLinkHost-*-portable.exe`) |
| [desklink-tunnel.bat](desklink-tunnel.bat) | (Opcional) Túnel Cloudflare para expor `localhost:3000` |

---

## ICE / TURN (obrigatório para internet / NAT diferente)

Por defeito só existe **STUN** público (`stun.l.google.com`). Para dois PCs em redes diferentes, configure **TURN** (Metered ou lista estática).

### Metered (recomendado)

1. Crie uma app em [Metered](https://www.metered.ca/), copie o **domínio** (ex. `desklink.metered.live`) e a **API Key**.
2. Em `server/.env`:

```env
METERED_DOMAIN=desklink.metered.live
METERED_API_KEY=sua_chave_aqui
```

O servidor expõe `GET /api/ice-servers` com credenciais em cache curto.

### Lista estática (`ICE_SERVERS_JSON`)

Se definir `ICE_SERVERS_JSON` no ambiente, **ignora** Metered. Exemplo (PowerShell):

```powershell
$env:ICE_SERVERS_JSON='[{"urls":["turn:turn.example.com:3478"],"username":"u","credential":"p"}]'
```

---

## Túnel gratuito (sem IP público)

Se o provedor usa **CGNAT** ou não dá para abrir porta, exponha o DeskLink com **Cloudflare Quick Tunnel** (grátis, sem cartão).

### 1. Instalar `cloudflared` (uma vez no Windows)

1. [Releases cloudflared](https://github.com/cloudflare/cloudflared/releases) → baixe **`cloudflared-windows-amd64.exe`**.
2. Renomeie para **`cloudflared.exe`** e coloque na **raiz** do repositório (junto a `desklink-tunnel.bat`).

### 2. Dois processos em paralelo

- Janela A: [desklink-server.bat](desklink-server.bat) (servidor em `http://localhost:3000`).
- Janela B: [desklink-tunnel.bat](desklink-tunnel.bat) — ou manualmente:  
  `cloudflared tunnel --url http://localhost:3000`

O túnel mostra um URL **`https://….trycloudflare.com`**. Esse é o URL público: use-o no **controlador** e no **campo do servidor do host** (sem barra no final).

### 3. Observações

- Cada reinício do túnel pode gerar **URL nova** (plano gratuito).
- Na primeira visita pode aparecer página intersticial da Cloudflare — continue.
- Alternativa: [ngrok](https://ngrok.com/) (`ngrok http 3000`).
- **Metered** (`METERED_*` no `.env`) continua recomendado para WebRTC entre redes diferentes.

---

## Estrutura do repositório

```
server/   Express + Socket.io, salas por UUID, relay SDP/ICE
client/   Vite — controlador (vídeo, overlay, atalhos)
agent/    Electron — captura de ecrã + @nut-tree-fork/nut-js (input)
```

---

## Limitações

- Pensado para **um par** host/controlador por sessão (UUID)
- Sem chat nem transferência de ficheiros
- Controlo pode falhar em prompts elevados (UAC) ou fora da sessão do utilizador no Windows
- Atalhos **Win+…** no controlador podem ser interceptados pelo SO local; o painel de **atalhos** envia comandos pelo DataChannel sem depender do teclado físico
