import { labelForKey } from "./schema-options.js";
import { unwrapNullable } from "./schema-types.js";
import { attachRegistry, detachRegistry, registryForType } from "./spigot-registry.js";
import { expressionProblem } from "./kingdoms-yaml.js";
import { conditionCalculator, expressionAssist } from "./expression-assist.js";
import { readableCondition } from "./message-preview.js";
import { openRichValueDialog, richExpressionPreview, richValueTrigger } from "./rich-value-dialog.js";

const semanticDataLists = new Map();
let mappingKeyControlId = 0;

export function createMappingKeyControl({ path, keyType, value, onRename }) {
  if (isConditionKey(keyType) && !isFallbackKey(keyType, value)) {
    return conditionKeyControl({ path, keyType, value, onRename });
  }

  const root = element("div", "editor-key-control d-grid gap-2");
  const labelText = mappingKeyLabel(keyType, value);
  const input = element("input", "form-control editor-input editor-key-input w-100");
  input.type = "text";
  input.value = value;
  input.spellcheck = false;

  const inputControl = configureMappingKeyInput(input, keyType, path.at(-2));
  input.setAttribute("aria-label", labelText);

  const validateCondition = () => {
    if (!isConditionKey(keyType)) {
      return;
    }

    input.setCustomValidity(isFallbackKey(keyType, input.value) ? "" : expressionProblem(input.value, "condition"));
  };
  input.addEventListener("input", validateCondition);

  input.addEventListener("change", () => {
    const nextKey = input.value.trim();
    input.setCustomValidity(nextKey ? "" : "Enter a non-empty name.");

    if (!input.reportValidity() || nextKey === path.at(-1)) {
      return;
    }

    try {
      onRename(path, nextKey);
    } catch (error) {
      input.setCustomValidity(error.message);
      input.reportValidity();
    }
  });

  const field = element("div", "form-floating editor-floating");
  const id = input.id || `editor-mapping-key-${++mappingKeyControlId}`;
  input.id = id;
  const label = element("label", "", labelText);
  label.htmlFor = id;
  field.append(inputControl, label);
  root.append(field);

  const help = mappingKeyHelp(keyType, value);

  if (help) {
    root.append(element("small", "editor-control-hint", help));
  }

  return root;
}

function conditionKeyControl({ path, keyType, value, onRename }) {
  const root = element("div", "editor-key-control");
  const preview = richExpressionPreview(`When ${readableCondition(value)}`, "condition");
  const trigger = richValueTrigger("Edit condition", preview);
  trigger.addEventListener("click", () => {
    const content = element("div", "editor-rich-dialog-layout d-grid gap-3");
    const editor = element("div", "editor-rich-dialog-primary d-grid gap-2 min-w-0");
    const input = element("textarea", "form-control editor-input editor-input--expression");
    input.rows = 4;
    input.value = value;
    input.spellcheck = false;
    input.placeholder = "Example: kingdoms_members >= 5 && !pacifist";
    input.setAttribute("aria-label", "Condition");

    const validate = () => {
      const next = input.value.trim();
      input.setCustomValidity(next ? expressionProblem(next, "condition") : "Enter a condition.");
      return !input.validationMessage;
    };
    input.addEventListener("input", validate);
    editor.append(input);

    const tools = element("aside", "editor-rich-dialog-tools d-grid align-content-start gap-3 min-w-0");
    tools.append(expressionAssist(input, "condition", validate), conditionCalculator(input));
    content.append(editor, tools);

    openRichValueDialog({
      eyebrow: "Condition",
      title: "Edit condition",
      content,
      initialFocus: input,
      onSave: () => {
        if (!validate() || !input.reportValidity()) {
          return false;
        }

        const next = input.value.trim();

        if (next === value) {
          return true;
        }

        try {
          onRename(path, next);
          return true;
        } catch (error) {
          input.setCustomValidity(error.message);
          input.reportValidity();
          return false;
        }
      }
    });
  });
  root.append(trigger);
  return root;
}

export function configureMappingKeyInput(input, type, fallbackKey = "") {
  input.removeAttribute("list");
  input.removeAttribute("min");
  input.removeAttribute("max");
  input.removeAttribute("step");
  input.type = ["integer", "decimal"].includes(type?.kind) ? "number" : "text";

  if (type?.kind === "integer") {
    input.step = "1";
  }

  if (type?.kind === "decimal") {
    input.step = "any";
  }

  if (type?.minimum !== undefined) {
    input.min = String(type.minimum);
  }

  if (type?.maximum !== undefined) {
    input.max = String(type.maximum);
  }

  input.setAttribute("aria-label", mappingKeyLabel(type));

  const values = type?.values ?? [];
  const registry = registryForType(type, fallbackKey);

  if (values.length && !registry) {
    const id = semanticDataList(type, values);
    input.setAttribute("list", id);
    input.autocomplete = "off";
  }

  const inputControl = registry ? attachRegistry(input, registry) : detachRegistry(input);
  input.placeholder = registry
    ? `Search ${registry.typeName} values`
    : mappingKeyPlaceholder(type, fallbackKey);
  return inputControl;
}

