import { io, type Socket } from "socket.io-client";
import type { ControlMsg } from "./protocol.js";

declare global {
  interface Window {
    desklink: {
      getDesktopSources: () => Promise<DesktopSource[]>;
      applyControl: (json: string) => Promise<void>;
      notifySessionActive: () => Promise<void>;
      readClipboard: () => Promise<string>;
      writeClipboard: (text: string) => Promise<void>;
      setActiveDisplayBounds: (
        bounds: { x: number; y: number; width: number; height: number } | null,
      ) => Promise<void>;
    };
  }
}

type DesktopSource = {
  id: string;
  name: string;
  displayId: number | null;
  bounds: { x: number; y: number; width: number; height: number } | null;
};

const CLIP_MAX_CHARS = 256 * 1024;
const CLIP_POLL_MS = 500;
const CLIP_SUPPRESS_MS = 450;
const WHEEL_FLUSH_MS = 16;
const WHEEL_MAX_STEPS_PER_FLUSH = 8;

let hostClipboardSync = false;
let hostClipPollId: ReturnType<typeof setInterval> | null = null;
/** Último texto conhecido no clipboard do OS (evita push duplicado). */
let hostClipKnown = "";
let hostClipSuppressUntil = 0;
let hostWheelPendingX = 0;
let hostWheelPendingY = 0;
let hostWheelFlushTimer: ReturnType<typeof setTimeout> | null = null;

function clearHostClipboardPoll() {
  if (hostClipPollId) {
    clearInterval(hostClipPollId);
    hostClipPollId = null;
  }
}

function stopHostClipboardSync() {
  hostClipboardSync = false;
  clearHostClipboardPoll();
  hostClipKnown = "";
  hostClipSuppressUntil = 0;
}

function startHostClipboardPoll() {
  clearHostClipboardPoll();
  hostClipboardSync = true;
  hostClipKnown = "";
  hostClipSuppressUntil = 0;
  hostClipPollId = setInterval(() => {
    void (async () => {
      if (!hostClipboardSync || !controlChannel || controlChannel.readyState !== "open") {
        return;
      }
      if (Date.now() < hostClipSuppressUntil) return;
      let text: string;
      try {
        text = await window.desklink.readClipboard();
      } catch {
        return;
      }
      if (text.length > CLIP_MAX_CHARS) {
        text = text.slice(0, CLIP_MAX_CHARS);
      }
      if (text === hostClipKnown) return;
      hostClipKnown = text;
      controlChannel.send(
        JSON.stringify({
          t: "clip",
          d: "push",
          text,
        } satisfies ControlMsg),
      );
    })();
  }, CLIP_POLL_MS);
}

function setHostClipboardSync(enabled: boolean) {
  if (!enabled) {
    stopHostClipboardSync();
    return;
  }
  startHostClipboardPoll();
}

function resetHostWheelState() {
  hostWheelPendingX = 0;
  hostWheelPendingY = 0;
  if (hostWheelFlushTimer) {
    clearTimeout(hostWheelFlushTimer);
    hostWheelFlushTimer = null;
  }
}

function scheduleHostWheelFlush() {
  if (hostWheelFlushTimer) return;
  hostWheelFlushTimer = setTimeout(() => {
    hostWheelFlushTimer = null;
    flushHostWheelToMain();
  }, WHEEL_FLUSH_MS);
}

function enqueueHostWheel(vx: number, vy: number) {
  const sx = Number.isFinite(vx) ? Math.trunc(vx) : 0;
  const sy = Number.isFinite(vy) ? Math.trunc(vy) : 0;
  if (sx === 0 && sy === 0) return;
  hostWheelPendingX += sx;
  hostWheelPendingY += sy;
  scheduleHostWheelFlush();
}

function flushHostWheelToMain() {
  if (!controlChannel || controlChannel.readyState !== "open") {
    resetHostWheelState();
    return;
  }
  const sx =
    Math.sign(hostWheelPendingX) *
    Math.min(WHEEL_MAX_STEPS_PER_FLUSH, Math.abs(hostWheelPendingX));
  const sy =
    Math.sign(hostWheelPendingY) *
    Math.min(WHEEL_MAX_STEPS_PER_FLUSH, Math.abs(hostWheelPendingY));
  if (sx === 0 && sy === 0) return;
  hostWheelPendingX -= sx;
  hostWheelPendingY -= sy;
  void window.desklink.applyControl(JSON.stringify({ t: "wheel", vx: sx, vy: sy } satisfies ControlMsg));
  if (hostWheelPendingX !== 0 || hostWheelPendingY !== 0) {
    scheduleHostWheelFlush();
  }
}

