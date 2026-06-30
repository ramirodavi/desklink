/**
 * Gera agent-server/build/icon.png a partir do Host com máxima nitidez.
 * Uso: node scripts/generate-icon-source.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const hostPng = path.join(root, "..", "agent", "build", "icon.png");
const dstPng = path.join(root, "build", "icon.png");

const SIZE = 552;
const SCALE = 4; // supersampling para bordas nítidas no rack
const GRAD_TOP = [109, 187, 247];
const GRAD_BOTTOM = [53, 127, 226];

function gradientColor(y) {
  const t = y / (SIZE - 1);
  return [
    Math.round(GRAD_TOP[0] + (GRAD_BOTTOM[0] - GRAD_TOP[0]) * t),
    Math.round(GRAD_TOP[1] + (GRAD_BOTTOM[1] - GRAD_TOP[1]) * t),
    Math.round(GRAD_TOP[2] + (GRAD_BOTTOM[2] - GRAD_TOP[2]) * t),
  ];
}

const { data, info } = await sharp(hostPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const pixels = Buffer.from(data);

function idx(x, y) { return (y * W + x) * 4; }
function get(x, y) {
  const i = idx(x, y);
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}
function isBlue(r, g, b) { return b > 165 && r < 145 && g < 215; }
function isWhite(r, g, b) { return r > 225 && g > 225 && b > 225; }

// Área interna do monitor (acima do pescoço/base).
const BOX = { left: 90, top: 115, right: 460, bottom: 358 };

// ── Apaga glifo: branco DENTRO da tela, preservando bisel (anel branco) ─────
// Marca todo branco na BOX; depois remove o que está conectado à borda (bisel).
const glyph = new Uint8Array(W * H);
for (let y = BOX.top; y <= BOX.bottom; y++) {
  for (let x = BOX.left; x <= BOX.right; x++) {
    const [r, g, b, a] = get(x, y);
    if (a > 50 && isWhite(r, g, b)) glyph[x + y * W] = 1;
  }
}

const bezelQ = [];
for (let x = BOX.left; x <= BOX.right; x++) {
  if (glyph[x + BOX.top * W]) { glyph[x + BOX.top * W] = 0; bezelQ.push(x + BOX.top * W); }
  if (glyph[x + BOX.bottom * W]) { glyph[x + BOX.bottom * W] = 0; bezelQ.push(x + BOX.bottom * W); }
}
for (let y = BOX.top; y <= BOX.bottom; y++) {
  if (glyph[BOX.left + y * W]) { glyph[BOX.left + y * W] = 0; bezelQ.push(BOX.left + y * W); }
  if (glyph[BOX.right + y * W]) { glyph[BOX.right + y * W] = 0; bezelQ.push(BOX.right + y * W); }
}

while (bezelQ.length > 0) {
  const pos = bezelQ.pop();
  const x = pos % W;
  const y = Math.floor(pos / W);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < BOX.left || nx > BOX.right || ny < BOX.top || ny > BOX.bottom) continue;
    const np = nx + ny * W;
    if (!glyph[np]) continue;
    glyph[np] = 0;
    bezelQ.push(np);
  }
}

for (let y = BOX.top; y <= BOX.bottom; y++) {
  const [gr, gg, gb] = gradientColor(y);
  for (let x = BOX.left; x <= BOX.right; x++) {
    if (!glyph[x + y * W]) continue;
    const i = idx(x, y);
    pixels[i] = gr;
    pixels[i + 1] = gg;
    pixels[i + 2] = gb;
    pixels[i + 3] = 255;
  }
}

// Limpa o interior da tela: preserva só o anel do bisel (~18px), resto → gradiente.
const CORE = { left: 115, top: 125, right: 435, bottom: 345 };
const BEZEL_THICK = 18;

function distToCoreEdge(x, y) {
  return Math.min(x - CORE.left, CORE.right - x, y - CORE.top, CORE.bottom - y);
}

for (let y = CORE.top; y <= CORE.bottom; y++) {
  const [gr, gg, gb] = gradientColor(y);
  for (let x = CORE.left; x <= CORE.right; x++) {
    const [r, g, b, a] = get(x, y);
    if (a < 50) continue;
    const onBezel = distToCoreEdge(x, y) < BEZEL_THICK && isWhite(r, g, b);
    if (onBezel) continue;
    const i = idx(x, y);
    pixels[i] = gr;
    pixels[i + 1] = gg;
    pixels[i + 2] = gb;
    pixels[i + 3] = 255;
  }
}

// ── Rack em supersampling 4× (bordas nítidas após downscale Lanczos) ─────────
const BAR_W = 230;
const BAR_H = 40;
const GAP = 16;
const CORNER_R = 10;
const TOTAL_H = BAR_H * 3 + GAP * 2;
const cx = Math.round((BOX.left + BOX.right) / 2);
const cy = Math.round((BOX.top + BOX.bottom) / 2) - 8;
const RACK_X = cx - Math.round(BAR_W / 2);
const RACK_Y = cy - Math.round(TOTAL_H / 2);

const SW = W * SCALE;
const SH = H * SCALE;
const rackHi = Buffer.alloc(SW * SH * 4); // RGBA transparente

function rackIdx(x, y) { return (y * SW + x) * 4; }
function paintRackWhite(x, y) {
  if (x < 0 || x >= SW || y < 0 || y >= SH) return;
  const i = rackIdx(x, y);
  rackHi[i] = 255;
  rackHi[i + 1] = 255;
  rackHi[i + 2] = 255;
  rackHi[i + 3] = 255;
}
function paintRackGrad(x, y) {
  if (x < 0 || x >= SW || y < 0 || y >= SH) return;
  const i = rackIdx(x, y);
  const sy = Math.min(SH - 1, Math.max(0, Math.round(y / SCALE)));
  const [r, g, b] = gradientColor(sy);
  rackHi[i] = r;
  rackHi[i + 1] = g;
  rackHi[i + 2] = b;
  rackHi[i + 3] = 255;
}

function paintRackRoundRect(lx, ty, w, h, r) {
  const slx = lx * SCALE;
  const sty = ty * SCALE;
  const sw = w * SCALE;
  const sh = h * SCALE;
  const sr = r * SCALE;
  for (let y = sty; y < sty + sh; y++) {
    for (let x = slx; x < slx + sw; x++) {
      const cx0 = x - slx;
      const cy0 = y - sty;
      let inside = true;
      if (cx0 < sr && cy0 < sr) inside = (cx0 - sr) ** 2 + (cy0 - sr) ** 2 <= sr * sr;
      else if (cx0 >= sw - sr && cy0 < sr) inside = (cx0 - (sw - sr - 1)) ** 2 + (cy0 - sr) ** 2 <= sr * sr;
      else if (cx0 < sr && cy0 >= sh - sr) inside = (cx0 - sr) ** 2 + (cy0 - (sh - sr - 1)) ** 2 <= sr * sr;
      else if (cx0 >= sw - sr && cy0 >= sh - sr) inside = (cx0 - (sw - sr - 1)) ** 2 + (cy0 - (sh - sr - 1)) ** 2 <= sr * sr;
      if (inside) paintRackWhite(x, y);
    }
  }
}

function paintRackCircleGrad(cx0, cy0, r) {
  const scx = cx0 * SCALE;
  const scy = cy0 * SCALE;
  const sr = r * SCALE;
  for (let dy = -sr; dy <= sr; dy++) {
    for (let dx = -sr; dx <= sr; dx++) {
      if (dx * dx + dy * dy <= sr * sr) paintRackGrad(scx + dx, scy + dy);
    }
  }
}

for (let b = 0; b < 3; b++) {
  const barY = RACK_Y + b * (BAR_H + GAP);
  paintRackRoundRect(RACK_X, barY, BAR_W, BAR_H, CORNER_R);
  const dotCY = barY + Math.round(BAR_H / 2);
  const dotStart = RACK_X + BAR_W - 22;
  for (let d = 0; d < 3; d++) paintRackCircleGrad(dotStart - d * 20, dotCY, 6);
}

const rackLayer = await sharp(rackHi, { raw: { width: SW, height: SH, channels: 4 } })
  .resize(W, H, { kernel: sharp.kernel.lanczos3 })
  .sharpen({ sigma: 0.8, m1: 0.5, m2: 0.25 })
  .png()
  .toBuffer();

const masterPng = await sharp(pixels, { raw: { width: W, height: H, channels: 4 } })
  .composite([{ input: rackLayer, blend: "over" }])
  .png()
  .toBuffer();

await fs.promises.mkdir(path.join(root, "build"), { recursive: true });
fs.writeFileSync(dstPng, masterPng);
console.log("[generate-icon-source] OK:", dstPng);
