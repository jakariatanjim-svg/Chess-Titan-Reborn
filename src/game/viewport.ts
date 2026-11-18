import * as THREE from "three";

export function mountGameViewport(container: HTMLElement): void {
  const canvas = document.createElement("canvas");
  canvas.className = "scene-canvas";

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#091019");

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(6.7, 7.4, 8.2);
  camera.lookAt(0, 0, 0);

  const ambientLight = new THREE.HemisphereLight("#b9d5e8", "#101820", 1.8);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight("#e7f3ff", 2.2);
  keyLight.position.set(4, 8, 5);
  scene.add(keyLight);

  const stage = new THREE.Mesh(
    new THREE.CylinderGeometry(5.45, 5.8, 0.35, 64),
    new THREE.MeshStandardMaterial({
      color: "#24323d",
      metalness: 0.58,
      roughness: 0.42,
    }),
  );
  stage.position.y = -0.28;
  scene.add(stage);

  const grid = new THREE.GridHelper(9.6, 8, "#6a8293", "#263846");
  grid.position.y = -0.09;
  scene.add(grid);

  const resize = (): void => {
    const { width, height } = container.getBoundingClientRect();
    const safeWidth = Math.max(width, 1);
    const safeHeight = Math.max(height, 1);

    camera.aspect = safeWidth / safeHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(safeWidth, safeHeight, false);
    renderer.render(scene, camera);
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  container.replaceChildren(canvas);
  resize();
}
