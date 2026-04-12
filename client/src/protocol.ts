/** Mensagens DataChannel host ↔ controlador (JSON) */
export type ControlMsg =
  | { t: "move"; x: number; y: number }
  | { t: "btn"; b: number; down: boolean }
  /** Duplo clique (evita depender só do intervalo entre dois cliques pela rede) */
  | { t: "dblclick"; b: number }
  | { t: "wheel"; dx: number; dy: number }
  | {
      t: "key";
      code: string;
      down: boolean;
      ctrl: boolean;
      alt: boolean;
      shift: boolean;
      meta: boolean;
    }
  /** Sincronização de clipboard (texto); só o controlador envia `sync`. */
  | { t: "clip"; d: "sync"; enabled: boolean }
  | { t: "clip"; d: "set"; text: string }
  | { t: "clip"; d: "push"; text: string };
