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
    }
  | { t: "clip"; d: "sync"; enabled: boolean }
  | { t: "clip"; d: "set"; text: string }
  | { t: "clip"; d: "push"; text: string };
