import { parseAnchorName, parseFunctionCall, parseImportedAnchor } from "./kingdoms-yaml.js";
import { parseSimpleLiteral, pathKey } from "./yaml-source.js";

const CONFIGURATION_MENU_LINKS = [
  {
    config: "champion-upgrades.yml",
    menu: /(?:^|\/)guis\/[^/]+\/structures\/nexus\/(?:champion-settings|champions)\.ya?ml$/i,
    menuReason: "Champion loadout menu",
    configReason: "Champion loadout settings"
  },
  {
    config: "invasions.yml",
    menu: /(?:^|\/)guis\/[^/]+\/(?:challenge|surrender)\.ya?ml$/i,
    menuReason: "Invasion menu",
    configReason: "Invasion gameplay settings"
  },
  {
    config: "map.yml",
    menu: /(?:^|\/)guis\/[^/]+\/map-settings\.ya?ml$/i,
    menuReason: "Map settings menu",
    configReason: "Map gameplay settings"
  },
  {
    config: "misc-upgrades.yml",
    menu: /(?:^|\/)guis\/[^/]+\/structures\/nexus\/misc-upgrades\.ya?ml$/i,
    menuReason: "Player-facing upgrade menu",
    configReason: "Upgrade gameplay settings"
  },
  {
    config: "protection-signs.yml",
    menu: /(?:^|\/)guis\/[^/]+\/protection-signs\/[^/]+\.ya?ml$/i,
    menuReason: "Protection-sign menu",
    configReason: "Protection-sign settings"
  },
  {
    config: "ranks.yml",
    menu: /(?:^|\/)guis\/[^/]+\/(?:confirm\/ranks|structures\/nexus\/(?:nation\/)?ranks)\/.+\.ya?ml$/i,
    menuReason: "Rank management menu",
    configReason: "Rank and permission settings"
  },
  {
    config: "relations.yml",
    menu: /(?:^|\/)guis\/[^/]+\/structures\/nexus\/(?:nation\/)?settings\/(?:relation-editor|relations)\.ya?ml$/i,
    menuReason: "Relation settings menu",
    configReason: "Relation gameplay settings"
  },
  {
    config: "resource-points.yml",
    menu: /(?:^|\/)guis\/[^/]+\/structures\/nexus\/(?:nation\/)?resource-points-converter\.ya?ml$/i,
    menuReason: "Resource-point converter menu",
    configReason: "Resource-point conversion rules"
  },
  {
    config: "structures.yml",
    menu: /(?:^|\/)guis\/[^/]+\/structures\/nexus\/structures\.ya?ml$/i,
    menuReason: "Structure purchase menu",
    configReason: "Global Structure settings"
  },
  {
    config: "turrets.yml",
    menu: /(?:^|\/)guis\/[^/]+\/structures\/nexus\/turrets\.ya?ml$/i,
    menuReason: "Turret purchase menu",
    configReason: "Global turret settings"
  }
];

export function workspaceRelationships(workspace, activeSession) {
  const imports = importsForSession(activeSession);
  const dependencies = imports.map((name) => ({
    name,
    path: resolveImportPath(workspace, activeSession.fileName, name),
    reason: "Shared template"
  }));
  const consumers = [];

  for (const session of workspace.files) {
    if (session === activeSession) {
      continue;
    }

    for (const name of importsForSession(session)) {
      if (resolveImportPath(workspace, session.fileName, name) === activeSession.fileName) {
        consumers.push({ name, path: session.fileName, reason: "Uses this template" });
      }
    }
  }

  const occupied = new Set([
    activeSession.fileName,
    ...dependencies.map((item) => item.path),
    ...consumers.map((item) => item.path)
  ].filter(Boolean));
  const related = workspace.files
    .filter((session) => !occupied.has(session.fileName) && filesBelongTogether(activeSession.fileName, session.fileName))
    .map((session) => ({ path: session.fileName, reason: relatedReason(activeSession.fileName, session.fileName) }));

  return {
    dependencies,
    consumers: uniqueByPath(consumers),
    related: uniqueByPath(related),
    warnings: [
      ...importedAnchorWarnings(activeSession, dependencies, workspace),
      ...moduleParameterWarnings(activeSession, dependencies, workspace),
      ...importCycleWarnings(workspace, activeSession),
      ...linkedConfigurationWarnings(workspace, activeSession)
    ]
  };
}

function linkedConfigurationWarnings(workspace, session) {
  return [
    ...outpostWarnings(workspace, session),
    ...upgradeCatalogWarnings(workspace, session),
    ...purchaseMenuWarnings(workspace, session),
    ...languageReferenceWarnings(workspace, session)
  ];
}

