/**
 * Prepara o payload exclusivo do Server para o installer:
 *  - payload-server/ → arquivos exclusivos do Server (exe, icon.ico, resources/)
 *
 * O runtime Electron comum (payload-common/) é gerado por prepare-wizard-payload.mjs.
 * Este script deve ser executado DEPOIS daquele.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const agentServerRoot  = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir       = join(agentServerRoot, "release");
const agentRoot        = join(agentServerRoot, "..", "agent");
const payloadServerDir = join(agentRoot, "installer", "payload-server");
const buildIconIco     = join(agentServerRoot, "build", "icon.ico");

if (!existsSync(releaseDir)) {
  console.error(
    "[prepare-wizard-payload-server] Pasta não encontrada:", releaseDir,
    "\nExecute `npm run build:host-bundle -w agent-server` antes.",
  );
  process.exit(1);
}

const unpackedDir = join(releaseDir, "win-unpacked");
if (!existsSync(unpackedDir)) {
  console.error(
    "[prepare-wizard-payload-server] win-unpacked não encontrado:", unpackedDir,
    "\nGaranta que `electron-builder --win dir` foi executado.",
  );
  process.exit(1);
}

function clearDirSafe(target) {
  if (!existsSync(target)) return;

  const stale = target + "._old";
  if (existsSync(stale)) {
    try { rmSync(stale, { recursive: true, force: true }); } catch { /* ignora */ }
  }

  try {
    renameSync(target, stale);
    try { rmSync(stale, { recursive: true, force: true }); } catch { /* ignora */ }
    return;
  } catch { /* continua */ }

  try {
    rmSync(target, { recursive: true, force: true });
    return;
  } catch { /* continua */ }

  spawnSync("cmd", ["/c", "rmdir", "/s", "/q", target], { shell: false });
  if (existsSync(target)) {
    console.warn(
      `[prepare-wizard-payload-server] Aviso: não foi possível remover completamente "${target}".` +
        "\nOs arquivos serão sobrescritos (ignoreversion está ativo no Inno Setup).",
    );
  }
}

/**
 * Arquivos exclusivos do Server — o restante já está em payload-common/.
 */
const SERVER_ONLY = new Set(["DeskLinkServer.exe", "icon.ico", "resources"]);

clearDirSafe(payloadServerDir);
mkdirSync(payloadServerDir, { recursive: true });

const entries = readdirSync(unpackedDir, { withFileTypes: true });
for (const e of entries) {
  if (!SERVER_ONLY.has(e.name)) continue;  // runtime comum → ignorar
  const src = join(unpackedDir, e.name);
  const dst = join(payloadServerDir, e.name);
  if (e.isDirectory()) cpSync(src, dst, { recursive: true });
  else cpSync(src, dst);
}

// Sobrescreve icon.ico com o ícone do Servidor gerado pelo build
if (existsSync(buildIconIco)) {
  cpSync(buildIconIco, join(payloadServerDir, "icon.ico"));
}

console.log("[prepare-wizard-payload-server] OK:", payloadServerDir);
