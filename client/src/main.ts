import { io, type Socket } from "socket.io-client";
import type { ControlMsg } from "./protocol.js";
import {
  runShortcutSequence,
  SHORTCUT_SEQUENCES,
} from "./shortcuts.js";

document.title = "DeskLink — Controlador Remoto";

function $(sel: string) {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Missing ${sel}`);
  return el as HTMLElement;
}

const defaultServer = "";

const app = $("#app");
app.innerHTML = `
  <div class="panel connect-panel">
    <div class="connect-header">
      <img src="/api/brand-icon" width="40" height="40" alt="" decoding="async" />
      <div>
        <h1>DeskLink</h1>
        <p>Controlador — conecte com o código que o host enviou</p>
      </div>
    </div>
    <div class="row">
      <label>URL do servidor (vazio = esta página; use http://…)
        <input type="text" id="serverUrl" placeholder="http://203.0.113.10:3000" value="${defaultServer}" />
      </label>
      <label>Código da sessão
        <input type="text" id="sessionId" placeholder="UUID do host" autocomplete="off" />
      </label>
      <button type="button" id="btnConnect">Conectar</button>
      <button type="button" id="btnDisconnect" class="danger" disabled>Desconectar</button>
    </div>
    <p class="status" id="status">Informe o código; o host precisa estar com o DeskLink aberto e com “Iniciar compartilhamento” já ativo.</p>
  </div>
  <div class="panel remote-panel hidden" id="remotePanel">
    <div class="remote-toolbar">
      <div class="remote-toolbar-head">
        <span class="remote-toolbar-title">Área remota</span>
        <button type="button" class="monitor-indicator" id="monitorIndicator" title="Clique para alternar o monitor remoto ativo">
          <span class="monitor-indicator-icon" aria-hidden="true">↹</span>
          <span class="monitor-indicator-label">Monitor: aguardando…</span>
        </button>
      </div>
      <div class="remote-toolbar-actions">
        <label class="remote-control-label" title="Quando desmarcado, a área remota fica apenas em visualização (sem enviar mouse/teclado ao host).">
          <input type="checkbox" id="remoteControlEnabled" checked />
          Habilitar controle remoto
        </label>
        <label class="wheel-sensitivity-label" title="Ajusta a sensibilidade da rolagem enviada ao host. Aplique sem reconectar.">
          Sensibilidade da rolagem
          <select id="wheelSensitivity">
            <option value="low">Baixa</option>
            <option value="medium" selected>Média</option>
            <option value="high">Alta</option>
          </select>
        </label>
        <label class="clipboard-sync-label" title="Sincroniza a área de transferência entre este PC e o remoto. Apenas texto. O navegador pode pedir permissão de leitura.">
          <input type="checkbox" id="clipboardSync" />
          Sincronizar área de transferência
        </label>
        <button type="button" class="btn-ghost" id="btnFocusRemote" title="Rola a página para a área remota ocupar a janela">Focar na tela remota</button>
        <button type="button" class="btn-ghost" id="btnFullscreen" title="Tela cheia do navegador">Tela cheia</button>
      </div>
    </div>
    <div class="shortcut-panel" id="shortcutPanel">
      <div class="shortcut-panel-head">
        <span class="shortcut-panel-title">Atalhos no PC remoto</span>
        <span class="shortcut-panel-hint">Envia o comando direto ao host (útil quando Win+… não chega pelo teclado local).</span>
        <span class="shortcut-panel-hint">Teclas rápidas: <kbd>F6</kbd> (sincronizar área de transferência), <kbd>F7</kbd> (habilitar controle remoto), <kbd>F8</kbd> (alternar monitor), <kbd>F9</kbd> (focar tela remota), <kbd>F10</kbd> (tela cheia).</span>
      </div>
      <div class="shortcut-groups">
        <div class="shortcut-group">
          <span class="shortcut-group-title">Área de transferência / edição</span>
          <div class="shortcut-buttons">
            <button type="button" class="btn-shortcut" data-shortcut="ctrlC">Ctrl+C</button>
            <button type="button" class="btn-shortcut" data-shortcut="ctrlV">Ctrl+V</button>
            <button type="button" class="btn-shortcut" data-shortcut="ctrlX">Ctrl+X</button>
            <button type="button" class="btn-shortcut" data-shortcut="ctrlA">Ctrl+A</button>
            <button type="button" class="btn-shortcut" data-shortcut="ctrlZ">Ctrl+Z</button>
            <button type="button" class="btn-shortcut" data-shortcut="ctrlY">Ctrl+Y</button>
          </div>
        </div>
        <div class="shortcut-group">
          <span class="shortcut-group-title">Windows</span>
          <div class="shortcut-buttons">
            <button type="button" class="btn-shortcut" data-shortcut="winR">Win+R</button>
            <button type="button" class="btn-shortcut" data-shortcut="winE">Win+E</button>
            <button type="button" class="btn-shortcut" data-shortcut="winD">Win+D</button>
            <button type="button" class="btn-shortcut" data-shortcut="winL" title="Bloqueia a sessão no PC remoto">Win+L</button>
            <button type="button" class="btn-shortcut" data-shortcut="winShiftS">Win+Shift+S</button>
          </div>
        </div>
        <div class="shortcut-group">
          <span class="shortcut-group-title">Sistema</span>
          <div class="shortcut-buttons">
            <button type="button" class="btn-shortcut" data-shortcut="altTab">Alt+Tab</button>
            <button type="button" class="btn-shortcut" data-shortcut="altF4">Alt+F4</button>
            <button type="button" class="btn-shortcut" data-shortcut="ctrlShiftEsc">Ctrl+Shift+Esc</button>
            <button type="button" class="btn-shortcut" data-shortcut="ctrlAltDel">Ctrl+Alt+Del</button>
          </div>
        </div>
      </div>
    </div>
    <div class="remote-stage" id="remoteStage">
      <div class="remote-wrap">
        <video id="remoteVideo" autoplay playsinline muted></video>
        <div class="overlay" id="overlay" tabindex="0"></div>
      </div>
    </div>
    <p class="status" id="connStatus"></p>
  </div>
`;

const serverUrlInput = $("#serverUrl") as HTMLInputElement;
const sessionIdInput = $("#sessionId") as HTMLInputElement;
const btnConnect = $("#btnConnect") as HTMLButtonElement;
const btnDisconnect = $("#btnDisconnect") as HTMLButtonElement;
const statusEl = $("#status");
const remotePanel = $("#remotePanel");
const remoteVideo = $("#remoteVideo") as HTMLVideoElement;
const overlay = $("#overlay") as HTMLDivElement;
const connStatus = $("#connStatus");
const monitorIndicator = $("#monitorIndicator") as HTMLButtonElement;
const remoteStage = $("#remoteStage") as HTMLDivElement;
const btnFocusRemote = $("#btnFocusRemote") as HTMLButtonElement;
const btnFullscreen = $("#btnFullscreen") as HTMLButtonElement;
const shortcutPanel = $("#shortcutPanel");
const clipboardSyncCheckbox = $("#clipboardSync") as HTMLInputElement;
const remoteControlCheckbox = $("#remoteControlEnabled") as HTMLInputElement;
const wheelSensitivitySelect = $("#wheelSensitivity") as HTMLSelectElement;

const CLIP_MAX_CHARS = 256 * 1024;
const CLIP_POLL_MS = 500;
type WheelSensitivity = "low" | "medium" | "high";
type WheelProfile = {
  lineHeight: number;
  step: number;
  flushMs: number;
  maxStepsPerFlush: number;
};
const WHEEL_PROFILES: Record<WheelSensitivity, WheelProfile> = {
  low: { lineHeight: 19, step: 150, flushMs: 20, maxStepsPerFlush: 4 },
  medium: { lineHeight: 19, step: 120, flushMs: 16, maxStepsPerFlush: 8 },
  high: { lineHeight: 19, step: 90, flushMs: 12, maxStepsPerFlush: 12 },
};
const DEFAULT_WHEEL_SENSITIVITY: WheelSensitivity = "medium";
let clientClipPollId: ReturnType<typeof setInterval> | null = null;
let captureKeys = false;
let remoteControlEnabled = true;
/** Quando true, o usuário pediu sync; alinhado ao checkbox. */
let clientClipboardSync = false;
/** Último texto enviado ao host (evita reenvio). */
let clientLastSentToHost = "";
let clientSuppressAfterHostPush = 0;

let socket: Socket | null = null;
let pc: RTCPeerConnection | null = null;
let controlSend: RTCDataChannel | null = null;
let currentSessionId = "";
/** ICE pode chegar antes do SDP remoto — sem fila a mídia nunca conecta */
let pendingIce: RTCIceCandidateInit[] = [];
let wheelAccumX = 0;
let wheelAccumY = 0;
let wheelPendingX = 0;
let wheelPendingY = 0;
let wheelFlushTimer: ReturnType<typeof setTimeout> | null = null;
let wheelSensitivity: WheelSensitivity = DEFAULT_WHEEL_SENSITIVITY;
let wheelProfile: WheelProfile = WHEEL_PROFILES[wheelSensitivity];
const HOTKEY_TOGGLE_CLIPBOARD_SYNC = "F6";
const HOTKEY_TOGGLE_REMOTE_CONTROL = "F7";
const HOTKEY_NEXT_MONITOR = "F8";
const HOTKEY_FOCUS_REMOTE = "F9";
const HOTKEY_TOGGLE_FULLSCREEN = "F10";
const monitorIndicatorLabel = monitorIndicator.querySelector(
  ".monitor-indicator-label",
) as HTMLSpanElement;

function updateMonitorIndicator(
  idx: number | null,
  total: number | null,
  name = "",
) {
  if (idx === null || total === null || total <= 0) {
    monitorIndicatorLabel.textContent = "Monitor: aguardando…";
    return;
  }
  const n = idx + 1;
  const suffix = name ? ` (${name})` : "";
  monitorIndicatorLabel.textContent = `Monitor: ${n}/${total}${suffix}`;
}

function normalizeWheelDelta(dm: number, delta: number): number {
  if (!Number.isFinite(delta)) return 0;
  if (dm === 0) return delta;
  return delta * wheelProfile.lineHeight;
}

function parseWheelSensitivity(raw: string): WheelSensitivity | null {
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  return null;
}

function applyWheelSensitivity(level: WheelSensitivity, syncUi = true) {
  wheelSensitivity = level;
  wheelProfile = WHEEL_PROFILES[level];
  resetWheelState();
  if (syncUi) {
    wheelSensitivitySelect.value = level;
  }
}

function resetWheelState() {
  wheelAccumX = 0;
  wheelAccumY = 0;
  wheelPendingX = 0;
  wheelPendingY = 0;
  if (wheelFlushTimer) {
    clearTimeout(wheelFlushTimer);
    wheelFlushTimer = null;
  }
}

function scheduleWheelFlush() {
  if (wheelFlushTimer) return;
  wheelFlushTimer = setTimeout(() => {
    wheelFlushTimer = null;
    flushWheelToHost();
  }, wheelProfile.flushMs);
}

function enqueueWheelFromEvent(ev: WheelEvent) {
  const dm = ev.deltaMode === 1 || ev.deltaMode === 2 ? 1 : 0;
  wheelAccumX += normalizeWheelDelta(dm, ev.deltaX);
  wheelAccumY += normalizeWheelDelta(dm, ev.deltaY);

  let stepX = 0;
  let stepY = 0;
  while (Math.abs(wheelAccumX) >= wheelProfile.step) {
    const dir = wheelAccumX > 0 ? 1 : -1;
    wheelAccumX -= dir * wheelProfile.step;
    stepX += dir;
  }
  while (Math.abs(wheelAccumY) >= wheelProfile.step) {
    const dir = wheelAccumY > 0 ? 1 : -1;
    wheelAccumY -= dir * wheelProfile.step;
    stepY += dir;
  }

  if (stepX === 0 && stepY === 0) return;
  wheelPendingX += stepX;
  wheelPendingY += stepY;
  scheduleWheelFlush();
}

function flushWheelToHost() {
  if (!controlSend || controlSend.readyState !== "open") {
    resetWheelState();
    return;
  }
  const sendX =
    Math.sign(wheelPendingX) *
    Math.min(wheelProfile.maxStepsPerFlush, Math.abs(wheelPendingX));
  const sendY =
    Math.sign(wheelPendingY) *
    Math.min(wheelProfile.maxStepsPerFlush, Math.abs(wheelPendingY));
  if (sendX === 0 && sendY === 0) return;
  wheelPendingX -= sendX;
  wheelPendingY -= sendY;
  const msg: ControlMsg = { t: "wheel", vx: sendX, vy: sendY };
  controlSend.send(JSON.stringify(msg));
  if (wheelPendingX !== 0 || wheelPendingY !== 0) {
    scheduleWheelFlush();
  }
}

function requestNextMonitorByUi() {
  if (!controlSend || controlSend.readyState !== "open") {
    setConnStatus("Canal de controle ainda não está pronto para alternar monitor.");
    return;
  }
  const monMsg: ControlMsg = { t: "monitor", d: "next" };
  controlSend.send(JSON.stringify(monMsg));
  setConnStatus("Solicitação enviada: alternar monitor remoto.");
}

function toggleCheckboxByHotkey(
  checkbox: HTMLInputElement,
  onText: string,
  offText: string,
) {
  checkbox.checked = !checkbox.checked;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  setConnStatus(checkbox.checked ? onText : offText);
}

function hasNoModifiers(ev: KeyboardEvent): boolean {
  return !ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey;
}

function handleGlobalFunctionHotkeys(ev: KeyboardEvent): boolean {
  if (ev.type !== "keydown") return false;
  if (remotePanel.classList.contains("hidden")) return false;
  if (!hasNoModifiers(ev)) return false;

  if (ev.code === HOTKEY_TOGGLE_CLIPBOARD_SYNC) {
    ev.preventDefault();
    ev.stopPropagation();
    toggleCheckboxByHotkey(
      clipboardSyncCheckbox,
      "Sincronização da área de transferência ativada.",
      "Sincronização da área de transferência desativada.",
    );
    return true;
  }

  if (ev.code === HOTKEY_TOGGLE_REMOTE_CONTROL) {
    ev.preventDefault();
    ev.stopPropagation();
    toggleCheckboxByHotkey(
      remoteControlCheckbox,
      "Controle remoto ativado.",
      "Controle remoto desativado (modo visualização).",
    );
    return true;
  }

  if (ev.code === HOTKEY_NEXT_MONITOR) {
    ev.preventDefault();
    ev.stopPropagation();
    requestNextMonitorByUi();
    return true;
  }

  if (ev.code === HOTKEY_FOCUS_REMOTE) {
    ev.preventDefault();
    ev.stopPropagation();
    btnFocusRemote.click();
    setConnStatus("Tela remota em foco.");
    return true;
  }

  if (ev.code === HOTKEY_TOGGLE_FULLSCREEN) {
    ev.preventDefault();
    ev.stopPropagation();
    btnFullscreen.click();
    return true;
  }
  return false;
}

function setStatus(text: string, kind: "" | "ok" | "err" = "") {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? ` ${kind}` : "");
}

function setConnStatus(text: string) {
  connStatus.textContent = text;
}

/** Base do servidor DeskLink (origem), sempre com esquema http(s) */
function normalizeServerBase(raw: string): string {
  const t = raw.trim();
  if (!t) return window.location.origin;
  const withScheme = /^https?:\/\//i.test(t) ? t : `http://${t}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    throw new Error(`URL inválida: ${raw}`);
  }
}