function outpostWarnings(workspace, session) {
  const sessionPath = normalizedPath(session.fileName);
  const gameplay = workspace.files.find((candidate) => isOutpostDefinition(candidate.fileName));
  const page = outpostPageDetails(session.fileName);
  const warnings = [];

  if (page && gameplay) {
    const stocks = directChildren(gameplay.document.index, ["stocks"]);
    const stockByName = new Map(stocks.map((stock) => [stock.key, stock]));
    const siblingPages = workspace.files.filter((candidate) => {
      const details = outpostPageDetails(candidate.fileName);

      return details && details.language === page.language && candidate !== session;
    });
    const siblingProducts = new Set(siblingPages.flatMap((candidate) => outpostProducts(candidate).map((product) => product.stockName)));

    for (const product of outpostProducts(session)) {
      const stock = stockByName.get(product.stockName);

      if (!stock) {
        warnings.push(`${product.label} refers to outpost stock “${product.stockName}”, but that stock is not defined in ${gameplay.fileName}.`);
        continue;
      }

      if (siblingProducts.has(product.stockName)) {
        warnings.push(`${product.label} appears on more than one uploaded outpost page for ${page.language.toUpperCase()}.`);
      }

      const stockMaterial = outpostStockMaterial(gameplay.document.index, stock);

      if (product.material && stockMaterial && normalizeIdentifier(product.material) !== normalizeIdentifier(stockMaterial)) {
        warnings.push(`${product.label} displays ${product.material}, but outpost stock “${product.stockName}” gives players ${stockMaterial}.`);
      }
    }
  }

  if (gameplay === session || (isOutpostDefinition(sessionPath) && gameplay)) {
    const pagesByLanguage = new Map();

    for (const candidate of workspace.files) {
      const details = outpostPageDetails(candidate.fileName);

      if (!details) {
        continue;
      }

      if (!pagesByLanguage.has(details.language)) {
        pagesByLanguage.set(details.language, []);
      }

      pagesByLanguage.get(details.language).push(candidate);
    }

    for (const [language, pages] of pagesByLanguage) {
      if (!pages.some((candidate) => outpostPageDetails(candidate.fileName).page === "1")
        || !pages.some((candidate) => outpostPageDetails(candidate.fileName).page === "2")) {
        continue;
      }

      const represented = new Set(pages.flatMap((candidate) => outpostProducts(candidate).map((product) => product.stockName)));

      for (const stock of directChildren(session.document.index, ["stocks"])) {
        if (!represented.has(stock.key)) {
          warnings.push(`Outpost stock “${stock.key}” has no product button on the uploaded ${language.toUpperCase()} outpost pages.`);
        }
      }
    }
  }

  return warnings;
}

function outpostProducts(session) {
  return directChildren(session.document.index, ["options"]).flatMap((entry) => {
    if (!entry.key.startsWith("stock-") || !entry.container) {
      return [];
    }

    return [{
      label: entry.path.join(" → "),
      stockName: entry.key.slice("stock-".length),
      material: scalarValue(session.document.index, [...entry.path, "material"])
    }];
  });
}

function outpostStockMaterial(index, stock) {
  const direct = scalarValue(index, [...stock.path, "item", "material"]);

  if (direct) {
    return direct;
  }

  const call = parseFunctionCall(stock.source)
    ?? parseFunctionCall(index.byPath.get(pathKey([...stock.path, "<<"]))?.source ?? "");

  return call?.args[1] ? simpleValue(call.args[1]) : "";
}

function outpostPageDetails(path) {
  const match = /(?:^|\/)guis\/([^/]+)\/structures\/outpost\/([1-9]\d*)\.ya?ml$/i.exec(normalizedPath(path));

  return match ? { language: match[1].toLocaleLowerCase("en-US"), page: match[2] } : null;
}

function isOutpostDefinition(path) {
  return /(?:^|\/)structures\/outpost\.ya?ml$/i.test(normalizedPath(path))
    && !isGuiPath(path);
}

function upgradeCatalogWarnings(workspace, session) {
  const catalog = upgradeCatalogDetails(session.fileName);

  if (!catalog) {
    return [];
  }

  const gameplay = workspace.files.find((candidate) => {
    const path = normalizedPath(candidate.fileName);

    return !isGuiPath(path) && new RegExp(`(?:^|/)${catalog.file.replace(".", "\\.")}$`, "i").test(path);
  });

  if (!gameplay) {
    return [];
  }

  const definitions = new Set(directChildren(gameplay.document.index, [])
    .filter((entry) => gameplay.document.index.byPath.has(pathKey([...entry.path, "enabled"])))
    .map((entry) => entry.key));
  const warnings = [];

  for (const option of directChildren(session.document.index, ["options"])) {
    if (!looksLikeUpgradeButton(session.document.index, option, catalog.kind)) {
      continue;
    }

    if (!definitions.has(option.key)) {
      warnings.push(`${option.path.join(" → ")} looks like an upgrade button, but “${option.key}” is not defined in ${gameplay.fileName}.`);
    }
  }

  return warnings;
}

