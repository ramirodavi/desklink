import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const agentRoot        = join(dirname(fileURLToPath(import.meta.url)), "..");
const payloadCommonDir = join(agentRoot, "installer", "payload-common");
const payloadHostDir   = join(agentRoot, "installer", "payload");
const payloadServerDir = join(agentRoot, "installer", "payload-server");
const installerScript  = join(agentRoot, "installer", "DeskLinkDeployWizard.iss");
const publishDir       = join(agentRoot, "installer", "publish");
const wizardExe        = join(publishDir, "DeskLinkDeployWizard.exe");

if (!existsSync(payloadCommonDir)) {
  console.error(
    "[build-deploy-wizard] Payload comum não encontrado:", payloadCommonDir,
    "\nExecute `npm run prepare:wizard-payload -w agent` antes.",
  );
  process.exit(1);
}

if (!existsSync(payloadHostDir)) {
  console.error(
    "[build-deploy-wizard] Payload do Host não encontrado:", payloadHostDir,
    "\nExecute `npm run prepare:wizard-payload -w agent` antes.",
  );
  process.exit(1);
}

if (!existsSync(payloadServerDir)) {
  console.error(
    "[build-deploy-wizard] Payload do Servidor não encontrado:", payloadServerDir,
    "\nExecute `npm run prepare:wizard-payload -w agent-server` antes.",
  );
  process.exit(1);
}

if (!existsSync(installerScript)) {
  console.error("[build-deploy-wizard] Script do Inno não encontrado:", installerScript);
  process.exit(1);
}

mkdirSync(publishDir, { recursive: true });

const isccPath =
  process.env.ISCC_PATH ||
  "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe";

const iscc = isccPath.replace(/^"+|"+$/g, "");

console.log("[build-deploy-wizard] ISCC:", iscc);

const r = spawnSync(iscc, [installerScript], {
  cwd: join(agentRoot, "installer"),
  stdio: "inherit",
  shell: false,
  env: process.env,
});

if (r.error || r.status !== 0) {
  console.error(
    "[build-deploy-wizard] Falha ao executar ISCC (Inno Setup). Instale o Inno Setup 6 ou defina ISCC_PATH.",
  );
  if (r.error) console.error(r.error.message);
  process.exit(r.status ?? 1);
}

if (!existsSync(wizardExe)) {
  console.error("[build-deploy-wizard] Saída esperada em:", wizardExe);
  process.exit(1);
}

console.log("[build-deploy-wizard] OK (Inno Setup):", wizardExe);
