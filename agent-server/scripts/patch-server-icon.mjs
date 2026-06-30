import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rceditModule = require("rcedit");
const rcedit = rceditModule.rcedit ?? rceditModule.default ?? rceditModule;

const agentServerRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverExe = join(agentServerRoot, "release", "win-unpacked", "DeskLinkServer.exe");
const iconIco = join(agentServerRoot, "build", "icon.ico");

if (!existsSync(serverExe)) {
  console.error("[patch-server-icon] Executável não encontrado:", serverExe);
  process.exit(1);
}

if (!existsSync(iconIco)) {
  console.error("[patch-server-icon] Ícone .ico não encontrado:", iconIco);
  process.exit(1);
}

await rcedit(serverExe, { icon: iconIco });
console.log("[patch-server-icon] OK:", serverExe);