function looksLikeUpgradeButton(index, option, kind) {
  const descendants = index.entries.filter((entry) => startsWith(entry.path, option.path));

  if (kind === "misc") {
    return descendants.some((entry) => entry.key === "[fn]" || entry.syntax?.kind === "function-merge");
  }

  return descendants.some((entry) => !entry.container
    && /%(?:level|max_level|cost|scaling)%/.test(String(parseSimpleLiteral(entry.source).value ?? "")));
}

function upgradeCatalogDetails(path) {
  const normalized = normalizedPath(path);

  if (/(?:^|\/)guis\/[^/]+\/structures\/nexus\/misc-upgrades\.ya?ml$/i.test(normalized)) {
    return { kind: "misc", file: "misc-upgrades.yml" };
  }

  if (/(?:^|\/)guis\/[^/]+\/structures\/nexus\/champion-upgrades\.ya?ml$/i.test(normalized)) {
    return { kind: "champion", file: "champion-upgrades.yml" };
  }

  return null;
}

function purchaseMenuWarnings(workspace, session) {
  const definition = gameplayDefinitionDetails(session.fileName);

  if (!definition) {
    return [];
  }

  if (definition.family === "structures" && ["nexus", "national-nexus"].includes(definition.name)) {
    return [];
  }

  const menuName = definition.family === "turrets" ? "turrets.yml" : "structures.yml";
  const menus = workspace.files.filter((candidate) => new RegExp(
    `(?:^|/)guis/[^/]+/structures/nexus/${menuName.replace(".", "\\.")}$`, "i"
  ).test(normalizedPath(candidate.fileName)));
  const warnings = [];

  for (const menu of menus) {
    if (!menu.document.index.byPath.has(pathKey(["options", definition.name]))) {
      warnings.push(`${menu.fileName} has no purchase button for ${definition.label} “${definition.name}”.`);
    }
  }

  if (definition.family === "turrets") {
    const guis = workspace.files.filter((candidate) => new RegExp(
      `(?:^|/)guis/[^/]+/turrets/${escapeRegExp(definition.name)}\\.ya?ml$`, "i"
    ).test(normalizedPath(candidate.fileName)));

    for (const gui of guis) {
      const configuredName = scalarValue(gui.document.index, ["(import)", "turretgui", "parameters", "<name>"]);

      if (configuredName && normalizeIdentifier(configuredName) !== normalizeIdentifier(definition.name)) {
        warnings.push(`${gui.fileName} identifies its turret as “${configuredName}”, but it is paired with ${definition.name}.`);
      }
    }
  }

  return warnings;
}

function gameplayDefinitionDetails(path) {
  const match = /(?:^|\/)(structures|turrets)\/([^/]+)\.ya?ml$/i.exec(normalizedPath(path));

  if (!match || isGuiPath(path)) {
    return null;
  }

  const family = match[1].toLocaleLowerCase("en-US");
  const name = match[2].toLocaleLowerCase("en-US");

  return { family, name, label: family === "turrets" ? "Turret" : "Structure" };
}

function languageReferenceWarnings(workspace, session) {
  const language = matchingLanguageSession(workspace, session.fileName);

  if (!language) {
    return [];
  }

  const missing = new Set();

  for (const entry of session.document.index.entries) {
    if (entry.container) {
      continue;
    }

    const value = String(parseSimpleLiteral(entry.source).value ?? "");

    for (const match of value.matchAll(/\{\$\$([^{}]+)}/g)) {
      const reference = match[1].trim();

      if (reference && !language.document.index.byPath.has(pathKey(reference.split(".")))) {
        missing.add(reference);
      }
    }
  }

  return [...missing].map((reference) =>
    `Message reference “${reference}” was not found in ${language.fileName}.`
  );
}

function matchingLanguageSession(workspace, sourcePath) {
  const normalized = normalizedPath(sourcePath);
  const guiMatch = /(?:^|\/)guis\/([^/]+)\//i.exec(normalized);
  const requested = (guiMatch?.[1] ?? "en").toLocaleLowerCase("en-US");

  return workspace.files.find((candidate) => new RegExp(
    `(?:^|/)languages/${escapeRegExp(requested)}\\.ya?ml$`, "i"
  ).test(normalizedPath(candidate.fileName))) ?? null;
}

