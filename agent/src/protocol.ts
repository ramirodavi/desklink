export type ControlMsg =
  | { t: "move"; x: number; y: number }
  | { t: "btn"; b: number; down: boolean }
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
    };
