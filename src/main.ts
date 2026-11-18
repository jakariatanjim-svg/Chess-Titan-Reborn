import "./styles.css";

type BoardTheme = "classic" | "glass";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("The application root is missing.");
}

app.innerHTML = `
  <main class="app-shell">
    <section class="welcome-panel" data-welcome aria-labelledby="app-title">
      <div class="menu-copy">
        <p class="eyebrow">Chess Titan Reborn</p>
        <h1 id="app-title">A timeless game, remade for the web.</h1>
        <p class="intro">Take a seat at the table. Play a local game now; computer play is coming soon.</p>
      </div>
      <nav class="main-menu" aria-label="Main menu">
        <button class="primary-action menu-action" type="button" data-open-game>Play local game</button>
        <button class="secondary-action menu-action" type="button" data-open-settings>Settings</button>
        <button class="secondary-action menu-action" type="button" data-open-credits>Credits</button>
      </nav>
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
            <option value="classic">Classic Matte</option>
            <option value="glass">Reborn Glass</option>
          </select>
        </label>
        <p class="dialog-note">Your board finish is saved on this device.</p>
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
        <p class="credit-line"><strong>Computer engine</strong><br>Stockfish 19 Lite files are included; computer play is not connected yet.</p>
        <button class="primary-action" type="button" data-close-credits>Close</button>
      </div>
    </dialog>
  </main>
`;

const welcome = app.querySelector<HTMLElement>("[data-welcome]");
const openButton = app.querySelector<HTMLButtonElement>("[data-open-game]");
const status = app.querySelector<HTMLElement>("[data-loading-status]");
const viewport = app.querySelector<HTMLElement>("[data-game-viewport]");
const settingsDialog = app.querySelector<HTMLDialogElement>("[data-settings-dialog]");
const creditsDialog = app.querySelector<HTMLDialogElement>("[data-credits-dialog]");
const themeSelect = app.querySelector<HTMLSelectElement>("[data-board-theme]");

if (!welcome || !openButton || !status || !viewport || !settingsDialog || !creditsDialog || !themeSelect) {
  throw new Error("The game shell could not be initialized.");
}

let currentTheme: BoardTheme = "classic";
let disposeGame: (() => void) | null = null;

try {
  currentTheme = localStorage.getItem("chess-titan-board-theme") === "glass" ? "glass" : "classic";
} catch {
  currentTheme = "classic";
}
themeSelect.value = currentTheme;

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
  saveTheme(themeSelect.value === "glass" ? "glass" : "classic");
});

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  if (target.closest("[data-open-settings]")) {
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
    openButton.disabled = false;
    status.textContent = "";
    app.classList.remove("is-playing");
  }
});

openButton.addEventListener("click", async () => {
  openButton.disabled = true;
  status.textContent = "Setting the table…";

  try {
    const { mountChessGame } = await import("./game/chess-game");
    disposeGame = mountChessGame(viewport, currentTheme);
    welcome.hidden = true;
    viewport.hidden = false;
    status.textContent = "";
    app.classList.add("is-playing");
  } catch {
    status.textContent = "The 3D board could not be opened. Please try again.";
    openButton.disabled = false;
  }
});