async function fetchIceServers(base: string): Promise<RTCIceServer[]> {
  const url = `${base.replace(/\/$/, "")}/api/ice-servers`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    const hint =
      window.location.protocol === "https:" && base.startsWith("http:")
        ? " Página em HTTPS não pode chamar API em HTTP (abra o controlador em http://…:3000 ou use HTTPS no servidor)."
        : " Confira IP/porta, se o servidor está no ar e se digitou http:// (ex.: http://IP:3000).";
    throw new Error(`${e instanceof Error ? e.message : String(e)}.${hint}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ao obter ICE`);
  return (await res.json()) as RTCIceServer[];
}

function stopClientClipboardPollOnly() {
  if (clientClipPollId) {
    clearInterval(clientClipPollId);
    clientClipPollId = null;
  }
}

/** Para sync, notifica o host se necessário e repõe UI (desligar / desconectar). */
function disableClientClipboardSync(notifyHost: boolean) {
  stopClientClipboardPollOnly();
  if (
    notifyHost &&
    controlSend &&
    controlSend.readyState === "open" &&
    clientClipboardSync
  ) {
    try {
      const off: ControlMsg = { t: "clip", d: "sync", enabled: false };
      controlSend.send(JSON.stringify(off));
    } catch {
      /* ignore */
    }
  }
  clientClipboardSync = false;
  clientLastSentToHost = "";
  clientSuppressAfterHostPush = 0;
  clipboardSyncCheckbox.checked = false;
}

