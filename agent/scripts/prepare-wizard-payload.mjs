import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const agentRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(agentRoot, "release");
const payloadStageDir = join(agentRoot, "installer", "payload");
const rootIconIco = join(agentRoot, "build", "icon.ico");

if (!existsSync(releaseDir)) {
  console.error(
    `[prepare-wizard-payload] Pasta não encontrada: ${releaseDir}\n` +
      "Execute `npm run build:host-bundle -w agent` antes de gerar o payload.",
  );
  process.exit(1);
}

const unpackedDir = join(releaseDir, "win-unpacked");
if (!existsSync(unpackedDir)) {
  console.error(
    `[prepare-wizard-payload] Pasta win-unpacked não encontrada: ${unpackedDir}\n` +
      "Garanta que `npm run build:host-bundle -w agent` foi executado com `--win dir` (ou valide a saída do electron-builder).",
  );
  process.exit(1);
}

if (existsSync(payloadStageDir)) {
  rmSync(payloadStageDir, { recursive: true, force: true });
}
mkdirSync(payloadStageDir, { recursive: true });

// Copiar toda a distribuição desempacotada para evitar extração em runtime.
const entries = readdirSync(unpackedDir, { withFileTypes: true });
for (const e of entries) {
  const src = join(unpackedDir, e.name);
  const dst = join(payloadStageDir, e.name);
  if (e.isDirectory()) {
    cpSync(src, dst, { recursive: true });
  } else {
    cpSync(src, dst);
  }
}
if (existsSync(rootIconIco)) {
  cpSync(rootIconIco, join(payloadStageDir, "icon.ico"));
}
console.log("[prepare-wizard-payload] OK (payload de instalação):", payloadStageDir);
