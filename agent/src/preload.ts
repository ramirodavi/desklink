import { contextBridge, ipcRenderer } from "electron";

type DesktopSource = {
  id: string;
  name: string;
  displayId: number | null;
  bounds: { x: number; y: number; width: number; height: number } | null;
};

contextBridge.exposeInMainWorld("desklink", {
  getDesktopSources: () =>
    ipcRenderer.invoke("desktop-sources") as Promise<DesktopSource[]>,
  applyControl: (json: string) => ipcRenderer.invoke("apply-control", json),
  notifySessionActive: () => ipcRenderer.invoke("desklink-notify-session"),
  readClipboard: () =>
    ipcRenderer.invoke("desklink-clipboard-read") as Promise<string>,
  writeClipboard: (text: string) =>
    ipcRenderer.invoke("desklink-clipboard-write", text) as Promise<void>,
  setActiveDisplayBounds: (
    bounds: { x: number; y: number; width: number; height: number } | null,
  ) => ipcRenderer.invoke("desklink-set-active-display-bounds", bounds) as Promise<void>,
});

export type DesklinkPreload = {
  getDesktopSources: () => Promise<DesktopSource[]>;
  applyControl: (json: string) => Promise<void>;
  notifySessionActive: () => Promise<void>;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
  setActiveDisplayBounds: (
    bounds: { x: number; y: number; width: number; height: number } | null,
  ) => Promise<void>;
};

declare global {
  interface Window {
    desklink: DesklinkPreload;
  }
}
