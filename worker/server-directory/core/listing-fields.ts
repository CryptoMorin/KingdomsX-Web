import { ApiError } from "./http";
import {
  SERVER_LANGUAGE_LIMIT,
  SERVER_LANGUAGE_MAX_LENGTH,
  SERVER_REGIONS
} from "../../../src/server-listing-metadata";

export function parseListingMetadata(
  body: Record<string, unknown>,
  current?: { regions: string[]; languages: string[] }
): { regions: string[]; languages: string[] } {
  const regions = Object.hasOwn(body, "regions") ? parseServerRegions(body.regions) : current?.regions;

  if (!regions?.length) {
    throw new ApiError(400, "Choose at least one server region.");
  }

  return {
    regions,
    languages: Object.hasOwn(body, "languages") ? parseServerLanguages(body.languages) : current?.languages ?? []
  };
}

function parseServerRegions(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length) {
    throw new ApiError(400, "Choose at least one server region.");
  }

  if (value.length > SERVER_REGIONS.length) {
    throw new ApiError(400, `Choose up to ${SERVER_REGIONS.length} server regions.`);
  }

  const regions = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new ApiError(400, "Choose supported server regions.");
    }

    const region = entry.trim().toLowerCase();

    if (!SERVER_REGIONS.some(({ value: candidate }) => candidate === region)) {
      throw new ApiError(400, "Choose supported server regions.");
    }

    regions.add(region);
  }

  return [...regions];
}

export function parseStoredServerRegions(value: string): string[] {
  const regions: unknown = JSON.parse(value);

  if (!Array.isArray(regions) || regions.some((region) => typeof region !== "string")) {
    throw new Error("Stored server regions must be an array of strings.");
  }

  return regions;
}

function parseServerLanguages(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new ApiError(400, "Server languages must be a list of language names.");
  }

  if (value.length > SERVER_LANGUAGE_LIMIT) {
    throw new ApiError(400, `Choose up to ${SERVER_LANGUAGE_LIMIT} server languages.`);
  }

  const languages: string[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new ApiError(400, "Each server language must be a language name.");
    }

    const language = entry.trim().replace(/\s+/g, " ");

    if (!language || language.length > SERVER_LANGUAGE_MAX_LENGTH) {
      throw new ApiError(400, `Each server language must be between 1 and ${SERVER_LANGUAGE_MAX_LENGTH} characters.`);
    }

    if (/[\u0000-\u001f\u007f-\u009f]/u.test(language)) {
      throw new ApiError(400, "Server language names must not contain control characters.");
    }

    if (language.includes(",")) {
      throw new ApiError(400, "Each server language must be one name without commas. Use a name such as Chinese (Simplified).");
    }

    const key = language.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      languages.push(language);
    }
  }

  return languages;
}

export function parseStoredServerLanguages(value: string): string[] {
  const languages: unknown = JSON.parse(value);

  if (!Array.isArray(languages) || languages.some((language) => typeof language !== "string")) {
    throw new Error("Stored server languages must be an array of strings.");
  }

  return languages;
}

export function validateListingNameAndDescription(name: string, description: string): void {
  if (!name || name.length < 3) {
    throw new ApiError(400, "Server name must be at least 3 characters.");
  }

  if (!description || description.length < 40) {
    throw new ApiError(400, "Description must be at least 40 characters.");
  }
}
