import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Square } from "chess.js";

export type BoardTheme = "titan" | "classic" | "glass" | "marble";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export type PieceColor = "w" | "b";

export interface RenderPiece {
  square: Square;
  type: PieceType;
  color: PieceColor;
}

export interface CapturedPiece {
  type: PieceType;
  color: PieceColor;
}

export interface HighlightedMove {
  square: Square;
  capture: boolean;
}

interface Palette {
  light: string;
  dark: string;
  frame: string;
  trim: string;
  label: string;
  tileRoughness: number;
  tileMetalness: number;
  pieceRoughness: number;
  pieceMetalness: number;
  clearcoat: number;
  tilePattern: "solid" | "marble";
}

const files = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

function squareCoordinates(square: Square): { x: number; z: number } {
  const fileIndex = square.charCodeAt(0) - "a".charCodeAt(0);
  const rank = Number(square[1]);
  return { x: fileIndex - 3.5, z: 3.5 - (rank - 1) };
}

export class ChessBoard3D {
  private readonly container: HTMLElement;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly horizontalFrameWidth = 12.2;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  // Center the camera directly on the active player's file axis; only the elevation is angled.
  private readonly initialCameraPosition = new THREE.Vector3(0, 11.65, 9.75);
  private readonly defaultCameraPosition = new THREE.Vector3();
  private readonly boardRoot = new THREE.Group();
  private readonly signatureDetailRoot = new THREE.Group();
  private readonly coordinateRoot = new THREE.Group();
  private readonly pieceRoot = new THREE.Group();
  private readonly capturedPieceRoot = new THREE.Group();
  private readonly highlightRoot = new THREE.Group();
  private readonly tileMeshes = new Map<Square, { mesh: THREE.Mesh; isDark: boolean }>();
  private readonly onSquareClick: (square: Square) => void;
  private activeTheme: BoardTheme;
  private lightTileMaterial: THREE.MeshPhysicalMaterial;
  private darkTileMaterial: THREE.MeshPhysicalMaterial;
  private readonly frameMaterial: THREE.MeshPhysicalMaterial;
  private readonly trimMaterial: THREE.MeshPhysicalMaterial;
  private innerFrameMaterial!: THREE.MeshPhysicalMaterial;
  private groundMaterial!: THREE.MeshStandardMaterial;
  private environmentTexture: THREE.CanvasTexture | null = null;
  private readonly coordinateMaterials: THREE.SpriteMaterial[] = [];
  private pieces: RenderPiece[] = [];
  private capturedPieces: CapturedPiece[] = [];
  private selectedSquare: Square | null = null;
  private highlightedMoves: HighlightedMove[] = [];
  private lastMove: { from: Square; to: Square } | null = null;
  private checkedKingSquare: Square | null = null;
  private pointerStart: THREE.Vector2 | null = null;
  private freeViewPointerStart: THREE.Vector2 | null = null;
  private keepFreeView: boolean;
  private freeViewActive = false;
  private cameraAnimating = false;
  private animationFrame = 0;
  private cameraAnimationFrame = 0;
  private disposed = false;