export function mappingKeyLabel(type, value = "") {
  if (isFallbackKey(type, value)) {
    return "Fallback";
  }

  if (isConditionKey(type)) {
    return "Condition expression";
  }

  if (isEnchantKeyType(type)) {
    return "Enchant";
  }

  if (type?.typeName === "Material") {
    return "Item";
  }

  if (type?.kind === "integer") {
    return "Number";
  }

  if (type?.kind === "decimal") {
    return "Numeric value";
  }

  if (type?.typeName === "BuildingConditionAction") {
    return "Action name";
  }

  if (type?.typeName === "BuildingSoundStage") {
    return "Level or custom stage key";
  }

  if (type?.typeName === "BuildingSoundEvent") {
    return "Sound event name";
  }

  if (type?.typeName === "KingdomCommand") {
    return "Command ID";
  }

  return "Entry name";
}

export function mappingKeyHelp(type, value = "") {
  if (isFallbackKey(type, value)) {
    return "Optional output used only when none of the conditions above match. The fallback always belongs last.";
  }

  if (isConditionKey(type)) {
    return type.allowFallback
      ? "Conditions are checked from top to bottom. Edit the output used when this condition matches separately."
      : "Edit the condition here and its matching output separately.";
  }

  if (isEnchantKeyType(type)) {
    return "Choose the Minecraft enchantment to apply.";
  }

  if (type?.typeName === "Material") {
    return "Choose the Minecraft item material.";
  }

  if (type?.kind === "integer") {
    return "Enter a whole number.";
  }

  if (type?.kind === "decimal") {
    return "Enter a numeric value.";
  }

  if (type?.typeName === "BuildingSoundStage") {
    return "Each numbered stage applies until the next stage. For example, level 2 also covers later levels until another stage is added.";
  }

  if (type?.typeName === "BuildingSoundEvent") {
    return "Enter the sound event name used by this building.";
  }

  if (type?.typeName === "BuildingConditionAction") {
    return "Enter the building action checked by this condition group.";
  }

  if (type?.typeName === "KingdomCommand") {
    return "Use the command's main node name from /k admin cmd. Display names and aliases are edited in the language file.";
  }

  return "";
}

export function isEnchantKeyType(type) {
  return ["Enchant", "Enchantment"].includes(type?.typeName);
}

export function mappingValueLabelForKey(keyType, valueType) {
  const value = unwrapNullable(valueType);

  if (keyType?.typeName === "Material" && ["integer", "decimal"].includes(value?.kind)) {
    return "Value";
  }

  return "";
}

function mappingKeyPlaceholder(type, fallbackKey) {
  if (isConditionKey(type)) {
    return type.allowFallback
      ? "Condition expression, or else"
      : "e.g. kingdoms_members > 10";
  }

  if (type?.kind === "integer") {
    return "e.g. 10";
  }

  if (type?.kind === "decimal") {
    return "e.g. 1.5";
  }

  if (type?.typeName === "BuildingConditionAction") {
    return "e.g. purchase or upgrade";
  }

  if (type?.typeName === "BuildingSoundStage") {
    return "e.g. 1, 2, or a custom stage";
  }

  if (type?.typeName === "BuildingSoundEvent") {
    return "e.g. teleport-sound";
  }

  if (type?.typeName === "KingdomCommand") {
    return "e.g. claim or invite";
  }

  return fallbackKey ? `New ${labelForKey(fallbackKey).toLocaleLowerCase("en-US")}` : "New entry";
}

function isConditionKey(type) {
  return type?.kind === "expression" && type.language === "condition";
}

function isFallbackKey(type, value) {
  return isConditionKey(type) && type.allowFallback && String(value).trim() === "else";
}

function semanticDataList(type, values) {
  const key = `${type?.typeName ?? type?.kind ?? "values"}:${values.join("\u0000")}`;
  const existing = semanticDataLists.get(key);

  if (existing) {
    return existing;
  }

  const dataList = element("datalist");
  dataList.id = `editor-mapping-values-${semanticDataLists.size + 1}`;

  for (const value of values) {
    const option = element("option");
    option.value = String(value);
    dataList.append(option);
  }

  document.body.append(dataList);
  semanticDataLists.set(key, dataList.id);
  return dataList.id;
}

function element(tagName, className = "", text = "") {
  const node = document.createElement(tagName);

  if (className) {
    node.className = className;
  }

  if (text) {
    node.textContent = text;
  }

  return node;
}
