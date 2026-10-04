import { buildGuiPreview } from "./gui-preview.js";
import { unwrapNullable } from "./schema-types.js";
import { parseSimpleLiteral } from "./yaml-source.js";
import { customYamlWarnings } from "./kingdoms-yaml-validation.js";

export function semanticWarnings({ index, schemaId = "", sections = [] }) {
  const warnings = [];
  warnings.push(...customYamlWarnings(index));
  validateNumericBounds(sections, warnings);
  validateSetDuplicates(sections, warnings);
  validateElseOrder(index, sections, warnings);

  if (schemaId === "guis/schema") {
    validateGui(index, warnings);
  }

  if (schemaId === "relations") {
    validateRelations(index, warnings);
  }

  if (schemaId === "invasions") {
    validateInvasions(index, warnings);
  }

  if (schemaId === "turrets") {
    validateTurrets(index, warnings);
  }

  if (schemaId === "structures") {
    validateBuildingLimits(index, warnings, "Structure");
  }

  if (schemaId === "addons/outposts") {
    validateOutposts(index, warnings);
  }

  return [...new Set(warnings)];
}

function validateOutposts(index, warnings) {
  const outposts = index.entries.filter((entry) => entry.path.length === 1 && entry.container);

  for (const outpost of outposts) {
    for (const path of [
      [...outpost.path, "spawn"],
      [...outpost.path, "center"]
    ]) {
      validateOutpostLocation(index, path, warnings);
    }

    for (const entry of index.entries.filter((candidate) =>
      candidate.path.length === 4
        && candidate.path[0] === outpost.key
        && candidate.path[1] === "arena-mobs"
        && candidate.path[3] === "spawn-location"
    )) {
      validateOutpostLocation(index, entry.path, warnings);
    }
  }
}

function validateOutpostLocation(index, path, warnings) {
  const value = scalarValue(index, path).trim();

  if (!value) {
    return;
  }

  const parts = value.split(",").map((part) => part.trim());
  const valid = parts.length === 6
    && parts[0].length > 0
    && parts.slice(1).every((part) => part.length > 0 && Number.isFinite(Number(part)));

  if (!valid) {
    warnings.push(`${path.join(" → ")} needs world,x,y,z,yaw,pitch, for example world,120.5,64,-32.5,90,0.`);
  }
}

function validateTurrets(index, warnings) {
  validateBuildingLimits(index, warnings, "Turret");

  const accuracy = numberValue(index, ["accuracy"]);

  if (accuracy >= 1 && accuracy <= 5) {
    warnings.push("Turret accuracy caching between 1 and 5 ticks adds overhead without a useful performance benefit. Use 0 for instant updates or at least 6 ticks.");
  }

  const updateTicks = numberValue(index, ["update-ticks"]);

  if (updateTicks > 20) {
    warnings.push(`Turrets update every ${updateTicks} ticks (${formatSeconds(updateTicks / 20)} seconds). This multiplies every turret cooldown and may make turrets feel unresponsive.`);
  }

  for (const entry of index.entries.filter((candidate) =>
    candidate.path.length === 4
      && candidate.path[0] === "effects"
      && candidate.path[2] === "particles"
      && candidate.path[3] === "count"
  )) {
    const count = Number(parseSimpleLiteral(entry.source).value);

    if (count > 100) {
      warnings.push(`${entry.path.join(" → ")} creates ${count} particles for one effect event. Test this under realistic turret load.`);
    }
  }
}

function validateBuildingLimits(index, warnings, label) {
  const total = numberValue(index, ["limits", "total"]);
  const perLand = numberValue(index, ["limits", "per-land"]);

  if (Number.isFinite(total) && total < -1) {
    warnings.push(`${label} total limit uses ${total}. Use -1 or 0 for unlimited, or a positive limit.`);
  }

  if (Number.isFinite(perLand) && perLand < -1) {
    warnings.push(`${label} per-land limit uses ${perLand}. Use -1 or 0 for unlimited, or a positive limit.`);
  }

  if (total > 0 && perLand > total) {
    warnings.push(`${label} per-land limit (${perLand}) is above the kingdom-wide total (${total}), so the per-land value can never be reached.`);
  }
}

