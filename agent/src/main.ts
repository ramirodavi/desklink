import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, desktopCapturer, ipcMain, Notification } from "electron";
import { applyControlJson } from "./control.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const iconPath = join(__dirname, "..", "build", "icon.png");

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 380,
    minHeight: 560,
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      // CommonJS (.cjs): preload ESM falha com sandbox e window.desklink fica undefined
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void mainWindow.loadFile(join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.desklink.host");
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("desktop-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1, height: 1 },
    fetchWindowIcons: false,
  });
  return sources.map((s) => ({ id: s.id, name: s.name }));
});

ipcMain.handle("apply-control", async (_e, json: string) => {
  await applyControlJson(json);
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
