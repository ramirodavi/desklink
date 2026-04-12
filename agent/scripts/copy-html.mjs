import { copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const rendererSrc = join(root, "src/renderer");
const rendererDist = join(root, "dist/renderer");
await copyFile(join(rendererSrc, "index.html"), join(rendererDist, "index.html"));
await copyFile(join(rendererSrc, "styles.css"), join(rendererDist, "styles.css"));