function cleanupPeer() {
  disableClientClipboardSync(true);
  resetWheelState();
  controlSend?.close();
  controlSend = null;
  pendingIce = [];
  pc?.close();
  pc = null;
}

async function flushPendingIce() {
  if (!pc || !pc.remoteDescription) return;
  while (pendingIce.length) {
    const c = pendingIce.shift()!;
    try {
      await pc.addIceCandidate(c);
    } catch {
      /* ignore */
    }
  }
}

function cleanupSocket() {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

function disconnectAll() {
  cleanupPeer();
  cleanupSocket();
  captureKeys = false;
  remoteVideo.srcObject = null;
  remotePanel.classList.add("hidden");
  btnConnect.disabled = false;
  btnDisconnect.disabled = true;
  setConnStatus("");
  updateMonitorIndicator(null, null);
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {});
  }
}

btnDisconnect.addEventListener("click", () => {
  disconnectAll();
  setStatus("Desconectado.");
});

btnFocusRemote.addEventListener("click", () => {
  remoteStage.scrollIntoView({ behavior: "smooth", block: "start" });
});

monitorIndicator.addEventListener("click", () => {
  requestNextMonitorByUi();
});

btnFullscreen.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await remoteStage.requestFullscreen();
  } catch {
    setConnStatus("Tela cheia não disponível neste navegador.");
  }
});

