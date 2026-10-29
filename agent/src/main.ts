import { join, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  ipcMain,
  nativeImage,
  Notification,
  screen,
  type Display,
  type Rectangle,
} from "electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Windows: preferir .ico (vários tamanhos); PNG como fallback */
const iconIcoPath = join(__dirname, "..", "build", "icon.ico");
const iconPngPath = join(__dirname, "..", "build", "icon.png");

/**
 * Buffer + createFromBuffer: funciona com ficheiros dentro do app.asar;
 * createFromPath falha por vezes no Windows quando o caminho aponta para o asar.
 */
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

/** Limite alinhado ao plano (texto clipboard). */
const CLIPBOARD_MAX_CHARS = 256 * 1024;
const SPLASH_FALLBACK_MS = 10000;
const SPLASH_MIN_MS = 5000;

let splashShownAtMs = 0;

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let splashFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let mainWindowShown = false;
type ControlModule = typeof import("./control.js");
let controlModulePromise: Promise<ControlModule> | null = null;

function loadControlModule(): Promise<ControlModule> {
  if (!controlModulePromise) {
    controlModulePromise = import("./control.js");
  }
  return controlModulePromise;
}

let annotateOverlay: BrowserWindow | null = null;
/** Último tamanho lógico do canvas no overlay (evita redimensionar a cada traço — reset do canvas apaga o histórico). */
let annotateOverlayCanvasPx: { w: number; h: number } | null = null;

const ANNOTATE_OVERLAY_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:transparent}#c{display:block}</style></head><body><canvas id="c"></canvas><script>
const c=document.getElementById("c");
const ctx=c.getContext("2d");
window.__deskAnnotateResize=function(w,h){c.width=w;c.height=h;};
window.__deskAnnotateClear=function(){ctx.clearRect(0,0,c.width,c.height);};
window.__deskAnnotateStroke=function(pts){if(!pts||pts.length<2)return;ctx.strokeStyle="#e02020";ctx.lineWidth=3;ctx.lineJoin="round";ctx.lineCap="round";ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(var i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();};
</script></body></html>`;

function closeAnnotateOverlay() {
  annotateOverlayCanvasPx = null;
  if (!annotateOverlay || annotateOverlay.isDestroyed()) {
    annotateOverlay = null;
    return;
  }
  annotateOverlay.close();
  annotateOverlay = null;
}

function ensureAnnotateOverlay(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): BrowserWindow {
  const bx = Math.round(bounds.x);
  const by = Math.round(bounds.y);
  const bw = Math.max(1, Math.round(bounds.width));
  const bh = Math.max(1, Math.round(bounds.height));
  if (annotateOverlay && !annotateOverlay.isDestroyed()) {
    annotateOverlay.setBounds({ x: bx, y: by, width: bw, height: bh });
    const sizeChanged =
      !annotateOverlayCanvasPx ||
      annotateOverlayCanvasPx.w !== bw ||
      annotateOverlayCanvasPx.h !== bh;
    if (sizeChanged) {
      annotateOverlayCanvasPx = { w: bw, h: bh };
      void annotateOverlay.webContents.executeJavaScript(
        `try{window.__deskAnnotateResize(${bw},${bh});}catch(e){}`,
      );
    }
    return annotateOverlay;
  }
  const win = new BrowserWindow({
    x: bx,
    y: by,
    width: bw,
    height: bh,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(ANNOTATE_OVERLAY_HTML),
  );
  annotateOverlayCanvasPx = { w: bw, h: bh };
  win.webContents.once("did-finish-load", () => {
    if (!win.isDestroyed()) {
      void win.webContents.executeJavaScript(
        `try{window.__deskAnnotateResize(${bw},${bh});}catch(e){}`,
      );
    }
  });
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.showInactive();
  });
  annotateOverlay = win;
  win.on("closed", () => {
    if (annotateOverlay === win) annotateOverlay = null;
    annotateOverlayCanvasPx = null;
  });
  return win;
}

function clearSplashFallback() {
  if (splashFallbackTimer) {
    clearTimeout(splashFallbackTimer);
    splashFallbackTimer = null;
  }
}

function closeSplashWindow() {
  clearSplashFallback();
  if (!splashWindow) return;
  if (!splashWindow.isDestroyed()) {
    splashWindow.close();
  }
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
  <title>DeskLink</title>
  <style>
    :root {
      --bg-a: #0c1222;
      --bg-b: #101a31;
      --ink: #eef4ff;
      --muted: #b4c3e6;
      --accent: #4f8ff7;
    }
    html, body {
      margin: 0;
      height: 100%;
      color: var(--ink);
      font-family: "Segoe UI", system-ui, sans-serif;
      background: radial-gradient(circle at 25% 20%, rgba(79, 143, 247, 0.22), transparent 38%),
                  radial-gradient(circle at 78% 78%, rgba(89, 189, 255, 0.18), transparent 42%),
                  linear-gradient(160deg, var(--bg-a), var(--bg-b));
      overflow: hidden;
    }
    .wrap {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      transform: translateY(-2px);
    }
    .logo-shell {
      width: 78px;
      height: 78px;
      border-radius: 20px;
      display: grid;
      place-items: center;
      position: relative;
      background: rgba(17, 28, 52, 0.62);
      border: 1px solid rgba(168, 203, 255, 0.24);
      box-shadow: 0 16px 35px rgba(0, 0, 0, 0.35);
      animation: floatY 2.6s ease-in-out infinite;
    }
    .logo-shell::before {
      content: "";
      position: absolute;
      inset: -7px;
      border-radius: 24px;
      border: 2px solid rgba(79, 143, 247, 0.38);
      animation: halo 1.9s ease-out infinite;
    }
    .logo {
      width: 52px;
      height: 52px;
      object-fit: contain;
      filter: drop-shadow(0 6px 12px rgba(79, 143, 247, 0.35));
      animation: pulseLogo 1.4s ease-in-out infinite;
      user-select: none;
      -webkit-user-drag: none;
    }
    .title {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0.01em;
      margin-top: 4px;
    }
    .subtitle {
      font-size: 13px;
      color: var(--muted);
      letter-spacing: 0.01em;
    }
    .bar {
      width: 224px;
      height: 7px;
      border-radius: 999px;
      background: rgba(122, 149, 203, 0.25);
      overflow: hidden;
      margin-top: 8px;
    }
    .bar > span {
      display: block;
      width: 42%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, rgba(79, 143, 247, 0.35), rgba(79, 143, 247, 0.95));
      animation: loadMove 1s ease-in-out infinite;
    }
    @keyframes loadMove {
      0% { transform: translateX(-80%); }
      100% { transform: translateX(260%); }
    }
    @keyframes pulseLogo {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.04); }
    }
    @keyframes halo {
      0% { opacity: 0.7; transform: scale(0.94); }
      70% { opacity: 0; transform: scale(1.08); }
      100% { opacity: 0; transform: scale(1.08); }
    }
    @keyframes floatY {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px); }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="logo-shell">
        <img class="logo" src="${splashIconDataUrl}" alt="" />
      </div>
      <div class="title">DeskLink Host</div>
      <div class="subtitle">Inicializando aplicação...</div>
      <div class="bar" aria-hidden="true"><span></span></div>
    </div>
  </div>
</body>
</html>`;
  void splashWindow.loadURL(
    `data:text/html;charset=UTF-8,${encodeURIComponent(splashHtml)}`,
  );
  splashFallbackTimer = setTimeout(() => {
    closeSplashWindow();
    if (!mainWindowShown) {
      mainWindowShown = true;
      mainWindow?.show();
    }
  }, SPLASH_FALLBACK_MS);
}

