import { keyboard, mouse, screen } from "@nut-tree-fork/nut-js";
import { Button, Key, Point } from "@nut-tree-fork/shared";
import { spawn } from "node:child_process";
import type { ControlMsg } from "./protocol.js";
import { codeToKey } from "./keymap.js";

let inited = false;
/** Pixels físicos do monitor compartilhado (SetCursorPos). */
let activeDisplayBounds: { x: number; y: number; width: number; height: number } | null =
  null;
const pressedButtons = new Set<Button>();
const pressedKeys = new Set<Key>();
const MAX_WHEEL_STEPS = 8;
const WHEEL_DELTA = 120;
let nativeWheelHelper: ReturnType<typeof spawn> | null = null;

const nativeWheelHelperScript = `
Add-Type -Namespace DeskLinkNative -Name User32 -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, System.UIntPtr dwExtraInfo);
"@ -ErrorAction SilentlyContinue | Out-Null
$MOUSEEVENTF_WHEEL = 0x0800
$MOUSEEVENTF_HWHEEL = 0x1000
while (($line = [Console]::In.ReadLine()) -ne $null) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $parts = $line.Split(" ")
  if ($parts.Length -lt 2) { continue }
  $v = 0
  $h = 0
  [void][int]::TryParse($parts[0], [ref]$v)
  [void][int]::TryParse($parts[1], [ref]$h)
  if ($v -ne 0) { [DeskLinkNative.User32]::mouse_event($MOUSEEVENTF_WHEEL, 0, 0, $v, [System.UIntPtr]::Zero) }
  if ($h -ne 0) { [DeskLinkNative.User32]::mouse_event($MOUSEEVENTF_HWHEEL, 0, 0, $h, [System.UIntPtr]::Zero) }
}
`;

function ensureNativeWheelHelper(): ReturnType<typeof spawn> | null {
  if (process.platform !== "win32") return null;
  if (
    nativeWheelHelper &&
    !nativeWheelHelper.killed &&
    nativeWheelHelper.stdin &&
    nativeWheelHelper.stdin.writable
  ) {
    return nativeWheelHelper;
  }
  const p = spawn(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      nativeWheelHelperScript,
    ],
    { stdio: ["pipe", "ignore", "ignore"] },
  );
  p.on("exit", () => {
    if (nativeWheelHelper === p) nativeWheelHelper = null;
  });
  nativeWheelHelper = p;
  return p;
}

function tryNativeWheel(vx: number, vy: number): boolean {
  const helper = ensureNativeWheelHelper();
  if (!helper || helper.killed || !helper.stdin || !helper.stdin.writable) return false;
  const vertical = -vy * WHEEL_DELTA;
  const horizontal = vx * WHEEL_DELTA;
  if (vertical === 0 && horizontal === 0) return true;
  helper.stdin.write(`${vertical} ${horizontal}\n`);
  return true;
}

process.once("exit", () => {
  if (nativeWheelHelper && !nativeWheelHelper.killed) {
    nativeWheelHelper.kill();
    nativeWheelHelper = null;
  }
});

function ensureInit() {
  if (inited) return;
  keyboard.config.autoDelayMs = 0;
  mouse.config.autoDelayMs = 0;
  mouse.config.mouseSpeed = 20000;
  inited = true;
}

export function setActiveDisplayBounds(
  bounds: { x: number; y: number; width: number; height: number } | null,
) {
  activeDisplayBounds = bounds;
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

function isLetterCode(code: string): boolean {
  return /^Key[A-Z]$/.test(code);
}

/** Texto a digitar via Unicode no host; `null` = pressionar a tecla física (`code`). */
function textToType(msg: Extract<ControlMsg, { t: "key" }>): string | null {
  if (typeof msg.text === "string") return msg.text || null;
  // Controladores antigos: deduz pelo caractere enviado.
  const textKey = typeof msg.key === "string" ? msg.key : "";
  if (
    textKey.length === 1 &&
    !isLetterCode(msg.code) &&
    !msg.ctrl &&
    !msg.alt &&
    !msg.meta
  ) {
    return textKey;
  }
  return null;
}

function clampWheelSteps(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const n = Math.trunc(v);
  return Math.sign(n) * Math.min(MAX_WHEEL_STEPS, Math.abs(n));
}

/** Libera botões/teclas que ficaram pressionados após queda da sessão remota. */
export async function releaseAllRemoteInput(): Promise<void> {
  ensureInit();
  const buttons = [...pressedButtons];
  const keys = [...pressedKeys];
  pressedButtons.clear();
  pressedKeys.clear();
  for (const b of buttons) {
    try {
      await mouse.releaseButton(b);
    } catch {
      /* ignore */
    }
  }
  for (const k of keys) {
    try {
      await keyboard.releaseKey(k);
    } catch {
      /* ignore */
    }
  }
}

async function applyWheel(vx: number, vy: number): Promise<void> {
  const sx = clampWheelSteps(vx);
  const sy = clampWheelSteps(vy);
  if (tryNativeWheel(sx, sy)) return;
  if (sy > 0) await mouse.scrollDown(sy);
  else if (sy < 0) await mouse.scrollUp(-sy);
  if (sx > 0) await mouse.scrollRight(sx);
  else if (sx < 0) await mouse.scrollLeft(-sx);
}

export async function applyControlJson(json: string): Promise<void> {
  ensureInit();
  let msg: ControlMsg;
  try {
    msg = JSON.parse(json) as ControlMsg;
  } catch {
    return;
  }

  const fallbackW = await screen.width();
  const fallbackH = await screen.height();
  const target = activeDisplayBounds;
  const w = target?.width ?? fallbackW;
  const h = target?.height ?? fallbackH;
  const ox = target?.x ?? 0;
  const oy = target?.y ?? 0;

  switch (msg.t) {
    case "move": {
      const x = ox + Math.min(w - 1, Math.max(0, Math.round(msg.x * w)));
      const y = oy + Math.min(h - 1, Math.max(0, Math.round(msg.y * h)));
      await mouse.setPosition(new Point(x, y));
      break;
    }
    case "btn": {
      const b = btnToButton(msg.b);
      if (msg.down) {
        pressedButtons.add(b);
        await mouse.pressButton(b);
      } else {
        pressedButtons.delete(b);
        await mouse.releaseButton(b);
      }
      break;
    }
    case "dblclick": {
      const b = btnToButton(msg.b);
      await mouse.doubleClick(b);
      break;
    }
    case "wheel": {
      await applyWheel(msg.vx, msg.vy);
      break;
    }
    case "key": {
      const text = textToType(msg);
      if (text !== null) {
        // Digita via Unicode: respeita o layout de quem controla sem trocar o idioma do host.
        if (msg.down) await keyboard.type(text);
        break;
      }
      const k = codeToKey(msg.code);
      if (k === undefined) return;
      const mods = modifierKeys(msg);
      if (msg.down) {
        for (const m of mods) pressedKeys.add(m);
        pressedKeys.add(k);
        await keyboard.pressKey(...mods, k);
      } else {
        for (const m of mods) pressedKeys.delete(m);
        pressedKeys.delete(k);
        await keyboard.releaseKey(...mods, k);
      }
      break;
    }
    case "monitor": {
      break;
    }
    case "chat": {
      break;
    }
    case "annotate":
    case "streamProfile":
    case "streamProfileAck":
    case "inputReset": {
      break;
    }
    default:
      break;
  }
}