document.addEventListener("fullscreenchange", () => {
  const fs = document.fullscreenElement === remoteStage;
  btnFullscreen.textContent = fs ? "Sair da tela cheia" : "Tela cheia";
});

clipboardSyncCheckbox.addEventListener("change", () => {
  const on = clipboardSyncCheckbox.checked;
  if (!on) {
    disableClientClipboardSync(true);
    return;
  }
  if (!controlSend || controlSend.readyState !== "open") {
    clipboardSyncCheckbox.checked = false;
    return;
  }
  clientClipboardSync = true;
  clientLastSentToHost = "";
  clientSuppressAfterHostPush = 0;
  try {
    const syn: ControlMsg = { t: "clip", d: "sync", enabled: true };
    controlSend.send(JSON.stringify(syn));
  } catch {
    clipboardSyncCheckbox.checked = false;
    clientClipboardSync = false;
    return;
  }
  void navigator.clipboard
    .readText()
    .then((t) => {
      let text = t;
      if (text.length > CLIP_MAX_CHARS) {
        text = text.slice(0, CLIP_MAX_CHARS);
      }
      clientLastSentToHost = text;
    })
    .catch(() => {});
  startClientClipboardPoll();
});

wheelSensitivitySelect.addEventListener("change", () => {
  const parsed = parseWheelSensitivity(wheelSensitivitySelect.value);
  if (!parsed) return;
  applyWheelSensitivity(parsed, false);
  setConnStatus(`Sensibilidade da rolagem: ${parsed === "low" ? "baixa" : parsed === "high" ? "alta" : "média"}.`);
});