  constructor(
    container: HTMLElement,
    onSquareClick: (square: Square) => void,
    theme: BoardTheme,
    keepFreeView: boolean,
  ) {
    this.container = container;
    this.onSquareClick = onSquareClick;
    this.activeTheme = theme;
    this.keepFreeView = keepFreeView;
    const palette = this.getPalette();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute("aria-hidden", "true");

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(theme === "titan" ? "#173238" : "#11171d");
    this.environmentTexture = this.createStudioEnvironment();
    this.scene.environment = this.environmentTexture;
    this.scene.environmentIntensity = theme === "titan" ? 1.15 : 0.85;

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    this.camera.position.copy(this.initialCameraPosition);
    this.camera.lookAt(0, 0.1, 0);

    const hemisphere = new THREE.HemisphereLight("#e8f2f4", "#15191a", 1.85);
    this.scene.add(hemisphere);

    const keyLight = new THREE.DirectionalLight("#fff0d4", 3.7);
    keyLight.position.set(4.5, 10, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1536, 1536);
    keyLight.shadow.camera.left = -7;
    keyLight.shadow.camera.right = 7;
    keyLight.shadow.camera.top = 7;
    keyLight.shadow.camera.bottom = -7;
    keyLight.shadow.bias = -0.00035;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight("#9dc6d2", 1.35);
    fillLight.position.set(-6, 5, -4);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight("#e8f2f0", 1.05);
    rimLight.position.set(0, 7, -8);
    this.scene.add(rimLight);

    this.lightTileMaterial = this.createTileMaterial(palette.light, palette, false);
    this.darkTileMaterial = this.createTileMaterial(palette.dark, palette, true);
    this.frameMaterial = new THREE.MeshPhysicalMaterial({
      color: palette.frame,
      metalness: 0.45,
      roughness: palette.tileRoughness,
      clearcoat: palette.clearcoat * 0.55,
    });
    this.trimMaterial = new THREE.MeshPhysicalMaterial({
      color: palette.trim,
      metalness: 0.75,
      roughness: Math.max(0.16, palette.tileRoughness * 0.55),
      clearcoat: palette.clearcoat,
    });

    this.buildBoard();
    this.scene.add(this.pieceRoot, this.capturedPieceRoot, this.highlightRoot);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.05, 0);
    this.defaultCameraPosition.copy(this.initialCameraPosition);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.controls.minDistance = 8.5;
    this.controls.maxDistance = 15.5;
    this.controls.minPolarAngle = 0.38;
    this.controls.maxPolarAngle = 1.42;
    this.controls.rotateSpeed = 0.62;

    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.handlePointerUp);
    this.renderer.domElement.addEventListener("pointercancel", this.handlePointerCancel);
    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.addEventListener("contextmenu", this.handleContextMenu);
    this.container.replaceChildren(this.renderer.domElement);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.animate();
  }

  setPosition(pieces: RenderPiece[]): void {
    this.pieces = pieces.map((piece) => ({ ...piece }));
    this.clearGroup(this.pieceRoot);

    for (const piece of this.pieces) {
      const model = this.createPiece(piece);
      const position = squareCoordinates(piece.square);
      model.position.set(position.x, 0.235, position.z);
      this.pieceRoot.add(model);
    }
  }

  setCapturedPieces(pieces: CapturedPiece[]): void {
    this.capturedPieces = pieces.map((piece) => ({ ...piece }));
    this.clearGroup(this.capturedPieceRoot);

    const piecesByColor: Record<PieceColor, CapturedPiece[]> = { w: [], b: [] };
    for (const piece of this.capturedPieces) piecesByColor[piece.color].push(piece);

    for (const color of ["w", "b"] as const) {
      const side = color === "w" ? 1 : -1;
      for (const [index, piece] of piecesByColor[color].entries()) {
        const column = Math.floor(index / 8);
        const row = index % 8;
        const model = this.createPiece(piece);
        model.scale.setScalar(0.48);
        model.position.set(side * (4.64 + column * 0.52), 0.256, 3.5 - row);
        this.capturedPieceRoot.add(model);
      }
    }

    this.renderFrame();
  }

  setKeepFreeView(keep: boolean): void {
    this.keepFreeView = keep;
    if (!keep && this.freeViewActive) this.resetView();
  }

  rotateForNextPlayer(): void {
    const target = this.controls.target.clone();
    const halfTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    const defaultOffset = this.defaultCameraPosition.clone().sub(target).applyQuaternion(halfTurn);
    this.defaultCameraPosition.copy(target).add(defaultOffset);

    const destination = this.defaultCameraPosition.clone();
    if (this.keepFreeView && this.freeViewActive) {
      const freeViewOffset = this.camera.position.clone().sub(target).applyQuaternion(halfTurn);
      destination.copy(target).add(freeViewOffset);
    } else {
      this.freeViewActive = false;
    }
    this.animateCameraTo(destination);
  }

  resetPlayerView(): void {
    this.freeViewActive = false;
    this.defaultCameraPosition.copy(this.initialCameraPosition);
    this.animateCameraTo(this.defaultCameraPosition);
  }

  resetView(): void {
    this.freeViewActive = false;
    this.animateCameraTo(this.defaultCameraPosition);
  }

  setHighlights(
    selectedSquare: Square | null,
    moves: HighlightedMove[],
    lastMove: { from: Square; to: Square } | null,
    checkedKingSquare: Square | null,
  ): void {
    this.selectedSquare = selectedSquare;
    this.highlightedMoves = moves.map((move) => ({ ...move }));
    this.lastMove = lastMove ? { ...lastMove } : null;
    this.checkedKingSquare = checkedKingSquare;
    this.clearGroup(this.highlightRoot);

    const accent = this.activeTheme === "glass" ? "#f2d78e" : this.activeTheme === "marble" ? "#ead08f" : "#d7aa55";

    if (this.lastMove) {
      const moveBlue = "#268cff";
      this.addSquareTint(this.lastMove.from, moveBlue, 0.37);
      this.addSquareTint(this.lastMove.to, moveBlue, 0.37);
      this.addSquareOutline(this.lastMove.from, "#5aa8ff", 0.032);
      this.addSquareOutline(this.lastMove.to, "#5aa8ff", 0.032);
    }

    if (checkedKingSquare) {
      this.addSquareTint(checkedKingSquare, "#ed273b", 0.56);
      this.addSquareOutline(checkedKingSquare, "#ff4053", 0.055);
    }

    if (selectedSquare) {
      this.addSquareTint(selectedSquare, accent, 0.3);
      this.addSquareOutline(selectedSquare, accent, 0.032);
    }

    for (const move of this.highlightedMoves) {
      const position = squareCoordinates(move.square);
      const material = new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        toneMapped: false,
      });
      const marker = move.capture
        ? new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.035, 8, 32), material)
        : new THREE.Mesh(new THREE.CircleGeometry(0.13, 24), material);
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(position.x, 0.28, position.z);
      marker.renderOrder = 3;
      this.highlightRoot.add(marker);
    }

    this.renderFrame();
  }

  setTheme(theme: BoardTheme): void {
    if (theme === this.activeTheme) return;

    const previousLight = this.lightTileMaterial;
    const previousDark = this.darkTileMaterial;
    this.activeTheme = theme;
    this.signatureDetailRoot.visible = theme === "titan";
    this.coordinateRoot.visible = theme !== "titan";
    this.scene.background = new THREE.Color(theme === "titan" ? "#173238" : "#11171d");
    this.scene.environmentIntensity = theme === "titan" ? 1.15 : 0.85;
    this.groundMaterial.color.set(theme === "titan" ? "#10292d" : "#10161c");
    const palette = this.getPalette();
    this.lightTileMaterial = this.createTileMaterial(palette.light, palette, false);
    this.darkTileMaterial = this.createTileMaterial(palette.dark, palette, true);

    for (const { mesh, isDark } of this.tileMeshes.values()) {
      mesh.material = isDark ? this.darkTileMaterial : this.lightTileMaterial;
    }

    this.frameMaterial.color.set(palette.frame);
    this.frameMaterial.roughness = palette.tileRoughness;
    this.frameMaterial.clearcoat = palette.clearcoat * 0.55;
    this.innerFrameMaterial.color.set(palette.frame);
    this.innerFrameMaterial.roughness = palette.tileRoughness;
    this.innerFrameMaterial.metalness = palette.tileMetalness;
    this.trimMaterial.color.set(palette.trim);
    this.trimMaterial.metalness = this.activeTheme === "marble" ? 0.7 : 0.75;
    this.trimMaterial.roughness = Math.max(0.16, palette.tileRoughness * 0.55);
    this.trimMaterial.clearcoat = palette.clearcoat;
    this.coordinateMaterials.forEach((material) => material.color.set(palette.label));
    previousLight.map?.dispose();
    previousDark.map?.dispose();
    previousLight.dispose();
    previousDark.dispose();

    this.setPosition(this.pieces);
    this.setCapturedPieces(this.capturedPieces);
    this.setHighlights(this.selectedSquare, this.highlightedMoves, this.lastMove, this.checkedKingSquare);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    if (this.cameraAnimationFrame) cancelAnimationFrame(this.cameraAnimationFrame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.renderer.domElement.removeEventListener("pointercancel", this.handlePointerCancel);
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.removeEventListener("contextmenu", this.handleContextMenu);

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
        if ("geometry" in object && object.geometry instanceof THREE.BufferGeometry) {
          geometries.add(object.geometry);
        }
        if ("material" in object) {
          const material = object.material;
          if (Array.isArray(material)) material.forEach((entry) => materials.add(entry));
          else if (material instanceof THREE.Material) materials.add(material);
        }
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => {
      if ("map" in material && material.map instanceof THREE.Texture) material.map.dispose();
      material.dispose();
    });
    this.environmentTexture?.dispose();
    this.renderer.dispose();
    this.container.replaceChildren();
  }

  private createStudioEnvironment(): THREE.CanvasTexture | null {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) return null;

    const backdrop = context.createLinearGradient(0, 0, 0, canvas.height);
    backdrop.addColorStop(0, "#091317");
    backdrop.addColorStop(0.23, "#20383d");
    backdrop.addColorStop(0.5, "#899393");
    backdrop.addColorStop(0.73, "#34484a");
    backdrop.addColorStop(1, "#0b1518");
    context.fillStyle = backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const softboxes = [
      { x: 88, y: 64, width: 116, height: 316, alpha: 0.76 },
      { x: 382, y: 92, width: 72, height: 244, alpha: 0.5 },
      { x: 732, y: 58, width: 144, height: 330, alpha: 0.68 },
    ];
    for (const panel of softboxes) {
      const light = context.createLinearGradient(panel.x, 0, panel.x + panel.width, 0);
      light.addColorStop(0, "rgba(255, 244, 218, 0)");
      light.addColorStop(0.25, `rgba(255, 244, 218, ${panel.alpha * 0.32})`);
      light.addColorStop(0.75, `rgba(255, 244, 218, ${panel.alpha})`);
      light.addColorStop(1, "rgba(255, 244, 218, 0)");
      context.fillStyle = light;
      context.fillRect(panel.x, panel.y, panel.width, panel.height);
    }

    const horizon = context.createLinearGradient(0, 240, 0, 286);
    horizon.addColorStop(0, "rgba(255, 248, 228, 0)");
    horizon.addColorStop(0.5, "rgba(255, 248, 228, 0.22)");
    horizon.addColorStop(1, "rgba(255, 248, 228, 0)");
    context.fillStyle = horizon;
    context.fillRect(0, 240, canvas.width, 46);

    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  private getPalette(): Palette {
    if (this.activeTheme === "titan") {
      return {
        light: "#d6c9ad",
        dark: "#202b2a",
        frame: "#141c1c",
        trim: "#c7a45c",
        label: "#e4d5b6",
        tileRoughness: 0.3,
        tileMetalness: 0.12,
        pieceRoughness: 0.2,
        pieceMetalness: 0.18,
        clearcoat: 0.92,
        tilePattern: "marble",
      };
    }

    if (this.activeTheme === "marble") {
      return {
        light: "#e6dccb",
        dark: "#28443d",
        frame: "#142923",
        trim: "#c6a86b",
        label: "#e7d6ad",
        tileRoughness: 0.36,
        tileMetalness: 0.04,
        pieceRoughness: 0.27,
        pieceMetalness: 0.2,
        clearcoat: 0.48,
        tilePattern: "marble",
      };
    }

    if (this.activeTheme === "glass") {
      return {
        light: "#b8d1d0",
        dark: "#29454d",
        frame: "#17252b",
        trim: "#b2c6c1",
        label: "#d4e0d8",
        tileRoughness: 0.2,
        tileMetalness: 0.38,
        pieceRoughness: 0.2,
        pieceMetalness: 0.52,
        clearcoat: 0.92,
        tilePattern: "solid",
      };
    }

    return {
      light: "#d7c49d",
      dark: "#664a31",
      frame: "#34271d",
      trim: "#9b794e",
      label: "#dfcfad",
      tileRoughness: 0.65,
      tileMetalness: 0.14,
      pieceRoughness: 0.39,
      pieceMetalness: 0.28,
      clearcoat: 0.28,
      tilePattern: "solid",
    };
  }

  private createTileMaterial(color: string, palette: Palette, isDark: boolean): THREE.MeshPhysicalMaterial {
    const map = palette.tilePattern === "marble" ? this.createMarbleTexture(color, isDark) : null;
    return new THREE.MeshPhysicalMaterial({
      color: map ? "#ffffff" : color,
      map,
      roughness: palette.tileRoughness,
      metalness: palette.tileMetalness,
      clearcoat: palette.clearcoat,
      clearcoatRoughness: Math.max(0.08, palette.tileRoughness * 0.7),
    });
  }

  private createMarbleTexture(baseColor: string, isDark: boolean): THREE.CanvasTexture | null {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.fillStyle = baseColor;
    context.fillRect(0, 0, size, size);
    const wash = context.createLinearGradient(0, 0, size, size);
    wash.addColorStop(0, isDark ? "rgba(190, 218, 201, 0.11)" : "rgba(255, 252, 241, 0.42)");
    wash.addColorStop(0.48, isDark ? "rgba(12, 29, 26, 0.1)" : "rgba(119, 94, 71, 0.07)");
    wash.addColorStop(1, isDark ? "rgba(5, 17, 16, 0.22)" : "rgba(255, 255, 255, 0.12)");
    context.fillStyle = wash;
    context.fillRect(0, 0, size, size);

    let seed = isDark ? 7283 : 1949;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    for (let index = 0; index < 9; index += 1) {
      const startX = random() * size;
      const drift = (random() - 0.5) * size * 0.72;
      const middleX = startX + drift;
      const endX = startX + drift * 0.55 + (random() - 0.5) * 100;
      const width = 3 + random() * 7;
      context.beginPath();
      context.moveTo(startX, -40);
      context.bezierCurveTo(
        startX - drift * 0.18,
        size * 0.28,
        middleX + drift * 0.22,
        size * 0.67,
        endX,
        size + 40,
      );
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = width;
      context.strokeStyle = isDark ? "rgba(8, 24, 21, 0.38)" : "rgba(100, 78, 63, 0.2)";
      context.stroke();
      context.lineWidth = Math.max(1, width * 0.24);
      context.strokeStyle = isDark ? "rgba(173, 205, 181, 0.34)" : "rgba(255, 250, 237, 0.78)";
      context.stroke();

      if (index % 2 === 0) {
        const branchY = size * (0.22 + random() * 0.58);
        const branchX = startX + drift * (branchY / size);
        context.beginPath();
        context.moveTo(branchX, branchY);
        context.quadraticCurveTo(branchX + (random() - 0.5) * 110, branchY + 30, branchX + (random() - 0.5) * 190, branchY + 105);
        context.lineWidth = 1.4;
        context.strokeStyle = isDark ? "rgba(145, 184, 158, 0.23)" : "rgba(118, 94, 77, 0.14)";
        context.stroke();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
    return texture;
  }

  private buildBoard(): void {
    this.groundMaterial = new THREE.MeshStandardMaterial({
      color: this.activeTheme === "titan" ? "#10292d" : "#10161c",
      roughness: 0.92,
      metalness: 0.04,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), this.groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.47;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(8.62, 0.42, 8.62), this.frameMaterial);
    pedestal.position.y = -0.2;
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    this.boardRoot.add(pedestal);

    const trim = new THREE.Mesh(new THREE.BoxGeometry(8.42, 0.12, 8.42), this.trimMaterial);
    trim.position.y = 0.035;
    trim.castShadow = true;
    trim.receiveShadow = true;
    this.boardRoot.add(trim);

    this.innerFrameMaterial = new THREE.MeshPhysicalMaterial({
      color: this.getPalette().frame,
      metalness: 0.32,
      roughness: 0.52,
    });
    const innerFrame = new THREE.Mesh(new THREE.BoxGeometry(8.12, 0.13, 8.12), this.innerFrameMaterial);
    innerFrame.position.y = 0.13;
    innerFrame.receiveShadow = true;
    this.boardRoot.add(innerFrame);

    for (let rank = 8; rank >= 1; rank -= 1) {
      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const square = `${files[fileIndex]}${rank}` as Square;
        const isDark = (rank + fileIndex) % 2 === 1;
        const tile = new THREE.Mesh(
          new THREE.BoxGeometry(0.995, 0.12, 0.995),
          isDark ? this.darkTileMaterial : this.lightTileMaterial,
        );
        const position = squareCoordinates(square);
        tile.position.set(position.x, 0.205, position.z);
        tile.castShadow = true;
        tile.receiveShadow = true;
        tile.userData.square = square;
        tile.userData.isDark = isDark;
        this.tileMeshes.set(square, { mesh: tile, isDark });
        this.boardRoot.add(tile);
      }
    }

    this.addCaptureTrays();
    this.addSignatureDetails();
    this.addCoordinateLabels();
    this.signatureDetailRoot.visible = this.activeTheme === "titan";
    this.coordinateRoot.visible = this.activeTheme !== "titan";
    this.boardRoot.add(this.signatureDetailRoot, this.coordinateRoot);
    this.scene.add(this.boardRoot);
  }

  private addSignatureDetails(): void {
    const border = 4.12;
    const railY = 0.108;
    const rails: Array<{ geometry: THREE.BoxGeometry; position: [number, number, number] }> = [
      { geometry: new THREE.BoxGeometry(8.24, 0.022, 0.026), position: [0, railY, -border] },
      { geometry: new THREE.BoxGeometry(8.24, 0.022, 0.026), position: [0, railY, border] },
      { geometry: new THREE.BoxGeometry(0.026, 0.022, 8.24), position: [-border, railY, 0] },
      { geometry: new THREE.BoxGeometry(0.026, 0.022, 8.24), position: [border, railY, 0] },
    ];

    for (const rail of rails) {
      const mesh = new THREE.Mesh(rail.geometry, this.trimMaterial);
      mesh.position.set(...rail.position);
      mesh.castShadow = true;
      this.signatureDetailRoot.add(mesh);
    }

    for (const x of [-border, border]) {
      for (const z of [-border, border]) {
        const corner = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.028, 0.22), this.trimMaterial);
        corner.position.set(x, railY + 0.006, z);
        corner.rotation.y = Math.PI / 4;
        corner.castShadow = true;
        this.signatureDetailRoot.add(corner);

        const inset = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), this.frameMaterial);
        inset.scale.set(1, 0.32, 1);
        inset.position.set(x, railY + 0.027, z);
        this.signatureDetailRoot.add(inset);
      }
    }
  }

  private addCaptureTrays(): void {
    for (const side of [-1, 1]) {
      const centerX = side * 4.94;
      const tray = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.68, 8.62), this.frameMaterial);
      tray.position.set(centerX, -0.075, 0);
      tray.castShadow = true;
      tray.receiveShadow = true;
      this.boardRoot.add(tray);

      const surface = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.012, 8.42), this.innerFrameMaterial);
      surface.position.set(centerX, 0.261, 0);
      surface.receiveShadow = true;
      this.boardRoot.add(surface);
    }
  }

  private addCoordinateLabels(): void {
    const palette = this.getPalette();
    const labels = [
      ...files.map((file, index) => ({ text: file.toUpperCase(), x: index - 3.5, z: 4.13 })),
      ...files.map((file, index) => ({ text: file.toUpperCase(), x: index - 3.5, z: -4.13 })),
      ...Array.from({ length: 8 }, (_, index) => ({ text: String(index + 1), x: -4.13, z: 3.5 - index })),
      ...Array.from({ length: 8 }, (_, index) => ({ text: String(index + 1), x: 4.13, z: 3.5 - index })),
    ];

    for (const label of labels) {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const context = canvas.getContext("2d");
      if (!context) continue;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#ffffff";
      context.font = "700 54px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label.text, 64, 67);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({ map: texture, color: palette.label, transparent: true, depthWrite: false });
      this.coordinateMaterials.push(material);
      const sprite = new THREE.Sprite(material);
      sprite.position.set(label.x, 0.11, label.z);
      sprite.scale.set(0.25, 0.25, 1);
      this.coordinateRoot.add(sprite);
    }
  }

  private createPiece(piece: Pick<RenderPiece, "type" | "color">): THREE.Group {
    const palette = this.getPalette();
    const group = new THREE.Group();
    const isSignature = this.activeTheme === "titan";
    const bodyColor = piece.color === "w"
      ? (isSignature ? "#f2e9d7" : this.activeTheme === "glass" ? "#edf5f0" : this.activeTheme === "marble" ? "#fffaf0" : "#f5ecdc")
      : (isSignature ? "#202427" : this.activeTheme === "glass" ? "#15232b" : this.activeTheme === "marble" ? "#17342d" : "#242321");
    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      color: bodyColor,
      metalness: isSignature && piece.color === "b" ? 0.72 : palette.pieceMetalness,
      roughness: isSignature && piece.color === "b" ? 0.18 : palette.pieceRoughness,
      clearcoat: isSignature ? 1 : palette.clearcoat,
      clearcoatRoughness: isSignature ? 0.12 : Math.max(0.08, palette.pieceRoughness * 0.65),
    });
    const accentMaterial = new THREE.MeshPhysicalMaterial({
      color: isSignature ? "#d8b765" : this.activeTheme === "glass" ? "#d7bf82" : this.activeTheme === "marble" ? "#ead08f" : "#c9a76d",
      metalness: isSignature ? 0.88 : 0.78,
      roughness: isSignature ? 0.17 : this.activeTheme === "glass" ? 0.18 : this.activeTheme === "marble" ? 0.2 : 0.36,
      clearcoat: isSignature ? 0.95 : 0.72,
    });

    const addLathe = (profile: Array<[number, number]>, material = bodyMaterial): void => {
      const points = profile.map(([radius, height]) => new THREE.Vector2(radius, height));
      this.addPieceMesh(group, new THREE.LatheGeometry(points, 48), material);
    };
    const addCylinder = (
      radiusTop: number,
      radiusBottom: number,
      height: number,
      y: number,
      material = bodyMaterial,
    ): void => {
      this.addPieceMesh(group, new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 48), material, [0, y, 0]);
    };
    const addAccentRing = (radius: number, height: number, tube = 0.012): void => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 12, 48), accentMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = height;
      ring.castShadow = true;
      group.add(ring);
    };
    const base: Array<[number, number]> = isSignature
      ? [
          [0, 0.015], [0.18, 0.015], [0.245, 0.03], [0.278, 0.058],
          [0.263, 0.085], [0.238, 0.105], [0.272, 0.132], [0.25, 0.157],
          [0.205, 0.18], [0.16, 0.207], [0.14, 0.235], [0, 0.235],
        ]
      : [
          [0, 0.015], [0.18, 0.015], [0.25, 0.055], [0.27, 0.095],
          [0.2, 0.135], [0.14, 0.17], [0.12, 0.205], [0, 0.205],
        ];

    addLathe(base);
    if (isSignature) {
      addAccentRing(0.263, 0.061, 0.013);
      addAccentRing(0.257, 0.132, 0.012);
      addAccentRing(0.2, 0.18, 0.009);
    }

    switch (piece.type) {
      case "p": {
        addLathe([[0, 0.18], [0.12, 0.2], [0.1, 0.3], [0.085, 0.43], [0.12, 0.49], [0.15, 0.52], [0, 0.52]]);
        if (isSignature) {
          addAccentRing(0.104, 0.32, 0.01);
          addAccentRing(0.13, 0.49, 0.011);
        }
        this.addPieceMesh(group, new THREE.SphereGeometry(0.145, 32, 20), bodyMaterial, [0, 0.61, 0]);
        break;
      }
      case "r": {
        addCylinder(0.14, 0.17, 0.38, 0.39);
        addCylinder(0.24, 0.22, 0.14, 0.65);
        for (let index = 0; index < 4; index += 1) {
          const angle = (index * Math.PI) / 2 + Math.PI / 4;
          this.addPieceMesh(
            group,
            new THREE.BoxGeometry(0.105, 0.14, 0.105),
            bodyMaterial,
            [Math.cos(angle) * 0.155, 0.78, Math.sin(angle) * 0.155],
          );
        }
        if (isSignature) {
          addAccentRing(0.2, 0.58, 0.012);
          addAccentRing(0.235, 0.72, 0.012);
        }
        break;
      }
      case "n": {
        addCylinder(0.13, 0.17, 0.22, 0.31);
        const shape = new THREE.Shape();
        shape.moveTo(-0.2, 0.02);
        shape.lineTo(-0.24, 0.18);
        shape.quadraticCurveTo(-0.14, 0.42, 0.035, 0.56);
        shape.lineTo(0.105, 0.72);
        shape.lineTo(0.2, 0.57);
        shape.quadraticCurveTo(0.37, 0.53, 0.42, 0.4);
        shape.lineTo(0.56, 0.31);
        shape.lineTo(0.35, 0.27);
        shape.quadraticCurveTo(0.29, 0.07, 0.13, 0.035);
        shape.closePath();
        const horseGeometry = new THREE.ExtrudeGeometry(shape, {
          depth: 0.16,
          bevelEnabled: true,
          bevelSegments: 4,
          steps: 1,
          bevelSize: 0.028,
          bevelThickness: 0.025,
        });
        horseGeometry.translate(-0.16, 0.22, -0.08);
        this.addPieceMesh(group, horseGeometry, bodyMaterial);
        this.addPieceMesh(group, new THREE.SphereGeometry(0.027, 16, 12), accentMaterial, [0.18, 0.61, 0.1]);
        if (isSignature) addAccentRing(0.155, 0.39, 0.011);
        break;
      }
      case "b": {
        const bishopProfile: Array<[number, number]> = isSignature
          ? [[0, 0.18], [0.16, 0.22], [0.145, 0.31], [0.105, 0.42], [0.145, 0.53], [0.135, 0.64], [0.105, 0.74], [0.075, 0.82], [0.035, 0.88], [0, 0.91]]
          : [[0, 0.18], [0.16, 0.22], [0.14, 0.31], [0.1, 0.43], [0.14, 0.54], [0.115, 0.63], [0.07, 0.72], [0, 0.76]];
        addLathe(bishopProfile);
        addAccentRing(0.12, 0.39, 0.022);
        if (isSignature) addAccentRing(0.14, 0.55, 0.01);
        this.addPieceMesh(
          group,
          new THREE.SphereGeometry(isSignature ? 0.045 : 0.065, 24, 18),
          accentMaterial,
          [0, isSignature ? 0.88 : 0.72, 0],
        );
        break;
      }
      case "q": {
        addLathe([[0, 0.18], [0.17, 0.22], [0.14, 0.32], [0.11, 0.49], [0.16, 0.59], [0.19, 0.64], [0.14, 0.69], [0, 0.69]]);
        if (isSignature) {
          addAccentRing(0.155, 0.59, 0.011);
          addAccentRing(0.17, 0.655, 0.01);
        }
        for (let index = 0; index < 5; index += 1) {
          const angle = (index * Math.PI * 2) / 5;
          this.addPieceMesh(
            group,
            new THREE.SphereGeometry(0.058, 20, 16),
            accentMaterial,
            [Math.cos(angle) * 0.17, 0.75 + (index % 2) * 0.025, Math.sin(angle) * 0.17],
          );
        }
        if (isSignature) this.addPieceMesh(group, new THREE.SphereGeometry(0.046, 20, 16), accentMaterial, [0, 0.78, 0]);
        break;
      }
      case "k": {
        addLathe([[0, 0.18], [0.18, 0.22], [0.15, 0.32], [0.12, 0.49], [0.16, 0.59], [0.18, 0.66], [0.13, 0.71], [0, 0.71]]);
        if (isSignature) {
          addAccentRing(0.165, 0.62, 0.011);
          addAccentRing(0.14, 0.72, 0.01);
        }
        this.addPieceMesh(group, new THREE.BoxGeometry(0.065, 0.28, 0.07), accentMaterial, [0, 0.84, 0]);
        this.addPieceMesh(group, new THREE.BoxGeometry(0.22, 0.065, 0.07), accentMaterial, [0, 0.86, 0]);
        break;
      }
    }

    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    return group;
  }

  private addPieceMesh(
    group: THREE.Group,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: [number, number, number] = [0, 0, 0],
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  private addSquareTint(square: Square, color: string, opacity: number): void {
    const position = squareCoordinates(square);
    const tint = new THREE.Mesh(
      new THREE.PlaneGeometry(0.98, 0.98),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    tint.rotation.x = -Math.PI / 2;
    tint.position.set(position.x, 0.269, position.z);
    tint.renderOrder = 1;
    this.highlightRoot.add(tint);
  }

  private addSquareOutline(square: Square, color: string, thickness: number): void {
    const { x, z } = squareCoordinates(square);
    const material = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const halfSize = 0.49;
    const y = 0.281;
    const bars = [
      { geometry: new THREE.BoxGeometry(0.98, 0.018, thickness), position: [x, y, z - halfSize + thickness / 2] as const },
      { geometry: new THREE.BoxGeometry(0.98, 0.018, thickness), position: [x, y, z + halfSize - thickness / 2] as const },
      { geometry: new THREE.BoxGeometry(thickness, 0.018, 0.98), position: [x - halfSize + thickness / 2, y, z] as const },
      { geometry: new THREE.BoxGeometry(thickness, 0.018, 0.98), position: [x + halfSize - thickness / 2, y, z] as const },
    ];

    for (const bar of bars) {
      const mesh = new THREE.Mesh(bar.geometry, material);
      mesh.position.set(...bar.position);
      mesh.renderOrder = 2;
      this.highlightRoot.add(mesh);
    }
  }

  private clearGroup(group: THREE.Group): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        const material = object.material;
        if (Array.isArray(material)) material.forEach((entry) => materials.add(entry));
        else materials.add(material);
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    group.clear();
  }

  private getSquareAt(clientX: number, clientY: number): Square | null {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    this.pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(
      Array.from(this.tileMeshes.values(), ({ mesh }) => mesh),
      false,
    );
    return (intersections[0]?.object.userData.square as Square | undefined) ?? null;
  }

  private resize(): void {
    const bounds = this.container.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return;
    this.camera.aspect = bounds.width / bounds.height;
    const cameraDistance = this.camera.position.distanceTo(this.controls.target);
    const horizontalFitFov = THREE.MathUtils.radToDeg(
      2 * Math.atan(this.horizontalFrameWidth / (2 * cameraDistance * this.camera.aspect)),
    );
    this.camera.fov = THREE.MathUtils.clamp(horizontalFitFov, 28, 48);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(bounds.width, bounds.height, false);
    this.renderFrame();
  }

  private renderFrame(): void {
    if (this.disposed) return;
    if (!this.cameraAnimating) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private animate(): void {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(() => this.animate());
    if (!this.cameraAnimating) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private animateCameraTo(destination: THREE.Vector3): void {
    if (this.disposed) return;
    if (this.cameraAnimationFrame) cancelAnimationFrame(this.cameraAnimationFrame);
    this.cameraAnimationFrame = 0;
    this.cameraAnimating = true;
    this.controls.enabled = false;

    const target = this.controls.target.clone();
    const start = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(target));
    const end = new THREE.Spherical().setFromVector3(destination.clone().sub(target));
    const thetaDelta = THREE.MathUtils.euclideanModulo(end.theta - start.theta + Math.PI, Math.PI * 2) - Math.PI;
    const duration = 620;
    let startTime: number | null = null;

    const step = (time: number): void => {
      if (this.disposed) return;
      startTime ??= time;
      const progress = Math.min(1, (time - startTime) / duration);
      const eased = progress * progress * (3 - 2 * progress);
      const spherical = new THREE.Spherical(
        THREE.MathUtils.lerp(start.radius, end.radius, eased),
        THREE.MathUtils.lerp(start.phi, end.phi, eased),
        start.theta + thetaDelta * eased,
      );
      this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(spherical));
      this.camera.lookAt(target);

      if (progress < 1) {
        this.cameraAnimationFrame = requestAnimationFrame(step);
        return;
      }

      this.camera.position.copy(destination);
      this.camera.lookAt(target);
      this.controls.enabled = true;
      const wasDampingEnabled = this.controls.enableDamping;
      this.controls.enableDamping = false;
      this.controls.update();
      this.camera.position.copy(destination);
      this.camera.lookAt(target);
      this.controls.update();
      this.controls.enableDamping = wasDampingEnabled;
      this.cameraAnimating = false;
      this.cameraAnimationFrame = 0;
    };

    this.cameraAnimationFrame = requestAnimationFrame(step);
  }

  private finishFreeViewDrag(clientX: number, clientY: number): void {
    if (!this.freeViewPointerStart) return;
    const moved = this.freeViewPointerStart.distanceTo(new THREE.Vector2(clientX, clientY));
    this.freeViewPointerStart = null;
    if (moved <= 3) return;

    if (this.keepFreeView) {
      this.freeViewActive = true;
    } else {
      this.resetView();
    }
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.cameraAnimating) return;
    if (event.button === 2) {
      this.pointerStart = null;
      this.freeViewPointerStart = new THREE.Vector2(event.clientX, event.clientY);
      try {
        this.renderer.domElement.setPointerCapture(event.pointerId);
      } catch {
        // The browser may not support pointer capture for this pointer.
      }
      this.renderer.domElement.style.cursor = "grabbing";
      return;
    }
    if (event.button !== 0) return;
    this.pointerStart = new THREE.Vector2(event.clientX, event.clientY);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.button === 2 && this.freeViewPointerStart) {
      this.finishFreeViewDrag(event.clientX, event.clientY);
      this.renderer.domElement.style.cursor = this.getSquareAt(event.clientX, event.clientY) ? "pointer" : "grab";
      return;
    }
    if (event.button !== 0 || !this.pointerStart) return;
    const moved = this.pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY));
    this.pointerStart = null;
    if (moved > 7) return;
    const square = this.getSquareAt(event.clientX, event.clientY);
    if (square) this.onSquareClick(square);
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    this.pointerStart = null;
    this.finishFreeViewDrag(event.clientX, event.clientY);
    this.renderer.domElement.style.cursor = "grab";
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.cameraAnimating) return;
    if (this.pointerStart || this.freeViewPointerStart) {
      this.renderer.domElement.style.cursor = "grabbing";
      return;
    }
    this.renderer.domElement.style.cursor = this.getSquareAt(event.clientX, event.clientY) ? "pointer" : "grab";
  };

  private readonly handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };
}
