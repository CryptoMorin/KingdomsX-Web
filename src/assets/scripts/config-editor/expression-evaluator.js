import { DURATION_UNITS } from "./value-controls.js";

const FUNCTIONS = {
  abs: (value) => Math.abs(value),
  ceil: (value) => Math.ceil(value),
  eq: conditional((left, right) => left === right),
  floor: (value) => Math.floor(value),
  ge: conditional((left, right) => left >= right),
  gt: conditional((left, right) => left > right),
  le: conditional((left, right) => left <= right),
  log: (value, base) => base === undefined ? Math.log(value) : Math.log(value) / Math.log(base),
  log2: (value) => Math.log2(value),
  log10: (value) => Math.log10(value),
  lt: conditional((left, right) => left < right),
  max: (...values) => Math.max(...values),
  min: (...values) => Math.min(...values),
  naturalSum: (value) => value * (value + 1) / 2,
  ne: conditional((left, right) => left !== right),
  percentOf: (percentage, value) => percentage / 100 * value,
  rint: (value) => Math.round(value),
  round: (value) => Math.round(value),
  sign: (value) => Math.sign(value),
  sqrt: (value) => Math.sqrt(value),
  whatPercentOf: (value, total) => value / total * 100
};

const DURATION_MILLISECONDS = new Map(DURATION_UNITS.flatMap((unit) =>
  unit.aliases.map((alias) => [alias, unit.milliseconds])
));

function conditional(predicate) {
  return (left, right, whenTrue, whenFalse) => predicate(left, right) ? whenTrue : whenFalse;
}

export function evaluateExpression(source, variables = {}) {
  const { value, problem } = evaluateExpressionWithSteps(source, variables);

  return { value, problem };
}

export function evaluateExpressionWithSteps(source, variables = {}) {
  try {
    const parser = new Parser(tokenize(source));
    const expression = parser.expression();
    parser.expect("end");

    let current = substituteValues(expression, variables);
    const steps = [renderExpression(current)];

    while (current.kind !== "number") {
      const simplified = simplifyOnce(current);

      if (!simplified.changed) {
        throw new Error("The sample calculation could not be simplified.");
      }

      current = simplified.node;
      const rendered = renderExpression(current);

      if (steps.at(-1) !== rendered) {
        steps.push(rendered);
      }
    }

    const value = current.value;

    if (!Number.isFinite(value)) {
      throw new Error("The sample result is not a finite number.");
    }

    return { value, resultType: current.duration ? "duration" : "number", problem: "", steps };
  } catch (error) {
    return { value: null, resultType: null, problem: error.message, steps: [] };
  }
}