remoteControlCheckbox.addEventListener("change", () => {
  remoteControlEnabled = remoteControlCheckbox.checked;
  if (!remoteControlEnabled) {
    captureKeys = false;
    overlay.classList.add("view-only");
    setConnStatus("Modo de visualização: controle remoto desativado neste navegador.");
    return;
  }
  overlay.classList.remove("view-only");
  setConnStatus("Controle remoto ativado. Clique na área remota para capturar teclado e mouse.");
});

shortcutPanel.addEventListener("click", (ev) => {
  if (!remoteControlEnabled) {
    setConnStatus("Modo de visualização ativo: marque 'Habilitar controle remoto' para usar atalhos.");
    return;
  }
  const btn = (ev.target as HTMLElement).closest(
    "button[data-shortcut]",
  ) as HTMLButtonElement | null;
  if (!btn) return;
  ev.preventDefault();
  const id = btn.getAttribute("data-shortcut");
  if (!id) return;
  const seq = SHORTCUT_SEQUENCES[id];
  if (!seq?.length) return;
  if (!controlSend || controlSend.readyState !== "open") {
    setConnStatus("Canal de controle ainda não está pronto. Aguarde a conexão.");
    return;
  }
  void runShortcutSequence(seq, (json) => controlSend!.send(json)).catch(
    () => {
      setConnStatus("Falha ao enviar atalho.");
    },
  );
});