function importsForSession(session) {
  return session.document.index.entries
    .filter((entry) => entry.path.length === 2 && entry.path[0] === "(import)")
    .map((entry) => entry.key);
}

export function resolveImportPath(workspace, sourcePath, importName) {
  const expected = `${String(importName).toLocaleLowerCase("en-US")}.yml`;
  const candidates = workspace.files.filter((session) => basename(session.fileName).toLocaleLowerCase("en-US") === expected);

  if (!candidates.length) {
    return null;
  }

  const sourceIsGui = pathSegments(sourcePath).some((segment) => segment === "guis");
  const sourceLanguage = sourceIsGui ? guiLanguage(sourcePath) : "";

  return candidates
    .map((session) => ({
      path: session.fileName,
      score: importCandidateScore(session.fileName, sourceIsGui, sourceLanguage)
    }))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path, "en-US"))[0].path;
}

function importCandidateScore(path, sourceIsGui, sourceLanguage) {
  const segments = pathSegments(path);
  let score = 0;

  if (sourceLanguage && guiLanguage(path) === sourceLanguage) {
    score += 200;
  }

  if (sourceIsGui && segments.includes("templates")) {
    score += 100;
  }

  if (!sourceIsGui && segments.includes("declarations")) {
    score += 100;
  }

  if (segments.includes("templates") || segments.includes("declarations")) {
    score += 20;
  }

  score -= segments.length;
  return score;
}

function moduleParameterWarnings(session, dependencies, workspace) {
  const warnings = [];
  const isTemplate = session.document.index.byPath.has("(module)");

  for (const dependency of dependencies) {
    if (!dependency.path) {
      continue;
    }

    const parent = workspace.files.find((candidate) => candidate.fileName === dependency.path);

    if (!parent) {
      continue;
    }

    const declared = declaredModuleParameters(parent.document.index);
    const supplied = suppliedModuleParameters(session.document.index, dependency.name);
    const extendsParent = scalarValue(session.document.index, ["(import)", dependency.name, "extend"]) !== "false";

    if (!isTemplate && extendsParent) {
      for (const [name, parameter] of declared) {
        if (parameter.required && !supplied.has(name)) {
          warnings.push(`${parent.fileName} requires the “${name}” template input, but this file does not provide it.`);
        }
      }
    }

    for (const name of supplied) {
      if (!declared.has(name)) {
        warnings.push(`Template input “${name}” is not accepted by ${parent.fileName}.`);
      }
    }
  }

  return warnings;
}

function declaredModuleParameters(index) {
  const parameters = new Map();

  for (const entry of index.entries) {
    if (entry.path.length !== 3 || entry.path[0] !== "(module)" || entry.path[1] !== "parameters") {
      continue;
    }

    const defaultValue = index.byPath.get(["(module)", "parameters", entry.key, "default"].join("\u0000"));
    parameters.set(entry.key, { required: !defaultValue });
  }

  return parameters;
}

function suppliedModuleParameters(index, importName) {
  const supplied = new Set();

  for (const entry of index.entries) {
    if (entry.path.length === 4
      && entry.path[0] === "(import)"
      && entry.path[1] === importName
      && entry.path[2] === "parameters") {
      supplied.add(entry.key);
    }
  }

  return supplied;
}

function importCycleWarnings(workspace, activeSession) {
  const cycle = findImportCycle(workspace, activeSession, [], new Set());

  return cycle ? [`Shared templates form a cycle: ${cycle.join(" → ")}.`] : [];
}

function findImportCycle(workspace, session, stack, finished) {
  if (finished.has(session.fileName)) {
    return null;
  }

  const position = stack.findIndex((path) => path === session.fileName);

  if (position >= 0) {
    return [...stack.slice(position), session.fileName];
  }

  const nextStack = [...stack, session.fileName];

  for (const name of importsForSession(session)) {
    const path = resolveImportPath(workspace, session.fileName, name);
    const dependency = workspace.files.find((candidate) => candidate.fileName === path);

    if (!dependency) {
      continue;
    }

    const cycle = findImportCycle(workspace, dependency, nextStack, finished);

    if (cycle) {
      return cycle;
    }
  }

  finished.add(session.fileName);
  return null;
}