function tokenize(source) {
  const tokens = [];
  const value = String(source);
  let index = 0;

  while (index < value.length) {
    const rest = value.slice(index);
    const whitespace = /^\s+/.exec(rest);

    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }

    const duration = /^\[\s*(\d+(?:\.\d*)?|\.\d+)\s*([A-Za-z]+)\s*]/.exec(rest);

    if (duration) {
      const multiplier = DURATION_MILLISECONDS.get(duration[2].toLocaleLowerCase("en-US"));

      if (!multiplier) {
        throw new Error(`Sample calculation does not recognize the time unit “${duration[2]}”.`);
      }

      tokens.push({
        kind: "number",
        value: Number(duration[1]) * multiplier,
        source: duration[0],
        duration: true
      });
      index += duration[0].length;
      continue;
    }

    const durationVariable = /^\[\s*<([A-Za-z_][A-Za-z0-9_-]*)>\s*]/.exec(rest);

    if (durationVariable) {
      tokens.push({ kind: "identifier", value: durationVariable[1], duration: true });
      index += durationVariable[0].length;
      continue;
    }

    const templateVariable = /^<([A-Za-z_][A-Za-z0-9_-]*)>/.exec(rest);

    if (templateVariable) {
      tokens.push({ kind: "identifier", value: templateVariable[1], duration: false });
      index += templateVariable[0].length;
      continue;
    }

    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(rest);

    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]), source: number[0], duration: false });
      index += number[0].length;
      continue;
    }

    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);

    if (identifier) {
      tokens.push({ kind: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }

    if ("+-*/%^(),".includes(value[index])) {
      tokens.push({ kind: value[index], value: value[index] });
      index += 1;
      continue;
    }

    throw new Error(`Sample calculation does not yet support “${value[index]}”.`);
  }

  tokens.push({ kind: "end", value: "" });
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.position = 0;
  }

  expression() {
    let node = this.term();

    while (["+", "-"].includes(this.current().kind)) {
      node = binary(this.take().kind, node, this.term());
    }

    return node;
  }

  term() {
    let node = this.power();

    while (["*", "/", "%"].includes(this.current().kind)) {
      node = binary(this.take().kind, node, this.power());
    }

    return node;
  }

  power() {
    const left = this.unary();

    if (this.current().kind !== "^") {
      return left;
    }

    this.take();
    return binary("^", left, this.power());
  }

  unary() {
    if (["+", "-"].includes(this.current().kind)) {
      return { kind: "unary", operator: this.take().kind, value: this.unary() };
    }

    return this.primary();
  }

  primary() {
    const token = this.current();

    if (token.kind === "number") {
      this.take();
      return { kind: "number", value: token.value, source: token.source, duration: token.duration };
    }

    if (token.kind === "(") {
      this.take();
      const node = this.expression();
      this.expect(")");
      return { ...node, grouped: true };
    }

    if (token.kind !== "identifier") {
      throw new Error("Enter a complete formula before calculating a sample.");
    }

    const name = this.take().value;

    if (this.current().kind !== "(") {
      return { kind: "variable", name, duration: token.duration };
    }

    this.take();
    const args = [];

    if (this.current().kind !== ")") {
      do {
        args.push(this.expression());
        if (this.current().kind !== ",") {
          break;
        }

        this.take();
      } while (true);
    }

    this.expect(")");
    return { kind: "call", name, args };
  }

  current() {
    return this.tokens[this.position];
  }

  take() {
    return this.tokens[this.position++];
  }

  expect(kind) {
    if (this.current().kind !== kind) {
      throw new Error(`Expected ${kind === "end" ? "the end of the formula" : kind}.`);
    }

    return this.take();
  }
}

function binary(operator, left, right) {
  return { kind: "binary", operator, left, right };
}

function substituteValues(node, variables) {
  if (node.kind === "number") {
    return numberNode(node.value, node.grouped, node.duration);
  }

  if (node.kind === "variable") {
    const value = Number(variables[node.name]);

    if (!Number.isFinite(value)) {
      throw new Error(`Enter a sample value for ${node.name}.`);
    }

    return numberNode(value, node.grouped, node.duration);
  }

  if (node.kind === "unary") {
    return {
      ...node,
      value: substituteValues(node.value, variables)
    };
  }

  if (node.kind === "binary") {
    return {
      ...node,
      left: substituteValues(node.left, variables),
      right: substituteValues(node.right, variables)
    };
  }

  const fn = FUNCTIONS[node.name];

  if (!fn) {
    throw new Error(`Sample calculation does not yet support ${node.name}().`);
  }

  return {
    ...node,
    args: node.args.map((argument) => substituteValues(argument, variables))
  };
}

function simplifyOnce(node) {
  if (node.kind === "number") {
    return { node, changed: false };
  }

  if (node.kind === "unary") {
    const child = simplifyOnce(node.value);

    if (child.changed) {
      return { node: { ...node, value: child.node }, changed: true };
    }

    const value = node.operator === "-" ? -node.value.value : node.value.value;

    return { node: numberNode(value, false, node.value.duration), changed: true };
  }

  if (node.kind === "binary") {
    const left = simplifyOnce(node.left);

    if (left.changed) {
      return { node: { ...node, left: left.node }, changed: true };
    }

    const right = simplifyOnce(node.right);

    if (right.changed) {
      return { node: { ...node, right: right.node }, changed: true };
    }

    return {
      node: numberNode(
        calculateBinary(node.operator, node.left.value, node.right.value),
        false,
        binaryReturnsDuration(node.operator, node.left, node.right)
      ),
      changed: true
    };
  }

  for (let index = 0; index < node.args.length; index += 1) {
    const argument = simplifyOnce(node.args[index]);

    if (!argument.changed) {
      continue;
    }

    const args = [...node.args];
    args[index] = argument.node;
    return { node: { ...node, args }, changed: true };
  }

  return {
    node: numberNode(
      FUNCTIONS[node.name](...node.args.map((argument) => argument.value)),
      false,
      functionReturnsDuration(node.name, node.args)
    ),
    changed: true
  };
}

