/** Mensagens DataChannel host ↔ controlador (JSON) */
export type ControlMsg =
  | { t: "move"; x: number; y: number }
  | { t: "btn"; b: number; down: boolean }
  /** Duplo clique (evita depender só do intervalo entre dois cliques pela rede) */
  | { t: "dblclick"; b: number }
  /** Wheel em "steps" inteiros (positivo = baixo/direita). */
  | { t: "wheel"; vx: number; vy: number }
  | { t: "monitor"; d: "next" }
  | { t: "monitor"; d: "active"; idx: number; total: number; name: string }
  | {
      t: "key";
      code: string;
      key: string;
      down: boolean;
      ctrl: boolean;
      alt: boolean;
      shift: boolean;
      meta: boolean;
    }
  /** Sincronização de clipboard (texto); só o controlador envia `sync`. */
  | { t: "clip"; d: "sync"; enabled: boolean }
  | { t: "clip"; d: "set"; text: string }
  | { t: "clip"; d: "push"; text: string }
  /** Texto UTF-8 (inclui emojis); o remetente define `from` coerente com o lado local. */
  | {
      t: "chat";
      id: string;
      at: number;
      from: "host" | "controller";
      text: string;
    };
