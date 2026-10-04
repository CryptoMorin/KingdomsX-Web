const decoder = new TextDecoder();

export function classFieldReferences(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (view.getUint32(0) !== 0xcafebabe) {
    throw new Error("Invalid JVM class file.");
  }

  let offset = 8;
  const constantCount = view.getUint16(offset);
  offset += 2;
  const constants = new Array(constantCount);

  for (let index = 1; index < constantCount; index += 1) {
    const tag = view.getUint8(offset);
    offset += 1;

    if (tag === 1) {
      const length = view.getUint16(offset);
      offset += 2;
      constants[index] = {
        tag,
        value: decoder.decode(bytes.subarray(offset, offset + length))
      };
      offset += length;
      continue;
    }

    if (tag === 3 || tag === 4) {
      constants[index] = { tag };
      offset += 4;
      continue;
    }

    if (tag === 5 || tag === 6) {
      constants[index] = { tag };
      offset += 8;
      index += 1;
      continue;
    }

    if ([7, 8, 16, 19, 20].includes(tag)) {
      constants[index] = { tag, index: view.getUint16(offset) };
      offset += 2;
      continue;
    }

    if ([9, 10, 11, 12, 17, 18].includes(tag)) {
      constants[index] = {
        tag,
        first: view.getUint16(offset),
        second: view.getUint16(offset + 2)
      };
      offset += 4;
      continue;
    }

    if (tag === 15) {
      constants[index] = { tag };
      offset += 3;
      continue;
    }

    throw new Error(`Unsupported JVM constant-pool tag ${tag}.`);
  }

  const utf8 = (index) => constants[index]?.value;
  const className = (index) => utf8(constants[index]?.index);
  const references = [];

  for (const constant of constants) {
    if (constant?.tag !== 9) {
      continue;
    }

    const nameAndType = constants[constant.second];
    references.push({
      className: className(constant.first),
      field: utf8(nameAndType?.first),
      descriptor: utf8(nameAndType?.second)
    });
  }

  return references;
}

export function kingdomsConfigFieldUsage(classFiles) {
  const usage = new Map();
  const enumClass = /^org\/kingdoms\/config\/KingdomsConfig(?:\$[^$]+)?$/;
  const enumFile = /^org\/kingdoms\/config\/KingdomsConfig(?:\$[^$]+)?\.class$/;

  for (const [fileName, bytes] of Object.entries(classFiles)) {
    if (!fileName.endsWith(".class") || enumFile.test(fileName)) {
      continue;
    }

    const consumer = fileName.replace(/\.class$/, "");

    for (const reference of classFieldReferences(bytes)) {
      if (!enumClass.test(reference.className)) {
        continue;
      }

      const key = `${reference.className}#${reference.field}`;
      const consumers = usage.get(key) ?? new Set();
      consumers.add(consumer);
      usage.set(key, consumers);
    }
  }

  return usage;
}
