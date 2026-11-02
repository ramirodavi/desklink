import { io, type Socket } from "socket.io-client";
import { CHAT_EMOJI_GROUPS } from "./chat-emoji-data.js";
import {
  createCommandPalette,
  type PaletteCommand,
} from "./command-palette.js";
import type { ControlMsg } from "./protocol.js";
import { parseStreamProfileId } from "./stream-profiles.js";
import {
  runShortcutSequence,
  SHORTCUT_LABELS,
  SHORTCUT_SEQUENCES,
} from "./shortcuts.js";
import {
  describeIceConnectionForUi,
  describeIceGatheringForUi,
} from "./webrtc-connection-info.js";
import {
  buildPathPillFromReport,
  deriveQuality,
  extractInboundVideoStats,
  formatMetricsLine,
} from "./webrtc-media-stats.js";

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
      <div class="remote-session-strip" id="connectionRow" aria-label="Estado da conexão e métricas">
        <div class="remote-session-status">
          <span class="connection-pill connection-pill--neutral" id="iceStatePill" title="">ICE: —</span>
          <span class="connection-pill connection-pill--neutral" id="icePathPill" title="">Caminho: —</span>
        </div>
        <span class="connection-metrics" id="metricsLine" title="">Métricas: aguardando…</span>
        <div class="remote-session-profile" title="Ajusta uso de banda e nitidez no PC remoto (bitrate e FPS de envio).">
          <label class="inline-field-label" for="streamProfileSelect">Perfil de vídeo</label>
          <select id="streamProfileSelect" class="toolbar-inline-select">
            <option value="economy">Economia de dados</option>
            <option value="balanced" selected>Balanceado</option>
            <option value="high">Qualidade máxima</option>
          </select>
          <span class="profile-apply-hint" id="profileApplyHint" aria-live="polite"></span>
        </div>
      </div>
      <div class="remote-toolbar-actions">
        <label class="remote-control-label" title="Quando desmarcado, a área remota fica apenas em visualização (sem enviar mouse/teclado ao host).">
          <input type="checkbox" id="remoteControlEnabled" checked />
          Habilitar controle remoto
        </label>
        <label class="wheel-sensitivity-label" title="Ajusta a sensibilidade da rolagem enviada ao host. Aplique sem reconectar.">
          <span class="inline-field-label">Rolagem</span>
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
        <label class="pen-mode-label" title="Desenhar anotações vermelhas na tela remota do host (atalho Shift+F9). Enquanto ativo, o mouse não controla o PC remoto.">
          <input type="checkbox" id="penModeCheckbox" />
          Modo caneta (anotações no host)
        </label>
        <button type="button" class="btn-ghost" id="btnFocusRemote" title="Rola a página para a área remota ocupar a janela (Shift+F10)">Focar na tela remota</button>
        <button type="button" class="btn-ghost" id="btnFullscreen" title="Tela cheia da área remota (Shift+F11)">Tela cheia</button>
        <button type="button" class="btn-ghost" id="btnCommandPalette" title="Buscar e executar comandos e atalhos (Shift+F12)">Comandos <kbd>Shift+F12</kbd></button>
      </div>
    </div>
    <div class="shortcut-panel" id="shortcutPanel">
      <div class="shortcut-panel-head">
        <span class="shortcut-panel-title">Atalhos no PC remoto</span>
        <span class="shortcut-panel-hint">Envia o comando direto ao host (útil quando Win+… não chega pelo teclado local).</span>
        <span class="shortcut-panel-hint">Teclas rápidas (com <kbd>Shift</kbd>): <kbd>Shift+F6</kbd> (sincronizar área de transferência), <kbd>Shift+F7</kbd> (habilitar controle remoto), <kbd>Shift+F8</kbd> (alternar monitor), <kbd>Shift+F9</kbd> (modo caneta / anotações no host), <kbd>Shift+F10</kbd> (focar tela remota), <kbd>Shift+F11</kbd> (tela cheia da área remota), <kbd>Shift+F12</kbd> (paleta de comandos). Fx sem Shift é enviada ao host.</span>
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
        <canvas class="annotate-canvas" id="annotateCanvas" aria-hidden="true"></canvas>
      </div>
    </div>
    <section class="chat-panel" id="chatPanel" aria-label="Conversa com o host">
      <div class="chat-panel-head">
        <span class="chat-panel-title">Conversa com o host</span>
      </div>
      <div class="chat-log" id="chatLog" role="log" aria-live="polite"></div>
      <div class="chat-toolbar">
        <div class="chat-input-wrap">
          <textarea id="chatInput" maxlength="4000" rows="1" placeholder="Escreva uma mensagem…" autocomplete="off"></textarea>
        </div>
        <div class="chat-emoji-wrap">
          <button type="button" class="btn-ghost chat-icon-btn" id="btnChatEmoji" aria-label="Mostrar emojis" aria-expanded="false" aria-haspopup="dialog" title="Mostrar emojis">🙂</button>
          <div id="chatEmojiPopover" class="emoji-popover hidden" role="dialog" aria-label="Seletor de emojis" aria-hidden="true"></div>
        </div>
        <button type="button" class="chat-icon-btn chat-send-btn" id="btnChatSend" aria-label="Enviar mensagem" title="Enviar mensagem">➤</button>
      </div>
    </section>
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
const remoteWrap = overlay.parentElement as HTMLDivElement;
const annotateCanvas = $("#annotateCanvas") as HTMLCanvasElement;
const penModeCheckbox = $("#penModeCheckbox") as HTMLInputElement;
const connStatus = $("#connStatus");
const monitorIndicator = $("#monitorIndicator") as HTMLButtonElement;
const remoteStage = $("#remoteStage") as HTMLDivElement;
const btnFocusRemote = $("#btnFocusRemote") as HTMLButtonElement;
const btnFullscreen = $("#btnFullscreen") as HTMLButtonElement;
const btnCommandPalette = $("#btnCommandPalette") as HTMLButtonElement;
const shortcutPanel = $("#shortcutPanel");
const clipboardSyncCheckbox = $("#clipboardSync") as HTMLInputElement;
const remoteControlCheckbox = $("#remoteControlEnabled") as HTMLInputElement;
const wheelSensitivitySelect = $("#wheelSensitivity") as HTMLSelectElement;
const chatPanel = $("#chatPanel");
const chatLog = $("#chatLog");
const chatInput = $("#chatInput") as HTMLTextAreaElement;
const btnChatSend = $("#btnChatSend") as HTMLButtonElement;
const btnChatEmoji = $("#btnChatEmoji") as HTMLButtonElement;
const chatEmojiPopover = $("#chatEmojiPopover") as HTMLDivElement;
const iceStatePill = $("#iceStatePill") as HTMLSpanElement;
const icePathPill = $("#icePathPill") as HTMLSpanElement;
const metricsLine = $("#metricsLine") as HTMLSpanElement;
const streamProfileSelect = $("#streamProfileSelect") as HTMLSelectElement;
const profileApplyHint = $("#profileApplyHint") as HTMLSpanElement;

