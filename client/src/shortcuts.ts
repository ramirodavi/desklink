import type { ControlMsg } from "./protocol.js";

/** Uma etapa de tecla: flags batem com o que o agente espera (modificador “puro” sem flag duplicada). */
function k(
  code: string,
  down: boolean,
  o: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {},
): ControlMsg {
  return {
    t: "key",
    code,
    down,
    ctrl: o.ctrl ?? false,
    alt: o.alt ?? false,
    shift: o.shift ?? false,
    meta: o.meta ?? false,
  };
}

/** Sequências prontas para o host (Windows) — enviadas pelo DataChannel, sem passar pelo teclado do navegador. */
export const SHORTCUT_SEQUENCES: Record<string, ControlMsg[]> = {
  ctrlC: [
    k("ControlLeft", true),
    k("KeyC", true, { ctrl: true }),
    k("KeyC", false, { ctrl: true }),
    k("ControlLeft", false),
  ],
  ctrlV: [
    k("ControlLeft", true),
    k("KeyV", true, { ctrl: true }),
    k("KeyV", false, { ctrl: true }),
    k("ControlLeft", false),
  ],
  ctrlX: [
    k("ControlLeft", true),
    k("KeyX", true, { ctrl: true }),
    k("KeyX", false, { ctrl: true }),
    k("ControlLeft", false),
  ],
  ctrlA: [
    k("ControlLeft", true),
    k("KeyA", true, { ctrl: true }),
    k("KeyA", false, { ctrl: true }),
    k("ControlLeft", false),
  ],
  ctrlZ: [
    k("ControlLeft", true),
    k("KeyZ", true, { ctrl: true }),
    k("KeyZ", false, { ctrl: true }),
    k("ControlLeft", false),
  ],
  ctrlY: [
    k("ControlLeft", true),
    k("KeyY", true, { ctrl: true }),
    k("KeyY", false, { ctrl: true }),
    k("ControlLeft", false),
  ],
  winR: [
    k("MetaLeft", true),
    k("KeyR", true, { meta: true }),
    k("KeyR", false, { meta: true }),
    k("MetaLeft", false),
  ],
  winE: [
    k("MetaLeft", true),
    k("KeyE", true, { meta: true }),
    k("KeyE", false, { meta: true }),
    k("MetaLeft", false),
  ],
  winD: [
    k("MetaLeft", true),
    k("KeyD", true, { meta: true }),
    k("KeyD", false, { meta: true }),
    k("MetaLeft", false),
  ],
  /** Bloqueia a sessão do Windows remoto */
  winL: [
    k("MetaLeft", true),
    k("KeyL", true, { meta: true }),
    k("KeyL", false, { meta: true }),
    k("MetaLeft", false),
  ],
  altTab: [
    k("AltLeft", true),
    k("Tab", true, { alt: true }),
    k("Tab", false, { alt: true }),
    k("AltLeft", false),
  ],
  altF4: [
    k("AltLeft", true),
    k("F4", true, { alt: true }),
    k("F4", false, { alt: true }),
    k("AltLeft", false),
  ],
  ctrlShiftEsc: [
    k("ControlLeft", true),
    k("ShiftLeft", true, { ctrl: true }),
    k("Escape", true, { ctrl: true, shift: true }),
    k("Escape", false, { ctrl: true, shift: true }),
    k("ShiftLeft", false, { ctrl: true }),
    k("ControlLeft", false),
  ],
  /** Pode não abrir o ecrã de segurança real — depende do Windows/nut-js */
  ctrlAltDel: [
    k("ControlLeft", true),
    k("AltLeft", true, { ctrl: true }),
    k("Delete", true, { ctrl: true, alt: true }),
    k("Delete", false, { ctrl: true, alt: true }),
    k("AltLeft", false, { ctrl: true }),
    k("ControlLeft", false),
  ],
  winShiftS: [
    k("MetaLeft", true),
    k("ShiftLeft", true, { meta: true }),
    k("KeyS", true, { meta: true, shift: true }),
    k("KeyS", false, { meta: true, shift: true }),
    k("ShiftLeft", false, { meta: true }),
    k("MetaLeft", false),
  ],
};

/** Envia sequência ordenada; pequeno atraso entre passos para o host processar. */
export async function runShortcutSequence(
  steps: ControlMsg[],
  sendJson: (json: string) => void,
  delayMs = 28,
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    sendJson(JSON.stringify(steps[i]));
    if (i < steps.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
