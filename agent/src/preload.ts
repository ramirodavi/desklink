import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desklink", {
  getDesktopSources: () =>
    ipcRenderer.invoke("desktop-sources") as Promise<{ id: string; name: string }[]>,
  applyControl: (json: string) => ipcRenderer.invoke("apply-control", json),
  notifySessionActive: () => ipcRenderer.invoke("desklink-notify-session"),
});

export type DesklinkPreload = {
  getDesktopSources: () => Promise<{ id: string; name: string }[]>;
  applyControl: (json: string) => Promise<void>;
  notifySessionActive: () => Promise<void>;
};

declare global {
  interface Window {
    desklink: DesklinkPreload;
  }
}
