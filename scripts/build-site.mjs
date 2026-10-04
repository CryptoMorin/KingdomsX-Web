import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import {
  siteBuildOutputName,
  prepareSiteBuild
} from "./prepare-site-build.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const astroCli = path.join(repositoryRoot, "node_modules", "astro", "bin", "astro.mjs");

const [target, mode, ...extraArguments] = process.argv.slice(2);
const editorModes = {
  "--production": {
    PUBLIC_EDITOR_SITE_URL: "https://editor.kingdomsx.com"
  },
  "--preview": {
    PUBLIC_EDITOR_SITE_URL: "http://localhost:8788",
    EDITOR_MANUAL_WORKSPACES: "true"
  },
  "--preview-production": {
    PUBLIC_EDITOR_SITE_URL: "http://localhost:8788",
    EDITOR_MANUAL_WORKSPACES: "false"
  }
};

if (extraArguments.length || (mode && (target !== "editor" || !Object.hasOwn(editorModes, mode)))) {
  throw new Error("Only editor builds accept --production, --preview or --preview-production.");
}

const outputName = siteBuildOutputName(target);

execFileSync(process.execPath, [astroCli, "build"], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    ...editorModes[mode],
    EDITOR_STANDALONE_BUILD: String(target === "editor"),
    SERVER_DIRECTORY_STANDALONE_BUILD: String(target === "server-directory"),
    PUBLIC_SERVER_DIRECTORY_STANDALONE_BUILD: String(target === "server-directory")
  },
  stdio: "inherit"
});

await prepareSiteBuild(target, path.join(repositoryRoot, outputName));
