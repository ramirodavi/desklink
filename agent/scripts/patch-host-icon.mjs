import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rceditModule = require("rcedit");
const rcedit = rceditModule.rcedit ?? rceditModule.default ?? rceditModule;

const agentRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hostExe = join(agentRoot, "release", "win-unpacked", "DeskLinkHost.exe");
const iconIco = join(agentRoot, "build", "icon.ico");

if (!existsSync(hostExe)) {
  console.error("[patch-host-icon] Executável não encontrado:", hostExe);
  process.exit(1);
}

if (!existsSync(iconIco)) {
  console.error("[patch-host-icon] Ícone .ico não encontrado:", iconIco);
  process.exit(1);
}

await rcedit(hostExe, { icon: iconIco });
console.log("[patch-host-icon] OK:", hostExe);
