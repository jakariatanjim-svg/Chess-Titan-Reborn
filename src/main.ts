import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("The application root is missing.");
}

app.innerHTML = `
  <main class="app-shell">
    <section class="welcome-panel" data-welcome aria-labelledby="app-title">
      <p class="eyebrow">Chess Titan Reborn</p>
      <h1 id="app-title">A new board is waiting.</h1>
      <p class="intro">Play a complete game of chess with familiar rules and a fresh tabletop feel.</p>
      <button class="primary-action" type="button" data-open-game>Open board</button>
      <p class="loading-status" data-loading-status aria-live="polite"></p>
    </section>
    <section class="game-viewport" data-game-viewport aria-label="Chess game" hidden></section>
  </main>
`;

const welcome = app.querySelector<HTMLElement>("[data-welcome]");
const openButton = app.querySelector<HTMLButtonElement>("[data-open-game]");
const status = app.querySelector<HTMLElement>("[data-loading-status]");
const viewport = app.querySelector<HTMLElement>("[data-game-viewport]");

if (!welcome || !openButton || !status || !viewport) {
  throw new Error("The game shell could not be initialized.");
}

openButton.addEventListener("click", async () => {
  openButton.disabled = true;
  status.textContent = "Opening the chessboard…";

  try {
    const { mountChessGame } = await import("./game/chess-game");
    mountChessGame(viewport);
    welcome.hidden = true;
    viewport.hidden = false;
    status.textContent = "";
    app.classList.add("is-playing");
  } catch {
    status.textContent = "The chessboard could not be opened. Please try again.";
    openButton.disabled = false;
  }
});
