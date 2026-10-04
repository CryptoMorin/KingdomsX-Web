const MANAGED_FILE_NAMES = new Set(["globals.yml", "globals.yaml"]);

export function isKingdomsManagedFile(fileName) {
  const name = String(fileName).replaceAll("\\", "/").split("/").at(-1);

  return MANAGED_FILE_NAMES.has(name?.toLocaleLowerCase("en-US"));
}