function createWindow() {
  createSplashWindow();
  mainWindow = new BrowserWindow({
    width: 520,
    height: 860,
    minWidth: 400,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0d1528",
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      // CommonJS (.cjs): preload ESM falha com sandbox e window.desklink fica undefined
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
      // A UI aparece primeiro; o módulo de input pesado carrega depois.
      setTimeout(() => {
        void loadControlModule().catch(() => {});
      }, 0);
    }, remaining);
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
  });

  mainWindow.on("focus", () => {
    if (process.platform === "win32") {
      mainWindow?.flashFrame(false);
    }
  });

  void mainWindow.loadFile(join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  app.setName("DeskLink Host");
  app.setAppUserModelId("com.desklink.host");
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

type DisplayRect = { x: number; y: number; width: number; height: number };

function roundDisplayRect(rect: Rectangle): DisplayRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

/**
 * Retângulo em pixels físicos para SetCursorPos.
 * display.bounds do Electron é DIP; com escala ≠ 100% os dois divergem.
 */
function physicalInputBounds(display: Display): DisplayRect {
  const dip = display.bounds;
  if (process.platform !== "win32") {
    return {
      x: dip.x,
      y: dip.y,
      width: dip.width,
      height: dip.height,
    };
  }
  const sf = display.scaleFactor || 1;
  const converted = screen.dipToScreenRect(null, dip);
  const expectedW = dip.width * sf;
  if (Math.abs(converted.width - expectedW) <= 2) {
    return roundDisplayRect(converted);
  }
  const origin = screen.dipToScreenPoint({ x: dip.x, y: dip.y });
  return {
    x: Math.round(origin.x),
    y: Math.round(origin.y),
    width: Math.max(1, Math.round(dip.width * sf)),
    height: Math.max(1, Math.round(dip.height * sf)),
  };
}

ipcMain.handle("desktop-sources", async () => {
  const displays = screen.getAllDisplays();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1, height: 1 },
    fetchWindowIcons: false,
  });
  return sources.map((s) => {
    const displayId = Number.parseInt(s.display_id, 10);
    const display = Number.isFinite(displayId)
      ? displays.find((d) => d.id === displayId)
      : undefined;
    const bounds: DisplayRect | null = display
      ? {
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
        }
      : null;
    return {
      id: s.id,
      name: s.name,
      displayId: Number.isFinite(displayId) ? displayId : null,
      bounds,
      inputBounds: display ? physicalInputBounds(display) : null,
    };
  });
});

