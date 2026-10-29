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
      /**
       * Texto já resolvido no controlador (layout/acentos de quem controla), digitado via Unicode
       * no host. `""` = enviar a tecla física (`code`). Ausente em controladores antigos.
       */
      text?: string;
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
    }
  /** Controlador pede ajuste de bitrate/FPS/resolução no host. */
  | { t: "streamProfile"; profile: "economy" | "balanced" | "high" }
  /** Host confirma se aplicou os parâmetros de encoding. */
  | {
      t: "streamProfileAck";
      profile: "economy" | "balanced" | "high";
      applied: boolean;
    }
  /** Anotações desenhadas pelo controlador (coords normalizadas 0–1 no vídeo). */
  | { t: "annotate"; d: "segment"; points: { x: number; y: number }[] }
  | { t: "annotate"; d: "clear" }
  /** Host notifica novo ciclo de input remoto (soltar estado local no controlador). */
  | { t: "inputReset"; sessionEpoch: number };
