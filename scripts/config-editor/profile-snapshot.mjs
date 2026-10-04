export function buildProfileSignature(index) {
  const rootKeys = new Set();
  const paths = new Set();

  for (const entry of index.entries) {
    rootKeys.add(entry.path[0]);
    paths.add(entry.path.slice(0, 2).join("\u0000"));
  }

  return {
    entryCount: index.entries.length,
    rootKeys: [...rootKeys].sort((left, right) => left.localeCompare(right)),
    paths: [...paths].sort((left, right) => left.localeCompare(right))
  };
}

export function profileOption(entry) {
  return {
    path: entry.path,
    source: entry.source,
    comments: entry.comments,
    container: entry.container,
    emptyMapping: entry.emptyMapping,
    complexSequence: entry.complexSequence,
    collectionItems: entry.collectionItems?.map(({ source }) => source) ?? null
  };
}

export function profileFileName(resourceName) {
  const name = resourceName.replace(/\.ya?ml$/i, "");

  return `default--${safeFileName(name)}.json`;
}

export function safeFileName(value) {
  return value.replaceAll("/", "__").replace(/[^a-zA-Z0-9_.-]/g, "-");
}
