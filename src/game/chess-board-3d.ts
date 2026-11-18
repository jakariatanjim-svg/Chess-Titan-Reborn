import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Square } from "chess.js";

export type BoardTheme = "classic" | "glass";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export type PieceColor = "w" | "b";

export interface RenderPiece {
  square: Square;
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
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly boardRoot = new THREE.Group();
  private readonly pieceRoot = new THREE.Group();
  private readonly highlightRoot = new THREE.Group();
  private readonly tileMeshes = new Map<Square, { mesh: THREE.Mesh; isDark: boolean }>();
  private readonly onSquareClick: (square: Square) => void;
  private activeTheme: BoardTheme;
  private lightTileMaterial: THREE.MeshPhysicalMaterial;
  private darkTileMaterial: THREE.MeshPhysicalMaterial;
  private readonly frameMaterial: THREE.MeshPhysicalMaterial;
  private readonly trimMaterial: THREE.MeshPhysicalMaterial;
  private innerFrameMaterial!: THREE.MeshPhysicalMaterial;
  private readonly coordinateMaterials: THREE.SpriteMaterial[] = [];
  private pieces: RenderPiece[] = [];
  private selectedSquare: Square | null = null;
  private highlightedMoves: HighlightedMove[] = [];
  private lastMove: { from: Square; to: Square } | null = null;
  private pointerStart: THREE.Vector2 | null = null;
  private animationFrame = 0;
  private disposed = false;

  constructor(
    container: HTMLElement,
    onSquareClick: (square: Square) => void,
    theme: BoardTheme,
  ) {
    this.container = container;
    this.onSquareClick = onSquareClick;
    this.activeTheme = theme;
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
    this.scene.background = new THREE.Color("#11171d");

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    this.camera.position.set(7.2, 9.1, 10.4);
    this.camera.lookAt(0, 0.1, 0);

    const hemisphere = new THREE.HemisphereLight("#e6edf4", "#24201b", 1.65);
    this.scene.add(hemisphere);

    const keyLight = new THREE.DirectionalLight("#fff1d2", 3.1);
    keyLight.position.set(4.5, 9, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1536, 1536);
    keyLight.shadow.camera.left = -7;
    keyLight.shadow.camera.right = 7;
    keyLight.shadow.camera.top = 7;
    keyLight.shadow.camera.bottom = -7;
    keyLight.shadow.bias = -0.00035;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight("#94b8cf", 1.05);
    fillLight.position.set(-6, 5, -4);
    this.scene.add(fillLight);

    this.lightTileMaterial = this.createTileMaterial(palette.light, palette);
    this.darkTileMaterial = this.createTileMaterial(palette.dark, palette);
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
    this.scene.add(this.pieceRoot, this.highlightRoot);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.05, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = false;
    this.controls.minDistance = 8.5;
    this.controls.maxDistance = 15.5;
    this.controls.minPolarAngle = 0.38;
    this.controls.maxPolarAngle = 1.42;
    this.controls.rotateSpeed = 0.62;

    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.handlePointerUp);
    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
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

  setHighlights(
    selectedSquare: Square | null,
    moves: HighlightedMove[],
    lastMove: { from: Square; to: Square } | null,
  ): void {
    this.selectedSquare = selectedSquare;
    this.highlightedMoves = moves.map((move) => ({ ...move }));
    this.lastMove = lastMove ? { ...lastMove } : null;
    this.clearGroup(this.highlightRoot);

    const accent = this.activeTheme === "glass" ? "#f2d78e" : "#d7aa55";
    const lastMoveColor = this.activeTheme === "glass" ? "#89c9c6" : "#bf9653";

    if (this.lastMove) {
      this.addSquareTint(this.lastMove.from, lastMoveColor, 0.2);
      this.addSquareTint(this.lastMove.to, lastMoveColor, 0.2);
    }

    if (selectedSquare) {
      this.addSquareTint(selectedSquare, accent, 0.34);
      const selectedPosition = squareCoordinates(selectedSquare);
      const border = new THREE.Mesh(
        new THREE.BoxGeometry(0.91, 0.018, 0.91),
        new THREE.MeshBasicMaterial({ color: accent, toneMapped: false }),
      );
      border.position.set(selectedPosition.x, 0.277, selectedPosition.z);
      border.renderOrder = 2;
      this.highlightRoot.add(border);
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
    const palette = this.getPalette();
    this.lightTileMaterial = this.createTileMaterial(palette.light, palette);
    this.darkTileMaterial = this.createTileMaterial(palette.dark, palette);

    for (const { mesh, isDark } of this.tileMeshes.values()) {
      mesh.material = isDark ? this.darkTileMaterial : this.lightTileMaterial;
    }

    this.frameMaterial.color.set(palette.frame);
    this.frameMaterial.roughness = palette.tileRoughness;
    this.innerFrameMaterial.color.set(palette.frame);
    this.innerFrameMaterial.roughness = palette.tileRoughness;
    this.trimMaterial.color.set(palette.trim);
    this.trimMaterial.roughness = Math.max(0.16, palette.tileRoughness * 0.55);
    this.trimMaterial.clearcoat = palette.clearcoat;
    this.coordinateMaterials.forEach((material) => material.color.set(palette.label));
    previousLight.dispose();
    previousDark.dispose();

    this.setPosition(this.pieces);
    this.setHighlights(this.selectedSquare, this.highlightedMoves, this.lastMove);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);

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
    this.renderer.dispose();
    this.container.replaceChildren();
  }

