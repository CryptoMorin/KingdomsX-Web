import type { DirectoryEnv } from "./server-directory/contracts";

declare global {
  interface ProductionEnv extends LocalEnv {}
}

declare const localEnv: LocalEnv;
const directoryEnv: DirectoryEnv = localEnv;

void directoryEnv;
