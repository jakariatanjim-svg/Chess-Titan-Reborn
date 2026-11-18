import { Chess, type Square } from "chess.js";
import { ChessBoard3D, type BoardTheme, type RenderPiece } from "./chess-board-3d";

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

export function mountChessGame(container: HTMLElement, initialTheme: BoardTheme, keepFreeView: boolean): () => void {
  const chess = new Chess();
  let selectedSquare: Square | null = null;
  let pendingPromotion: { from: Square; to: Square } | null = null;

  container.innerHTML = `
    <section class="game-screen" aria-labelledby="game-heading">
      <header class="game-header">
        <div>
          <p class="eyebrow">Chess Titan Reborn</p>
          <h1 id="game-heading">Local game</h1>
        </div>
        <div class="game-actions">
          <button class="secondary-action" type="button" data-back-to-menu>Main menu</button>
          <button class="secondary-action" type="button" data-open-settings>Settings</button>
          <button class="secondary-action" type="button" data-undo>Undo move</button>
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
          <p class="local-game-note">Pass-and-play on this device. The view turns toward the next player after each move. Computer play will be added separately.</p>
        </aside>
      </div>
      <footer class="site-credit">© 2026 jakariatanjim-svg</footer>
    </section>
  `;

  const gameScreen = container.querySelector<HTMLElement>(".game-screen");
  const boardElement = container.querySelector<HTMLElement>("[data-chessboard]");
  const boardControls = container.querySelector<HTMLElement>("[data-board-controls]");
  const turnStatus = container.querySelector<HTMLElement>("[data-turn-status]");
  const interactionHint = container.querySelector<HTMLElement>("[data-interaction-hint]");
  const moveList = container.querySelector<HTMLOListElement>("[data-move-list]");
  const moveCount = container.querySelector<HTMLElement>("[data-move-count]");
  const undoButton = container.querySelector<HTMLButtonElement>("[data-undo]");
  const promotionCard = container.querySelector<HTMLElement>("[data-promotion-card]");
  const promotionOptions = container.querySelector<HTMLElement>("[data-promotion-options]");

  if (
    !gameScreen ||
    !boardElement ||
    !boardControls ||
    !turnStatus ||
    !interactionHint ||
    !moveList ||
    !moveCount ||
    !undoButton ||
    !promotionCard ||
    !promotionOptions
  ) {
    throw new Error("The chess game interface could not be initialized.");
  }

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

  const boardView = new ChessBoard3D(boardElement, handleSquareClick, initialTheme, keepFreeView);

  const colorName = (color: "w" | "b"): string => (color === "w" ? "White" : "Black");

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

  function renderAccessibleBoard(): void {
    for (const [square, button] of squareButtons) {
      const piece = chess.get(square);
      const label = piece
        ? `${square}, ${colorName(piece.color)} ${pieceNames[piece.type]}`
        : `${square}, empty`;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(selectedSquare === square));
      button.textContent = piece ? `${pieceGlyphs[`${piece.color}${piece.type}`]} ${square}` : square;
      button.disabled = chess.isGameOver() || pendingPromotion !== null;
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
    turnStatus.textContent = describeGameState();
    undoButton.disabled = chess.history().length === 0;
    const moveHint = pendingPromotion
      ? "Choose the piece for your pawn promotion."
      : selectedSquare
        ? `Selected ${selectedSquare}. Choose a highlighted square or another piece.`
        : "Select one of your pieces, then choose a highlighted square.";
    interactionHint.textContent = `${moveHint} Right-drag rotates the view; mouse-wheel zoom is disabled.`;

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

  function commitMove(from: Square, to: Square, promotion?: PromotionPiece): void {
    chess.move({ from, to, ...(promotion ? { promotion } : {}) });
    selectedSquare = null;
    pendingPromotion = null;
    boardView.rotateForNextPlayer();
    render(true);
  }

  function handleSquareClick(square: Square): void {
    if (chess.isGameOver() || pendingPromotion) return;

    if (selectedSquare) {
      const move = chess
        .moves({ square: selectedSquare, verbose: true })
        .find((candidate) => candidate.to === square);
      if (move) {
        if (move.promotion) {
          pendingPromotion = { from: selectedSquare, to: square };
          render();
        } else {
          commitMove(selectedSquare, square);
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
      chess.reset();
      selectedSquare = null;
      pendingPromotion = null;
      boardView.resetPlayerView();
      render(true);
      return;
    }

    if (target.closest("[data-undo]")) {
      const undoneMove = chess.undo();
      selectedSquare = null;
      pendingPromotion = null;
      if (undoneMove) boardView.rotateForNextPlayer();
      render(true);
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
      commitMove(pendingPromotion.from, pendingPromotion.to, promotion);
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

  return () => {
    window.removeEventListener("chess-board-theme-change", handleThemeChange);
    window.removeEventListener("chess-free-view-setting-change", handleFreeViewSettingChange);
    boardView.dispose();
    container.replaceChildren();
  };
}