function importedAnchorWarnings(session, dependencies, workspace) {
  const warnings = [];

  for (const dependency of dependencies) {
    if (!dependency.path) {
      continue;
    }

    const parent = workspace.files.find((candidate) => candidate.fileName === dependency.path);

    if (!parent) {
      continue;
    }

    const available = anchorNames(parent.document.index);
    const anchorList = session.document.index.byPath.get(["(import)", dependency.name, "anchors"].join("\u0000"));

    for (const item of anchorList?.collectionItems ?? []) {
      const imported = parseImportedAnchor(item.source);

      if (imported && !available.has(imported.parentName)) {
        warnings.push(`Imported shared value “${imported.parentName}” is not defined in ${parent.fileName}.`);
      }
    }
  }

  return warnings;
}

function anchorNames(index) {
  const names = new Set();

  for (const entry of index.entries) {
    const ownName = parseAnchorName(entry.source);

    if (ownName) {
      names.add(ownName);
    }

    for (const item of entry.collectionItems ?? []) {
      const itemName = parseAnchorName(item.source);

      if (itemName) {
        names.add(itemName);
      }
    }
  }

  return names;
}

function filesBelongTogether(leftPath, rightPath) {
  if (linkedConfigurationReason(leftPath, rightPath)) {
    return true;
  }

  const left = domainIdentity(leftPath);
  const right = domainIdentity(rightPath);

  return Boolean(left && right && left.family === right.family && left.name === right.name && left.gui !== right.gui);
}

function relatedReason(sourcePath, targetPath) {
  const linked = linkedConfigurationReason(sourcePath, targetPath);

  if (linked) {
    return linked;
  }

  return domainIdentity(targetPath)?.gui ? "Related inventory menu" : "Related gameplay settings";
}

function linkedConfigurationReason(sourcePath, targetPath) {
  const source = normalizedPath(sourcePath);
  const target = normalizedPath(targetPath);

  for (const link of CONFIGURATION_MENU_LINKS) {
    const sourceIsConfig = coreConfiguration(source, link.config);
    const targetIsConfig = coreConfiguration(target, link.config);

    if (sourceIsConfig && link.menu.test(target)) {
      return link.menuReason;
    }

    if (targetIsConfig && link.menu.test(source)) {
      return link.configReason;
    }
  }

  return "";
}

function coreConfiguration(path, fileName) {
  return !isGuiPath(path) && basename(path).toLocaleLowerCase("en-US") === fileName;
}

function domainIdentity(path) {
  const segments = pathSegments(path);
  const guiIndex = segments.indexOf("guis");
  const gui = guiIndex >= 0;
  const start = gui ? guiIndex + 2 : 0;
  const familyIndex = segments.findIndex((segment, index) => index >= start && ["structures", "turrets"].includes(segment));

  if (familyIndex < 0 || familyIndex + 1 >= segments.length) {
    return null;
  }

  const family = segments[familyIndex];
  const tail = segments.slice(familyIndex + 1);
  const name = tail[0].replace(/\.ya?ml$/i, "");

  if (!gui && tail.length !== 1) {
    return null;
  }

  if (gui && tail.length > 1) {
    const fileName = tail.at(-1).replace(/\.ya?ml$/i, "");

    if (tail.length !== 2 || fileName !== name) {
      return null;
    }
  }

  return { family, name, gui };
}

function pathSegments(path) {
  return String(path).replaceAll("\\", "/").split("/").filter(Boolean).map((segment) => segment.toLocaleLowerCase("en-US"));
}

function guiLanguage(path) {
  const segments = pathSegments(path);
  const guiIndex = segments.indexOf("guis");

  return guiIndex >= 0 ? segments[guiIndex + 1] ?? "" : "";
}

function basename(path) {
  return String(path).replaceAll("\\", "/").split("/").at(-1) ?? "";
}

function normalizedPath(path) {
  return String(path).replaceAll("\\", "/");
}

function isGuiPath(path) {
  return /(?:^|\/)guis\//i.test(normalizedPath(path));
}

function directChildren(index, parentPath) {
  return index.entries.filter((entry) =>
    entry.path.length === parentPath.length + 1 && startsWith(entry.path, parentPath)
  );
}

function startsWith(path, prefix) {
  return prefix.every((segment, index) => path[index] === segment);
}

function scalarValue(index, path) {
  const entry = index.byPath.get(pathKey(path));

  return entry && !entry.container ? String(parseSimpleLiteral(entry.source).value ?? "") : "";
}

function simpleValue(source) {
  return String(parseSimpleLiteral(String(source)).value ?? "");
}

function normalizeIdentifier(value) {
  return String(value).trim().replaceAll(/[-\s]+/g, "_").toLocaleUpperCase("en-US");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueByPath(items) {
  const seen = new Set();

  return items.filter((item) => {
    if (!item.path || seen.has(item.path)) {
      return false;
    }

    seen.add(item.path);
    return true;
  });
}
