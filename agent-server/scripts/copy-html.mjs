import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const rendererSrc = join(root, "src", "renderer");
const rendererDist = join(root, "dist", "renderer");
const serverIconPng = join(root, "build", "icon.png");

await mkdir(rendererDist, { recursive: true });

await copyFile(join(rendererSrc, "index.html"), join(rendererDist, "index.html"));
await copyFile(join(rendererSrc, "styles.css"), join(rendererDist, "styles.css"));

if (existsSync(serverIconPng)) {
  await copyFile(serverIconPng, join(rendererDist, "icon.png"));
}

console.log("[copy-html] OK:", rendererDist);