let applyControlChain: Promise<void> = Promise.resolve();

ipcMain.handle("apply-control", async (_e, json: string) => {
  const mod = await loadControlModule();
  const run = applyControlChain.then(() => mod.applyControlJson(json));
  applyControlChain = run.catch(() => {});
  await run;
});

ipcMain.handle("desklink-release-all-input", async () => {
  const mod = await loadControlModule();
  await mod.releaseAllRemoteInput();
});

function isDisplayBounds(
  bounds: unknown,
): bounds is { x: number; y: number; width: number; height: number } {
  return (
    typeof bounds === "object" &&
    bounds !== null &&
    typeof (bounds as { x?: unknown }).x === "number" &&
    typeof (bounds as { y?: unknown }).y === "number" &&
    typeof (bounds as { width?: unknown }).width === "number" &&
    typeof (bounds as { height?: unknown }).height === "number"
  );
}

ipcMain.handle(
  "desklink-set-active-display-bounds",
  async (_e, bounds: unknown) => {
    if (isDisplayBounds(bounds)) {
      const b = bounds;
      const mod = await loadControlModule();
      mod.setActiveDisplayBounds(b);
      if (annotateOverlay && !annotateOverlay.isDestroyed()) {
        ensureAnnotateOverlay(b);
        void annotateOverlay.webContents.executeJavaScript(
          "try{window.__deskAnnotateClear();}catch(e){}",
        );
      }
      return;
    }
    const mod = await loadControlModule();
    mod.setActiveDisplayBounds(null);
    closeAnnotateOverlay();
  },
);

ipcMain.handle("desklink-annotate-stroke", async (_e, payload: unknown) => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !isDisplayBounds((payload as { bounds?: unknown }).bounds)
  ) {
    return;
  }
  const { bounds, points } = payload as {
    bounds: { x: number; y: number; width: number; height: number };
    points: unknown;
  };
  if (!Array.isArray(points) || points.length < 2) return;
  const local: { x: number; y: number }[] = [];
  for (const p of points) {
    if (
      typeof p !== "object" ||
      p === null ||
      typeof (p as { x?: unknown }).x !== "number" ||
      typeof (p as { y?: unknown }).y !== "number"
    ) {
      return;
    }
    local.push({
      x: Math.round((p as { x: number }).x),
      y: Math.round((p as { y: number }).y),
    });
  }
  const win = ensureAnnotateOverlay(bounds);
  if (win.webContents.isLoading()) {
    await new Promise<void>((resolve) => {
      win.webContents.once("did-finish-load", resolve);
    });
  }
  const ptsJson = JSON.stringify(local);
  await win.webContents.executeJavaScript(
    `try{window.__deskAnnotateStroke(${ptsJson});}catch(e){}`,
  );
});

ipcMain.handle("desklink-annotate-clear", async () => {
  if (!annotateOverlay || annotateOverlay.isDestroyed()) return;
  void annotateOverlay.webContents.executeJavaScript(
    "try{window.__deskAnnotateClear();}catch(e){}",
  );
});

ipcMain.handle("desklink-annotate-close", () => {
  closeAnnotateOverlay();
});

ipcMain.handle("desklink-notify-session", () => {
  mainWindow?.minimize();
  if (Notification.isSupported()) {
    const n = new Notification({
      title: "DeskLink",
      body:
        "Conexão estabelecida. O controlador já está vendo sua tela; a janela foi minimizada.",
    });
    n.show();
  }
});

ipcMain.handle("desklink-notify-chat", (_e, preview: unknown) => {
  const body =
    typeof preview === "string"
      ? preview
      : preview == null
        ? ""
        : String(preview);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isFocused()) return;
  const clipped = body.length > 140 ? `${body.slice(0, 137)}…` : body;
  if (Notification.isSupported()) {
    const n = new Notification({
      title: "DeskLink — Nova mensagem no chat",
      body: clipped || "(sem texto)",
    });
    n.show();
  }
  if (process.platform === "win32") {
    mainWindow.flashFrame(true);
  }
});

ipcMain.handle("desklink-clipboard-read", () => {
  try {
    return clipboard.readText();
  } catch {
    return "";
  }
});

ipcMain.handle("desklink-clipboard-write", (_e, text: unknown) => {
  const s = typeof text === "string" ? text : "";
  const clipped = s.length > CLIPBOARD_MAX_CHARS ? s.slice(0, CLIPBOARD_MAX_CHARS) : s;
  clipboard.writeText(clipped);
});
