/** Paleta de comandos do controlador (Shift+F12): busca e executa ações locais e atalhos no host. */

export type PaletteCommand = {
  id: string;
  group: string;
  /** Função para rótulos que dependem do estado (ex.: "Ativar"/"Desativar"). */
  title: string | (() => string);
  /** Termos extras de busca (sinônimos, nomes em inglês). */
  keywords?: string;
  /** Atalho exibido à direita (apenas informativo). */
  hint?: string;
  run: () => void;
};

export type CommandPalette = {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
};

type Match = { cmd: PaletteCommand; title: string; score: number };

/** Minúsculas e sem acentos, para "monitor" achar "Mônitor" e "area" achar "área". */
function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function resolveTitle(cmd: PaletteCommand): string {
  return typeof cmd.title === "function" ? cmd.title() : cmd.title;
}

/** Todos os termos precisam aparecer; título que começa com o termo vem primeiro. */
function filterCommands(commands: PaletteCommand[], query: string): Match[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const out: Match[] = [];
  for (const cmd of commands) {
    const title = resolveTitle(cmd);
    const normTitle = normalize(title);
    const haystack = `${normTitle} ${normalize(cmd.group)} ${normalize(cmd.keywords ?? "")} ${normalize(cmd.hint ?? "")}`;
    if (!terms.every((t) => haystack.includes(t))) continue;
    let score = 0;
    for (const t of terms) {
      if (normTitle.startsWith(t)) score += 3;
      else if (normTitle.includes(` ${t}`)) score += 2;
      else if (normTitle.includes(t)) score += 1;
    }
    out.push({ cmd, title, score });
  }
  // sort é estável: empates mantêm a ordem de registro (agrupada).
  if (terms.length) out.sort((a, b) => b.score - a.score);
  return out;
}

export function createCommandPalette(
  getCommands: () => PaletteCommand[],
  hooks: { onOpen?: () => void } = {},
): CommandPalette {
  const backdrop = document.createElement("div");
  backdrop.className = "command-palette hidden";
  backdrop.innerHTML = `
    <div class="command-palette-dialog" role="dialog" aria-modal="true" aria-label="Paleta de comandos">
      <input type="text" class="command-palette-input" role="combobox" aria-expanded="true"
        aria-controls="commandPaletteList" aria-autocomplete="list" autocomplete="off" spellcheck="false"
        placeholder="Digite um comando… (Esc para fechar)" />
      <ul class="command-palette-list" id="commandPaletteList" role="listbox"></ul>
      <div class="command-palette-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
        <span><kbd>Enter</kbd> executar</span>
        <span><kbd>Esc</kbd> fechar</span>
      </div>
    </div>
  `;
  const input = backdrop.querySelector(".command-palette-input") as HTMLInputElement;
  const list = backdrop.querySelector(".command-palette-list") as HTMLUListElement;

  let matches: Match[] = [];
  let active = 0;
  let restoreFocus: HTMLElement | null = null;

  function render() {
    matches = filterCommands(getCommands(), input.value);
    list.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement("li");
      empty.className = "command-palette-empty";
      empty.textContent = "Nenhum comando encontrado.";
      list.append(empty);
      input.removeAttribute("aria-activedescendant");
      return;
    }
    const grouped = !input.value.trim();
    let lastGroup = "";
    matches.forEach((m, idx) => {
      if (grouped && m.cmd.group !== lastGroup) {
        lastGroup = m.cmd.group;
        const head = document.createElement("li");
        head.className = "command-palette-group";
        head.setAttribute("role", "presentation");
        head.textContent = m.cmd.group;
        list.append(head);
      }
      const li = document.createElement("li");
      li.id = `command-palette-opt-${m.cmd.id}`;
      li.className = "command-palette-item";
      li.setAttribute("role", "option");
      const label = document.createElement("span");
      label.className = "command-palette-item-title";
      label.textContent = m.title;
      li.append(label);
      if (!grouped) {
        const g = document.createElement("span");
        g.className = "command-palette-item-group";
        g.textContent = m.cmd.group;
        li.append(g);
      }
      if (m.cmd.hint) {
        const k = document.createElement("kbd");
        k.textContent = m.cmd.hint;
        li.append(k);
      }
      li.addEventListener("pointermove", () => {
        if (active === idx) return;
        active = idx;
        syncActiveClass();
      });
      li.addEventListener("click", () => execute(idx));
      list.append(li);
    });
    // Cabeçalhos de grupo também são filhos de `list`; `active` indexa só as opções.
    active = 0;
    syncActiveClass();
  }

  function options(): HTMLElement[] {
    return [...list.querySelectorAll<HTMLElement>(".command-palette-item")];
  }

  function syncActiveClass() {
    options().forEach((li, idx) => {
      const on = idx === active;
      li.classList.toggle("is-active", on);
      li.setAttribute("aria-selected", on ? "true" : "false");
      if (on) {
        input.setAttribute("aria-activedescendant", li.id);
        li.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function move(delta: number) {
    if (!matches.length) return;
    active = (active + delta + matches.length) % matches.length;
    syncActiveClass();
  }

  function execute(idx: number) {
    const m = matches[idx];
    if (!m) return;
    close();
    m.cmd.run();
  }

  input.addEventListener("input", render);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      move(1);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      move(-1);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      execute(active);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  });
  backdrop.addEventListener("pointerdown", (ev) => {
    if (ev.target === backdrop) {
      ev.preventDefault();
      close();
    }
  });
  // Só o elemento em tela cheia (e seus filhos) fica visível: a paleta fecha ao mudar o modo.
  document.addEventListener("fullscreenchange", () => close());

  function isOpen() {
    return !backdrop.classList.contains("hidden");
  }

  function open() {
    if (isOpen()) return;
    hooks.onOpen?.();
    restoreFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (document.fullscreenElement ?? document.body).append(backdrop);
    backdrop.classList.remove("hidden");
    input.value = "";
    render();
    input.focus();
  }

  function close() {
    if (!isOpen()) return;
    backdrop.classList.add("hidden");
    const target = restoreFocus;
    restoreFocus = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }

  return {
    open,
    close,
    toggle: () => (isOpen() ? close() : open()),
    isOpen,
  };
}
