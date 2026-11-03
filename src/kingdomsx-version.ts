export const MINIMUM_KINGDOMSX_WEB_VERSION = "1.17.28";

export function supportsKingdomsWebIntegrations(version: string): boolean {
  const match = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/i.exec(version.trim());

  if (!match) {
    return false;
  }

  const parts = match[1].split(".").map(Number);
  const minimum = MINIMUM_KINGDOMSX_WEB_VERSION.split(".").map(Number);

  if (!parts.every(Number.isSafeInteger)) {
    return false;
  }

  for (let index = 0; index < Math.max(parts.length, minimum.length); index += 1) {
    const difference = (parts[index] ?? 0) - (minimum[index] ?? 0);

    if (difference !== 0) {
      return difference > 0;
    }
  }

  // A prerelease of the minimum version predates its official release
  return !match[2];
}
