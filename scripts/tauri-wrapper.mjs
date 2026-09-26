#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureLinuxdeploy } from "./ensure-linuxdeploy.mjs";

const args = process.argv.slice(2);

/** npm, pnpm, or yarn — matches the package manager that invoked this script. */
function packageManager() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm")) return "pnpm";
  if (userAgent.startsWith("yarn")) return "yarn";
  return "npm";
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function runBuild(pm) {
  if (pm === "npm") {
    await run("npm", ["run", "build"]);
  } else {
    await run(pm, ["build"]);
  }
}

function linuxBuildEnv() {
  if (process.platform !== "linux") return process.env;
  return {
    ...process.env,
    // AppImageLauncher binfmt on Arch breaks Tauri's linuxdeploy + plugin ELFs named *.AppImage.
    APPIMAGELAUNCHER_DISABLE: process.env.APPIMAGELAUNCHER_DISABLE ?? "1",
    // linuxdeploy's bundled strip chokes on .relr.dyn on rolling distros (Arch).
    NO_STRIP: process.env.NO_STRIP ?? "true",
    APPIMAGE_EXTRACT_AND_RUN: process.env.APPIMAGE_EXTRACT_AND_RUN ?? "1",
  };
}

async function runTauri(pm, tauriArgs, env = process.env) {
  // `--` matters: without it `npm exec` swallows tauri's own flags (--config among
  // them) as its own, and the value ends up in cargo's argv as a stray argument.
  await run(pm, ["exec", "--", "tauri", ...tauriArgs], { env });
}

/**
 * Arguments for a local `tauri build` without release signing keys.
 *
 * The override goes in a real file instead of inline JSON: this command runs
 * through a shell on Windows, and the shell eats the quotes inside
 * '{"bundle":…}' before tauri can parse it, so the build died in cargo's
 * argument parser. A path the shell cannot mangle survives everywhere.
 */
export function prepareLocalConfig({ argv = args, env = process.env } = {}) {
  if (argv[0]?.toLowerCase() !== "build" || env.TAURI_SIGNING_PRIVATE_KEY) {
    return { args: argv, cleanup: () => {} };
  }
  const dir = mkdtempSync(path.join(tmpdir(), "mooshie-tauri-"));
  const file = path.join(dir, "tauri.local.json");
  writeFileSync(file, JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
  return {
    args: [...argv, "--config", /[\s"]/.test(file) ? `"${file}"` : file],
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // A leftover temp file is not worth failing a finished build over.
      }
    },
  };
}

async function main() {
  const pm = packageManager();
  const firstArg = args[0]?.toLowerCase();

  if (firstArg === "dev" || firstArg === "build") {
    await runBuild(pm);
  }

  if (firstArg === "build" && process.platform === "linux") {
    await ensureLinuxdeploy();
  }

  const env = firstArg === "build" ? linuxBuildEnv() : process.env;
  const config = prepareLocalConfig();
  try {
    await runTauri(pm, config.args, env);
  } finally {
    config.cleanup();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
