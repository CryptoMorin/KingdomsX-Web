import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { createMinecraftBlockScene } from "./minecraft-renderer.js";
import { createMinecraftHolograms } from "./minecraft-hologram.js";

const MAX_PIXEL_RATIO = 2;
const CAMERA_FOV = 34;

export async function renderMinecraftStructure(canvas, blocks, {
  skinUrl = "",
  holograms = [],
  origin = [0, 0, 0]
} = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("A canvas is required to show this schematic.");
  }

  if (!blocks.length) {
    throw new Error("This schematic has no supported blocks to show.");
  }

  const model = await createMinecraftBlockScene({ blocks, skinUrl });

  if (!model?.group) {
    throw new Error("The schematic model could not be created.");
  }

  const warnings = missingBlockWarnings(model, blocks);
  const scene = new THREE.Scene();
  scene.add(model.group);
  let hologramLayer;

  try {
    hologramLayer = await createMinecraftHolograms(holograms, {
      origin
    });
  } catch (error) {
    hologramLayer = { group: new THREE.Group(), dispose() {} };
    warnings.push(`The configured hologram could not be shown. ${error.message}`);
  }

  scene.add(hologramLayer.group);

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 10_000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.maxPolarAngle = Math.PI * 0.94;

  const bounds = new THREE.Box3().setFromObject(scene);
  frameModel(camera, controls, bounds);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO));

  let disposed = false;
  let intersecting = true;
  let visible = true;
  let animationFrame = 0;

  const resize = () => {
    const viewport = canvas.parentElement;
    const width = Math.max(1, viewport?.clientWidth ?? canvas.clientWidth);
    const height = Math.max(1, viewport?.clientHeight ?? canvas.clientHeight);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  const draw = () => {
    animationFrame = 0;

    if (disposed || !visible) {
      return;
    }

    controls.update();
    renderer.render(scene, camera);
    animationFrame = globalThis.requestAnimationFrame(draw);
  };

  const updateVisibility = (isVisible) => {
    visible = isVisible && !document.hidden;

    if (visible && !animationFrame) {
      animationFrame = globalThis.requestAnimationFrame(draw);
    }
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas.parentElement ?? canvas);

  const intersectionObserver = typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting ?? false;
      updateVisibility(intersecting);
    });
  intersectionObserver?.observe(canvas);

  const onVisibilityChange = () => updateVisibility(intersecting);
  document.addEventListener("visibilitychange", onVisibilityChange);

  resize();
  animationFrame = globalThis.requestAnimationFrame(draw);

  return {
    warnings,
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;

      if (animationFrame) {
        globalThis.cancelAnimationFrame(animationFrame);
      }

      document.removeEventListener("visibilitychange", onVisibilityChange);
      intersectionObserver?.disconnect();
      resizeObserver.disconnect();
      controls.dispose();
      hologramLayer.dispose();
      model.dispose?.();
      renderer.dispose();
    }
  };
}

function missingBlockWarnings(model, blocks) {
  const missing = new Set(
    (model.palette ?? [])
      .filter((entry) => entry.models?.some(({ model: modelId }) => modelId === "block-model-renderer:missing"))
      .map(({ id }) => id)
  );

  if (!missing.size) {
    return [];
  }

  const counts = new Map();

  for (const block of blocks) {
    if (!missing.has(block.id)) {
      continue;
    }

    const id = `${block.namespace}:${block.id}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const unsupported = [...counts.entries()]
    .map(([id, count]) => `${id} (${count.toLocaleString("en-US")})`)
    .join(", ");

  return [`Some blocks could not be displayed with the current Minecraft assets: ${unsupported}.`];
}

function frameModel(camera, controls, bounds) {
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 8);
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const distance = radius / Math.sin(halfFov) * 1.15;
  const direction = new THREE.Vector3(1, 0.72, 1).normalize();

  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(0.1, distance / 100);
  camera.far = Math.max(1_000, distance * 12);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minDistance = Math.max(radius * 0.35, 8);
  controls.maxDistance = Math.max(radius * 8, 128);
  controls.update();
}