const STREAM_PROFILE_STORAGE_KEY = "desklink-stream-profile";

const CHAT_MAX_CHARS = 4000;
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
let penMode = false;
let annotatePenHandlersWired = false;
let penStrokeActive = false;
let penSegmentNorm: { x: number; y: number }[] = [];
let currentSessionId = "";
let remoteInputSessionEpoch = 0;
let monitorSyncReady = false;
let userInitiatedDisconnect = false;
let socketReconnecting = false;
let webrtcRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
let cachedIceServers: RTCIceServer[] = [];
let controllerSessionStarted = false;
let waitingForHostReconnect = false;
let hostJoinRetryTimer: ReturnType<typeof setTimeout> | null = null;
/** ICE pode chegar antes do SDP remoto — sem fila a mídia nunca conecta */
let pendingIce: RTCIceCandidateInit[] = [];

type ControlCaptureHandlers = {
  onContextMenu: (ev: Event) => void;
  onPointerMove: (ev: PointerEvent) => void;
  onPointerDown: (ev: PointerEvent) => void;
  onPointerUp: (ev: PointerEvent) => void;
  onWheel: (ev: WheelEvent) => void;
  keyHandler: (ev: KeyboardEvent) => void;
};

let controlCaptureHandlers: ControlCaptureHandlers | null = null;
let wheelAccumX = 0;
let wheelAccumY = 0;
let wheelPendingX = 0;
let wheelPendingY = 0;
let wheelFlushTimer: ReturnType<typeof setTimeout> | null = null;
let wheelSensitivity: WheelSensitivity = DEFAULT_WHEEL_SENSITIVITY;
let wheelProfile: WheelProfile = WHEEL_PROFILES[wheelSensitivity];

let statsPollerId: ReturnType<typeof setInterval> | null = null;
let lastIceUiKey = "";
let lastPathUiKey = "";
let lastMetricsUiKey = "";
let profileApplyHintClearTimer: ReturnType<typeof setTimeout> | null = null;
const HOTKEY_TOGGLE_CLIPBOARD_SYNC = "F6";
const HOTKEY_TOGGLE_REMOTE_CONTROL = "F7";
const HOTKEY_NEXT_MONITOR = "F8";
const HOTKEY_TOGGLE_PEN_MODE = "F9";
const HOTKEY_FOCUS_REMOTE = "F10";
const HOTKEY_TOGGLE_FULLSCREEN = "F11";
const HOTKEY_COMMAND_PALETTE = "F12";
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

function formatChatTime(at: number) {
  return new Date(at).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function appendClientChatLine(side: "self" | "remote", text: string, at = Date.now()) {
  const row = document.createElement("div");
  row.className =
    "chat-line" + (side === "self" ? " chat-line--self" : " chat-line--remote");
  const meta = document.createElement("div");
  meta.className = "chat-line-meta";
  meta.textContent =
    side === "self"
      ? `Você · ${formatChatTime(at)}`
      : `Host remoto · ${formatChatTime(at)}`;
  const body = document.createElement("div");
  body.className = "chat-line-body";
  body.textContent = text;
  row.append(meta, body);
  chatLog.append(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function clearClientChatLog() {
  chatLog.replaceChildren();
}

function notifyClientChatIncoming(text: string) {
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  if (typeof Notification === "undefined") return;
  const preview = text.length > 120 ? `${text.slice(0, 117)}…` : text;
  const title = "DeskLink — Nova mensagem no chat";
  const run = () => {
    try {
      new Notification(title, { body: preview });
    } catch {
      /* ignore */
    }
  };
  if (Notification.permission === "granted") run();
  else if (Notification.permission === "default") {
    void Notification.requestPermission().then((p) => {
      if (p === "granted") run();
    });
  }
}

function insertAtChatInputCursor(chunk: string) {
  const start = chatInput.selectionStart ?? chatInput.value.length;
  const end = chatInput.selectionEnd ?? chatInput.value.length;
  const next = chatInput.value.slice(0, start) + chunk + chatInput.value.slice(end);
  if (next.length > CHAT_MAX_CHARS) {
    setConnStatus(
      `O chat aceita no máximo ${CHAT_MAX_CHARS} caracteres por mensagem.`,
    );
    return;
  }
  chatInput.value = next;
  const pos = start + chunk.length;
  chatInput.setSelectionRange(pos, pos);
  chatInput.focus();
}

let clientChatEmojiPopoverBuilt = false;
let clientEmojiOutsideClose: ((e: PointerEvent) => void) | null = null;

function buildClientEmojiPopoverIfNeeded() {
  if (clientChatEmojiPopoverBuilt) return;
  clientChatEmojiPopoverBuilt = true;
  for (const g of CHAT_EMOJI_GROUPS) {
    const sec = document.createElement("div");
    sec.className = "emoji-popover-group";
    const gt = document.createElement("div");
    gt.className = "emoji-popover-group-title";
    gt.textContent = g.title;
    sec.append(gt);
    const grid = document.createElement("div");
    grid.className = "emoji-popover-grid";
    for (const ch of g.emojis) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "emoji-popover-cell";
      b.textContent = ch;
      b.title = ch;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        insertAtChatInputCursor(ch);
        closeClientChatEmojiPopover();
      });
      grid.append(b);
    }
    sec.append(grid);
    chatEmojiPopover.append(sec);
  }
}

function closeClientChatEmojiPopover() {
  chatEmojiPopover.classList.add("hidden");
  chatEmojiPopover.setAttribute("aria-hidden", "true");
  btnChatEmoji.setAttribute("aria-expanded", "false");
  if (clientEmojiOutsideClose) {
    document.removeEventListener("pointerdown", clientEmojiOutsideClose, true);
    clientEmojiOutsideClose = null;
  }
}