/**
 * Coordenadas 0–1 no vídeo real (ignora letterboxing de object-fit:contain).
 * Sem videoWidth/height ainda, cai no retângulo inteiro do overlay.
 */
function clientToVideoNorm(clientX: number, clientY: number): {
  x: number;
  y: number;
} | null {
  const rect = overlay.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const vw = remoteVideo.videoWidth;
  const vh = remoteVideo.videoHeight;
  if (!vw || !vh) {
    return { x: px / rect.width, y: py / rect.height };
  }
  const rw = rect.width;
  const rh = rect.height;
  const scale = Math.min(rw / vw, rh / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;
  const offX = (rw - dispW) / 2;
  const offY = (rh - dispH) / 2;
  if (
    px < offX ||
    px > offX + dispW ||
    py < offY ||
    py > offY + dispH
  ) {
    return null;
  }
  return {
    x: (px - offX) / dispW,
    y: (py - offY) / dispH,
  };
}

function sendMove(x: number, y: number) {
  if (!controlSend || controlSend.readyState !== "open") return;
  const msg: ControlMsg = { t: "move", x, y };
  controlSend.send(JSON.stringify(msg));
}

function handleControlMessageFromHost(raw: string) {
  let msg: ControlMsg;
  try {
    msg = JSON.parse(raw) as ControlMsg;
  } catch {
    return;
  }
  if (msg.t === "monitor" && msg.d === "active") {
    updateMonitorIndicator(msg.idx, msg.total, msg.name);
    return;
  }
  if (msg.t === "clip" && msg.d === "push") {
    if (!clientClipboardSync) return;
    const text = typeof msg.text === "string" ? msg.text : "";
    const clipped =
      text.length > CLIP_MAX_CHARS ? text.slice(0, CLIP_MAX_CHARS) : text;
    void navigator.clipboard.writeText(clipped).then(
      () => {
        clientLastSentToHost = clipped;
        clientSuppressAfterHostPush = Date.now() + 450;
      },
      () => {
        setConnStatus("Não foi possível escrever na área de transferência local.");
      },
    );
  }
}

async function clientClipboardPollTick() {
  if (!clientClipboardSync || !controlSend || controlSend.readyState !== "open") {
    return;
  }
  if (Date.now() < clientSuppressAfterHostPush) return;
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return;
  }
  if (text.length > CLIP_MAX_CHARS) {
    text = text.slice(0, CLIP_MAX_CHARS);
  }
  if (text === clientLastSentToHost) return;
  clientLastSentToHost = text;
  const setMsg: ControlMsg = { t: "clip", d: "set", text };
  controlSend.send(JSON.stringify(setMsg));
}