function validateRelations(index, warnings) {
  const pvpMode = scalarValue(index, ["pvp"]);
  const advanced = scalarValue(index, ["pvp-advanced"]).trim();

  if (pvpMode === "conditional" && !advanced) {
    warnings.push("PvP mode is Conditional, but the advanced PvP condition is empty. Add a condition that decides when players may fight.");
  }

  const relationModes = index.entries.filter((entry) =>
    entry.path.length === 3
      && entry.path[0] === "relations"
      && entry.path[2] === "pvp"
  );

  if (pvpMode !== "relational" && relationModes.length) {
    warnings.push(`PvP rules inside individual relations are ignored while the main PvP mode is ${pvpMode || "not configured"}. Choose Relational mode to use them.`);
  }
}

function validateInvasions(index, warnings) {
  const radius = numberValue(index, ["adjoining-protection", "radius"]);
  const tolerance = numberValue(index, ["adjoining-protection", "marginal-error-limit"]);

  if (radius === 0 && tolerance > 0) {
    warnings.push("Adjoining protection is disabled because its radius is 0, so its missing-land tolerance currently has no effect.");
  } else if (radius > 0 && tolerance >= 0) {
    const surroundingLands = (radius * 2 + 1) ** 2 - 1;

    if (tolerance >= surroundingLands) {
      warnings.push(`Adjoining protection allows ${tolerance} missing surrounding lands, but radius ${radius} has only ${surroundingLands}. This can protect every claimed land from invasion.`);
    }
  }

  if (booleanValue(index, ["plunder", "enabled"])
    && booleanValue(index, ["plunder", "continue-if-champion-dies"])
    && booleanValue(index, ["plunder", "keep-champion"]) === false) {
    warnings.push("Continue after the champion dies is enabled, but Keep champion is disabled. Enable Keep champion or this option has no effect.");
  }
}

function validateSetDuplicates(sections, warnings) {
  for (const field of allFields(sections)) {
    if (unwrapNullable(field.type)?.kind !== "set" || !field.entry.collectionItems) {
      continue;
    }

    const values = field.entry.collectionItems.map((item) => String(parseSimpleLiteral(item.source).value ?? ""));
    const duplicates = [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];

    if (duplicates.length) {
      warnings.push(`${field.path.join(" → ")} contains duplicate values: ${duplicates.join(", ")}.`);
    }
  }
}

function validateElseOrder(index, sections, warnings) {
  const conditionalOutputPaths = new Set(allOwners(sections)
    .filter((owner) =>
      owner.keyType?.kind === "expression"
        && owner.keyType.language === "condition"
        && owner.keyType.allowFallback
    )
    .map((owner) => owner.path.join("\u0000")));
  const groups = new Map();

  for (const entry of index.entries) {
    const parent = entry.path.slice(0, -1);
    const key = parent.join("\u0000");

    if (!groups.has(key)) {
      groups.set(key, { path: parent, entries: [] });
    }

    groups.get(key).entries.push(entry);
  }

  for (const group of groups.values()) {
    const direct = group.entries.filter((entry) => entry.path.length === group.path.length + 1);
    const elseIndex = direct.findIndex((entry) => entry.key === "else");

    if (elseIndex < 0 || elseIndex === direct.length - 1) {
      continue;
    }

    const conditionMapping = conditionalOutputPaths.has(group.path.join("\u0000"))
      || group.path.some((segment) => /conditions?/i.test(segment));
    const laterConditionalVariant = direct.slice(elseIndex + 1)
      .some((entry) => index.byPath.has([...entry.path, "condition"].join("\u0000")));

    if (conditionMapping || laterConditionalVariant) {
      warnings.push(`${group.path.join(" → ")} has an Else branch before another branch. Move Else to the end.`);
    }
  }
}

function validateNumericBounds(sections, warnings) {
  for (const field of allFields(sections)) {
    const type = unwrapNullable(field.type);

    if (!type || !["integer", "decimal"].includes(type.kind)) {
      continue;
    }

    const value = Number(parseSimpleLiteral(field.entry.source).value);

    if (!Number.isFinite(value)) {
      continue;
    }

    const label = field.path.join(" → ");

    if (Number.isFinite(type.minimum) && value < type.minimum) {
      warnings.push(`${label} is ${value}. Use ${type.minimum} or more.`);
    }

    if (Number.isFinite(type.maximum) && value > type.maximum) {
      warnings.push(`${label} is ${value}. Use ${type.maximum} or less.`);
    }
  }
}