async function applyClipSetFromClient(text: string) {
  if (!hostClipboardSync) return;
  let s = typeof text === "string" ? text : "";
  if (s.length > CLIP_MAX_CHARS) s = s.slice(0, CLIP_MAX_CHARS);
  await window.desklink.writeClipboard(s);
  hostClipKnown = s;
  hostClipSuppressUntil = Date.now() + CLIP_SUPPRESS_MS;
}

function routeControlChannelMessage(raw: string) {
  let msg: ControlMsg;
  try {
    msg = JSON.parse(raw) as ControlMsg;
  } catch {
    void window.desklink.applyControl(raw);
    return;
  }
  if (msg.t === "clip") {
    if (msg.d === "sync") {
      setHostClipboardSync(msg.enabled);
      return;
    }
    if (msg.d === "set") {
      void applyClipSetFromClient(msg.text);
      return;
    }
    return;
  }
  if (msg.t === "monitor" && msg.d === "next") {
    void switchToNextDesktopSource();
    return;
  }
  if (msg.t === "wheel") {
    enqueueHostWheel(msg.vx, msg.vy);
    return;
  }
  void window.desklink.applyControl(raw);
}

const root = document.getElementById("root")!;

root.innerHTML = `
  <div class="app-shell">
    <header class="brand">
      <div class="brand-icon" aria-hidden="true">
        <img src="./icon.png" width="48" height="48" alt="" decoding="async" />
      </div>
      <div class="brand-text">
        <h1>DeskLink</h1>
        <p>Compartilhe sua tela com quem você confia</p>
      </div>
    </header>

    <section class="card">
      <p class="card-title">Servidor</p>
      <label class="field-label" for="serverUrl">Endereço do servidor DeskLink</label>
      <input type="text" id="serverUrl" value="" placeholder="http://IP:3000 ou https://…" autocomplete="off" />
      <p class="hint">Cole o mesmo URL do servidor; ao conectar, o status abaixo atualiza e o botão de compartilhar libera.</p>
    </section>

    <section class="card">
      <p class="card-title">Código da sessão</p>
      <p class="hint" style="margin-top:0">Envie este código para a outra pessoa conectar.</p>
      <div class="session-box">
        <p class="session-code" id="sessionCode"></p>
      </div>
      <div class="actions">
        <button type="button" class="secondary" id="btnCopy">Copiar código</button>
      </div>
    </section>

    <section class="card">
      <p class="card-title">Tela</p>
      <div class="actions">
        <button type="button" class="primary" id="btnShare">Iniciar compartilhamento</button>
        <button type="button" class="danger" id="btnStop" disabled>Parar</button>
      </div>
      <p class="status" id="statusText">Cole o URL do servidor e aguarde “Conectado”.</p>
    </section>

    <p class="footer-note">Ao compartilhar, outra pessoa poderá ver e controlar seu PC.</p>
  </div>
`;

const serverUrlInput = document.getElementById("serverUrl") as HTMLInputElement;
const sessionCodeEl = document.getElementById("sessionCode") as HTMLParagraphElement;
const statusText = document.getElementById("statusText") as HTMLParagraphElement;
const btnCopy = document.getElementById("btnCopy") as HTMLButtonElement;
const btnShare = document.getElementById("btnShare") as HTMLButtonElement;
const btnStop = document.getElementById("btnStop") as HTMLButtonElement;

btnShare.disabled = true;

const sessionId = crypto.randomUUID();
sessionCodeEl.textContent = sessionId;

let socket: Socket | null = null;
let pc: RTCPeerConnection | null = null;
let controlChannel: RTCDataChannel | null = null;
let localStream: MediaStream | null = null;
let pendingIce: RTCIceCandidateInit[] = [];
let desktopSources: DesktopSource[] = [];
let activeSourceIdx = -1;

function setStatus(t: string, kind: "" | "ok" | "err" = "") {
  statusText.textContent = t;
  statusText.className = "status" + (kind ? ` ${kind}` : "");
}

