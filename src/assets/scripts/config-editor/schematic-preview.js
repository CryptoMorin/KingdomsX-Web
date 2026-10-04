import { playerHeadTextureUrl } from "./minecraft-assets.js";
import { canRenderMinecraftModels } from "./minecraft-renderer.js";
import {
  buildingCoreMaterial,
  buildingHologramPreview,
  buildingHologramOrigin,
  engineHubSetupHologramHeight
} from "./building-hologram.js";
import {
  configuredBuildingMaxLevel,
  schematicLevelPreviews,
  schematicPreviewsEnabled,
  schematicSelectionForBuilding
} from "./schematic-catalog.js";
import { remoteSchematicPathEditable } from "./remote-workspace-manifest.js";
import { parseSimpleLiteral, pathKey } from "./yaml-source.js";

export function createSchematicPreview(elements) {
  let activeWorkspace = null;
  let activeSession = null;
  let activeFileName = "";
  let activeSchemaId = "";
  let activeMaxLevel = null;
  let activePressureMine = false;
  let activeConfigIndex = null;
  let activeMessageMacros = null;
  let activeFallbackName = "Building";
  let activeResourcePath = "";
  let activeResourceBytes = null;
  let renderMode = "";
  let loadSequence = 0;
  let levelSequence = 0;
  let viewer = null;

  const disposeViewer = () => {
    viewer?.dispose();
    viewer = null;
  };

  const invalidate = () => {
    activeWorkspace = null;
    activeSession = null;
    activeFileName = "";
    activeSchemaId = "";
    activeMaxLevel = null;
    activePressureMine = false;
    activeConfigIndex = null;
    activeMessageMacros = null;
    activeFallbackName = "Building";
    activeResourcePath = "";
    activeResourceBytes = null;
    renderMode = "";
    loadSequence += 1;
    levelSequence += 1;
    disposeViewer();
  };

  const selectLevel = async (resource) => {
    const request = ++levelSequence;
    disposeViewer();
    setSelectedLevel(elements.levels, resource.level);
    elements.canvas.style.visibility = "hidden";
    elements.status.hidden = false;
    elements.status.textContent = `Loading level ${resource.level}…`;
    elements.notice.hidden = true;

    try {
      const [{ renderMinecraftStructure }, { parseWorldEditSchematic }] = await Promise.all([
        import("./minecraft-structure-viewer.js"),
        import("./worldedit-schematic.js")
      ]);
      const schematic = await cachedSchematic(resource.bytes, parseWorldEditSchematic);

      if (request !== levelSequence) {
        return;
      }

      const holograms = buildingHologramPreview(activeConfigIndex, resource.level, {
        macros: activeMessageMacros,
        fallbackName: activeFallbackName,
        setupHeight: engineHubSetupHologramHeight(activeFileName || activeResourcePath)
      });
      const hologramOrigin = buildingHologramOrigin(
        schematic.blocks,
        schematic.origin,
        buildingCoreMaterial(activeConfigIndex, resource.level)
      );
      const nextViewer = await renderMinecraftStructure(elements.canvas, schematic.blocks, {
        skinUrl: playerHeadTextureUrl(schematic.skinTexture),
        holograms,
        origin: hologramOrigin
      });

      if (request !== levelSequence) {
        nextViewer.dispose();
        return;
      }

      viewer = nextViewer;
      elements.canvas.style.visibility = "visible";
      elements.status.hidden = true;
      setSchematicSource(elements, resource.origin, resource.path);
      elements.meta.replaceChildren(
        pill(resource.levelLabel),
        formatPill(schematic.format),
        pill(`${schematic.dimensions.width} × ${schematic.dimensions.height} × ${schematic.dimensions.length}`),
        pill(blockCount(schematic.blocks.length)),
        ...(holograms.length ? [hologramPill()] : [])
      );
      const warnings = [...schematic.warnings, ...(nextViewer.warnings ?? [])];
      elements.notice.textContent = warnings.join(" ");
      elements.notice.hidden = warnings.length === 0;
    } catch (error) {
      if (request !== levelSequence) {
        return;
      }

      elements.canvas.style.visibility = "hidden";
      elements.status.hidden = false;
      elements.status.textContent = previewErrorMessage(error);
      elements.meta.replaceChildren(pill(resource.levelLabel));
    }
  };

  const render = async ({ workspace, session, schemaId, configIndex, messageMacros = null }) => {
    if (!schematicPreviewsEnabled(workspace)) {
      invalidate();
      elements.container.hidden = true;
      return;
    }

    const fileName = session?.fileName ?? "";
    const maxLevel = configuredBuildingMaxLevel(configIndex);
    const pressureMine = isPressureMine(configIndex);

    if (renderMode === "building"
      && workspace === activeWorkspace
      && session === activeSession
      && fileName === activeFileName
      && schemaId === activeSchemaId
      && maxLevel === activeMaxLevel
      && pressureMine === activePressureMine
      && configIndex === activeConfigIndex
      && messageMacros === activeMessageMacros) {
      return;
    }

    activeWorkspace = workspace;
    activeSession = session;
    activeFileName = fileName;
    activeSchemaId = schemaId;
    activeMaxLevel = maxLevel;
    activePressureMine = pressureMine;
    activeConfigIndex = configIndex;
    activeMessageMacros = messageMacros;
    activeFallbackName = buildingName(fileName);
    activeResourcePath = "";
    activeResourceBytes = null;
    renderMode = "building";
    const request = ++loadSequence;
    levelSequence += 1;
    disposeViewer();
    elements.container.hidden = true;
    elements.viewport.hidden = false;
    elements.notice.hidden = true;
    elements.source.hidden = true;
    elements.replace.hidden = true;
    elements.meta.replaceChildren();

    let selection;

    try {
      selection = await schematicSelectionForBuilding(workspace, fileName, schemaId);
    } catch (error) {
      if (request !== loadSequence) {
        return;
      }

      elements.container.hidden = false;
      elements.title.textContent = buildingSchematicTitle(fileName, schemaId, configIndex);
      elements.levels.replaceChildren();
      elements.canvas.style.visibility = "hidden";
      elements.status.hidden = false;
      elements.status.textContent = previewErrorMessage(error);
      return;
    }

    if (request !== loadSequence) {
      return;
    }

    const resources = schematicLevelPreviews(selection.resources, maxLevel);

    if (!resources.length) {
      if (selection.source !== "workspace") {
        return;
      }

      elements.container.hidden = false;
      elements.viewport.hidden = true;
      elements.title.textContent = buildingSchematicTitle(fileName, schemaId, configIndex);
      elements.help.textContent = "Your files contain building designs, but none for this building. The editor will not use the default design while custom designs are present.";
      setSchematicSource(elements, "workspace");
      elements.levels.replaceChildren();
      elements.meta.replaceChildren();
      elements.notice.hidden = true;
      return;
    }

    elements.container.hidden = false;
    elements.title.textContent = buildingSchematicTitle(fileName, schemaId, configIndex);
    setSchematicSource(elements, selection.source, resources[0].path);
    elements.meta.replaceChildren();
    elements.levels.replaceChildren(...resources.map((resource) => levelButton(resource, selectLevel)));

    if (!canRenderMinecraftModels()) {
      elements.canvas.style.visibility = "hidden";
      elements.status.hidden = false;
      elements.status.textContent = "This browser cannot render the interactive Minecraft preview.";
      return;
    }

    await selectLevel(resources[0]);
  };

  const renderFile = async (file, { workspace, configIndex, messageMacros = null } = {}) => {
    if (!schematicPreviewsEnabled(workspace)) {
      invalidate();
      elements.container.hidden = true;
      return;
    }

    if (renderMode === "file"
      && file?.path === activeResourcePath
      && file?.bytes === activeResourceBytes
      && configIndex === activeConfigIndex
      && messageMacros === activeMessageMacros) {
      return;
    }

    activeWorkspace = null;
    activeSession = null;
    activeFileName = "";
    activeSchemaId = "";
    activeMaxLevel = null;
    activePressureMine = false;
    activeConfigIndex = configIndex;
    activeMessageMacros = messageMacros;
    activeFallbackName = buildingNameFromSchematicPath(file?.path);
    activeResourcePath = file?.path ?? "";
    activeResourceBytes = file?.bytes ?? null;
    renderMode = "file";
    loadSequence += 1;
    levelSequence += 1;
    disposeViewer();
    elements.container.hidden = false;
    elements.viewport.hidden = false;
    elements.notice.hidden = true;
    elements.replace.hidden = workspace?.sourceKind === "example"
      || !remoteSchematicPathEditable(workspace?.remoteContract, file?.path);
    elements.title.textContent = schematicFileTitle(file?.path, configIndex);
    elements.meta.replaceChildren();
    elements.levels.replaceChildren();

    const level = schematicFileLevel(file?.path);
    const resource = {
      ...file,
      origin: "workspace",
      level,
      endLevel: level,
      levelLabel: `Level ${level}`
    };
    setSchematicSource(elements, resource.origin, resource.path);
    elements.levels.replaceChildren(levelButton(resource, selectLevel));

    if (!canRenderMinecraftModels()) {
      elements.canvas.style.visibility = "hidden";
      elements.status.hidden = false;
      elements.status.textContent = "This browser cannot render the interactive Minecraft preview.";
      return;
    }

    await selectLevel(resource);
  };

  return {
    render,
    renderFile,
    invalidate,
    cleanup: invalidate
  };
}

