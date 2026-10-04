import { evaluateExpressionWithSteps } from "./expression-evaluator.js";
import { evaluateCondition, sampleConditionValue } from "./condition-evaluator.js";
import {
  CONDITION_OPERATOR_GROUPS,
  EXPRESSION_PLACEHOLDER_GROUPS,
  MATH_FUNCTION_GROUPS,
  MATH_OPERATOR_GROUPS
} from "./language-catalog.js";
import { insertionLibrary } from "./insertion-library.js";
import { DURATION_UNITS } from "./value-controls.js";

let labeledControlId = 0;

const VARIABLE_HELP = {
  lvl: "Current upgrade level",
  level: "Current level",
  amount: "Configured or current amount",
  damage: "Base damage",
  distance: "Distance involved in this action",
  kingdoms_kingdom_level: "Current kingdom level",
  kingdoms_members: "Current kingdom member count"
};

const PRIMARY_MATH_OPS = MATH_OPERATOR_GROUPS[0][1].filter(([label]) => !["[time]"].includes(label));
const ADVANCED_MATH_OPS = [
  ...MATH_OPERATOR_GROUPS[0][1].filter(([label]) => label === "[time]"),
  ...MATH_OPERATOR_GROUPS[1][1]
];
const PRIMARY_CONDITION_OPS = CONDITION_OPERATOR_GROUPS[0][1].filter(([label]) => [
  "AND", "OR", "NOT", "==", "!=", ">", "<", ">=", "<=", "( )"
].includes(label));
const ADVANCED_CONDITION_OPS = [
  ...CONDITION_OPERATOR_GROUPS[0][1].filter(([label]) => ["else", "true", "false"].includes(label)),
  ...CONDITION_OPERATOR_GROUPS[1][1]
];

function analyzeExpression(source) {
  const value = String(source ?? "");
  let searchable = value.replace(/'(?:[^']|'')*'|"(?:[^"\\]|\\.)*"/g, " ");
  const bracedVariables = [];
  searchable = searchable.replace(/\{\s*([^{}]+?)\s*}/g, (_token, name) => {
    const marker = `KINGDOMSXBRACED${bracedVariables.length}`;
    bracedVariables.push(name);
    return ` ${marker} `;
  });
  const templateVariables = [...searchable.matchAll(/(?:\[\s*)?<([A-Za-z_][A-Za-z0-9_-]*)>(?:\s*])?/g)]
    .map((match) => match[1]);
  searchable = searchable.replace(/(?:\[\s*)?<([A-Za-z_][A-Za-z0-9_-]*)>(?:\s*])?/g, " ");
  const functions = unique([...searchable.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map((match) => match[1]));
  const functionSet = new Set(functions);
  const variables = unique([...templateVariables, ...[...searchable.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)]
    .map((match) => {
      const marker = /^KINGDOMSXBRACED(\d+)$/.exec(match[0]);

      return marker ? bracedVariables[Number(marker[1])] : match[0];
    })
    .filter((name) => !functionSet.has(name) && !["true", "false", "null", "else"].includes(name.toLowerCase()))]);

  return { functions, variables };
}

