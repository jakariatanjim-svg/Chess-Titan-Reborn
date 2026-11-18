import { Chess, type Square } from "chess.js";

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

export function mountChessGame(container: HTMLElement): void {
  const chess = new Chess();
  let selectedSquare: Square | null = null;
  let pendingPromotion: { from: Square; to: Square } | null = null;

  container.innerHTML = `
    <main class="game-screen">
      <header class="game-header">
        <div>
          <p class="eyebrow">Chess Titan Reborn</p>
          <h1>Play chess</h1>
        </div>
        <div class="game-actions">
          <button class="secondary-action" type="button" data-undo>Undo move</button>
          <button class="primary-action" type="button" data-new-game>New game</button>
        </div>
      </header>
      <div class="game-layout">
        <section class="board-column" aria-label="Chessboard">
          <div class="chessboard" data-chessboard aria-label="Chessboard squares"></div>
          <p class="interaction-hint" data-interaction-hint aria-live="polite">Select a piece, then choose a highlighted square.</p>
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
          <p class="local-game-note">Pass-and-play on this device. Computer play will be added separately.</p>
        </aside>
      </div>
      <footer class="site-credit">© 2026 jakariatanjim-svg</footer>
    </main>
  `;

  const boardElement = container.querySelector<HTMLElement>("[data-chessboard]");
  const turnStatus = container.querySelector<HTMLElement>("[data-turn-status]");
  const interactionHint = container.querySelector<HTMLElement>("[data-interaction-hint]");
  const moveList = container.querySelector<HTMLOListElement>("[data-move-list]");
  const moveCount = container.querySelector<HTMLElement>("[data-move-count]");
  const undoButton = container.querySelector<HTMLButtonElement>("[data-undo]");
  const promotionCard = container.querySelector<HTMLElement>("[data-promotion-card]");
  const promotionOptions = container.querySelector<HTMLElement>("[data-promotion-options]");

  if (
    !boardElement ||
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

  const colorName = (color: "w" | "b"): string => (color === "w" ? "White" : "Black");

  const describeGameState = (): string => {
    if (chess.isCheckmate()) {
      return `Checkmate — ${colorName(chess.turn() === "w" ? "b" : "w")} wins.`;
    }
    if (chess.isStalemate()) return "Draw by stalemate.";
    if (chess.isThreefoldRepetition()) return "Draw by threefold repetition.";
    if (chess.isInsufficientMaterial()) return "Draw by insufficient material.";
    if (chess.isDraw()) return "Draw.";

    const turn = `${colorName(chess.turn())} to move`;
    return chess.isCheck() ? `${turn} — check.` : `${turn}.`;
  };

  const renderMoveHistory = (): void => {
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
  };

  const renderPromotionOptions = (): void => {
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
  };

  const renderBoard = (): void => {
    const board = chess.board();
    const lastMove = chess.history({ verbose: true }).at(-1);
    const legalMoves = selectedSquare
      ? chess.moves({ square: selectedSquare, verbose: true })
      : [];
    const legalDestinations = new Map(legalMoves.map((move) => [move.to, move] as const));

    boardElement.replaceChildren();
    boardElement.setAttribute("aria-label", `Chessboard. ${describeGameState()}`);

    ranks.forEach((rank, rowIndex) => {
      files.forEach((file, fileIndex) => {
        const square = `${file}${rank}` as Square;
        const piece = board[rowIndex][fileIndex];
        const button = document.createElement("button");
        const destinationMove = legalDestinations.get(square);
        const isDark = (rank + fileIndex) % 2 === 0;
        button.className = `square ${isDark ? "square-dark" : "square-light"}`;
        button.type = "button";
        button.dataset.square = square;
        button.setAttribute("aria-pressed", String(selectedSquare === square));
        button.setAttribute(
          "aria-label",
          `${square}, ${piece ? `${colorName(piece.color)} ${pieceNames[piece.type]}` : "empty"}${selectedSquare === square ? ", selected" : ""}`,
        );

        if (selectedSquare === square) button.classList.add("is-selected");
        if (lastMove && (lastMove.from === square || lastMove.to === square)) {
          button.classList.add("is-last-move");
        }
        if (destinationMove) {
          button.classList.add("is-legal-destination");
          if (destinationMove.isCapture()) button.classList.add("is-capture");
        }
        if (piece) {
          const glyph = document.createElement("span");
          glyph.className = `piece piece-${piece.color === "w" ? "white" : "black"}`;
          glyph.setAttribute("aria-hidden", "true");
          glyph.textContent = pieceGlyphs[`${piece.color}${piece.type}`];
          button.append(glyph);
        }

        if (fileIndex === 0 || rank === 1) {
          const coordinate = document.createElement("span");
          coordinate.className = `square-coordinate ${fileIndex === 0 ? "rank-coordinate" : "file-coordinate"}`;
          coordinate.setAttribute("aria-hidden", "true");
          coordinate.textContent = fileIndex === 0 ? String(rank) : file;
          button.append(coordinate);
        }

        boardElement.append(button);
      });
    });
  };

  const render = (): void => {
    turnStatus.textContent = describeGameState();
    undoButton.disabled = chess.history().length === 0;
    interactionHint.textContent = pendingPromotion
      ? "Choose the piece for your pawn promotion."
      : selectedSquare
        ? `Selected ${selectedSquare}. Choose a highlighted square or another piece.`
        : "Select a piece, then choose a highlighted square.";
    renderBoard();
    renderMoveHistory();
    renderPromotionOptions();
  };

  const commitMove = (from: Square, to: Square, promotion?: PromotionPiece): void => {
    chess.move({ from, to, ...(promotion ? { promotion } : {}) });
    selectedSquare = null;
    pendingPromotion = null;
    render();
  };

  boardElement.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const squareButton = target.closest<HTMLButtonElement>("button[data-square]");
    const squareValue = squareButton?.dataset.square;
    if (!squareValue) return;

    const square = squareValue as Square;
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
  });

  container.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.closest("[data-new-game]")) {
      chess.reset();
      selectedSquare = null;
      pendingPromotion = null;
      render();
      return;
    }

    if (target.closest("[data-undo]")) {
      chess.undo();
      selectedSquare = null;
      pendingPromotion = null;
      render();
      return;
    }

    const promotionButton = target.closest<HTMLButtonElement>("[data-promotion]");
    const promotion = promotionButton?.dataset.promotion as PromotionPiece | undefined;
    if (pendingPromotion && promotion && promotionPieces.includes(promotion)) {
      commitMove(pendingPromotion.from, pendingPromotion.to, promotion);
    }
  });

  render();
}
