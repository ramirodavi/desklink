/**
 * Prepara os payloads do installer:
 *  - payload-common/  → runtime Electron idêntico entre Host e Server (instalado 1x)
 *  - payload/         → arquivos exclusivos do Host (exe, icon.ico, resources/)
 *
 * Execute ANTES de prepare-wizard-payload-server.mjs.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const agentRoot       = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir      = join(agentRoot, "release");
const installerDir    = join(agentRoot, "installer");
const payloadDir      = join(installerDir, "payload");
const payloadCommonDir = join(installerDir, "payload-common");
const rootIconIco     = join(agentRoot, "build", "icon.ico");

if (!existsSync(releaseDir)) {
  console.error(
    `[prepare-wizard-payload] Pasta não encontrada: ${releaseDir}\n` +
      "Execute `npm run build:host-bundle -w agent` antes.",
  );
  process.exit(1);
}

const unpackedDir = join(releaseDir, "win-unpacked");
if (!existsSync(unpackedDir)) {
  console.error(
    `[prepare-wizard-payload] win-unpacked não encontrado: ${unpackedDir}\n` +
      "Garanta que `npm run build:host-bundle -w agent` foi executado com `--win dir`.",
  );
  process.exit(1);
}

/**
 * Libera o caminho alvo mesmo que contenha arquivos travados pelo Windows.
 * Estratégias em ordem crescente de agressividade:
 *   1. renameSync para nome temporário (funciona mesmo com handles abertos na maioria dos casos)
 *   2. rmSync recursivo
 *   3. cmd /c rmdir /s /q (bypass de permissão do Node.js)
 */
function clearDirSafe(target) {
  if (!existsSync(target)) return;

  const stale = target + "._old";
  if (existsSync(stale)) {
    try { rmSync(stale, { recursive: true, force: true }); } catch { /* ignora */ }
  }

  // Tentativa 1: rename
  try {
    renameSync(target, stale);
    try { rmSync(stale, { recursive: true, force: true }); } catch { /* ignora */ }
    return;
  } catch { /* continua */ }

  // Tentativa 2: rmSync
  try {
    rmSync(target, { recursive: true, force: true });
    return;
  } catch { /* continua */ }

  // Tentativa 3: cmd /c rmdir (último recurso — ignora erro; próximo cpSync sobrescreve)
  spawnSync("cmd", ["/c", "rmdir", "/s", "/q", target], { shell: false });
  if (existsSync(target)) {
    console.warn(
      `[prepare-wizard-payload] Aviso: não foi possível remover completamente "${target}".` +
        "\nOs arquivos serão sobrescritos (ignoreversion está ativo no Inno Setup).",
    );
  }
}

/**
 * Arquivos/pastas exclusivos do Host (não fazem parte do runtime Electron comum).
 * Tudo o que NÃO estiver nesta lista vai para payload-common.
 */
const HOST_ONLY = new Set(["DeskLinkHost.exe", "icon.ico", "resources"]);

clearDirSafe(payloadDir);
clearDirSafe(payloadCommonDir);
mkdirSync(payloadDir,       { recursive: true });
mkdirSync(payloadCommonDir, { recursive: true });

const entries = readdirSync(unpackedDir, { withFileTypes: true });
for (const e of entries) {
  const src = join(unpackedDir, e.name);
  if (HOST_ONLY.has(e.name)) {
    const dst = join(payloadDir, e.name);
    if (e.isDirectory()) cpSync(src, dst, { recursive: true });
    else cpSync(src, dst);
  } else {
    const dst = join(payloadCommonDir, e.name);
    if (e.isDirectory()) cpSync(src, dst, { recursive: true });
    else cpSync(src, dst);
  }
}

// Sobrescreve icon.ico no payload do Host com o gerado pelo build (pode diferir do empacotado)
if (existsSync(rootIconIco)) {
  cpSync(rootIconIco, join(payloadDir, "icon.ico"));
}

console.log("[prepare-wizard-payload] OK");
console.log("  payload/        →", payloadDir);
console.log("  payload-common/ →", payloadCommonDir);
