import { ApiError } from "./http";

export function validateListingNameAndDescription(name: string, description: string): void {
  if (!name || name.length < 3) {
    throw new ApiError(400, "Server name must be at least 3 characters.");
  }

  if (!description || description.length < 40) {
    throw new ApiError(400, "Description must be at least 40 characters.");
  }
}