function setSchematicSource(elements, source, path = "") {
  const fromWorkspace = source === "workspace";
  const hasMatchingFile = Boolean(path);
  elements.source.hidden = false;
  elements.source.textContent = fromWorkspace
    ? hasMatchingFile
      ? "From your files"
      : "No matching design"
    : "Default design";
  elements.source.classList.toggle("is-workspace", fromWorkspace);
  elements.source.classList.toggle("is-bundled", !fromWorkspace);
  elements.source.title = fromWorkspace
    ? path || "The opened files contain building designs, but none match this building."
    : "No schematic files were opened, so this preview uses the versioned default design provided by EngineHub.";

  if (!hasMatchingFile) {
    return;
  }

  elements.help.textContent = fromWorkspace
    ? `From ${path}. Drag to rotate, scroll to zoom, or right-drag to move.`
    : "No building schematics are in the open files, so this preview uses EngineHub's default. Drag to rotate, scroll to zoom, or right-drag to move.";
}

function levelButton(resource, selectLevel) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-sm btn-site-secondary editor-schematic-preview-level";
  button.textContent = resource.levelLabel;

  if (resource.sourceLevel && resource.sourceLevel !== resource.level) {
    button.title = `This level uses the schematic that starts at level ${resource.sourceLevel}.`;
  }

  button.dataset.schematicLevel = String(resource.level);
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => selectLevel(resource));
  return button;
}

