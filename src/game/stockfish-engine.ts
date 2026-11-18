import type { Square } from "chess.js";

export type PromotionPiece = "q" | "r" | "b" | "n";

export interface EngineMove {
  from: Square;
  to: Square;
  promotion?: PromotionPiece;
}

interface PendingSearch {
  cancelled: boolean;
  promise: Promise<EngineMove | null>;
  resolve: (move: EngineMove | null) => void;
  reject: (error: Error) => void;
}

function parseBestMove(line: string): EngineMove | null {
  const uci = line.split(/\s+/)[1];
  if (!uci || uci === "(none)" || uci === "0000" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(uci)) {
    return null;
  }

  const promotion = uci[4]?.toLowerCase() as PromotionPiece | undefined;
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    ...(promotion ? { promotion } : {}),
  };
}

/** Runs the bundled Stockfish single-threaded WASM engine in a browser worker. */
export class StockfishEngine {
  private readonly worker: Worker;
  private readonly readyPromise: Promise<void>;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readyState: "loading" | "ready" | "failed" | "disposed" = "loading";
  private pendingSearch: PendingSearch | null = null;

  constructor() {
    const workerUrl = new URL("/vendor/stockfish/stockfish-19-lite-single.js", window.location.origin);
    this.worker = new Worker(workerUrl, { name: "Stockfish 19" });
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleError);
    this.worker.postMessage("uci");
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  async newGame(): Promise<void> {
    await this.readyPromise;
    await this.cancelSearch();
    this.worker.postMessage("ucinewgame");
  }

  async search(fen: string, depth: number): Promise<EngineMove | null> {
    await this.readyPromise;
    if (this.readyState !== "ready") throw new Error("Stockfish is not available.");
    if (this.pendingSearch) throw new Error("Stockfish is already calculating a move.");

    let resolveSearch!: (move: EngineMove | null) => void;
    let rejectSearch!: (error: Error) => void;
    const promise = new Promise<EngineMove | null>((resolve, reject) => {
      resolveSearch = resolve;
      rejectSearch = reject;
    });
    this.pendingSearch = {
      cancelled: false,
      promise,
      resolve: resolveSearch,
      reject: rejectSearch,
    };

    try {
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${Math.max(1, Math.floor(depth))}`);
    } catch (error) {
      this.pendingSearch = null;
      rejectSearch(error instanceof Error ? error : new Error("Could not start the Stockfish search."));
    }

    return promise;
  }

  async cancelSearch(): Promise<void> {
    const pending = this.pendingSearch;
    if (!pending) return;
    pending.cancelled = true;
    this.worker.postMessage("stop");
    await pending.promise;
  }

  dispose(): void {
    if (this.readyState === "disposed") return;
    const wasLoading = this.readyState === "loading";
    this.readyState = "disposed";
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleError);
    this.worker.terminate();

    const error = new Error("The Stockfish worker was stopped.");
    if (wasLoading) this.readyReject?.(error);
    this.pendingSearch?.reject(error);
    this.pendingSearch = null;
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    if (typeof event.data !== "string") return;
    const line = event.data.trim();

    if (line === "uciok") {
      this.worker.postMessage("setoption name Threads value 1");
      this.worker.postMessage("setoption name Hash value 32");
      this.worker.postMessage("isready");
      return;
    }

    if (line === "readyok") {
      if (this.readyState !== "loading") return;
      this.readyState = "ready";
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
      return;
    }

    if (!line.startsWith("bestmove ")) return;
    const pending = this.pendingSearch;
    if (!pending) return;
    this.pendingSearch = null;
    pending.resolve(pending.cancelled ? null : parseBestMove(line));
  };

  private readonly handleError = (event: ErrorEvent): void => {
    const error = new Error(event.message || "The bundled Stockfish engine could not be loaded.");
    const wasLoading = this.readyState === "loading";
    this.readyState = "failed";
    if (wasLoading) this.readyReject?.(error);
    this.readyResolve = null;
    this.readyReject = null;
    this.pendingSearch?.reject(error);
    this.pendingSearch = null;
  };
}
