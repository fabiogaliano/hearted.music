import { build, context, type BuildOptions } from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const isWatch = process.argv.includes("--watch");
const isStore = process.argv.includes("--store");

type Target = "chromium" | "firefox";

function parseTarget(): Target {
  const arg = process.argv.find((a) => a.startsWith("--target="));
  const value = arg?.split("=")[1];
  if (value === "firefox" || value === "chromium") return value;
  if (value !== undefined) {
    throw new Error(`Unknown --target=${value} (expected chromium|firefox)`);
  }
  return "chromium";
}

const target = parseTarget();
const srcDir = resolve(import.meta.dirname, "../src");
const distDir = resolve(import.meta.dirname, "../dist", target);

mkdirSync(distDir, { recursive: true });

const commonOptions: BuildOptions = {
  bundle: true,
  sourcemap: isWatch,
  minify: isStore,
  logLevel: "info",
};

const contentEntry = (name: string): BuildOptions => ({
  ...commonOptions,
  entryPoints: [resolve(srcDir, `content/${name}.ts`)],
  outfile: resolve(distDir, `content/${name}.js`),
  format: "iife",
});

const configs: BuildOptions[] = [
  contentEntry("intercept-token"),
  contentEntry("spotify-token"),
  contentEntry("return-banner"),
  {
    ...commonOptions,
    entryPoints: [resolve(srcDir, "background/service-worker.ts")],
    outfile: resolve(distDir, "background/service-worker.js"),
    format: "esm",
  },
  {
    ...commonOptions,
    entryPoints: [resolve(srcDir, "popup/main.tsx")],
    outfile: resolve(distDir, "popup/main.js"),
    format: "esm",
  },
];

// The page<->extension bridge replaces externally_connectable, which Firefox
// does not implement. It only exists in the Firefox build.
if (target === "firefox") {
  configs.push(contentEntry("app-bridge"));
}

const isLocalDevOrigin = (url: string) =>
  url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1");

// Only strip local dev origins for store submissions (--store). Default builds
// keep them for local testing. Chrome and Firefox expose the web-app origins
// through different manifest keys, so each target strips its own.
function processManifest() {
  const manifest = JSON.parse(
    readFileSync(resolve(srcDir, `manifest.${target}.json`), "utf-8"),
  );

  if (isStore) {
    if (Array.isArray(manifest.host_permissions)) {
      manifest.host_permissions = manifest.host_permissions.filter(
        (url: string) => !isLocalDevOrigin(url),
      );
    }

    if (Array.isArray(manifest.externally_connectable?.matches)) {
      manifest.externally_connectable.matches =
        manifest.externally_connectable.matches.filter(
          (url: string) => !isLocalDevOrigin(url),
        );
    }

    if (Array.isArray(manifest.content_scripts)) {
      for (const script of manifest.content_scripts) {
        if (Array.isArray(script.matches)) {
          script.matches = script.matches.filter(
            (url: string) => !isLocalDevOrigin(url),
          );
        }
      }
    }
  }

  writeFileSync(
    resolve(distDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
}

processManifest();
cpSync(resolve(srcDir, "icons"), resolve(distDir, "icons"), { recursive: true });
cpSync(resolve(srcDir, "popup/index.html"), resolve(distDir, "popup/index.html"));

if (isWatch) {
  const contexts = await Promise.all(configs.map((c) => context(c)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log(`Watching for changes (${target})...`);
} else {
  await Promise.all(configs.map((c) => build(c)));
  console.log(`Build complete (${target}).`);
}
