export type ControlMsg =
  | { t: "move"; x: number; y: number }
  | { t: "btn"; b: number; down: boolean }
  | { t: "dblclick"; b: number }
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
  | { t: "clip"; d: "sync"; enabled: boolean }
  | { t: "clip"; d: "set"; text: string }
  | { t: "clip"; d: "push"; text: string }
  | {
      t: "chat";
      id: string;
      at: number;
      from: "host" | "controller";
      text: string;
    }
  | { t: "streamProfile"; profile: "economy" | "balanced" | "high" }
  | {
      t: "streamProfileAck";
      profile: "economy" | "balanced" | "high";
      applied: boolean;
    }
  | { t: "annotate"; d: "segment"; points: { x: number; y: number }[] }
  | { t: "annotate"; d: "clear" }
  | { t: "inputReset"; sessionEpoch: number };
