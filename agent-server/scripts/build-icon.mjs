/**
 * Gera build/icon.ico a partir de build/icon.png (vários tamanhos, preserva alpha).
 * Edite build/icon.png manualmente e execute: npm run build-icon -w agent-server
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import toIco from "to-ico";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(__dirname, "..", "build");
const pngPath = path.join(buildDir, "icon.png");
const icoPath = path.join(buildDir, "icon.ico");

if (!fs.existsSync(pngPath)) {
  console.warn("[build-icon] build/icon.png não encontrado; pulando icon.ico.");
  process.exit(0);
}

const sizes = [256, 128, 64, 48, 32, 16];
const buffers = await Promise.all(
  sizes.map((s) =>
    sharp(pngPath)
      .resize(s, s, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer(),
  ),
);

const ico = await toIco(buffers);
fs.writeFileSync(icoPath, ico);
console.log("[build-icon] Gerado:", icoPath);
