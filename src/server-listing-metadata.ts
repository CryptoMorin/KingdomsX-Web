export const SERVER_REGIONS = Object.freeze([
  { value: "na-east", label: "NA East" },
  { value: "na-central", label: "NA Central" },
  { value: "na-west", label: "NA West" },
  { value: "south-america", label: "South America" },
  { value: "eu-north", label: "EU North" },
  { value: "eu-central", label: "EU Central" },
  { value: "eu-west", label: "EU West" },
  { value: "eu-east", label: "EU East" },
  { value: "middle-east", label: "Middle East" },
  { value: "africa", label: "Africa" },
  { value: "asia-east", label: "Asia East" },
  { value: "asia-south", label: "Asia South" },
  { value: "asia-southeast", label: "Asia Southeast" },
  { value: "asia-central", label: "Asia Central" },
  { value: "oceania", label: "Oceania" }
]);

export const SERVER_LANGUAGE_LIMIT = 10;
export const SERVER_LANGUAGE_MAX_LENGTH = 40;

export function comparableServerLanguages(languages: readonly string[]): string {
  const normalized = languages.map((language) => language.trim().replace(/\s+/g, " ").toLowerCase());

  return JSON.stringify([...new Set(normalized)].sort());
}

export function comparableServerRegions(regions: readonly string[]): string {
  return JSON.stringify([...new Set(regions)].sort());
}

export function serverRegionsLabel(regions: readonly string[]): string {
  return regions.map((region) => SERVER_REGIONS.find(({ value }) => value === region)?.label ?? region).join(", ");
}

export function normalizeServerRegionFilter(value: string | null): string {
  const region = value?.trim().toLowerCase();

  return SERVER_REGIONS.find(({ value }) => value === region)?.value ?? "";
}
