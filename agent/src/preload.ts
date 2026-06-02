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
  releaseAllRemoteInput: () =>
    ipcRenderer.invoke("desklink-release-all-input") as Promise<void>,
  notifySessionActive: () => ipcRenderer.invoke("desklink-notify-session"),
  readClipboard: () =>
    ipcRenderer.invoke("desklink-clipboard-read") as Promise<string>,
  writeClipboard: (text: string) =>
    ipcRenderer.invoke("desklink-clipboard-write", text) as Promise<void>,
  setActiveDisplayBounds: (
    bounds: { x: number; y: number; width: number; height: number } | null,
  ) => ipcRenderer.invoke("desklink-set-active-display-bounds", bounds) as Promise<void>,
  annotateStroke: (payload: {
    bounds: { x: number; y: number; width: number; height: number };
    points: { x: number; y: number }[];
  }) => ipcRenderer.invoke("desklink-annotate-stroke", payload) as Promise<void>,
  annotateClear: () => ipcRenderer.invoke("desklink-annotate-clear") as Promise<void>,
  annotateClose: () => ipcRenderer.invoke("desklink-annotate-close") as Promise<void>,
  notifyChatMessage: (preview: string) =>
    ipcRenderer.invoke("desklink-notify-chat", preview) as Promise<void>,
});

export type DesklinkPreload = {
  getDesktopSources: () => Promise<DesktopSource[]>;
  applyControl: (json: string) => Promise<void>;
  releaseAllRemoteInput: () => Promise<void>;
  notifySessionActive: () => Promise<void>;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
  setActiveDisplayBounds: (
    bounds: { x: number; y: number; width: number; height: number } | null,
  ) => Promise<void>;
  annotateStroke: (payload: {
    bounds: { x: number; y: number; width: number; height: number };
    points: { x: number; y: number }[];
  }) => Promise<void>;
  annotateClear: () => Promise<void>;
  annotateClose: () => Promise<void>;
  notifyChatMessage: (preview: string) => Promise<void>;
};

declare global {
  interface Window {
    desklink: DesklinkPreload;
  }
}