function openClientChatEmojiPopover() {
  if (clientEmojiOutsideClose) {
    document.removeEventListener("pointerdown", clientEmojiOutsideClose, true);
    clientEmojiOutsideClose = null;
  }
  buildClientEmojiPopoverIfNeeded();
  chatEmojiPopover.classList.remove("hidden");
  chatEmojiPopover.setAttribute("aria-hidden", "false");
  btnChatEmoji.setAttribute("aria-expanded", "true");
  clientEmojiOutsideClose = (e: PointerEvent) => {
    if (
      chatEmojiPopover.contains(e.target as Node) ||
      btnChatEmoji.contains(e.target as Node)
    ) {
      return;
    }
    closeClientChatEmojiPopover();
  };
  setTimeout(() => {
    if (clientEmojiOutsideClose) {
      document.addEventListener("pointerdown", clientEmojiOutsideClose, true);
    }
  }, 0);
}

function toggleClientChatEmojiPopover() {
  if (chatEmojiPopover.classList.contains("hidden")) openClientChatEmojiPopover();
  else closeClientChatEmojiPopover();
}

function sendClientChatMessage() {
  if (!controlSend || controlSend.readyState !== "open") {
    setConnStatus("Canal de chat indisponível. Aguarde a conexão.");
    return;
  }
  const raw = chatInput.value;
  if (!raw.trim()) return;
  let text = raw;
  if (text.length > CHAT_MAX_CHARS) {
    text = text.slice(0, CHAT_MAX_CHARS);
    setConnStatus(`Mensagem limitada a ${CHAT_MAX_CHARS} caracteres.`);
  }
  const at = Date.now();
  const msg: ControlMsg = {
    t: "chat",
    id: crypto.randomUUID(),
    at,
    from: "controller",
    text,
  };
  try {
    controlSend.send(JSON.stringify(msg));
  } catch {
    setConnStatus("Não foi possível enviar a mensagem.");
    return;
  }
  appendClientChatLine("self", text, at);
  chatInput.value = "";
  closeClientChatEmojiPopover();
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

function toggleClipboardSyncByUser() {
  toggleCheckboxByHotkey(
    clipboardSyncCheckbox,
    "Sincronização da área de transferência ativada.",
    "Sincronização da área de transferência desativada.",
  );
}

function toggleRemoteControlByUser() {
  toggleCheckboxByHotkey(
    remoteControlCheckbox,
    "Controle remoto ativado.",
    "Controle remoto desativado (modo visualização).",
  );
}

/** Teclas físicas cujo keydown foi ao host e ainda aguardam keyup. */
const heldRemoteKeyCodes = new Set<string>();

/**
 * Solta no host as teclas ainda pressionadas (ex.: o Shift de Shift+F12) antes de a paleta
 * passar a reter o teclado; sem isso o keyup se perde e a tecla fica presa no remoto.
 */
function releaseHeldRemoteKeys() {
  const codes = [...heldRemoteKeyCodes];
  heldRemoteKeyCodes.clear();
  if (!controlSend || controlSend.readyState !== "open") return;
  for (const code of codes) {
    const msg: ControlMsg = {
      t: "key",
      code,
      key: "",
      down: false,
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      text: "",
    };
    try {
      controlSend.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }
}

/** Teclas enviadas como texto (Unicode) no keydown; o keyup correspondente não é repassado. */
const textKeyCodes = new Set<string>();

function isPrintableKey(key: string): boolean {
  if (!key || key === "Dead" || key === "Unidentified") return false;
  // Nomes de tecla (Enter, ArrowLeft, F5…) são ASCII iniciando em maiúscula; o resto é caractere.
  return [...key].length === 1 || !/^[A-Z][A-Za-z0-9]*$/.test(key);
}

/**
 * Caractere que o layout do controlador produziu (inclui acentos compostos e AltGr) para o host
 * digitar via Unicode. `""` = repassar a tecla física: atalhos com Ctrl/Alt/Win, teclas nomeadas,
 * espaço e letras sem acento (mantém repetição/atalhos de apps que leem a tecla).
 */
function resolveKeyText(ev: KeyboardEvent): string {
  if (!isPrintableKey(ev.key)) return "";
  const altGraph = ev.getModifierState("AltGraph");
  if ((ev.ctrlKey || ev.altKey || ev.metaKey) && !altGraph) return "";
  if (ev.code === "Space" && ev.key === " ") return "";
  const letter = /^Key([A-Z])$/.exec(ev.code);
  if (letter && !altGraph && ev.key.toUpperCase() === letter[1]) return "";
  return ev.key;
}

/** Atalhos do DeskLink usam Shift+Fx; Fx sozinho (ou com outros modificadores) vai para o host. */
function isHotkeyModifier(ev: KeyboardEvent): boolean {
  return ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey;
}

const HOTKEY_CODES = new Set([
  HOTKEY_TOGGLE_CLIPBOARD_SYNC,
  HOTKEY_TOGGLE_REMOTE_CONTROL,
  HOTKEY_NEXT_MONITOR,
  HOTKEY_TOGGLE_PEN_MODE,
  HOTKEY_FOCUS_REMOTE,
  HOTKEY_TOGGLE_FULLSCREEN,
  HOTKEY_COMMAND_PALETTE,
]);

/** Fx cujo keydown virou atalho local: o keyup correspondente também não vai ao host. */
const consumedHotkeyCodes = new Set<string>();

function handleGlobalFunctionHotkeys(ev: KeyboardEvent): boolean {
  if (ev.type === "keyup") {
    if (!consumedHotkeyCodes.delete(ev.code)) return false;
    ev.preventDefault();
    ev.stopPropagation();
    return true;
  }
  if (ev.type !== "keydown") return false;
  consumedHotkeyCodes.delete(ev.code);
  if (remotePanel.classList.contains("hidden")) return false;
  if (!isHotkeyModifier(ev)) return false;
  if (!HOTKEY_CODES.has(ev.code)) return false;
  consumedHotkeyCodes.add(ev.code);
  if (ev.repeat) {
    ev.preventDefault();
    ev.stopPropagation();
    return true;
  }

  if (ev.code === HOTKEY_TOGGLE_CLIPBOARD_SYNC) {
    ev.preventDefault();
    ev.stopPropagation();
    toggleClipboardSyncByUser();
    return true;
  }

  if (ev.code === HOTKEY_TOGGLE_REMOTE_CONTROL) {
    ev.preventDefault();
    ev.stopPropagation();
    toggleRemoteControlByUser();
    return true;
  }

  if (ev.code === HOTKEY_NEXT_MONITOR) {
    ev.preventDefault();
    ev.stopPropagation();
    requestNextMonitorByUi();
    return true;
  }

  if (ev.code === HOTKEY_TOGGLE_PEN_MODE) {
    ev.preventDefault();
    ev.stopPropagation();
    setPenMode(!penMode);
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

  if (ev.code === HOTKEY_COMMAND_PALETTE) {
    ev.preventDefault();
    ev.stopPropagation();
    commandPalette.toggle();
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

function applyConnectionPillClass(
  el: HTMLElement,
  severity: "ok" | "warn" | "err" | "neutral",
) {
  el.className = "connection-pill connection-pill--" + severity;
}

function stopStatsPoller() {
  if (statsPollerId) {
    clearInterval(statsPollerId);
    statsPollerId = null;
  }
}

function resetConnectionUiToIdle() {
  lastIceUiKey = "";
  lastPathUiKey = "";
  lastMetricsUiKey = "";
  iceStatePill.textContent = "ICE: —";
  iceStatePill.title = "";
  applyConnectionPillClass(iceStatePill, "neutral");
  icePathPill.textContent = "Caminho: —";
  icePathPill.title = "";
  applyConnectionPillClass(icePathPill, "neutral");
  metricsLine.textContent = "Métricas indisponíveis.";
  metricsLine.title = "";
  clearProfileApplyHint();
}

function clearProfileApplyHint() {
  if (profileApplyHintClearTimer) {
    clearTimeout(profileApplyHintClearTimer);
    profileApplyHintClearTimer = null;
  }
  profileApplyHint.textContent = "";
  profileApplyHint.className = "profile-apply-hint";
  profileApplyHint.removeAttribute("title");
}

async function refreshConnectionFromStats() {
  if (!pc) return;
  let report: RTCStatsReport;
  try {
    report = await pc.getStats();
  } catch {
    return;
  }

  const ice = pc.iceConnectionState;
  const conn = pc.connectionState;
  const gather = pc.iceGatheringState;

  const iceUi = describeIceConnectionForUi(ice, conn);
  let iceText = iceUi.text;
  const gExtra = describeIceGatheringForUi(gather);
  if (gExtra && ice !== "failed" && conn !== "failed") {
    iceText += gExtra.suffix;
  }
  const iceHint = [iceUi.hint, gExtra?.hint].filter(Boolean).join(" ").trim();
  const iceKey = `${iceText}|${iceUi.severity}`;
  if (iceKey !== lastIceUiKey) {
    lastIceUiKey = iceKey;
    iceStatePill.textContent = iceText;
    iceStatePill.title = iceHint;
    applyConnectionPillClass(iceStatePill, iceUi.severity);
  }

  const path = buildPathPillFromReport(report);
  const pathKey = `${path.label}|${path.hint}`;
  if (pathKey !== lastPathUiKey) {
    lastPathUiKey = pathKey;
    icePathPill.textContent = path.label;
    icePathPill.title = path.hint;
    const low = path.label.toLowerCase();
    const pathSev: "ok" | "warn" | "neutral" =
      low.includes("turn") || low.includes("relay")
        ? "warn"
        : low.includes("em análise")
          ? "neutral"
          : "ok";
    applyConnectionPillClass(icePathPill, pathSev);
  }

  const snap = extractInboundVideoStats(report);
  const quality = deriveQuality(snap);
  const line = formatMetricsLine(snap, quality);
  const metricsKey = `${line}|${quality.reasons.join("·")}`;
  if (metricsKey !== lastMetricsUiKey) {
    lastMetricsUiKey = metricsKey;
    metricsLine.textContent = line;
    metricsLine.title = quality.reasons.join(" ");
  }
}

function startStatsPoller() {
  stopStatsPoller();
  void refreshConnectionFromStats();
  statsPollerId = setInterval(() => {
    void refreshConnectionFromStats();
  }, 1500);
}

function scheduleWebRtcRecovery() {
  if (userInitiatedDisconnect || !socket?.connected) return;
  if (webrtcRecoveryTimer) return;
  webrtcRecoveryTimer = setTimeout(() => {
    webrtcRecoveryTimer = null;
    if (!pc || userInitiatedDisconnect || !socket?.connected) return;
    const st = pc.connectionState;
    const ice = pc.iceConnectionState;
    if (st === "failed" || ice === "failed") {
      setConnStatus("Reconectando WebRTC…");
      void beginControllerSession(cachedIceServers).catch((e) => {
        setConnStatus(`Falha ao reconectar WebRTC: ${String(e)}`);
      });
    }
  }, 2000);
}

function wirePeerConnectionIceUi(pcRef: RTCPeerConnection) {
  const bump = () => {
    void refreshConnectionFromStats();
  };
  pcRef.onicegatheringstatechange = bump;
  pcRef.oniceconnectionstatechange = () => {
    bump();
    if (pcRef.iceConnectionState === "failed") {
      scheduleWebRtcRecovery();
    }
  };
  pcRef.onconnectionstatechange = () => {
    bump();
    const st = pcRef.connectionState;
    if (st === "failed") {
      setConnStatus(
        "WebRTC: falha na conexão. Tentando reconectar…",
      );
      scheduleWebRtcRecovery();
    } else if (st === "connected") {
      setConnStatus("");
    } else if (st === "disconnected") {
      setConnStatus("WebRTC: desconectado. Aguardando recuperação…");
      scheduleWebRtcRecovery();
    }
  };
}

function attachControllerWebRtcHandlers(s: Socket) {
  s.off("signal");
  s.off("ice-candidate");
  s.on("signal", async (payload: { type: string; sdp?: string }) => {
    if (!pc) return;
    if (payload.type === "offer" && payload.sdp) {
      await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await flushPendingIce();
      s.emit("signal", {
        sessionId: currentSessionId,
        type: "answer",
        sdp: answer.sdp ?? "",
      });
    }
  });
  s.on(
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
}

async function beginControllerSession(iceServers: RTCIceServer[]) {
  if (!socket?.connected) return;
  cleanupPeer();
  await startControllerWebRtc(iceServers);
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

function releaseOverlayPointerCapture() {
  if (typeof overlay.releasePointerCapture !== "function") return;
  try {
    for (const id of [0, 1, 2, 3, 4]) {
      if (overlay.hasPointerCapture(id)) {
        overlay.releasePointerCapture(id);
      }
    }
  } catch {
    /* ignore */
  }
}

function teardownControlCapture() {
  if (!controlCaptureHandlers) return;
  const h = controlCaptureHandlers;
  overlay.removeEventListener("contextmenu", h.onContextMenu, true);
  overlay.removeEventListener("pointermove", h.onPointerMove);
  overlay.removeEventListener("pointerdown", h.onPointerDown);
  overlay.removeEventListener("pointerup", h.onPointerUp);
  overlay.removeEventListener("wheel", h.onWheel);
  window.removeEventListener("keydown", h.keyHandler, true);
  window.removeEventListener("keyup", h.keyHandler, true);
  controlCaptureHandlers = null;
  captureKeys = false;
  textKeyCodes.clear();
  heldRemoteKeyCodes.clear();
  releaseOverlayPointerCapture();
  resetWheelState();
}

function cleanupPeer() {
  if (webrtcRecoveryTimer) {
    clearTimeout(webrtcRecoveryTimer);
    webrtcRecoveryTimer = null;
  }
  teardownControlCapture();
  monitorSyncReady = false;
  if (penMode && controlSend?.readyState === "open") {
    try {
      const clearMsg: ControlMsg = { t: "annotate", d: "clear" };
      controlSend.send(JSON.stringify(clearMsg));
    } catch {
      /* ignore */
    }
  }
  penMode = false;
  penModeCheckbox.checked = false;
  remoteWrap.classList.remove("pen-mode");
  penStrokeActive = false;
  penSegmentNorm = [];
  clearAnnotateCanvas();
  stopStatsPoller();
  resetConnectionUiToIdle();
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
  userInitiatedDisconnect = true;
  socketReconnecting = false;
  waitingForHostReconnect = false;
  clearHostJoinRetryTimer();
  controllerSessionStarted = false;
  cleanupPeer();
  cleanupSocket();
  captureKeys = false;
  remoteVideo.srcObject = null;
  remotePanel.classList.add("hidden");
  commandPalette.close();
  closeClientChatEmojiPopover();
  clearClientChatLog();
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

streamProfileSelect.addEventListener("change", () => {
  clearProfileApplyHint();
  const prof = parseStreamProfileId(streamProfileSelect.value);
  if (!prof) return;
  try {
    localStorage.setItem(STREAM_PROFILE_STORAGE_KEY, prof);
  } catch {
    /* ignore */
  }
  if (!controlSend || controlSend.readyState !== "open") {
    setConnStatus(
      "Conecte o canal de controle antes de alterar o perfil de vídeo.",
    );
    return;
  }
  try {
    const m: ControlMsg = { t: "streamProfile", profile: prof };
    controlSend.send(JSON.stringify(m));
  } catch {
    setConnStatus(
      "Não foi possível enviar o perfil de vídeo. Aguarde o canal de controle.",
    );
  }
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

penModeCheckbox.addEventListener("change", () => {
  setPenMode(penModeCheckbox.checked);
});

btnChatEmoji.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleClientChatEmojiPopover();
});

btnChatSend.addEventListener("click", () => {
  sendClientChatMessage();
});

chatInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    sendClientChatMessage();
  }
});

document.addEventListener(
  "keydown",
  (ev) => {
    if (
      ev.key === "Escape" &&
      !chatEmojiPopover.classList.contains("hidden")
    ) {
      closeClientChatEmojiPopover();
    }
  },
  true,
);

window.addEventListener(
  "keydown",
  (ev) => {
    if (remotePanel.classList.contains("hidden")) return;
    if (
      ev.metaKey &&
      !ev.ctrlKey &&
      !ev.altKey &&
      (ev.key === "ç" || ev.key === "Ç")
    ) {
      ev.preventDefault();
      ev.stopPropagation();
      openClientChatEmojiPopover();
    }
  },
  true,
);

function sendShortcutById(id: string) {
  if (!remoteControlEnabled) {
    setConnStatus("Modo de visualização ativo: marque 'Habilitar controle remoto' para usar atalhos.");
    return;
  }
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
}

shortcutPanel.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest(
    "button[data-shortcut]",
  ) as HTMLButtonElement | null;
  if (!btn) return;
  ev.preventDefault();
  const id = btn.getAttribute("data-shortcut");
  if (id) sendShortcutById(id);
});

/** Altera um <select> da barra como se o usuário tivesse escolhido (dispara o mesmo `change`). */
function chooseSelectOption(select: HTMLSelectElement, value: string) {
  if (select.value === value) return;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function focusChatInput() {
  const go = () => {
    chatPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    chatInput.focus({ preventScroll: true });
  };
  // O chat fica fora da área em tela cheia.
  if (document.fullscreenElement) {
    void document.exitFullscreen().then(go, go);
  } else {
    go();
  }
}

function buildPaletteCommands(): PaletteCommand[] {
  const session: PaletteCommand[] = [
    {
      id: "monitor-next",
      group: "Sessão",
      title: "Alternar monitor remoto",
      keywords: "tela display",
      hint: "Shift+F8",
      run: requestNextMonitorByUi,
    },
    {
      id: "pen-toggle",
      group: "Sessão",
      title: () => (penMode ? "Desativar modo caneta" : "Ativar modo caneta (anotações no host)"),
      keywords: "desenhar anotar pen",
      hint: "Shift+F9",
      run: () => setPenMode(!penMode),
    },
    {
      id: "remote-control-toggle",
      group: "Sessão",
      title: () =>
        remoteControlEnabled
          ? "Desativar controle remoto (só visualizar)"
          : "Ativar controle remoto",
      keywords: "visualizacao view only mouse teclado",
      hint: "Shift+F7",
      run: toggleRemoteControlByUser,
    },
    {
      id: "clipboard-toggle",
      group: "Sessão",
      title: () =>
        clientClipboardSync
          ? "Desativar sincronização da área de transferência"
          : "Ativar sincronização da área de transferência",
      keywords: "clipboard copiar colar",
      hint: "Shift+F6",
      run: toggleClipboardSyncByUser,
    },
    {
      id: "focus-remote",
      group: "Sessão",
      title: "Focar na tela remota",
      hint: "Shift+F10",
      run: () => {
        btnFocusRemote.click();
        setConnStatus("Tela remota em foco.");
      },
    },
    {
      id: "fullscreen-toggle",
      group: "Sessão",
      title: () => (document.fullscreenElement ? "Sair da tela cheia" : "Tela cheia"),
      keywords: "fullscreen",
      hint: "Shift+F11",
      run: () => btnFullscreen.click(),
    },
    {
      id: "chat-focus",
      group: "Sessão",
      title: "Escrever no chat",
      keywords: "mensagem conversa",
      run: focusChatInput,
    },
    {
      id: "disconnect",
      group: "Sessão",
      title: "Desconectar",
      keywords: "sair encerrar",
      run: () => btnDisconnect.click(),
    },
  ];

  const remote: PaletteCommand[] = Object.entries(SHORTCUT_LABELS).map(
    ([id, l]) => ({
      id: `shortcut-${id}`,
      group: "PC remoto",
      title: l.title,
      keywords: l.keywords,
      hint: l.keys,
      run: () => sendShortcutById(id),
    }),
  );

  const optionCommands = (
    select: HTMLSelectElement,
    idPrefix: string,
    group: string,
    keywords: string,
  ): PaletteCommand[] =>
    [...select.options].map((opt) => ({
      id: `${idPrefix}-${opt.value}`,
      group,
      title: () =>
        `${group}: ${opt.text}${select.value === opt.value ? " (atual)" : ""}`,
      keywords,
      run: () => chooseSelectOption(select, opt.value),
    }));

  return [
    ...session,
    ...remote,
    ...optionCommands(streamProfileSelect, "stream-profile", "Perfil de vídeo", "qualidade bitrate fps banda"),
    ...optionCommands(wheelSensitivitySelect, "wheel", "Rolagem", "scroll sensibilidade"),
  ];
}

const paletteCommands = buildPaletteCommands();
const commandPalette = createCommandPalette(() => paletteCommands, {
  onOpen: releaseHeldRemoteKeys,
});

btnCommandPalette.addEventListener("click", () => {
  commandPalette.open();
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

function clearAnnotateCanvas() {
  const ctx = annotateCanvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, annotateCanvas.width, annotateCanvas.height);
}

function syncAnnotateCanvasSize() {
  const rect = overlay.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  if (annotateCanvas.width !== w || annotateCanvas.height !== h) {
    annotateCanvas.width = w;
    annotateCanvas.height = h;
  }
}

function setPenMode(on: boolean) {
  if (penMode === on) return;
  if (on) {
    if (!controlSend || controlSend.readyState !== "open") {
      penModeCheckbox.checked = false;
      setConnStatus("Conecte o canal de controle para usar o modo caneta.");
      return;
    }
  } else {
    if (controlSend?.readyState === "open") {
      try {
        const clearMsg: ControlMsg = { t: "annotate", d: "clear" };
        controlSend.send(JSON.stringify(clearMsg));
      } catch {
        /* ignore */
      }
    }
    clearAnnotateCanvas();
  }
  penMode = on;
  penModeCheckbox.checked = on;
  remoteWrap.classList.toggle("pen-mode", on);
  setConnStatus(
    on
      ? "Modo caneta (Shift+F9): desenhe no vídeo — traço aparece no host. O mouse não controla o remoto."
      : "Modo caneta desligado; anotações no host foram limpas.",
  );
}

function ensureAnnotatePenHandlers() {
  if (annotatePenHandlersWired) return;
  annotatePenHandlersWired = true;
  const ctx = annotateCanvas.getContext("2d");
  if (!ctx) return;

  function normsToCanvasPixels(points: { x: number; y: number }[]) {
    return points.map((p) => {
      const rect = overlay.getBoundingClientRect();
      const vw = remoteVideo.videoWidth;
      const vh = remoteVideo.videoHeight;
      if (!vw || !vh) {
        return { x: p.x * rect.width, y: p.y * rect.height };
      }
      const rw = rect.width;
      const rh = rect.height;
      const scale = Math.min(rw / vw, rh / vh);
      const dispW = vw * scale;
      const dispH = vh * scale;
      const offX = (rw - dispW) / 2;
      const offY = (rh - dispH) / 2;
      return { x: offX + p.x * dispW, y: offY + p.y * dispH };
    });
  }

  function strokeLocalIncremental(a: { x: number; y: number }, b: { x: number; y: number }) {
    syncAnnotateCanvasSize();
    const pix = normsToCanvasPixels([a, b]);
    ctx.strokeStyle = "#e02020";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pix[0].x, pix[0].y);
    ctx.lineTo(pix[1].x, pix[1].y);
    ctx.stroke();
  }

  annotateCanvas.addEventListener("pointerdown", (ev) => {
    if (!penMode || !controlSend || controlSend.readyState !== "open") return;
    ev.preventDefault();
    penStrokeActive = true;
    penSegmentNorm = [];
    try {
      annotateCanvas.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    const n = clientToVideoNorm(ev.clientX, ev.clientY);
    if (!n) return;
    penSegmentNorm.push(n);
  });

  annotateCanvas.addEventListener("pointermove", (ev) => {
    if (!penStrokeActive || !penMode) return;
    const n = clientToVideoNorm(ev.clientX, ev.clientY);
    if (!n) return;
    const prev = penSegmentNorm[penSegmentNorm.length - 1];
    penSegmentNorm.push(n);
    strokeLocalIncremental(prev, n);
  });

  const endPenStroke = (ev: PointerEvent) => {
    if (!penStrokeActive) return;
    penStrokeActive = false;
    try {
      if (annotateCanvas.hasPointerCapture(ev.pointerId)) {
        annotateCanvas.releasePointerCapture(ev.pointerId);
      }
    } catch {
      /* ignore */
    }
    if (!controlSend || controlSend.readyState !== "open") {
      penSegmentNorm = [];
      return;
    }
    if (penSegmentNorm.length >= 2) {
      const msg: ControlMsg = {
        t: "annotate",
        d: "segment",
        points: penSegmentNorm.map((q) => ({ x: q.x, y: q.y })),
      };
      try {
        controlSend.send(JSON.stringify(msg));
      } catch {
        /* ignore */
      }
    }
    penSegmentNorm = [];
  };

  annotateCanvas.addEventListener("pointerup", endPenStroke);
  annotateCanvas.addEventListener("pointercancel", endPenStroke);

  window.addEventListener("resize", () => {
    if (!penMode) return;
    syncAnnotateCanvasSize();
  });
  remoteVideo.addEventListener("loadedmetadata", () => {
    syncAnnotateCanvasSize();
  });
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
  if (msg.t === "inputReset") {
    remoteInputSessionEpoch = msg.sessionEpoch;
    captureKeys = false;
    releaseOverlayPointerCapture();
    monitorSyncReady = false;
    return;
  }
  if (msg.t === "monitor" && msg.d === "active") {
    updateMonitorIndicator(msg.idx, msg.total, msg.name);
    monitorSyncReady = true;
    return;
  }
  if (msg.t === "chat") {
    const text = typeof msg.text === "string" ? msg.text : "";
    const at = typeof msg.at === "number" ? msg.at : Date.now();
    appendClientChatLine("remote", text, at);
    notifyClientChatIncoming(text);
    return;
  }
  if (msg.t === "streamProfileAck") {
    if (profileApplyHintClearTimer) {
      clearTimeout(profileApplyHintClearTimer);
      profileApplyHintClearTimer = null;
    }
    if (msg.applied) {
      profileApplyHint.textContent = "✓ aplicado";
      profileApplyHint.className = "profile-apply-hint profile-apply-hint--ok";
      profileApplyHint.title = "O host confirmou este perfil de vídeo.";
      profileApplyHintClearTimer = setTimeout(() => {
        profileApplyHintClearTimer = null;
        profileApplyHint.textContent = "";
        profileApplyHint.className = "profile-apply-hint";
        profileApplyHint.removeAttribute("title");
      }, 2600);
    } else {
      profileApplyHint.textContent = "Não aplicado";
      profileApplyHint.className =
        "profile-apply-hint profile-apply-hint--warn";
      profileApplyHint.title =
        "O host não pôde aplicar o perfil (restrição do navegador ou estado da sessão).";
    }
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
  teardownControlCapture();
  ensureAnnotatePenHandlers();
  controlSend = channel;
  applyWheelSensitivity(DEFAULT_WHEEL_SENSITIVITY);
  let lastNorm: { x: number; y: number } | null = null;
  captureKeys = false;
  monitorSyncReady = false;
  remoteControlEnabled = remoteControlCheckbox.checked;
  if (remoteControlEnabled) overlay.classList.remove("view-only");
  else overlay.classList.add("view-only");

  channel.onmessage = (ev) => {
    handleControlMessageFromHost(String(ev.data));
  };

  setConnStatus(
    "Canal de controle pronto. Clique na área remota para capturar teclado e mouse.",
  );

  const sendSavedStreamProfile = () => {
    const prof = parseStreamProfileId(streamProfileSelect.value);
    if (!prof || !controlSend || controlSend.readyState !== "open") return;
    try {
      const m: ControlMsg = { t: "streamProfile", profile: prof };
      controlSend.send(JSON.stringify(m));
    } catch {
      /* ignore */
    }
  };

  if (channel.readyState === "open") {
    setTimeout(sendSavedStreamProfile, 400);
  } else {
    channel.addEventListener(
      "open",
      () => setTimeout(sendSavedStreamProfile, 400),
      { once: true },
    );
  }

  const onContextMenu = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
  };

  const onPointerMove = (ev: PointerEvent) => {
    if (penMode) return;
    if (!remoteControlEnabled) return;
    if (!monitorSyncReady) return;
    if (!controlSend || controlSend.readyState !== "open") return;
    const n = clientToVideoNorm(ev.clientX, ev.clientY);
    if (!n) return;
    lastNorm = n;
    sendMove(n.x, n.y);
  };

  const onPointerDown = (ev: PointerEvent) => {
    if (penMode) return;
    if (!remoteControlEnabled) return;
    if (!monitorSyncReady) return;
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
  };

  const onPointerUp = (ev: PointerEvent) => {
    if (penMode) return;
    if (!remoteControlEnabled) return;
    if (!monitorSyncReady) return;
    ev.preventDefault();
    try {
      if (overlay.hasPointerCapture(ev.pointerId)) {
        overlay.releasePointerCapture(ev.pointerId);
      }
    } catch {
      /* ignore */
    }
    if (!controlSend || controlSend.readyState !== "open") return;
    const n = clientToVideoNorm(ev.clientX, ev.clientY) ?? lastNorm;
    if (!n) return;
    lastNorm = n;
    sendMove(n.x, n.y);
    const msg: ControlMsg = { t: "btn", b: ev.button, down: false };
    controlSend.send(JSON.stringify(msg));
  };

  const onWheel = (ev: WheelEvent) => {
    if (penMode) return;
    if (!remoteControlEnabled) return;
    if (!monitorSyncReady) return;
    ev.preventDefault();
    if (!controlSend || controlSend.readyState !== "open") return;
    const n = clientToVideoNorm(ev.clientX, ev.clientY);
    if (n) {
      lastNorm = n;
      sendMove(n.x, n.y);
    }
    enqueueWheelFromEvent(ev);
  };

  const keyHandler = (ev: KeyboardEvent) => {
    if (handleGlobalFunctionHotkeys(ev)) return;
    // Paleta aberta: as teclas ficam no campo de busca, nada vai ao host.
    if (commandPalette.isOpen()) return;
    if (!remoteControlEnabled) return;
    if (!monitorSyncReady) return;
    if (!captureKeys || remotePanel.classList.contains("hidden")) return;
    if (!controlSend || controlSend.readyState !== "open") return;
    ev.preventDefault();
    ev.stopPropagation();
    // Acento "morto" (´ ` ~ ^ ¨): o navegador compõe e entrega o caractere final no próximo keydown.
    // Não repassar evita deixar o host com um acento pendente no layout dele.
    if (ev.key === "Dead") return;
    const down = ev.type === "keydown";
    let text = "";
    if (down) {
      text = resolveKeyText(ev);
      if (text) textKeyCodes.add(ev.code);
      else textKeyCodes.delete(ev.code);
    } else if (textKeyCodes.delete(ev.code)) {
      return;
    }
    const msg: ControlMsg = {
      t: "key",
      code: ev.code,
      key: ev.key,
      down,
      ctrl: ev.ctrlKey,
      alt: ev.altKey,
      shift: ev.shiftKey,
      meta: ev.metaKey,
      text,
    };
    controlSend.send(JSON.stringify(msg));
    if (!text) {
      if (down) heldRemoteKeyCodes.add(ev.code);
      else heldRemoteKeyCodes.delete(ev.code);
    }
  };

  overlay.addEventListener("contextmenu", onContextMenu, true);
  overlay.addEventListener("pointermove", onPointerMove);
  overlay.addEventListener("pointerdown", onPointerDown);
  overlay.addEventListener("pointerup", onPointerUp);
  overlay.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", keyHandler, true);
  window.addEventListener("keyup", keyHandler, true);

  controlCaptureHandlers = {
    onContextMenu,
    onPointerMove,
    onPointerDown,
    onPointerUp,
    onWheel,
    keyHandler,
  };
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

  wirePeerConnectionIceUi(pc);
  startStatsPoller();

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

  attachControllerWebRtcHandlers(socket);
  socket.emit("webrtc-controller-ready", { sessionId: currentSessionId });

  remotePanel.classList.remove("hidden");
  btnDisconnect.disabled = false;
  setStatus("Aguardando vídeo do host…", "ok");

  try {
    const saved = localStorage.getItem(STREAM_PROFILE_STORAGE_KEY);
    const p = saved ? parseStreamProfileId(saved) : null;
    if (p) streamProfileSelect.value = p;
  } catch {
    /* ignore */
  }
}

function clearHostJoinRetryTimer() {
  if (hostJoinRetryTimer) {
    clearTimeout(hostJoinRetryTimer);
    hostJoinRetryTimer = null;
  }
}

function scheduleHostJoinRetry(
  s: Socket,
  sessionId: string,
  iceServers: RTCIceServer[],
) {
  clearHostJoinRetryTimer();
  hostJoinRetryTimer = setTimeout(() => {
    hostJoinRetryTimer = null;
    if (userInitiatedDisconnect || !waitingForHostReconnect || !s.connected) {
      return;
    }
    attemptControllerJoin(s, sessionId, iceServers);
  }, 2000);
}

function attemptControllerJoin(
  s: Socket,
  sessionId: string,
  iceServers: RTCIceServer[],
) {
  s.emit(
    "join",
    { sessionId, role: "controller" },
    (err: string | null) => {
      if (err) {
        if (
          waitingForHostReconnect &&
          (err.includes("Nenhum host") ||
            err.includes("ainda não iniciou o compartilhamento"))
        ) {
          setStatus("Aguardando host reconectar…", "err");
          setConnStatus("Aguardando host…");
          scheduleHostJoinRetry(s, sessionId, iceServers);
          return;
        }
        setStatus(err, "err");
        if (!socketReconnecting && !waitingForHostReconnect) {
          btnConnect.disabled = false;
        }
        return;
      }
      waitingForHostReconnect = false;
      clearHostJoinRetryTimer();
      socketReconnecting = false;
      controllerSessionStarted = true;
      btnConnect.disabled = true;
      btnDisconnect.disabled = false;
      remotePanel.classList.remove("hidden");
      setStatus("Sessão aceita. Preparando WebRTC…", "ok");
      void beginControllerSession(iceServers).catch((e) => {
        setStatus(`WebRTC: ${String(e)}`, "err");
        if (!userInitiatedDisconnect) btnConnect.disabled = false;
      });
    },
  );
}

function wireControllerSocket(s: Socket, sessionId: string, iceServers: RTCIceServer[]) {
  s.on("connect_error", (err) => {
    if (!userInitiatedDisconnect) {
      setStatus(`Socket: ${err.message} (tentando de novo…)`, "err");
      return;
    }
    setStatus(`Socket: ${err.message}`, "err");
    btnConnect.disabled = false;
  });

  s.on("disconnect", (reason) => {
    if (userInitiatedDisconnect) {
      setStatus(`Desconectado: ${reason}`, "err");
      disconnectAll();
      return;
    }
    socketReconnecting = true;
    cleanupPeer();
    setStatus(`Conexão perdida (${reason}). Reconectando…`, "err");
    setConnStatus("Reconectando socket…");
  });

  s.on("peer-left", ({ role }: { role: string }) => {
    if (userInitiatedDisconnect) return;
    if (role === "host") {
      waitingForHostReconnect = true;
      cleanupPeer();
      btnDisconnect.disabled = false;
      remotePanel.classList.remove("hidden");
      setStatus("Host reconectando… aguardando retorno.", "err");
      setConnStatus("Aguardando host…");
      if (s.connected) {
        scheduleHostJoinRetry(s, sessionId, iceServers);
      }
      return;
    }
    setStatus("Controlador desconectou da sala; aguardando host…", "err");
    cleanupPeer();
  });

  s.on(
    "host-rejoined",
    (payload: { sessionId: string; sessionEpoch?: number }) => {
      if (payload.sessionId !== currentSessionId) return;
      waitingForHostReconnect = false;
      clearHostJoinRetryTimer();
      setStatus("Host voltou. Restabelecendo WebRTC…", "ok");
      void beginControllerSession(iceServers).catch((e) => {
        setStatus(`WebRTC: ${String(e)}`, "err");
      });
    },
  );

  s.on("connect", () => {
    setStatus(
      socketReconnecting || waitingForHostReconnect
        ? "Socket reconectado. Entrando na sessão…"
        : "Socket conectado. Entrando na sessão…",
    );
    attemptControllerJoin(s, sessionId, iceServers);
  });
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

  userInitiatedDisconnect = false;
  socketReconnecting = false;
  waitingForHostReconnect = false;
  clearHostJoinRetryTimer();
  controllerSessionStarted = false;
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

  cachedIceServers = iceServers;
  cleanupSocket();
  currentSessionId = sessionId;

  socket = io(base, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  });

  wireControllerSocket(socket, sessionId, iceServers);
});