function sendActiveMonitorStateToController() {
  if (!controlChannel || controlChannel.readyState !== "open") return;
  const src = desktopSources[activeSourceIdx];
  controlChannel.send(
    JSON.stringify({
      t: "monitor",
      d: "active",
      idx: activeSourceIdx,
      total: desktopSources.length,
      name: src?.name ?? "",
    } satisfies ControlMsg),
  );
}

async function applyActiveSourceBounds() {
  const src = desktopSources[activeSourceIdx];
  await window.desklink.setActiveDisplayBounds(src?.bounds ?? null);
}

async function createDesktopStream(sourceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxFrameRate: 30,
      },
    },
  } as MediaStreamConstraints);
}

async function switchToDesktopSource(nextIdx: number): Promise<boolean> {
  if (!pc || !localStream || nextIdx < 0 || nextIdx >= desktopSources.length) {
    return false;
  }
  const src = desktopSources[nextIdx];
  if (!src) return false;
  const nextStream = await createDesktopStream(src.id);
  const nextTrack = nextStream.getVideoTracks()[0];
  if (!nextTrack) {
    nextStream.getTracks().forEach((t) => t.stop());
    return false;
  }
  const sender = pc.getSenders().find((s) => s.track?.kind === "video");
  if (!sender) {
    nextStream.getTracks().forEach((t) => t.stop());
    return false;
  }
  await sender.replaceTrack(nextTrack);
  localStream.getTracks().forEach((t) => t.stop());
  localStream = nextStream;
  activeSourceIdx = nextIdx;
  await applyActiveSourceBounds();
  return true;
}

async function switchToNextDesktopSource() {
  if (!pc || !localStream || desktopSources.length <= 1) return;
  const next = (activeSourceIdx + 1) % desktopSources.length;
  try {
    const ok = await switchToDesktopSource(next);
    if (!ok) {
      setStatus("Falha ao alternar monitor remoto.", "err");
      return;
    }
    const src = desktopSources[activeSourceIdx];
    sendActiveMonitorStateToController();
    setStatus(`Monitor remoto ativo: ${src?.name ?? `#${activeSourceIdx + 1}`}.`, "ok");
  } catch (e) {
    setStatus(`Falha ao alternar monitor: ${String(e)}`, "err");
  }
}

btnCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(sessionId);
    setStatus("Código copiado.", "ok");
  } catch {
    setStatus("Não foi possível copiar.", "err");
  }
});