function startClientClipboardPoll() {
  stopClientClipboardPollOnly();
  clientClipPollId = setInterval(() => {
    void clientClipboardPollTick();
  }, CLIP_POLL_MS);
}

function setupControlChannel(channel: RTCDataChannel) {
  controlSend = channel;
  applyWheelSensitivity(DEFAULT_WHEEL_SENSITIVITY);
  let lastNorm: { x: number; y: number } | null = null;
  captureKeys = false;
  remoteControlEnabled = remoteControlCheckbox.checked;
  if (remoteControlEnabled) overlay.classList.remove("view-only");
  else overlay.classList.add("view-only");

  channel.onmessage = (ev) => {
    handleControlMessageFromHost(String(ev.data));
  };

  setConnStatus(
    "Canal de controle pronto. Clique na área remota para capturar teclado e mouse.",
  );

  overlay.addEventListener(
    "contextmenu",
    (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    },
    { capture: true },
  );

  overlay.addEventListener("pointermove", (ev) => {
    if (!remoteControlEnabled) return;
    if (!controlSend || controlSend.readyState !== "open") return;
    const n = clientToVideoNorm(ev.clientX, ev.clientY);
    if (!n) return;
    lastNorm = n;
    sendMove(n.x, n.y);
  });

  overlay.addEventListener("pointerdown", (ev) => {
    if (!remoteControlEnabled) return;
    ev.preventDefault();
    captureKeys = true;
    overlay.focus();
    try {
      overlay.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    if (!controlSend || controlSend.readyState !== "open") return;
    const n = clientToVideoNorm(ev.clientX, ev.clientY);
    if (!n) return;
    lastNorm = n;
    sendMove(n.x, n.y);
    const msg: ControlMsg = { t: "btn", b: ev.button, down: true };
    controlSend.send(JSON.stringify(msg));
  });

  overlay.addEventListener("pointerup", (ev) => {
    if (!remoteControlEnabled) return;
    ev.preventDefault();
    try {
      if (overlay.hasPointerCapture(ev.pointerId)) {
        overlay.releasePointerCapture(ev.pointerId);
      }
    } catch {
      /* ignore */
    }
    if (!controlSend || controlSend.readyState !== "open") return;
    const n =
      clientToVideoNorm(ev.clientX, ev.clientY) ?? lastNorm;
    if (!n) return;
    lastNorm = n;
    sendMove(n.x, n.y);
    const msg: ControlMsg = { t: "btn", b: ev.button, down: false };
    controlSend.send(JSON.stringify(msg));
  });

  overlay.addEventListener(
    "wheel",
    (ev) => {
      if (!remoteControlEnabled) return;
      ev.preventDefault();
      if (!controlSend || controlSend.readyState !== "open") return;
      const n = clientToVideoNorm(ev.clientX, ev.clientY);
      if (n) {
        lastNorm = n;
        sendMove(n.x, n.y);
      }
      enqueueWheelFromEvent(ev);
    },
    { passive: false },
  );

  const keyHandler = (ev: KeyboardEvent) => {
    if (handleGlobalFunctionHotkeys(ev)) return;
    if (!remoteControlEnabled) return;
    if (!captureKeys || remotePanel.classList.contains("hidden")) return;
    if (!controlSend || controlSend.readyState !== "open") return;
    ev.preventDefault();
    ev.stopPropagation();
    const msg: ControlMsg = {
      t: "key",
      code: ev.code,
      key: ev.key,
      down: ev.type === "keydown",
      ctrl: ev.ctrlKey,
      alt: ev.altKey,
      shift: ev.shiftKey,
      meta: ev.metaKey,
    };
    controlSend.send(JSON.stringify(msg));
  };
  window.addEventListener("keydown", keyHandler, true);
  window.addEventListener("keyup", keyHandler, true);
}

async function startControllerWebRtc(iceServers: RTCIceServer[]) {
  if (!socket) return;
  pc = new RTCPeerConnection({ iceServers });
  pc.ontrack = (ev) => {
    const stream = ev.streams[0] ?? new MediaStream([ev.track]);
    remoteVideo.srcObject = stream;
    void remoteVideo.play().catch(() => {
      /* autoplay */
    });
    setStatus("Vídeo remoto ativo.", "ok");
    remoteVideo.addEventListener(
      "playing",
      () => {
        if (socket?.connected && currentSessionId) {
          socket.emit("controller-video-ready", {
            sessionId: currentSessionId,
          });
        }
      },
      { once: true },
    );
  };

  pc.onconnectionstatechange = () => {
    const st = pc?.connectionState;
    if (st === "failed" || st === "disconnected") {
      setConnStatus(`WebRTC: ${st ?? "?"}`);
    }
  };

  pc.onicecandidate = (ev) => {
    if (!socket || !currentSessionId) return;
    socket.emit("ice-candidate", {
      sessionId: currentSessionId,
      candidate: ev.candidate
        ? {
            candidate: ev.candidate.candidate,
            sdpMLineIndex: ev.candidate.sdpMLineIndex,
            sdpMid: ev.candidate.sdpMid,
          }
        : null,
    });
  };

  pc.ondatachannel = (ev) => {
    void setupControlChannel(ev.channel);
  };

  socket.on("signal", async (payload: { type: string; sdp?: string }) => {
    if (!pc) return;
    if (payload.type === "offer" && payload.sdp) {
      await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await flushPendingIce();
      socket!.emit("signal", {
        sessionId: currentSessionId,
        type: "answer",
        sdp: answer.sdp ?? "",
      });
    }
  });

  socket.on(
    "ice-candidate",
    async (payload: { candidate: RTCIceCandidateInit | null }) => {
      if (!pc) return;
      if (!payload.candidate?.candidate) return;
      if (!pc.remoteDescription) {
        pendingIce.push(payload.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch {
        /* ignore */
      }
    },
  );

  socket.emit("webrtc-controller-ready", { sessionId: currentSessionId });

  remotePanel.classList.remove("hidden");
  btnDisconnect.disabled = false;
  setStatus("Aguardando vídeo do host…", "ok");
}

btnConnect.addEventListener("click", async () => {
  let base: string;
  try {
    base = normalizeServerBase(serverUrlInput.value.trim());
  } catch (e) {
    setStatus(`URL: ${String(e)}`, "err");
    return;
  }

  const sessionId = sessionIdInput.value.trim();
  if (!sessionId) {
    setStatus("Informe o código da sessão.", "err");
    return;
  }

  btnConnect.disabled = true;
  setStatus("Conectando ao servidor…");

  let iceServers: RTCIceServer[];
  try {
    iceServers = await fetchIceServers(base);
  } catch (e) {
    setStatus(`ICE: ${String(e)}`, "err");
    btnConnect.disabled = false;
    return;
  }

  cleanupSocket();
  currentSessionId = sessionId;

  socket = io(base, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
  });

  socket.on("connect_error", (err) => {
    setStatus(`Socket: ${err.message}`, "err");
    btnConnect.disabled = false;
  });

  socket.on("disconnect", (reason) => {
    setStatus(`Desconectado: ${reason}`, "err");
    disconnectAll();
  });

  socket.on("peer-left", ({ role }: { role: string }) => {
    setStatus(`Par saiu (${role}).`, "err");
    disconnectAll();
  });

  socket.on("connect", () => {
    setStatus("Socket conectado. Entrando na sessão…");
    socket!.emit(
      "join",
      { sessionId, role: "controller" },
      (err: string | null) => {
        if (err) {
          setStatus(err, "err");
          btnConnect.disabled = false;
          return;
        }
        setStatus("Sessão aceita. Preparando WebRTC…", "ok");
        void startControllerWebRtc(iceServers).catch((e) => {
          setStatus(`WebRTC: ${String(e)}`, "err");
          btnConnect.disabled = false;
        });
      },
    );
  });
});