  private getPalette(): Palette {
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
    };
  }

  private createTileMaterial(color: string, palette: Palette): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      color,
      roughness: palette.tileRoughness,
      metalness: palette.tileMetalness,
      clearcoat: palette.clearcoat,
      clearcoatRoughness: Math.max(0.08, palette.tileRoughness * 0.7),
    });
  }

  private buildBoard(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshStandardMaterial({ color: "#10161c", roughness: 0.96, metalness: 0.04 }),
    );
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

    this.addCoordinateLabels();
    this.scene.add(this.boardRoot);
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
      context.fillStyle = palette.label;
      context.font = "700 54px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label.text, 64, 67);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
      this.coordinateMaterials.push(material);
      const sprite = new THREE.Sprite(material);
      sprite.position.set(label.x, 0.11, label.z);
      sprite.scale.set(0.25, 0.25, 1);
      this.boardRoot.add(sprite);
    }
  }

  private createPiece(piece: RenderPiece): THREE.Group {
    const palette = this.getPalette();
    const group = new THREE.Group();
    const bodyColor = piece.color === "w"
      ? (this.activeTheme === "glass" ? "#edf5f0" : "#f5ecdc")
      : (this.activeTheme === "glass" ? "#15232b" : "#242321");
    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      color: bodyColor,
      metalness: palette.pieceMetalness,
      roughness: palette.pieceRoughness,
      clearcoat: palette.clearcoat,
      clearcoatRoughness: Math.max(0.08, palette.pieceRoughness * 0.65),
    });
    const accentMaterial = new THREE.MeshPhysicalMaterial({
      color: this.activeTheme === "glass" ? "#d7bf82" : "#c9a76d",
      metalness: 0.78,
      roughness: this.activeTheme === "glass" ? 0.18 : 0.36,
      clearcoat: 0.72,
    });

    const addLathe = (profile: Array<[number, number]>, material = bodyMaterial): void => {
      const points = profile.map(([radius, height]) => new THREE.Vector2(radius, height));
      this.addPieceMesh(group, new THREE.LatheGeometry(points, 32), material);
    };
    const addCylinder = (
      radiusTop: number,
      radiusBottom: number,
      height: number,
      y: number,
      material = bodyMaterial,
    ): void => {
      this.addPieceMesh(group, new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 32), material, [0, y, 0]);
    };
    const base: Array<[number, number]> = [
      [0, 0.015], [0.18, 0.015], [0.25, 0.055], [0.27, 0.095],
      [0.2, 0.135], [0.14, 0.17], [0.12, 0.205], [0, 0.205],
    ];

    addLathe(base);

    switch (piece.type) {
      case "p": {
        addLathe([[0, 0.18], [0.12, 0.2], [0.1, 0.3], [0.085, 0.43], [0.12, 0.49], [0.15, 0.52], [0, 0.52]]);
        this.addPieceMesh(group, new THREE.SphereGeometry(0.145, 24, 16), bodyMaterial, [0, 0.61, 0]);
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
          bevelSegments: 2,
          steps: 1,
          bevelSize: 0.028,
          bevelThickness: 0.025,
        });
        horseGeometry.translate(-0.16, 0.22, -0.08);
        this.addPieceMesh(group, horseGeometry, bodyMaterial);
        this.addPieceMesh(group, new THREE.SphereGeometry(0.027, 12, 8), accentMaterial, [0.18, 0.61, 0.1]);
        break;
      }
      case "b": {
        addLathe([[0, 0.18], [0.16, 0.22], [0.14, 0.31], [0.1, 0.43], [0.14, 0.54], [0.115, 0.63], [0.07, 0.72], [0, 0.76]]);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.022, 8, 28), accentMaterial);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.39;
        ring.castShadow = true;
        group.add(ring);
        this.addPieceMesh(group, new THREE.SphereGeometry(0.065, 18, 12), accentMaterial, [0, 0.72, 0]);
        break;
      }
      case "q": {
        addLathe([[0, 0.18], [0.17, 0.22], [0.14, 0.32], [0.11, 0.49], [0.16, 0.59], [0.19, 0.64], [0.14, 0.69], [0, 0.69]]);
        for (let index = 0; index < 5; index += 1) {
          const angle = (index * Math.PI * 2) / 5;
          this.addPieceMesh(
            group,
            new THREE.SphereGeometry(0.058, 14, 10),
            accentMaterial,
            [Math.cos(angle) * 0.17, 0.75 + (index % 2) * 0.025, Math.sin(angle) * 0.17],
          );
        }
        break;
      }
      case "k": {
        addLathe([[0, 0.18], [0.18, 0.22], [0.15, 0.32], [0.12, 0.49], [0.16, 0.59], [0.18, 0.66], [0.13, 0.71], [0, 0.71]]);
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
    tint.position.set(position.x, 0.268, position.z);
    tint.renderOrder = 1;
    this.highlightRoot.add(tint);
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
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(bounds.width, bounds.height, false);
    this.renderFrame();
  }

  private renderFrame(): void {
    if (this.disposed) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private animate(): void {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerStart = new THREE.Vector2(event.clientX, event.clientY);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.pointerStart) return;
    const moved = this.pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY));
    this.pointerStart = null;
    if (moved > 7) return;
    const square = this.getSquareAt(event.clientX, event.clientY);
    if (square) this.onSquareClick(square);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.pointerStart) return;
    this.renderer.domElement.style.cursor = this.getSquareAt(event.clientX, event.clientY) ? "pointer" : "grab";
  };
}
