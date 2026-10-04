import type { DirectoryEnv } from "./server-directory/contracts";

declare const localEnv: ServerDirectoryLocalEnv;
const directoryEnv: DirectoryEnv = localEnv;

void directoryEnv;
