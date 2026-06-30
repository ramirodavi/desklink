import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeImage,
  shell,
} from "electron";
import { startServer } from "../../server/src/index.js";

// esbuild compila este arquivo para CJS (--format=cjs).
// No contexto CJS do Node.js, __dirname é sempre injetado pelo module wrapper.
declare const __dirname: string;

const iconIcoPath = join(__dirname, "..", "build", "icon.ico");
const iconPngPath = join(__dirname, "..", "build", "icon.png");

function loadWindowIcon(): Electron.NativeImage | undefined {
  const tryFile = (p: string) => {
    if (!existsSync(p)) return undefined;
    try {
      const buf = readFileSync(p);
      const img = nativeImage.createFromBuffer(buf);
      return img.isEmpty() ? undefined : img;
    } catch {
      return undefined;
    }
  };
  return tryFile(iconIcoPath) ?? tryFile(iconPngPath);
}

const windowIcon = loadWindowIcon();

const SPLASH_FALLBACK_MS = 8_000;
const SPLASH_MIN_MS = 4_000;
let splashShownAtMs = 0;

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let splashFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let mainWindowShown = false;

let cloudflaredProcess: ChildProcess | null = null;
let serverPort = 3000;

// ---------------------------------------------------------------------------
// Caminhos contextuais (dev vs. packaged)
// ---------------------------------------------------------------------------

function getClientDistPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "client-dist");
  }
  return join(__dirname, "../../client/dist");
}

function getBrandIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "brand-icon.png");
  }
  return join(__dirname, "../../agent/build/icon.png");
}

