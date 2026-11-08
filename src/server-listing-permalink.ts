export function serverNameSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "server";
}

export function publicServerPermalinkPath(name: string, publicId: number): string {
  return `/${serverNameSlug(name)}.${publicId}/`;
}

export function publicServerPermalink(
  name: string,
  publicId: number,
  directoryOrigin = "https://servers.kingdomsx.com"
): string {
  return new URL(publicServerPermalinkPath(name, publicId), directoryOrigin).href;
}
