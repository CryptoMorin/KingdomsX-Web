import { spawn } from "node:child_process";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

const PREVIEW_PORTS = {
  website: 8786,
  serverDirectory: 8787,
  editor: 8788
};

async function runPreviewAll() {
  const options = resolvePreviewOptions(
    process.argv.slice(2),
    process.env,
    networkInterfaces()
  );
  const urls = previewUrls(options.host);
  const buildEnvironments = previewBuildEnvironments(urls, process.env, {
    manualEditorWorkspaces: !options.productionEditor
  });
  const platform = process.platform;
  const npmCommand = platform === "win32" ? "npm.cmd" : "npm";
  const wranglerCommand = path.join(repositoryRoot, "node_modules", ".bin", platform === "win32" ? "wrangler.cmd" : "wrangler");
  const emptyEnvFile = "worker/empty.env";

  console.log(`\nPreparing the local suite for ${options.host} (${options.source}).`);
  console.log(`Editor mode: ${options.productionEditor ? "production link-only" : "maintainer uploads enabled"}.`);

  if (options.source === "detected network interface") {
    console.log("Override this address with: npm run preview:all -- --host <hostname-or-IP>");
  }

  await runBuild(npmCommand, "build", buildEnvironments.website, platform);
  await runBuild(npmCommand, "server-directory:build", buildEnvironments.serverDirectory, platform);
  await runBuild(npmCommand, "editor:build", buildEnvironments.editor, platform);

  const workers = [
    startWorker("main website", wranglerCommand, [
      "dev",
      "--config",
      "wrangler.local.jsonc",
      "--env-file",
      emptyEnvFile,
      "--local",
      "--ip",
      "0.0.0.0",
      "--port",
      String(PREVIEW_PORTS.website),
      "--inspector-port",
      "9236",
      "--show-interactive-dev-session=false"
    ], platform),
    startWorker("server directory", wranglerCommand, [
      "dev",
      "--config",
      "wrangler.server-directory.local.jsonc",
      "--local",
      "--test-scheduled",
      "--ip",
      "0.0.0.0",
      "--port",
      String(PREVIEW_PORTS.serverDirectory),
      "--inspector-port",
      "9237",
      "--show-interactive-dev-session=false"
    ], platform),
    startWorker("editor", wranglerCommand, [
      "dev",
      "--config",
      "wrangler.editor.local.jsonc",
      "--env-file",
      emptyEnvFile,
      "--local",
      "--ip",
      "0.0.0.0",
      "--port",
      String(PREVIEW_PORTS.editor),
      "--inspector-port",
      "9238",
      "--show-interactive-dev-session=false"
    ], platform)
  ];

  console.log("\nLocal Workers are starting:");
  console.log(`  Main website:     ${urls.website}`);
  console.log(`  Server directory: ${urls.serverDirectory}`);
  console.log(`  Editor:           ${urls.editor}`);
  console.log("\nPress Ctrl+C to stop all three.\n");

  let stopping = false;

  const stopWorkers = (signal = "SIGTERM") => {
    if (stopping) {
      return;
    }

    stopping = true;

    for (const { child } of workers) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    }
  };

  const stopOnInterrupt = () => stopWorkers("SIGINT");
  const stopOnTermination = () => stopWorkers("SIGTERM");

  process.once("SIGINT", stopOnInterrupt);
  process.once("SIGTERM", stopOnTermination);

  try {
    const firstExit = await Promise.race(
      workers.map(({ completion, label }) =>
        completion.then((result) => ({ ...result, label }))
      )
    );

    if (!stopping) {
      const reason = firstExit.signal
        ? `signal ${firstExit.signal}`
        : `exit code ${firstExit.code}`;

      console.error(`\nThe ${firstExit.label} Worker stopped unexpectedly (${reason}).`);
      process.exitCode = firstExit.code || 1;
      stopWorkers();
    }
  } catch (error) {
    stopWorkers();
    throw error;
  } finally {
    await Promise.allSettled(workers.map(({ completion }) => completion));
    process.removeListener("SIGINT", stopOnInterrupt);
    process.removeListener("SIGTERM", stopOnTermination);
  }
}