function findCloudflared(): string | null {
  // 1. App empacotado: resources/cloudflared.exe
  if (app.isPackaged) {
    const bundled = join(process.resourcesPath, "cloudflared.exe");
    if (existsSync(bundled)) return bundled;
  }
  // 2. Dev: agent-server/resources/cloudflared.exe
  const devPath = join(__dirname, "..", "resources", "cloudflared.exe");
  if (existsSync(devPath)) return devPath;
  // 3. Raiz do repositório (compatibilidade com .bat existente)
  const rootPath = join(__dirname, "..", "..", "cloudflared.exe");
  if (existsSync(rootPath)) return rootPath;
  // 4. PATH do sistema
  const which = spawnSync("where", ["cloudflared"], {
    encoding: "utf8",
    shell: false,
  });
  if (which.status === 0 && which.stdout.trim()) {
    return which.stdout.trim().split(/\r?\n/)[0].trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// IPC helpers — enviar para renderer
// ---------------------------------------------------------------------------

type ServerPhase = "starting" | "ready" | "error";
type TunnelPhase = "idle" | "starting" | "ready" | "error";

// Estado atual mantido em memória para reenviar ao renderer quando ele terminar de carregar.
let currentServerPhase: ServerPhase = "starting";
let currentServerMessage: string | undefined;
let currentTunnelPhase: TunnelPhase = "idle";
let currentTunnelUrl: string | undefined;
let currentTunnelMessage: string | undefined;
const pendingLogs: string[] = [];
const MAX_PENDING_LOGS = 300;

function sendStatus(phase: ServerPhase, message?: string) {
  currentServerPhase = phase;
  currentServerMessage = message;
  mainWindow?.webContents.send("server:status", { phase, message });
}

function sendTunnelStatus(phase: TunnelPhase, url?: string, message?: string) {
  currentTunnelPhase = phase;
  currentTunnelUrl = url;
  currentTunnelMessage = message;
  mainWindow?.webContents.send("server:tunnel-status", { phase, url, message });
}

function sendLog(line: string) {
  pendingLogs.push(line);
  if (pendingLogs.length > MAX_PENDING_LOGS) pendingLogs.shift();
  mainWindow?.webContents.send("server:log", { line });
}

/** Reenvia o estado completo para o renderer recém-carregado. */
function flushStateToRenderer() {
  if (!mainWindow) return;
  const wc = mainWindow.webContents;
  wc.send("server:status", { phase: currentServerPhase, message: currentServerMessage });
  wc.send("server:tunnel-status", {
    phase: currentTunnelPhase,
    url: currentTunnelUrl,
    message: currentTunnelMessage,
  });
  for (const line of pendingLogs) {
    wc.send("server:log", { line });
  }
}

// ---------------------------------------------------------------------------
// Lógica do servidor e cloudflared
// ---------------------------------------------------------------------------

async function startInternalServer(): Promise<void> {
  const PORT = 3000;

  sendStatus("starting");
  sendLog("[servidor] Iniciando servidor de sinalização na porta " + String(PORT) + "...");

  try {
    await startServer({
      port: PORT,
      clientDistPath: getClientDistPath(),
      brandIconPath: getBrandIconPath(),
      onReady: (port) => {
        serverPort = port;
        sendStatus("ready");
        sendLog("[servidor] Servidor ativo em http://localhost:" + String(port));
        spawnCloudflared();
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendStatus("error", msg);
    sendLog("[servidor] ERRO: " + msg);
  }
}

function spawnCloudflared(): void {
  const cf = findCloudflared();
  if (!cf) {
    const msg =
      "cloudflared não encontrado. Baixe em https://github.com/cloudflare/cloudflared/releases " +
      "e coloque cloudflared.exe na pasta resources/ do DeskLink Server.";
    sendTunnelStatus("error", undefined, msg);
    sendLog("[túnel] ERRO: " + msg);
    return;
  }

  sendTunnelStatus("starting");
  sendLog("[túnel] Iniciando túnel Cloudflare... (" + cf + ")");

  const proc = spawn(cf, ["tunnel", "--url", "http://localhost:" + String(serverPort)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  cloudflaredProcess = proc;

  const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

  const onData = (data: Buffer) => {
    const lines = data.toString().split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      sendLog("[túnel] " + line);
      if (!currentTunnelUrl) {
        const m = line.match(TUNNEL_URL_RE);
        if (m) {
          const url = m[0];
          sendTunnelStatus("ready", url);
          sendLog("[túnel] URL ativa: " + url);
          void shell.openExternal(url);
        }
      }
    }
  };

  proc.stdout?.on("data", onData);
  proc.stderr?.on("data", onData);

  proc.on("exit", (code) => {
    cloudflaredProcess = null;
    if (code !== 0 && code !== null) {
      sendTunnelStatus("error", undefined, "cloudflared encerrado com código " + String(code));
      sendLog("[túnel] Processo encerrado (código " + String(code) + ")");
    } else {
      sendTunnelStatus("idle");
      sendLog("[túnel] Processo encerrado.");
    }
  });

  proc.on("error", (err) => {
    cloudflaredProcess = null;
    sendTunnelStatus("error", undefined, err.message);
    sendLog("[túnel] ERRO ao iniciar processo: " + err.message);
  });
}

function killCloudflared() {
  if (cloudflaredProcess && !cloudflaredProcess.killed) {
    cloudflaredProcess.kill();
    cloudflaredProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Janela splash
// ---------------------------------------------------------------------------

function clearSplashFallback() {
  if (splashFallbackTimer) {
    clearTimeout(splashFallbackTimer);
    splashFallbackTimer = null;
  }
}

function closeSplashWindow() {
  clearSplashFallback();
  if (!splashWindow) return;
  if (!splashWindow.isDestroyed()) splashWindow.close();
  splashWindow = null;
}

function createSplashWindow() {
  closeSplashWindow();
  splashShownAtMs = Date.now();
  const splashIconDataUrl = windowIcon?.toDataURL() ?? "";

  splashWindow = new BrowserWindow({
    width: 360,
    height: 230,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    movable: false,
    alwaysOnTop: true,
    backgroundColor: "#0d1528",
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const splashHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>DeskLink Server</title>
  <style>
    :root{--bg-a:#0c1222;--bg-b:#101a31;--ink:#eef4ff;--muted:#b4c3e6;--accent:#4f8ff7;}
    html,body{margin:0;height:100%;color:var(--ink);font-family:"Segoe UI",system-ui,sans-serif;
      background:radial-gradient(circle at 25% 20%,rgba(79,143,247,.22),transparent 38%),
                 radial-gradient(circle at 78% 78%,rgba(89,189,255,.18),transparent 42%),
                 linear-gradient(160deg,var(--bg-a),var(--bg-b));overflow:hidden;}
    .wrap{height:100%;display:flex;align-items:center;justify-content:center;}
    .card{display:flex;flex-direction:column;align-items:center;gap:10px;transform:translateY(-2px);}
    .logo-shell{width:78px;height:78px;border-radius:20px;display:grid;place-items:center;position:relative;
      background:rgba(17,28,52,.62);border:1px solid rgba(168,203,255,.24);box-shadow:0 16px 35px rgba(0,0,0,.35);
      animation:floatY 2.6s ease-in-out infinite;}
    .logo-shell::before{content:"";position:absolute;inset:-7px;border-radius:24px;
      border:2px solid rgba(79,143,247,.38);animation:halo 1.9s ease-out infinite;}
    .logo{width:52px;height:52px;object-fit:contain;filter:drop-shadow(0 6px 12px rgba(79,143,247,.35));
      animation:pulseLogo 1.4s ease-in-out infinite;user-select:none;-webkit-user-drag:none;}
    .title{font-size:18px;font-weight:700;letter-spacing:.01em;margin-top:4px;}
    .subtitle{font-size:13px;color:var(--muted);letter-spacing:.01em;}
    .bar{width:224px;height:7px;border-radius:999px;background:rgba(122,149,203,.25);overflow:hidden;margin-top:8px;}
    .bar>span{display:block;width:42%;height:100%;border-radius:inherit;
      background:linear-gradient(90deg,rgba(79,143,247,.35),rgba(79,143,247,.95));
      animation:loadMove 1s ease-in-out infinite;}
    @keyframes loadMove{0%{transform:translateX(-80%)}100%{transform:translateX(260%)}}
    @keyframes pulseLogo{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
    @keyframes halo{0%{opacity:.7;transform:scale(.94)}70%{opacity:0;transform:scale(1.08)}100%{opacity:0;transform:scale(1.08)}}
    @keyframes floatY{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="logo-shell"><img class="logo" src="${splashIconDataUrl}" alt="" /></div>
      <div class="title">DeskLink Server</div>
      <div class="subtitle">Inicializando...</div>
      <div class="bar" aria-hidden="true"><span></span></div>
    </div>
  </div>
</body>
</html>`;

  void splashWindow.loadURL(
    "data:text/html;charset=UTF-8," + encodeURIComponent(splashHtml),
  );

  splashFallbackTimer = setTimeout(() => {
    closeSplashWindow();
    if (!mainWindowShown) {
      mainWindowShown = true;
      mainWindow?.show();
    }
  }, SPLASH_FALLBACK_MS);
}

// ---------------------------------------------------------------------------
// Janela principal
// ---------------------------------------------------------------------------

function createWindow() {
  createSplashWindow();

  mainWindow = new BrowserWindow({
    width: 500,
    height: 700,
    minWidth: 420,
    minHeight: 580,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0d1528",
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (windowIcon) {
    const applyIcon = () => mainWindow?.setIcon(windowIcon);
    mainWindow.once("ready-to-show", applyIcon);
    mainWindow.webContents.once("did-finish-load", applyIcon);
  }

  mainWindow.removeMenu();

  mainWindow.once("ready-to-show", () => {
    const elapsed = Date.now() - splashShownAtMs;
    const remaining = Math.max(0, SPLASH_MIN_MS - elapsed);
    setTimeout(() => {
      closeSplashWindow();
      if (!mainWindowShown) {
        mainWindowShown = true;
        mainWindow?.show();
      }
    }, remaining);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    flushStateToRenderer();
  });

  mainWindow.webContents.once("did-fail-load", () => {
    const elapsed = Date.now() - splashShownAtMs;
    const remaining = Math.max(0, SPLASH_MIN_MS - elapsed);
    setTimeout(() => {
      closeSplashWindow();
      if (!mainWindowShown) {
        mainWindowShown = true;
        mainWindow?.show();
      }
    }, remaining);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    closeSplashWindow();
    killCloudflared();
  });

  void mainWindow.loadFile(join(__dirname, "renderer", "index.html"));
}

// ---------------------------------------------------------------------------
// Ciclo de vida Electron
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  app.setName("DeskLink Server");
  app.setAppUserModelId("com.desklink.server");
  createWindow();
  void startInternalServer();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  killCloudflared();
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------------------
// Handlers IPC (renderer → main)
// ---------------------------------------------------------------------------

ipcMain.handle("server:open-browser", () => {
  if (currentTunnelUrl) void shell.openExternal(currentTunnelUrl);
});

ipcMain.handle("server:stop", () => {
  killCloudflared();
  app.quit();
});

ipcMain.handle("server:copy-text", (_e, text: unknown) => {
  clipboard.writeText(typeof text === "string" ? text : "");
});

ipcMain.handle("server:restart-tunnel", () => {
  killCloudflared();
  sendTunnelStatus("starting");
  sendLog("[túnel] Reiniciando túnel...");
  spawnCloudflared();
});
