const srv = window.desklinkServer;

// ---------------------------------------------------------------------------
// Referências DOM
// ---------------------------------------------------------------------------

const serverDot = document.getElementById("server-dot") as HTMLElement;
const serverStatusText = document.getElementById("server-status-text") as HTMLElement;
const tunnelDot = document.getElementById("tunnel-dot") as HTMLElement;
const tunnelStatusText = document.getElementById("tunnel-status-text") as HTMLElement;

const urlCard = document.getElementById("url-card") as HTMLElement;
const tunnelUrlText = document.getElementById("tunnel-url-text") as HTMLElement;
const copyBtn = document.getElementById("copy-btn") as HTMLButtonElement;
const copyHint = document.getElementById("copy-hint") as HTMLElement;
const openBrowserBtn = document.getElementById("open-browser-btn") as HTMLButtonElement;
const restartTunnelBtn = document.getElementById("restart-tunnel-btn") as HTMLButtonElement;

const logArea = document.getElementById("log-area") as HTMLPreElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

const MAX_LOG_LINES = 300;
const logLines: string[] = [];

function addLog(line: string) {
  const ts = new Date().toTimeString().slice(0, 8);
  logLines.push("[" + ts + "] " + line);
  if (logLines.length > MAX_LOG_LINES) logLines.shift();
  logArea.textContent = logLines.join("\n");
  logArea.scrollTop = logArea.scrollHeight;
}

// ---------------------------------------------------------------------------
// Atualização de status
// ---------------------------------------------------------------------------

function setServerPhase(phase: string, message?: string) {
  if (phase === "ready") {
    serverDot.dataset.state = "ok";
    serverStatusText.textContent = "Ativo";
  } else if (phase === "error") {
    serverDot.dataset.state = "err";
    serverStatusText.textContent = message ?? "Erro";
  } else {
    serverDot.dataset.state = "waiting";
    serverStatusText.textContent = "Iniciando...";
  }
}

function setTunnelPhase(phase: string, url?: string, message?: string) {
  if (phase === "idle") {
    tunnelDot.dataset.state = "waiting";
    tunnelStatusText.textContent = "Aguardando servidor...";
    urlCard.classList.add("hidden");
  } else if (phase === "starting") {
    tunnelDot.dataset.state = "waiting";
    tunnelStatusText.textContent = "Iniciando túnel...";
    urlCard.classList.add("hidden");
  } else if (phase === "ready" && url) {
    tunnelDot.dataset.state = "ok";
    tunnelStatusText.textContent = "Ativo";
    tunnelUrlText.textContent = url;
    urlCard.classList.remove("hidden");
  } else {
    tunnelDot.dataset.state = "err";
    tunnelStatusText.textContent = message ?? "Erro";
    urlCard.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// IPC listeners
// ---------------------------------------------------------------------------

srv.onStatus((d) => setServerPhase(d.phase, d.message));
srv.onTunnelStatus((d) => setTunnelPhase(d.phase, d.url, d.message));
srv.onLog((d) => addLog(d.line));

// ---------------------------------------------------------------------------
// Ações dos botões
// ---------------------------------------------------------------------------

let copyHintTimer: ReturnType<typeof setTimeout> | null = null;

copyBtn.addEventListener("click", () => {
  const url = tunnelUrlText.textContent ?? "";
  if (!url) return;
  void srv.copyText(url).then(() => {
    copyHint.textContent = "URL copiada!";
    if (copyHintTimer) clearTimeout(copyHintTimer);
    copyHintTimer = setTimeout(() => {
      copyHint.textContent = "";
    }, 2000);
  });
});

openBrowserBtn.addEventListener("click", () => {
  void srv.openBrowser();
});

restartTunnelBtn.addEventListener("click", () => {
  tunnelUrlText.textContent = "";
  void srv.restartTunnel();
});

stopBtn.addEventListener("click", () => {
  stopBtn.disabled = true;
  stopBtn.textContent = "Encerrando...";
  void srv.stopServer();
});