export function expressionAssist(input, language, onInput = () => {}, suggestedSource = "") {
  const kind = language === "condition" ? "condition" : "math";
  const root = element("div", "editor-expression-assist d-grid gap-2");
  const heading = element("div", "editor-expression-assist-heading d-flex align-items-center gap-2");
  const icon = element("span", "editor-expression-assist-icon place-items-center d-grid flex-shrink-0");
  icon.append(element("i", kind === "condition" ? "fa-solid fa-code-branch" : "fa-solid fa-calculator"));
  const headingCopy = element("span", "d-grid");
  headingCopy.append(
    element("strong", "editor-small-heading", kind === "condition" ? "Condition tools" : "Formula tools"),
    element("small", "", "Insert common syntax or open the full library.")
  );
  heading.append(icon, headingCopy);

  const context = element("details", "editor-expression-assist-context editor-expression-assist-drawer editor-details-disclosure");
  const contextSummary = element("summary");
  const contextBody = element("div", "d-flex flex-wrap gap-1 mt-2");
  context.append(contextSummary, contextBody);
  const renderContext = () => {
    const current = analyzeExpression(input.value);
    const suggested = analyzeExpression(suggestedSource);
    const variables = unique([...current.variables, ...suggested.variables]);
    const functions = unique([...current.functions, ...suggested.functions]);

    if (!variables.length && !functions.length) {
      context.hidden = true;
      return;
    }

    context.hidden = false;
    contextSummary.textContent = kind === "condition" ? "Values for this condition" : "Values for this formula";
    const tokens = [];

    for (const name of variables) {
      tokens.push(tokenButton(
        name,
        VARIABLE_HELP[name] || "Value available in this setting",
        "variable",
        () => insertSnippet(input, name, onInput)
      ));
    }

    for (const name of functions) {
      tokens.push(tokenButton(
        `${name}()`,
        "Function already used in this expression",
        "function",
        () => insertSnippet(input, `${name}()`, onInput)
      ));
    }

    contextBody.replaceChildren(...tokens);
  };
  input.addEventListener("input", renderContext);
  renderContext();

  const common = element("div", "editor-expression-assist-common d-grid gap-1");
  const ops = element("div", "d-flex flex-wrap gap-1");
  ops.setAttribute("role", "toolbar");
  ops.setAttribute("aria-label", kind === "condition" ? "Common condition operators" : "Common math operators");
  const primary = kind === "condition" ? PRIMARY_CONDITION_OPS : PRIMARY_MATH_OPS;

  for (const [buttonLabel, value, help] of primary) {
    ops.append(insertButton(buttonLabel, help, () => insertSnippet(input, value, onInput)));
  }

  common.append(element("span", "editor-muted-eyebrow", "Common operators"), ops);

  const libraries = [];
  const advancedOps = kind === "condition" ? ADVANCED_CONDITION_OPS : ADVANCED_MATH_OPS;

  if (advancedOps.length) {
    libraries.push(["More operators", [["Operators", advancedOps]]]);
  }

  if (kind === "math") {
    libraries.push([
      "Functions",
      MATH_FUNCTION_GROUPS,
      "These functions are available in Kingdoms math fields."
    ]);
  }

  libraries.push([
    "Placeholders",
    EXPRESSION_PLACEHOLDER_GROUPS,
    "Do not wrap placeholders in % signs here. Which ones resolve depends on this setting."
  ]);

  root.append(heading, common, context, insertionLibrary({
    libraries,
    summary: kind === "condition" ? "Open condition library" : "Open formula library",
    searchLabel: "Search functions and placeholders",
    onInsert: (value) => insertSnippet(input, value, onInput)
  }));

  return root;
}

export function expressionCalculator(input) {
  const root = element("section", "editor-expression-sample rounded-3 p-3 d-grid gap-3");
  const heading = element("div", "d-grid gap-1");
  heading.append(
    element("h3", "editor-expression-sample-title mb-0", "Try this formula"),
    element("p", "editor-expression-sample-help mb-0", "Enter example values to see the result before saving.")
  );
  const controls = element("div", "editor-expression-sample-controls d-grid gap-2");
  const result = element("div", "editor-expression-sample-result rounded-3 p-3");
  const resultLabel = element("span", "editor-muted-eyebrow d-block", "Sample result");
  const resultValue = element("strong", "editor-expression-sample-result-value d-block mt-1");
  result.append(resultLabel, resultValue);
  const steps = element("details", "editor-expression-sample-steps editor-details-disclosure");
  const stepList = element("ol", "d-grid gap-1 mb-0 mt-2 ps-4");
  steps.append(element("summary", "", "Show calculation steps"), stepList);
  const samples = new Map();

  const calculate = () => {
    const variables = Object.fromEntries([...samples].map(([name, field]) => [name, Number(field.value)]));
    const evaluated = evaluateExpressionWithSteps(input.value, variables);

    result.classList.toggle("is-error", Boolean(evaluated.problem));
    resultLabel.textContent = evaluated.problem ? "Cannot calculate this sample" : "Sample result";
    resultValue.textContent = evaluated.problem || formatResult(evaluated.value, evaluated.resultType);
    stepList.replaceChildren(...evaluated.steps.map((step) => element("li", "", step)));
    steps.hidden = Boolean(evaluated.problem) || evaluated.steps.length === 0;
  };

  const render = () => {
    const names = analyzeExpression(input.value).variables;

    for (const name of [...samples.keys()]) {
      if (!names.includes(name)) {
        samples.delete(name);
      }
    }

    for (const name of names) {
      if (samples.has(name)) {
        continue;
      }

      const field = element("input", "form-control editor-input");
      field.type = "number";
      field.step = "any";
      field.value = /^(?:lvl|level)$/.test(name) ? "1" : "100";
      field.setAttribute("aria-label", `Sample value for ${name}`);
      field.addEventListener("input", calculate);
      samples.set(name, field);
    }

    controls.replaceChildren(...names.map((name) => labeledControl(name, samples.get(name))));
    calculate();
  };

  input.addEventListener("input", render);
  render();
  root.append(heading, controls, result, steps);

  return root;
}

