import "./styles.css";

type BoardTheme = "titan" | "classic" | "glass" | "marble";

function requireElement<T extends Element>(element: T | null, description: string): T {
  if (!element) throw new Error(`The ${description} is missing.`);
  return element;
}

function isBoardTheme(theme: string | null): theme is BoardTheme {
  return theme === "titan" || theme === "classic" || theme === "glass" || theme === "marble";
}

const app = requireElement(document.querySelector<HTMLElement>("#app"), "application root");

app.innerHTML = `
  <main class="app-shell">
    <section class="welcome-panel" data-welcome aria-labelledby="app-title">
      <div class="menu-copy">
        <p class="eyebrow">Chess Titan Reborn · Early beta</p>
        <h1 id="app-title">A timeless game, remade for the web.</h1>
        <p class="intro">Take a seat at the table. Play pass-and-play or challenge the bundled Stockfish engine, right in your browser.</p>
      </div>
      <nav class="main-menu" aria-label="Main menu">
        <button class="primary-action menu-action" type="button" data-open-local>Play local game</button>
        <button class="secondary-action menu-action" type="button" data-open-computer>Play vs computer</button>
        <button class="secondary-action menu-action" type="button" data-open-settings>Settings</button>
        <button class="secondary-action menu-action" type="button" data-open-credits>Credits</button>
      </nav>
      <p class="menu-note">Early beta — still in development. Board and controls are ready to try; feedback helps shape what comes next.</p>
      <p class="loading-status" data-loading-status aria-live="polite"></p>
      <footer class="site-credit">© 2026 jakariatanjim-svg</footer>
    </section>
    <section class="game-viewport" data-game-viewport aria-label="Chess game" hidden></section>
    <dialog class="app-dialog" data-settings-dialog aria-labelledby="settings-title">
      <div class="dialog-content">
        <p class="eyebrow">Preferences</p>
        <h2 id="settings-title">Settings</h2>
        <label class="setting-control" for="board-theme">
          Board finish
          <select id="board-theme" data-board-theme>
            <option value="titan">Titan Signature · Default</option>
            <option value="classic">Classic Matte</option>
            <option value="glass">Reborn Glass</option>
            <option value="marble">Royal Marble</option>
          </select>
        </label>
        <label class="setting-control" for="player-color">
          Your side (computer games)
          <select id="player-color" data-player-color>
            <option value="w">White</option>
            <option value="b">Black</option>
          </select>
        </label>
        <label class="setting-control" for="engine-depth">
          Computer strength
          <select id="engine-depth" data-engine-depth>
            <option value="5">Casual</option>
            <option value="9">Club</option>
            <option value="13">Strong</option>
          </select>
        </label>
        <label class="toggle-control">
          <input type="checkbox" data-keep-free-view />
          <span>Keep the adjusted view after dragging</span>
        </label>
        <p class="dialog-note">Board, view, and computer preferences are saved on this device. Side and strength apply to new computer games launched from the menu.</p>
        <p class="dialog-note">Right-drag rotates the board; with view retention off, it returns to the current player's angle. Mouse-wheel zoom is disabled.</p>
        <button class="primary-action" type="button" data-close-settings>Done</button>
      </div>
    </dialog>
    <dialog class="app-dialog" data-credits-dialog aria-labelledby="credits-title">
      <div class="dialog-content">
        <p class="eyebrow">The people and tools behind the board</p>
        <h2 id="credits-title">Credits</h2>
        <p class="credit-line"><strong>Chess Titan Reborn</strong><br>© 2026 jakariatanjim-svg</p>
        <p class="credit-line"><strong>Chess rules</strong><br>chess.js</p>
        <p class="credit-line"><strong>3D graphics</strong><br>Three.js</p>
        <p class="credit-line"><strong>Computer engine</strong><br>Bundled Stockfish 19 Lite runs locally in your browser; it does not use a game server.</p>
        <button class="primary-action" type="button" data-close-credits>Close</button>
      </div>
    </dialog>
  </main>
`;

const welcome = requireElement(app.querySelector<HTMLElement>("[data-welcome]"), "welcome panel");
const localGameButton = requireElement(app.querySelector<HTMLButtonElement>("[data-open-local]"), "local game button");
const computerGameButton = requireElement(app.querySelector<HTMLButtonElement>("[data-open-computer]"), "computer game button");
const status = requireElement(app.querySelector<HTMLElement>("[data-loading-status]"), "loading status");
const viewport = requireElement(app.querySelector<HTMLElement>("[data-game-viewport]"), "game viewport");
const settingsDialog = requireElement(app.querySelector<HTMLDialogElement>("[data-settings-dialog]"), "settings dialog");
const creditsDialog = requireElement(app.querySelector<HTMLDialogElement>("[data-credits-dialog]"), "credits dialog");
const themeSelect = requireElement(app.querySelector<HTMLSelectElement>("[data-board-theme]"), "board theme selector");
const playerColorSelect = requireElement(app.querySelector<HTMLSelectElement>("[data-player-color]"), "player color selector");
const engineDepthSelect = requireElement(app.querySelector<HTMLSelectElement>("[data-engine-depth]"), "engine strength selector");
const keepFreeViewInput = requireElement(app.querySelector<HTMLInputElement>("[data-keep-free-view]"), "free-view setting");

