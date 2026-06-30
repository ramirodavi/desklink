import { contextBridge, ipcRenderer } from "electron";

type StatusPayload = { phase: string; message?: string };
type TunnelStatusPayload = { phase: string; url?: string; message?: string };
type LogPayload = { line: string };

contextBridge.exposeInMainWorld("desklinkServer", {
  onStatus: (cb: (d: StatusPayload) => void) =>
    ipcRenderer.on("server:status", (_e, d: StatusPayload) => cb(d)),
  onTunnelStatus: (cb: (d: TunnelStatusPayload) => void) =>
    ipcRenderer.on("server:tunnel-status", (_e, d: TunnelStatusPayload) => cb(d)),
  onLog: (cb: (d: LogPayload) => void) =>
    ipcRenderer.on("server:log", (_e, d: LogPayload) => cb(d)),
  openBrowser: () => ipcRenderer.invoke("server:open-browser") as Promise<void>,
  stopServer: () => ipcRenderer.invoke("server:stop") as Promise<void>,
  copyText: (text: string) =>
    ipcRenderer.invoke("server:copy-text", text) as Promise<void>,
  restartTunnel: () =>
    ipcRenderer.invoke("server:restart-tunnel") as Promise<void>,
});

export type DesklinkServerPreload = {
  onStatus: (cb: (d: StatusPayload) => void) => void;
  onTunnelStatus: (cb: (d: TunnelStatusPayload) => void) => void;
  onLog: (cb: (d: LogPayload) => void) => void;
  openBrowser: () => Promise<void>;
  stopServer: () => Promise<void>;
  copyText: (text: string) => Promise<void>;
  restartTunnel: () => Promise<void>;
};

declare global {
  interface Window {
    desklinkServer: DesklinkServerPreload;
  }
}
