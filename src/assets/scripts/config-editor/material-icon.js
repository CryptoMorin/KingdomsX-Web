import {
  materialTextureCandidates,
  normalizeMaterialId,
  playerHeadTextureUrl
} from "./minecraft-assets.js";
import { drawMinecraftModelIcon } from "./minecraft-model-icon.js";
import { canRenderMinecraftModels } from "./minecraft-renderer.js";

let renderSequence = 0;

export function materialIconElement(material, {
  className = "",
  skull = "",
  components = {}
} = {}) {
  const root = document.createElement("span");
  root.className = `editor-material-icon d-inline-grid overflow-hidden ${className}`.trim();
  root.setAttribute("aria-hidden", "true");
  updateMaterialIcon(root, material, { skull, components });
  return root;
}

export function updateMaterialIcon(root, material, {
  skull = "",
  components = {}
} = {}) {
  const id = normalizeMaterialId(material);
  const renderId = String(++renderSequence);
  root.dataset.materialRender = renderId;
  root.replaceChildren();
  root.classList.remove("is-loading", "is-missing", "is-model");

  if (!id) {
    renderFallback(root);
    return;
  }

  if (!canRenderMinecraftModels()) {
    renderImageCandidates(root, materialTextureCandidates(material), renderId);
    return;
  }

  root.classList.add("is-loading");
  root.append(loadingIcon());

  renderModel(root, id, renderId, {
    skinUrl: id === "player_head" ? playerHeadTextureUrl(skull) : "",
    components
  }).catch(() => {
    if (root.dataset.materialRender !== renderId) {
      return;
    }

    renderImageCandidates(root, materialTextureCandidates(material), renderId);
  });
}

export function clearMaterialIcon(root) {
  root.dataset.materialRender = String(++renderSequence);
  root.replaceChildren();
  root.classList.remove("is-loading", "is-missing", "is-model");
}

async function renderModel(root, material, renderId, options) {
  const canvas = document.createElement("canvas");
  canvas.className = "editor-material-icon-model d-block w-100 h-100 object-fit-contain";
  await drawMinecraftModelIcon(canvas, material, options);

  if (root.dataset.materialRender !== renderId) {
    return;
  }

  root.classList.remove("is-loading");
  root.classList.add("is-model");
  root.replaceChildren(canvas);
}

function renderImageCandidates(root, candidates, renderId) {
  root.classList.remove("is-loading", "is-model");

  if (!candidates.length) {
    renderFallback(root);
    return;
  }

  const image = document.createElement("img");
  let candidateIndex = 0;
  configureImage(image, candidates[candidateIndex]);
  image.addEventListener("error", () => {
    if (root.dataset.materialRender !== renderId) {
      return;
    }

    candidateIndex += 1;

    if (candidateIndex < candidates.length) {
      image.src = candidates[candidateIndex];
      return;
    }

    renderFallback(root);
  });
  root.replaceChildren(image);
}

function renderFallback(root) {
  root.classList.remove("is-loading", "is-model");
  root.classList.add("is-missing");

  const icon = document.createElement("i");
  icon.className = "fa-solid fa-cube";
  root.replaceChildren(icon);
}

function configureImage(image, source) {
  image.className = "w-100 h-100 object-fit-contain";
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.src = source;
}

function loadingIcon() {
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-cube";
  return icon;
}
