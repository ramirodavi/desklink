import { keyboard, mouse, screen } from "@nut-tree-fork/nut-js";
import { Button, Key, Point } from "@nut-tree-fork/shared";
import type { ControlMsg } from "./protocol.js";
import { codeToKey } from "./keymap.js";

let inited = false;

function ensureInit() {
  if (inited) return;
  keyboard.config.autoDelayMs = 0;
  mouse.config.autoDelayMs = 0;
  mouse.config.mouseSpeed = 20000;
  inited = true;
}

function btnToButton(b: number): Button {
  if (b === 2) return Button.RIGHT;
  if (b === 1) return Button.MIDDLE;
  return Button.LEFT;
}

function modifierKeys(msg: Extract<ControlMsg, { t: "key" }>): Key[] {
  const m: Key[] = [];
  if (msg.ctrl) m.push(Key.LeftControl);
  if (msg.alt) m.push(Key.LeftAlt);
  if (msg.shift) m.push(Key.LeftShift);
  if (msg.meta) m.push(Key.LeftWin);
  return m;
}

export async function applyControlJson(json: string): Promise<void> {
  ensureInit();
  let msg: ControlMsg;
  try {
    msg = JSON.parse(json) as ControlMsg;
  } catch {
    return;
  }

  const w = await screen.width();
  const h = await screen.height();

  switch (msg.t) {
    case "move": {
      const x = Math.min(w, Math.max(0, Math.round(msg.x * w)));
      const y = Math.min(h, Math.max(0, Math.round(msg.y * h)));
      await mouse.setPosition(new Point(x, y));
      break;
    }
    case "btn": {
      const b = btnToButton(msg.b);
      if (msg.down) await mouse.pressButton(b);
      else await mouse.releaseButton(b);
      break;
    }
    case "dblclick": {
      const b = btnToButton(msg.b);
      await mouse.doubleClick(b);
      break;
    }
    case "wheel": {
      const dx = msg.dx;
      const dy = msg.dy;
      const stepX = Math.min(50, Math.max(1, Math.ceil(Math.abs(dx) / 20)));
      const stepY = Math.min(50, Math.max(1, Math.ceil(Math.abs(dy) / 20)));
      if (dy > 0) await mouse.scrollDown(stepY);
      else if (dy < 0) await mouse.scrollUp(stepY);
      if (dx > 0) await mouse.scrollRight(stepX);
      else if (dx < 0) await mouse.scrollLeft(stepX);
      break;
    }
    case "key": {
      const k = codeToKey(msg.code);
      if (k === undefined) return;
      const mods = modifierKeys(msg);
      if (msg.down) await keyboard.pressKey(...mods, k);
      else await keyboard.releaseKey(...mods, k);
      break;
    }
    default:
      break;
  }
}