export function conditionCalculator(input) {
  const root = element("section", "editor-expression-sample rounded-3 p-3 d-grid gap-3");
  const heading = element("div", "d-grid gap-1");
  heading.append(
    element("h3", "editor-expression-sample-title mb-0", "Try a situation"),
    element("p", "editor-expression-sample-help mb-0", "Enter example values to check whether this condition passes.")
  );
  const controls = element("div", "editor-expression-sample-controls d-grid gap-2");
  const result = element("div", "editor-expression-sample-result rounded-3 p-3");
  const samples = new Map();

  const calculate = () => {
    const variables = Object.fromEntries([...samples].map(([name, field]) => [name, sampleConditionValue(field.value)]));
    const evaluated = evaluateCondition(input.value, variables);

    result.classList.toggle("is-error", Boolean(evaluated.problem));
    result.textContent = evaluated.problem || (evaluated.value ? "This sample passes the condition." : "This sample does not pass the condition.");
  };

  const render = () => {
    const names = analyzeExpression(input.value).variables;

    for (const name of [...samples.keys()]) {
      if (!names.includes(name)) {
        samples.delete(name);
      }
    }

    for (const name of names) {
      if (samples.has(name)) {
        continue;
      }

      const field = element("input", "form-control editor-input");
      field.type = "text";
      field.value = /^(?:lvl|level|amount|count)$/i.test(name) ? "1" : "true";
      field.setAttribute("aria-label", `Sample value for ${name}`);
      field.addEventListener("input", calculate);
      samples.set(name, field);
    }

    controls.replaceChildren(...names.map((name) => labeledControl(name, samples.get(name))));
    calculate();
  };

  input.addEventListener("input", render);
  render();
  root.append(heading, controls, result);

  return root;
}

function tokenButton(label, help, kind, onClick) {
  const functionClass = kind === "function" ? " editor-expression-token--function" : "";
  const node = element("button", `editor-pill fw-bold text-nowrap editor-expression-token${functionClass} d-inline-flex align-items-center`, label);
  node.type = "button";
  node.title = help;
  node.setAttribute("aria-label", `Insert ${label}: ${help}`);
  node.addEventListener("click", onClick);
  return node;
}

function labeledControl(label, control) {
  const root = element("div", "form-floating editor-floating");
  const id = control.id || `editor-expression-sample-${++labeledControlId}`;
  control.id = id;
  control.placeholder = label;
  const fieldLabel = element("label", "", label);
  fieldLabel.htmlFor = id;
  root.append(control, fieldLabel);
  return root;
}

function unique(values) {
  return [...new Set(values)];
}

function formatResult(value, resultType) {
  if (resultType === "duration") {
    return formatDurationResult(value);
  }

  return Number.isInteger(value) ? value.toLocaleString() : Number(value.toFixed(6)).toLocaleString();
}

function formatDurationResult(milliseconds) {
  if (milliseconds === 0) {
    return "0 milliseconds";
  }

  for (const unit of DURATION_UNITS) {
    const amount = milliseconds / unit.milliseconds;

    if (!Number.isInteger(amount)) {
      continue;
    }

    const label = Math.abs(amount) === 1 ? unit.value.replace(/s$/, "") : unit.value;

    return `${amount.toLocaleString()} ${label}`;
  }

  return `${Number(milliseconds.toFixed(6)).toLocaleString()} milliseconds`;
}

function insertButton(label, help, onClick) {
  const node = element("button", "editor-expression-op", label);
  node.type = "button";
  node.title = help;
  node.setAttribute("aria-label", `Insert ${help.toLocaleLowerCase("en-US")}`);
  node.addEventListener("click", onClick);
  return node;
}

function insertSnippet(input, value, afterInsert = () => {}) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;

  input.setRangeText(value, start, end, "end");

  const opening = value.indexOf("(");

  if (opening !== -1) {
    input.setSelectionRange(start + opening + 1, start + opening + 1);
  }

  input.focus();
  afterInsert();
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
