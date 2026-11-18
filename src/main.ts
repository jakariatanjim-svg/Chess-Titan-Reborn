import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("The application root is missing.");
}

app.innerHTML = `
  <main class="app-shell">
    <section class="welcome-panel" aria-labelledby="app-title">
      <p class="eyebrow">Chess Titans Remastered</p>
      <h1 id="app-title">A new board is waiting.</h1>
      <p class="intro">The game workspace loads only when you are ready to play.</p>
      <button class="primary-action" type="button" data-open-workspace>Open board</button>
      <p class="loading-status" data-loading-status aria-live="polite"></p>
    </section>
    <section class="game-viewport" data-game-viewport aria-label="3D game workspace"></section>
  </main>
`;

const openButton = app.querySelector<HTMLButtonElement>("[data-open-workspace]");
const status = app.querySelector<HTMLElement>("[data-loading-status]");
const viewport = app.querySelector<HTMLElement>("[data-game-viewport]");

if (!openButton || !status || !viewport) {
  throw new Error("The game shell could not be initialized.");
}

openButton.addEventListener("click", async () => {
  openButton.disabled = true;
  status.textContent = "Loading the 3D workspace…";

  try {
    const { mountGameViewport } = await import("./game/viewport");
    mountGameViewport(viewport);
    status.textContent = "";
    openButton.remove();
  } catch {
    status.textContent = "The 3D workspace could not be started in this browser.";
    openButton.disabled = false;
  }
});
