import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desklink", {
  getDesktopSources: () =>
    ipcRenderer.invoke("desktop-sources") as Promise<{ id: string; name: string }[]>,
  applyControl: (json: string) => ipcRenderer.invoke("apply-control", json),
  notifySessionActive: () => ipcRenderer.invoke("desklink-notify-session"),
  readClipboard: () =>
    ipcRenderer.invoke("desklink-clipboard-read") as Promise<string>,
  writeClipboard: (text: string) =>
    ipcRenderer.invoke("desklink-clipboard-write", text) as Promise<void>,
});

export type DesklinkPreload = {
  getDesktopSources: () => Promise<{ id: string; name: string }[]>;
  applyControl: (json: string) => Promise<void>;
  notifySessionActive: () => Promise<void>;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
};

declare global {
  interface Window {
    desklink: DesklinkPreload;
  }
}