export function resolvePreviewOptions(args, environment, interfaces) {
  const { host: argumentHost, productionEditor } = previewArguments(args);

  if (argumentHost) {
    return {
      host: normalizePreviewHost(argumentHost),
      source: "--host option",
      productionEditor
    };
  }

  const environmentHost = environment.KINGDOMSX_PREVIEW_HOST?.trim();

  if (environmentHost) {
    return {
      host: normalizePreviewHost(environmentHost),
      source: "KINGDOMSX_PREVIEW_HOST",
      productionEditor
    };
  }

  const detectedHost = detectNetworkHost(interfaces);

  return detectedHost
    ? { host: detectedHost, source: "detected network interface", productionEditor }
    : { host: "localhost", source: "loopback fallback", productionEditor };
}

export function previewUrls(host) {
  const urlHost = isIP(host) === 6 ? `[${host}]` : host;

  return {
    website: `http://${urlHost}:${PREVIEW_PORTS.website}`,
    serverDirectory: `http://${urlHost}:${PREVIEW_PORTS.serverDirectory}`,
    editor: `http://${urlHost}:${PREVIEW_PORTS.editor}`
  };
}

export function previewBuildEnvironments(urls, environment, {
  manualEditorWorkspaces = true
} = {}) {
  const shared = {
    ...environment,
    PUBLIC_SITE_URL: urls.website,
    PUBLIC_ASSETS_BASE: "",
    PUBLIC_SERVERS_SITE_URL: urls.serverDirectory,
    PUBLIC_EDITOR_SITE_URL: urls.editor,
    PUBLIC_LOCAL_BUILD: "true",
    PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA"
  };

  return {
    website: shared,
    serverDirectory: shared,
    editor: {
      ...shared,
      EDITOR_MANUAL_WORKSPACES: String(manualEditorWorkspaces)
    }
  };
}

export function waitForExit(child) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }

    const cleanup = () => {
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onExit = (code, signal) => {
      cleanup();
      resolve({ code, signal });
    };

    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function previewArguments(args) {
  let host = "";
  let productionEditor = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--host") {
      if (host || !args[index + 1]) {
        throw new Error("Expected exactly one value after --host.");
      }

      host = args[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith("--host=")) {
      if (host || argument.length === "--host=".length) {
        throw new Error("Expected exactly one non-empty --host value.");
      }

      host = argument.slice("--host=".length);
      continue;
    }

    if (argument === "--production-editor") {
      if (productionEditor) {
        throw new Error("Expected --production-editor at most once.");
      }

      productionEditor = true;
      continue;
    }

    throw new Error(`Unknown preview:all option: ${argument}`);
  }

  return { host, productionEditor };
}

function normalizePreviewHost(value) {
  const host = value.trim().replace(/^\[|\]$/g, "");

  if (isIP(host)) {
    return host;
  }

  const validHostname = host.length <= 253 && host
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));

  if (!validHostname) {
    throw new Error(`Invalid preview host: ${value}`);
  }

  return host.toLowerCase();
}

function detectNetworkHost(interfaces) {
  const candidates = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.internal || (address.family !== "IPv4" && address.family !== 4)) {
        continue;
      }

      const privateAddress = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address.address);
      const physicalInterface = !/(?:docker|veth|bridge|br-|tailscale|vpn|loopback)/i.test(name);
      const score = Number(privateAddress) * 2 + Number(physicalInterface);

      candidates.push({ address: address.address, name, score });
    }
  }

  candidates.sort((left, right) =>
    right.score - left.score || left.name.localeCompare(right.name) || left.address.localeCompare(right.address)
  );

  return candidates[0]?.address ?? "";
}

async function runBuild(command, script, environment, platform) {
  const child = spawn(command, ["run", script], {
    cwd: repositoryRoot,
    env: environment,
    shell: platform === "win32",
    stdio: "inherit"
  });
  const result = await waitForExit(child);

  if (result.code !== 0) {
    const reason = result.signal ? `signal ${result.signal}` : `exit code ${result.code}`;

    throw new Error(`The ${script} build failed (${reason}).`);
  }
}

function startWorker(label, command, args, platform) {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    shell: platform === "win32",
    stdio: ["ignore", "inherit", "inherit"]
  });
  const completion = waitForExit(child).catch((error) => {
    throw new Error(`Unable to start the ${label} Worker.`, { cause: error });
  });

  return { child, completion, label };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    await runPreviewAll();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