function setSelectedLevel(container, level) {
  container.querySelectorAll("[data-schematic-level]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.schematicLevel === String(level) ? "true" : "false");
  });
}

function pill(text) {
  const item = document.createElement("span");
  item.className = "editor-pill fw-bold text-nowrap d-inline-flex align-items-center";
  item.textContent = text;
  return item;
}

function formatPill(format) {
  const sponge = /^SPONGE_V([1-3])_SCHEMATIC$/.exec(format);

  if (sponge) {
    const item = pill(`Modern WorldEdit (.schem v${sponge[1]})`);
    item.title = `Sponge schematic format version ${sponge[1]}`;
    return item;
  }

  const item = pill("Legacy WorldEdit (.schematic)");
  item.title = "MCEdit Alpha schematic format";
  return item;
}

function hologramPill() {
  const item = pill("Hologram preview");
  item.title = "Shows configured hologram text for this level. Lines that need live server values are left out.";
  return item;
}

function buildingName(fileName) {
  const baseName = String(fileName ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    ?.replace(/\.ya?ml$/i, "") ?? "Building";

  return baseName
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0].toLocaleUpperCase("en-US") + part.slice(1))
    .join(" ");
}

function buildingNameFromSchematicPath(path) {
  const normalized = String(path ?? "").replaceAll("\\", "/");
  const match = /(?:^|\/)schematics\/(?:structures|turrets)\/([^/]+)\/[1-9]\d*\.(?:schematic|schem)$/i.exec(normalized);

  return buildingName(`${match?.[1] ?? "Building"}.yml`);
}

function buildingSchematicTitle(fileName, schemaId, configIndex) {
  const qualifier = schemaId === "Turrets/turret" && !isPressureMine(configIndex) ? " Turret" : "";

  return `${buildingName(fileName)}${qualifier} schematic`;
}

function schematicFileTitle(path, configIndex) {
  const normalized = String(path ?? "").replaceAll("\\", "/");
  const match = /(?:^|\/)schematics\/(structures|turrets)\/([^/]+)\/[1-9]\d*\.(?:schematic|schem)$/i.exec(normalized);

  if (!match) {
    const fileName = normalized.split("/").at(-1)?.replace(/\.(?:schematic|schem)$/i, "") ?? "Building";

    return `${buildingName(`${fileName}.yml`)} schematic`;
  }

  const qualifier = match[1].toLocaleLowerCase("en-US") === "turrets" && !isPressureMine(configIndex)
    ? " Turret"
    : "";

  return `${buildingName(`${match[2]}.yml`)}${qualifier} schematic`;
}

function isPressureMine(index) {
  const type = index?.byPath?.get(pathKey(["type"]));

  if (!type || type.container) {
    return false;
  }

  return String(parseSimpleLiteral(type.source).value).toLocaleLowerCase("en-US") === "pressure_mine";
}

function schematicFileLevel(path) {
  const match = /\/([1-9]\d*)\.(?:schematic|schem)$/i.exec(String(path ?? "").replaceAll("\\", "/"));

  return Number.parseInt(match?.[1] ?? "1", 10);
}

function blockCount(count) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "block" : "blocks"}`;
}

function previewErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);

  return `The schematic preview could not be shown. ${message}`;
}

const parsedSchematics = new WeakMap();

function cachedSchematic(bytes, parse) {
  let request = parsedSchematics.get(bytes);

  if (!request) {
    request = parse(bytes);
    parsedSchematics.set(bytes, request);
    request.catch(() => {
      if (parsedSchematics.get(bytes) === request) {
        parsedSchematics.delete(bytes);
      }
    });
  }

  return request;
}
