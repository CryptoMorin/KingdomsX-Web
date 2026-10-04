export function optionPathMarker(path) {
  return JSON.stringify(path);
}

export function findOptionTarget(container, optionPath) {
  const candidates = [...container.querySelectorAll("[data-option-path]")];

  for (let length = optionPath.length; length > 0; length -= 1) {
    const marker = optionPathMarker(optionPath.slice(0, length));
    const target = candidates.find((candidate) => candidate.dataset.optionPath === marker);

    if (target) {
      return target;
    }
  }

  return null;
}