function validateGui(index, warnings) {
  const preview = buildGuiPreview(index);

  for (const collision of preview.collisions) {
    warnings.push(`Inventory slot ${collision.slot} is used by ${collision.options.map((option) => option.label).join(" and ")}.`);
  }

  for (const invalid of preview.invalid) {
    warnings.push(`${invalid.option.label} uses slot ${invalid.slot}, which is outside this ${preview.columns} × ${preview.rows} inventory.`);
  }

  for (const option of preview.options) {
    const optionEntries = directChildren(index, option.path);
    const hasX = optionEntries.some((entry) => entry.key === "posx");
    const hasY = optionEntries.some((entry) => entry.key === "posy");

    if (hasX !== hasY) {
      warnings.push(`${option.label} needs both a horizontal and vertical position.`);
    }
  }

  validateFormComponents(index, warnings);
}

function validateFormComponents(index, warnings) {
  const formPath = index.byPath.has("forms")
    ? ["forms"]
    : index.byPath.has("form")
      ? ["form"]
      : null;

  if (!formPath) {
    return;
  }

  for (const component of directChildren(index, [...formPath, "options"])) {
    const type = scalarValue(index, [...component.path, "component-type"]).toLocaleUpperCase("en-US");
    const label = component.path.join(" → ");

    if (type === "SLIDER") {
      const minimum = numberValue(index, [...component.path, "min"]);
      const maximum = numberValue(index, [...component.path, "max"]);
      const step = numberValue(index, [...component.path, "step"]);
      const fallback = numberValue(index, [...component.path, "default-value"]);

      if (Number.isFinite(minimum) && Number.isFinite(maximum) && minimum > maximum) {
        warnings.push(`${label} has a minimum above its maximum.`);
      }

      if (Number.isFinite(step) && step <= 0) {
        warnings.push(`${label} needs a step greater than 0.`);
      }

      if (Number.isFinite(fallback) && Number.isFinite(minimum) && Number.isFinite(maximum) && minimum <= maximum
        && (fallback < minimum || fallback > maximum)) {
        warnings.push(`${label} has a default value outside its ${minimum}–${maximum} range.`);
      }
    }

    if (["DROPDOWN", "STEP_SLIDER"].includes(type)) {
      const choices = index.byPath.get([...component.path, "steps"].join("\u0000"))?.collectionItems ?? [];
      const fallback = numberValue(index, [...component.path, "default-value"]);

      if (!choices.length) {
        warnings.push(`${label} needs at least one choice.`);
      } else if (Number.isInteger(fallback) && (fallback < 0 || fallback >= choices.length)) {
        warnings.push(`${label} uses default choice ${fallback}, but valid choice positions are 0–${choices.length - 1}.`);
      }
    }
  }
}

function allFields(sections) {
  const fields = [];
  const visit = (owner) => {
    fields.push(...owner.fields);
    owner.groups.forEach(visit);
  };
  sections.forEach(visit);
  return fields;
}

function allOwners(sections) {
  const owners = [];
  const visit = (owner) => {
    owners.push(owner);
    owner.groups?.forEach(visit);
  };
  sections.forEach(visit);
  return owners;
}

function directChildren(index, path) {
  return index.entries.filter((entry) =>
    entry.path.length === path.length + 1
      && path.every((segment, position) => entry.path[position] === segment)
  );
}

function scalarValue(index, path) {
  const entry = index.byPath.get(path.join("\u0000"));

  return entry && !entry.container ? String(parseSimpleLiteral(entry.source).value ?? "") : "";
}

function numberValue(index, path) {
  const value = Number(scalarValue(index, path));

  return Number.isFinite(value) ? value : Number.NaN;
}

function booleanValue(index, path) {
  const entry = index.byPath.get(path.join("\u0000"));
  const literal = entry && parseSimpleLiteral(entry.source);

  return literal?.kind === "boolean" ? literal.value : null;
}

function formatSeconds(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
