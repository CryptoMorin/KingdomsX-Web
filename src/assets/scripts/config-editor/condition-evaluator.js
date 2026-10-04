export function evaluateCondition(source, variables = {}) {
  try {
    const parser = new ConditionParser(tokenize(source), variables);
    const value = parser.or();
    parser.expect("end");

    return { value: Boolean(value), problem: "" };
  } catch (error) {
    return { value: null, problem: error.message };
  }
}

export function sampleConditionValue(source) {
  const value = String(source).trim();

  if (/^(?:true|false)$/i.test(value)) {
    return value.toLowerCase() === "true";
  }

  if (value && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return value;
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

    const bracedPlaceholder = /^\{\s*([^{}]+?)\s*}/.exec(rest);

    if (bracedPlaceholder) {
      tokens.push({ kind: "identifier", value: bracedPlaceholder[1] });
      index += bracedPlaceholder[0].length;
      continue;
    }

    const operator = /^(?:&&|\|\||==|!=|>=|<=|>|<|!|\(|\))/.exec(rest);

    if (operator) {
      tokens.push({ kind: operator[0], value: operator[0] });
      index += operator[0].length;
      continue;
    }

    const quoted = /^(?:'([^']|'')*'|"(?:[^"\\]|\\.)*")/.exec(rest);

    if (quoted) {
      const quote = quoted[0][0];
      const content = quoted[0].slice(1, -1);
      tokens.push({
        kind: "value",
        value: quote === "'" ? content.replaceAll("''", "'") : content.replace(/\\(["\\])/g, "$1")
      });
      index += quoted[0].length;
      continue;
    }

    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(rest);

    if (number) {
      tokens.push({ kind: "value", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }

    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);

    if (identifier) {
      const normalized = identifier[0].toLowerCase();
      const literal = normalized === "true" ? true : normalized === "false" ? false : null;
      tokens.push(literal === null
        ? { kind: "identifier", value: identifier[0] }
        : { kind: "value", value: literal });
      index += identifier[0].length;
      continue;
    }

    throw new Error(`Sample check does not yet support “${value[index]}”.`);
  }

  tokens.push({ kind: "end", value: "" });
  return tokens;
}

class ConditionParser {
  constructor(tokens, variables) {
    this.tokens = tokens;
    this.variables = variables;
    this.position = 0;
  }

  or() {
    let value = this.and();

    while (this.current().kind === "||") {
      this.take();
      const right = this.and();
      value = Boolean(value) || Boolean(right);
    }

    return value;
  }

  and() {
    let value = this.equality();

    while (this.current().kind === "&&") {
      this.take();
      const right = this.equality();
      value = Boolean(value) && Boolean(right);
    }

    return value;
  }

  equality() {
    let value = this.comparison();

    while (["==", "!="].includes(this.current().kind)) {
      const operator = this.take().kind;
      const right = this.comparison();
      value = operator === "==" ? value === right : value !== right;
    }

    return value;
  }

  comparison() {
    let value = this.unary();

    while ([">", ">=", "<", "<="].includes(this.current().kind)) {
      const operator = this.take().kind;
      const right = this.unary();

      if (operator === ">") {
        value = value > right;
      } else if (operator === ">=") {
        value = value >= right;
      } else if (operator === "<") {
        value = value < right;
      } else {
        value = value <= right;
      }
    }

    return value;
  }

  unary() {
    if (this.current().kind !== "!") {
      return this.primary();
    }

    this.take();
    return !this.unary();
  }

  primary() {
    const token = this.current();

    if (token.kind === "value") {
      return this.take().value;
    }

    if (token.kind === "identifier") {
      const name = this.take().value;

      if (this.current().kind === "(") {
        throw new Error(`Sample check does not yet support ${name}().`);
      }

      if (!Object.hasOwn(this.variables, name)) {
        throw new Error(`Enter a sample value for ${name}.`);
      }

      return this.variables[name];
    }

    if (token.kind === "(") {
      this.take();
      const value = this.or();
      this.expect(")");
      return value;
    }

    throw new Error("Enter a complete condition before checking a sample.");
  }

  current() {
    return this.tokens[this.position];
  }

  take() {
    return this.tokens[this.position++];
  }

  expect(kind) {
    if (this.current().kind !== kind) {
      throw new Error(`Expected ${kind === "end" ? "the end of the condition" : kind}.`);
    }

    return this.take();
  }
}
