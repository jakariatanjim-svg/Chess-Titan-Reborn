import { Chess, type Square } from "chess.js";
import { ChessBoard3D, type BoardTheme, type PieceColor, type RenderPiece } from "./chess-board-3d";
import { StockfishEngine } from "./stockfish-engine";

export type GameMode = "local" | "computer";

export interface ChessGameOptions {
  initialTheme: BoardTheme;
  keepFreeView: boolean;
  mode: GameMode;
  playerColor: PieceColor;
  engineDepth: number;
}

type PromotionPiece = "q" | "r" | "b" | "n";

const files = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const ranks = [8, 7, 6, 5, 4, 3, 2, 1] as const;
const promotionPieces: PromotionPiece[] = ["q", "r", "b", "n"];
const pieceNames: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};
const pieceGlyphs: Record<string, string> = {
  wp: "♙",
  wn: "♘",
  wb: "♗",
  wr: "♖",
  wq: "♕",
  wk: "♔",
  bp: "♟",
  bn: "♞",
  bb: "♝",
  br: "♜",
  bq: "♛",
  bk: "♚",
};

function requireElement<T extends Element>(element: T | null, description: string): T {
  if (!element) throw new Error(`The ${description} is missing.`);
  return element;
}

export function mountChessGame(container: HTMLElement, options: ChessGameOptions): () => void {
  const chess = new Chess();
  let selectedSquare: Square | null = null;
  let pendingPromotion: { from: Square; to: Square } | null = null;
  let engine: StockfishEngine | null = null;
  let engineReady = options.mode === "local";
  let engineThinking = false;
  let engineFailed = false;
  let engineMessage = "";
  let resetting = false;
  let disposed = false;

  const playerLabel = options.playerColor === "w" ? "White" : "Black";
  const computerLabel = options.playerColor === "w" ? "Black" : "White";

  container.innerHTML = `
    <section class="game-screen" aria-labelledby="game-heading">
      <header class="game-header">
        <div>
          <p class="eyebrow">Chess Titan Reborn</p>
          <h1 id="game-heading">${options.mode === "computer" ? "Play vs computer" : "Local game"}</h1>
        </div>
        <div class="game-actions">
          <button class="secondary-action" type="button" data-back-to-menu>Main menu</button>
          <button class="secondary-action" type="button" data-open-settings>Settings</button>
          <button class="secondary-action" type="button" data-undo>${options.mode === "computer" ? "Undo turn" : "Undo move"}</button>
          <button class="primary-action" type="button" data-new-game>New game</button>
        </div>
      </header>
      <div class="game-layout">
        <section class="board-column" aria-label="Chessboard">
          <div class="chessboard-3d" data-chessboard aria-label="Interactive 3D chessboard. Right-click and drag to rotate the view. Mouse-wheel zoom is disabled."></div>
          <details class="keyboard-board">
            <summary>Keyboard and screen-reader board controls</summary>
            <div class="accessible-chessboard" data-board-controls role="group" aria-label="Chessboard square controls"></div>
          </details>
          <p class="interaction-hint" data-interaction-hint aria-live="polite">Select a piece and a highlighted square to move. Right-click and drag to rotate the view.</p>
        </section>
        <aside class="game-sidebar">
          <section class="status-card" aria-labelledby="status-heading">
            <p class="eyebrow" id="status-heading">Game status</p>
            <p class="turn-status" data-turn-status aria-live="polite"></p>
            <p class="engine-status" data-engine-status aria-live="polite" hidden></p>
          </section>
          <section class="promotion-card" data-promotion-card hidden aria-labelledby="promotion-heading">
            <p class="eyebrow" id="promotion-heading">Choose promotion</p>
            <div class="promotion-options" data-promotion-options></div>
          </section>
          <section class="moves-card" aria-labelledby="moves-heading">
            <div class="moves-heading">
              <p class="eyebrow" id="moves-heading">Move history</p>
              <span data-move-count>0 moves</span>
            </div>
            <ol class="move-list" data-move-list></ol>
          </section>
          <p class="local-game-note">${options.mode === "computer"
            ? `You are ${playerLabel}; Stockfish plays ${computerLabel}. The engine runs on this device.`
            : "Pass-and-play on this device. The view turns toward the next player after each move."}</p>
        </aside>
      </div>
      <footer class="site-credit">© 2026 jakariatanjim-svg</footer>
    </section>
  `;

  const gameScreen = requireElement(container.querySelector<HTMLElement>(".game-screen"), "game screen");
  const boardElement = requireElement(container.querySelector<HTMLElement>("[data-chessboard]"), "3D board");
  const boardControls = requireElement(container.querySelector<HTMLElement>("[data-board-controls]"), "accessible board");
  const turnStatus = requireElement(container.querySelector<HTMLElement>("[data-turn-status]"), "turn status");
  const engineStatus = requireElement(container.querySelector<HTMLElement>("[data-engine-status]"), "engine status");
  const interactionHint = requireElement(container.querySelector<HTMLElement>("[data-interaction-hint]"), "interaction hint");
  const moveList = requireElement(container.querySelector<HTMLOListElement>("[data-move-list]"), "move list");
  const moveCount = requireElement(container.querySelector<HTMLElement>("[data-move-count]"), "move count");
  const undoButton = requireElement(container.querySelector<HTMLButtonElement>("[data-undo]"), "undo button");
  const newGameButton = requireElement(container.querySelector<HTMLButtonElement>("[data-new-game]"), "new game button");
  const promotionCard = requireElement(container.querySelector<HTMLElement>("[data-promotion-card]"), "promotion panel");
  const promotionOptions = requireElement(container.querySelector<HTMLElement>("[data-promotion-options]"), "promotion options");

  const squareButtons = new Map<Square, HTMLButtonElement>();
  for (const rank of ranks) {
    for (const file of files) {
      const square = `${file}${rank}` as Square;
      const button = document.createElement("button");
      button.className = "accessible-square";
      button.type = "button";
      button.dataset.square = square;
      button.textContent = square;
      squareButtons.set(square, button);
      boardControls.append(button);
    }
  }

  const boardView = new ChessBoard3D(
    boardElement,
    handleSquareClick,
    options.initialTheme,
    options.keepFreeView,
  );

  if (options.mode === "computer") {
    try {
      engine = new StockfishEngine();
    } catch {
      engineFailed = true;
      engineMessage = "The bundled Stockfish worker could not be started.";
    }
  }

  if (options.mode === "computer" && options.playerColor === "b") {
    boardView.rotateForNextPlayer();
  }

  const colorName = (color: PieceColor): string => (color === "w" ? "White" : "Black");

  function isHumanTurn(): boolean {
    return options.mode === "local" || chess.turn() === options.playerColor;
  }

  function describeGameState(): string {
    if (chess.isCheckmate()) {
      return `Checkmate — ${colorName(chess.turn() === "w" ? "b" : "w")} wins.`;
    }
    if (chess.isStalemate()) return "Draw by stalemate.";
    if (chess.isThreefoldRepetition()) return "Draw by threefold repetition.";
    if (chess.isInsufficientMaterial()) return "Draw by insufficient material.";
    if (chess.isDraw()) return "Draw.";

    const turn = `${colorName(chess.turn())} to move`;
    return chess.isCheck() ? `${turn} — check.` : `${turn}.`;
  }

  function boardPieces(): RenderPiece[] {
    const position = chess.board();
    const pieces: RenderPiece[] = [];

    for (let row = 0; row < ranks.length; row += 1) {
      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const piece = position[row][fileIndex];
        if (!piece) continue;
        pieces.push({
          square: `${files[fileIndex]}${ranks[row]}` as Square,
          type: piece.type,
          color: piece.color,
        });
      }
    }
    return pieces;
  }

  function canUndo(): boolean {
    const history = chess.history({ verbose: true });
    if (!history.length || resetting || engineThinking) return false;
    if (options.mode === "local") return true;
    if (history.length >= 2) return true;
    const lastMove = history.at(-1);
    return (engineFailed || chess.isGameOver()) && lastMove?.color === options.playerColor;
  }

  function renderAccessibleBoard(): void {
    const inputLocked = resetting || engineThinking || engineFailed || !isHumanTurn();
    for (const [square, button] of squareButtons) {
      const piece = chess.get(square);
      const label = piece
        ? `${square}, ${colorName(piece.color)} ${pieceNames[piece.type]}`
        : `${square}, empty`;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(selectedSquare === square));
      button.textContent = piece ? `${pieceGlyphs[`${piece.color}${piece.type}`]} ${square}` : square;
      button.disabled = chess.isGameOver() || pendingPromotion !== null || inputLocked;
    }
  }

  function renderMoveHistory(): void {
    const history = chess.history({ verbose: true });
    moveList.replaceChildren();
    moveCount.textContent = `${history.length} ${history.length === 1 ? "move" : "moves"}`;

    for (let index = 0; index < history.length; index += 2) {
      const row = document.createElement("li");
      row.className = "move-row";

      const number = document.createElement("span");
      number.className = "move-number";
      number.textContent = `${Math.floor(index / 2) + 1}.`;
      row.append(number);

      const whiteMove = document.createElement("span");
      whiteMove.textContent = history[index].san;
      row.append(whiteMove);

      const blackMove = history[index + 1];
      if (blackMove) {
        const blackMoveLabel = document.createElement("span");
        blackMoveLabel.textContent = blackMove.san;
        row.append(blackMoveLabel);
      }

      moveList.append(row);
    }
    moveList.scrollTop = moveList.scrollHeight;
  }

  function renderPromotionOptions(): void {
    promotionCard.hidden = pendingPromotion === null;
    promotionOptions.replaceChildren();
    if (!pendingPromotion) return;

    for (const type of promotionPieces) {
      const button = document.createElement("button");
      button.className = "promotion-piece";
      button.type = "button";
      button.dataset.promotion = type;
      button.setAttribute("aria-label", `Promote to ${pieceNames[type]}`);
      button.textContent = pieceGlyphs[`${chess.turn()}${type}`];
      promotionOptions.append(button);
    }
  }

  function render(positionChanged = false): void {
    if (disposed) return;
    turnStatus.textContent = describeGameState();
    undoButton.disabled = !canUndo();
    newGameButton.disabled = resetting;

    const moveHint = pendingPromotion
      ? "Choose the piece for your pawn promotion."
      : selectedSquare
        ? `Selected ${selectedSquare}. Choose a highlighted square or another piece.`
        : "Select one of your pieces, then choose a highlighted square.";
    interactionHint.textContent = `${moveHint} Right-drag rotates the view; mouse-wheel zoom is disabled.`;

    if (options.mode === "computer") {
      engineStatus.hidden = false;
      engineStatus.textContent = engineFailed
        ? engineMessage
        : engineThinking
          ? engineReady ? "Stockfish is calculating…" : "Loading Stockfish…"
          : engineReady ? `Stockfish 19 Lite · depth ${options.engineDepth}` : "Loading Stockfish…";
    } else {
      engineStatus.hidden = true;
      engineStatus.textContent = "";
    }

    if (positionChanged) boardView.setPosition(boardPieces());
    const legalMoves = selectedSquare
      ? chess.moves({ square: selectedSquare, verbose: true })
      : [];
    boardView.setHighlights(
      selectedSquare,
      legalMoves.map((move) => ({ square: move.to, capture: move.isCapture() })),
      chess.history({ verbose: true }).at(-1) ?? null,
    );
    renderAccessibleBoard();
    renderMoveHistory();
    renderPromotionOptions();
  }

  async function requestEngineMove(): Promise<void> {
    if (
      disposed ||
      resetting ||
      options.mode !== "computer" ||
      !engine ||
      engineFailed ||
      engineThinking ||
      chess.isGameOver() ||
      isHumanTurn()
    ) {
      return;
    }

    engineThinking = true;
    render();
    try {
      const move = await engine.search(chess.fen(), options.engineDepth);
      if (disposed) return;
      engineThinking = false;
      if (resetting) {
        render();
        return;
      }
      if (!move) {
        if (!chess.isGameOver()) {
          engineFailed = true;
          engineMessage = "Stockfish did not return a legal move. Start a new game or try local play.";
        }
        render();
        return;
      }

      chess.move(move);
      selectedSquare = null;
      pendingPromotion = null;
      render(true);
    } catch (error) {
      if (disposed) return;
      engineThinking = false;
      if (resetting) {
        render();
        return;
      }
      engineFailed = true;
      engineMessage = error instanceof Error ? error.message : "Stockfish could not calculate a move.";
      render();
    }
  }

  async function initializeEngine(): Promise<void> {
    if (options.mode !== "computer" || !engine) {
      if (options.mode === "computer") {
        engineFailed = true;
        engineMessage ||= "The bundled Stockfish worker could not be started.";
        render();
      }
      return;
    }

    try {
      await engine.ready();
      if (disposed) return;
      engineReady = true;
      render();
      if (!resetting && !isHumanTurn()) void requestEngineMove();
    } catch (error) {
      if (disposed) return;
      engineFailed = true;
      engineMessage = error instanceof Error ? error.message : "Stockfish could not be loaded.";
      render();
    }
  }

  async function resetGame(): Promise<void> {
    if (resetting || disposed) return;
    resetting = true;
    render();

    try {
      if (engine) {
        await engine.cancelSearch();
        await engine.newGame();
      }
      if (disposed) return;
      chess.reset();
      selectedSquare = null;
      pendingPromotion = null;
      engineThinking = false;
      boardView.resetPlayerView();
      if (options.mode === "computer" && options.playerColor === "b") {
        boardView.rotateForNextPlayer();
      }
    } catch (error) {
      if (!disposed) {
        engineFailed = true;
        engineMessage = error instanceof Error ? error.message : "Stockfish could not start a new game.";
      }
    } finally {
      resetting = false;
      render(true);
      if (options.mode === "computer" && !engineFailed && !isHumanTurn()) void requestEngineMove();
    }
  }

  function undoTurn(): void {
    if (!canUndo()) return;
    const history = chess.history({ verbose: true });

    if (options.mode === "local") {
      if (chess.undo()) boardView.rotateForNextPlayer();
    } else if (history.length >= 2) {
      chess.undo();
      chess.undo();
    } else {
      chess.undo();
    }

    selectedSquare = null;
    pendingPromotion = null;
    render(true);
    if (options.mode === "computer" && !engineFailed && !isHumanTurn()) void requestEngineMove();
  }

  function commitHumanMove(from: Square, to: Square, promotion?: PromotionPiece): void {
    chess.move({ from, to, ...(promotion ? { promotion } : {}) });
    selectedSquare = null;
    pendingPromotion = null;
    if (options.mode === "local") boardView.rotateForNextPlayer();
    render(true);
    if (options.mode === "computer" && !chess.isGameOver()) void requestEngineMove();
  }

  function handleSquareClick(square: Square): void {
    if (
      disposed ||
      resetting ||
      chess.isGameOver() ||
      pendingPromotion ||
      engineFailed ||
      engineThinking ||
      !isHumanTurn()
    ) {
      return;
    }

    if (selectedSquare) {
      const move = chess
        .moves({ square: selectedSquare, verbose: true })
        .find((candidate) => candidate.to === square);
      if (move) {
        if (move.promotion) {
          pendingPromotion = { from: selectedSquare, to: square };
          render();
        } else {
          commitHumanMove(selectedSquare, square);
        }
        return;
      }
    }

    const piece = chess.get(square);
    selectedSquare = piece?.color === chess.turn() ? square : null;
    render();
  }

  gameScreen.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest("[data-new-game]")) {
      void resetGame();
      return;
    }

    if (target.closest("[data-undo]")) {
      undoTurn();
      return;
    }

    const accessibleSquare = target.closest<HTMLButtonElement>("button[data-square]");
    const square = accessibleSquare?.dataset.square;
    if (square) {
      handleSquareClick(square as Square);
      return;
    }

    const promotionButton = target.closest<HTMLButtonElement>("[data-promotion]");
    const promotion = promotionButton?.dataset.promotion as PromotionPiece | undefined;
    if (pendingPromotion && promotion && promotionPieces.includes(promotion)) {
      commitHumanMove(pendingPromotion.from, pendingPromotion.to, promotion);
    }
  });

  const handleThemeChange = (event: Event): void => {
    const theme = (event as CustomEvent<BoardTheme>).detail;
    if (theme === "classic" || theme === "glass" || theme === "marble") boardView.setTheme(theme);
  };
  const handleFreeViewSettingChange = (event: Event): void => {
    boardView.setKeepFreeView((event as CustomEvent<boolean>).detail === true);
  };
  window.addEventListener("chess-board-theme-change", handleThemeChange);
  window.addEventListener("chess-free-view-setting-change", handleFreeViewSettingChange);

  render(true);
  if (options.mode === "computer") void initializeEngine();

  return () => {
    disposed = true;
    window.removeEventListener("chess-board-theme-change", handleThemeChange);
    window.removeEventListener("chess-free-view-setting-change", handleFreeViewSettingChange);
    engine?.dispose();
    boardView.dispose();
    container.replaceChildren();
  };
}