function cleanupPeer() {
  stopHostClipboardSync();
  resetHostWheelState();
  controlChannel?.close();
  controlChannel = null;
  pendingIce = [];
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  activeSourceIdx = -1;
  void window.desklink.setActiveDisplayBounds(null);
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

function disconnectSocket() {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

async function fetchIceServers(base: string): Promise<RTCIceServer[]> {
  const url = `${base.replace(/\/$/, "")}/api/ice-servers`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Falha ao obter servidores ICE");
  return (await res.json()) as RTCIceServer[];
}

function attachSocketHandlers(s: Socket) {
  s.on("controller-video-ready", () => {
    void window.desklink.notifySessionActive().catch(() => {});
  });

  s.on("webrtc-both-ready", async () => {
    if (!pc) return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      s.emit("signal", {
        sessionId,
        type: "offer",
        sdp: offer.sdp ?? "",
      });
      setStatus("Negociando WebRTC…", "ok");
    } catch (e) {
      setStatus(`Erro na oferta: ${String(e)}`, "err");
    }
  });

  s.on("signal", async (payload: { type: string; sdp?: string }) => {
    if (!pc || payload.type !== "answer" || !payload.sdp) return;
    try {
      await pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
      await flushPendingIce();
      setStatus("Conexão estabelecida.", "ok");
    } catch (e) {
      setStatus(`Erro SDP answer: ${String(e)}`, "err");
    }
  });

  s.on(
    "ice-candidate",
    async (payload: { candidate: RTCIceCandidateInit | null }) => {
      if (!pc || !payload.candidate?.candidate) return;
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

  s.on("peer-left", ({ role }: { role: string }) => {
    if (role !== "controller") return;
    setStatus(
      "Controlador desconectou. Inicie o compartilhamento de novo para nova conexão.",
      "err",
    );
    cleanupPeer();
    socket?.emit("webrtc-host-reset", { sessionId });
    btnShare.disabled = !socket?.connected;
    btnStop.disabled = true;
    serverUrlInput.disabled = false;
  });
}

function connectSocket(): Promise<void> {
  return new Promise((resolve, reject) => {
    const base = serverUrlInput.value.trim();
    if (!base) {
      reject(new Error("URL vazio"));
      return;
    }
    disconnectSocket();
    const s = io(base, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });
    socket = s;
    s.once("connect_error", reject);
    s.once("connect", () => {
      s.off("connect_error", reject);
      s.emit("join", { sessionId, role: "host" }, (err: string | null) => {
        if (err) {
          reject(new Error(err));
          return;
        }
        attachSocketHandlers(s);
        resolve();
      });
    });
  });
}

let connectDebounce: ReturnType<typeof setTimeout> | null = null;

async function tryConnectFromUrl() {
  const base = serverUrlInput.value.trim();
  if (!base) {
    disconnectSocket();
    btnShare.disabled = true;
    setStatus("Cole o URL do servidor (ex.: http://192.168.1.10:3000).", "");
    return;
  }
  setStatus("Conectando ao servidor…", "");
  btnShare.disabled = true;
  try {
    await connectSocket();
    setStatus(
      "Conectado. Envie o código ao controlador e clique em Iniciar compartilhamento.",
      "ok",
    );
    btnShare.disabled = false;
  } catch (e) {
    setStatus(`Falha ao conectar: ${String(e)}`, "err");
    btnShare.disabled = true;
  }
}

function scheduleConnectFromUrl() {
  if (connectDebounce) clearTimeout(connectDebounce);
  connectDebounce = setTimeout(() => {
    connectDebounce = null;
    void tryConnectFromUrl();
  }, 450);
}

serverUrlInput.addEventListener("input", scheduleConnectFromUrl);
serverUrlInput.addEventListener("paste", () => {
  setTimeout(() => scheduleConnectFromUrl(), 0);
});

btnShare.addEventListener("click", async () => {
  if (!socket?.connected) {
    setStatus("Conecte ao servidor antes (URL acima).", "err");
    return;
  }

  try {
    const base = serverUrlInput.value.trim();
    const iceServers = await fetchIceServers(base);
    desktopSources = await window.desklink.getDesktopSources();
    const first = desktopSources[0];
    if (!first) {
      setStatus("Nenhuma tela encontrada.", "err");
      return;
    }
    activeSourceIdx = 0;
    const stream = await createDesktopStream(first.id);

    cleanupPeer();
    activeSourceIdx = 0;
    localStream = stream;
    await applyActiveSourceBounds();

    pc = new RTCPeerConnection({ iceServers });
    for (const track of stream.getVideoTracks()) {
      pc.addTrack(track, stream);
    }

    pc.onicecandidate = (ev) => {
      if (!socket) return;
      socket.emit("ice-candidate", {
        sessionId,
        candidate: ev.candidate
          ? {
              candidate: ev.candidate.candidate,
              sdpMLineIndex: ev.candidate.sdpMLineIndex,
              sdpMid: ev.candidate.sdpMid,
            }
          : null,
      });
    };

    controlChannel = pc.createDataChannel("control", {
      ordered: true,
    });
    controlChannel.onopen = () => {
      sendActiveMonitorStateToController();
    };
    controlChannel.onmessage = (ev) => {
      routeControlChannelMessage(String(ev.data));
    };

    socket!.emit("webrtc-host-ready", { sessionId });
    btnShare.disabled = true;
    btnStop.disabled = false;
    serverUrlInput.disabled = true;
    const monitorHint =
      desktopSources.length > 1
        ? " Use F8 no controlador para alternar monitor."
        : "";
    setStatus(
      `Compartilhando ${first.name}. Aguardando controlador e permissão WebRTC.${monitorHint}`,
      "ok",
    );
  } catch (e) {
    setStatus(`Erro: ${String(e)}`, "err");
    cleanupPeer();
  }
});

btnStop.addEventListener("click", () => {
  cleanupPeer();
  socket?.emit("webrtc-host-reset", { sessionId });
  btnShare.disabled = !socket?.connected;
  btnStop.disabled = true;
  serverUrlInput.disabled = false;
  setStatus("Compartilhamento parado.", "ok");
});