function numberNode(value, grouped = false, duration = false) {
  return { kind: "number", value, grouped, duration };
}

function calculateBinary(operator, left, right) {
  if (operator === "+") {
    return left + right;
  }

  if (operator === "-") {
    return left - right;
  }

  if (operator === "*") {
    return left * right;
  }

  if (operator === "/") {
    return left / right;
  }

  if (operator === "%") {
    return left % right;
  }

  return left ** right;
}

function binaryReturnsDuration(operator, left, right) {
  if (["+", "-"].includes(operator)) {
    return left.duration || right.duration;
  }

  if (operator === "*") {
    return Boolean(left.duration) !== Boolean(right.duration);
  }

  if (operator === "/") {
    return Boolean(left.duration) && !right.duration;
  }

  if (operator === "%") {
    return Boolean(left.duration);
  }

  return Boolean(left.duration) && right.value === 1;
}

function functionReturnsDuration(name, args) {
  if (["abs", "ceil", "floor", "rint", "round"].includes(name)) {
    return Boolean(args[0]?.duration);
  }

  if (["min", "max"].includes(name)) {
    return args.some((argument) => argument.duration);
  }

  if (["eq", "ge", "gt", "le", "lt", "ne"].includes(name)) {
    return Boolean(args[2]?.duration || args[3]?.duration);
  }

  if (name === "percentOf") {
    return Boolean(args[1]?.duration);
  }

  return false;
}

function renderExpression(node, parent = null, side = "") {
  let rendered;

  if (node.kind === "number") {
    rendered = node.duration ? formatDurationResult(node.value) : formatNumber(node.value);
  } else if (node.kind === "unary") {
    rendered = `${node.operator}${renderExpression(node.value, node, "right")}`;
  } else if (node.kind === "call") {
    rendered = `${node.name}(${node.args.map((argument) => renderExpression(argument)).join(", ")})`;
  } else {
    rendered = `${renderExpression(node.left, node, "left")} ${node.operator} ${renderExpression(node.right, node, "right")}`;
  }

  return needsParentheses(node, parent, side) ? `(${rendered})` : rendered;
}

function needsParentheses(node, parent, side) {
  if (node.grouped && node.kind !== "number") {
    return true;
  }

  if (!parent || node.kind !== "binary") {
    return false;
  }

  const childPrecedence = precedence(node);
  const parentPrecedence = precedence(parent);

  if (childPrecedence < parentPrecedence) {
    return true;
  }

  if (childPrecedence > parentPrecedence) {
    return false;
  }

  if (side === "left") {
    return parent.operator === "^";
  }

  if (parent.operator === "+") {
    return node.operator === "-";
  }

  if (parent.operator === "*") {
    return node.operator === "/" || node.operator === "%";
  }

  return parent.operator !== "^" || node.operator !== "^";
}

function precedence(node) {
  if (node.kind === "binary") {
    if (["+", "-"].includes(node.operator)) {
      return 1;
    }

    if (["*", "/", "%"].includes(node.operator)) {
      return 2;
    }

    return 3;
  }

  if (node.kind === "unary") {
    return 4;
  }

  return 5;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : Number(value.toFixed(6)).toLocaleString("en-US");
}

function formatDurationResult(milliseconds) {
  if (!Number.isFinite(milliseconds)) {
    return String(milliseconds);
  }

  if (milliseconds === 0) {
    return "0 milliseconds";
  }

  for (const unit of DURATION_UNITS) {
    const amount = milliseconds / unit.milliseconds;

    if (!Number.isInteger(amount)) {
      continue;
    }

    const label = Math.abs(amount) === 1 ? unit.value.replace(/s$/, "") : unit.value;

    return `${formatNumber(amount)} ${label}`;
  }

  return `${formatNumber(milliseconds)} milliseconds`;
}