type GameMode = "local" | "computer";
type PlayerColor = "w" | "b";

let currentTheme: BoardTheme = "titan";
let keepFreeView = false;
let playerColor: PlayerColor = "w";
let engineDepth = 9;
let disposeGame: (() => void) | null = null;

try {
  const savedTheme = localStorage.getItem("chess-titan-board-theme");
  const savedColor = localStorage.getItem("chess-titan-player-color");
  const savedDepth = localStorage.getItem("chess-titan-engine-depth");
  currentTheme = savedTheme === "glass" || savedTheme === "marble" ? savedTheme : "titan";
  keepFreeView = localStorage.getItem("chess-titan-keep-free-view") === "true";
  playerColor = savedColor === "b" ? "b" : "w";
  engineDepth = [5, 9, 13].includes(Number(savedDepth)) ? Number(savedDepth) : 9;
} catch {
  currentTheme = "titan";
  keepFreeView = false;
  playerColor = "w";
  engineDepth = 9;
}
themeSelect.value = currentTheme;
playerColorSelect.value = playerColor;
engineDepthSelect.value = String(engineDepth);
keepFreeViewInput.checked = keepFreeView;

const saveTheme = (theme: BoardTheme): void => {
  currentTheme = theme;
  try {
    localStorage.setItem("chess-titan-board-theme", theme);
  } catch {
    // Keep the selected finish for the current session if storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<BoardTheme>("chess-board-theme-change", { detail: theme }));
};

themeSelect.addEventListener("change", () => {
  saveTheme(isBoardTheme(themeSelect.value) ? themeSelect.value : "titan");
});

playerColorSelect.addEventListener("change", () => {
  playerColor = playerColorSelect.value === "b" ? "b" : "w";
  try {
    localStorage.setItem("chess-titan-player-color", playerColor);
  } catch {
    // Keep the preference for the current session if storage is unavailable.
  }
});

engineDepthSelect.addEventListener("change", () => {
  const selectedDepth = Number(engineDepthSelect.value);
  engineDepth = [5, 9, 13].includes(selectedDepth) ? selectedDepth : 9;
  try {
    localStorage.setItem("chess-titan-engine-depth", String(engineDepth));
  } catch {
    // Keep the preference for the current session if storage is unavailable.
  }
});

keepFreeViewInput.addEventListener("change", () => {
  keepFreeView = keepFreeViewInput.checked;
  try {
    localStorage.setItem("chess-titan-keep-free-view", String(keepFreeView));
  } catch {
    // Keep the preference for the current session if storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<boolean>("chess-free-view-setting-change", { detail: keepFreeView }));
});

async function launchGame(mode: GameMode): Promise<void> {
  localGameButton.disabled = true;
  computerGameButton.disabled = true;
  status.textContent = mode === "computer" ? "Loading Stockfish…" : "Setting the table…";

  try {
    const { mountChessGame } = await import("./game/chess-game");
    disposeGame = mountChessGame(viewport, {
      initialTheme: currentTheme,
      keepFreeView,
      mode,
      playerColor,
      engineDepth,
    });
    welcome.hidden = true;
    viewport.hidden = false;
    status.textContent = "";
    app.classList.add("is-playing");
  } catch {
    status.textContent = "The game could not be opened. Please check WebGL support and try again.";
    localGameButton.disabled = false;
    computerGameButton.disabled = false;
  }
}

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  if (target.closest("[data-open-local]")) {
    void launchGame("local");
  } else if (target.closest("[data-open-computer]")) {
    void launchGame("computer");
  } else if (target.closest("[data-open-settings]")) {
    if (!settingsDialog.open) settingsDialog.showModal();
  } else if (target.closest("[data-open-credits]")) {
    if (!creditsDialog.open) creditsDialog.showModal();
  } else if (target.closest("[data-close-settings]")) {
    settingsDialog.close();
  } else if (target.closest("[data-close-credits]")) {
    creditsDialog.close();
  } else if (target.closest("[data-back-to-menu]")) {
    disposeGame?.();
    disposeGame = null;
    viewport.hidden = true;
    welcome.hidden = false;
    localGameButton.disabled = false;
    computerGameButton.disabled = false;
    status.textContent = "";
    app.classList.remove("is-playing");
  }
});
