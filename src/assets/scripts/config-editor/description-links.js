const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const LEGACY_WIKI_PREFIX = /^https:\/\/github\.com\/CryptoMorin\/KingdomsX\/wiki(?=\/|$)/i;

function descriptionParts(value) {
  const text = String(value ?? "");
  const parts = [];
  let position = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimTrailingPunctuation(match[0]);

    if (!url) {
      continue;
    }

    if (match.index > position) {
      parts.push({ text: text.slice(position, match.index) });
    }

    const linkedUrl = descriptionUrl(url);
    parts.push({ text: linkedUrl, url: linkedUrl });
    position = match.index + url.length;
  }

  if (position < text.length) {
    parts.push({ text: text.slice(position) });
  }

  return parts;
}

export function appendDescriptionText(container, value) {
  for (const part of descriptionParts(value)) {
    if (!part.url) {
      container.append(document.createTextNode(part.text));
      continue;
    }

    const link = document.createElement("a");
    link.href = part.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = part.text;
    container.append(link);
  }

  return container;
}

function descriptionUrl(url) {
  return String(url).replace(LEGACY_WIKI_PREFIX, "https://wiki.kingdomsx.com");
}

function trimTrailingPunctuation(url) {
  let trimmed = url.replace(/[.,;:!]+$/g, "");

  while (trimmed.endsWith(")") && occurrences(trimmed, ")") > occurrences(trimmed, "(")) {
    trimmed = trimmed.slice(0, -1);
  }

  while (trimmed.endsWith("]") && occurrences(trimmed, "]") > occurrences(trimmed, "[")) {
    trimmed = trimmed.slice(0, -1);
  }

  return trimmed;
}

function occurrences(value, character) {
  return [...value].filter((current) => current === character).length;
}
