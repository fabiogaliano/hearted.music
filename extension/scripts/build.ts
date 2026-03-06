import { build, context, type BuildOptions } from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const isWatch = process.argv.includes("--watch");
const isStore = process.argv.includes("--store");
const srcDir = resolve(import.meta.dirname, "../src");
const distDir = resolve(import.meta.dirname, "../dist");

mkdirSync(distDir, { recursive: true });

const commonOptions: BuildOptions = {
  bundle: true,
  sourcemap: isWatch,
  minify: isStore,
  logLevel: "info",
};

const configs: BuildOptions[] = [
  {
    ...commonOptions,
    entryPoints: [resolve(srcDir, "content/intercept-token.ts")],
    outfile: resolve(distDir, "content/intercept-token.js"),
    format: "iife",
  },
  {
    ...commonOptions,
    entryPoints: [resolve(srcDir, "content/spotify-token.ts")],
    outfile: resolve(distDir, "content/spotify-token.js"),
    format: "iife",
  },
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

// Only strip local dev origins for Chrome Store submissions (--store).
// Default builds keep them for local testing.
function processManifest() {
  const manifest = JSON.parse(readFileSync(resolve(srcDir, "manifest.json"), "utf-8"));

  if (isStore) {
    const isLocalDevOrigin = (url: string) =>
      url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1");

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
  }

  writeFileSync(resolve(distDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

processManifest();
cpSync(resolve(srcDir, "icons"), resolve(distDir, "icons"), { recursive: true });
cpSync(resolve(srcDir, "popup/index.html"), resolve(distDir, "popup/index.html"));

if (isWatch) {
  const contexts = await Promise.all(configs.map((c) => context(c)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("Watching for changes...");
} else {
  await Promise.all(configs.map((c) => build(c)));
  console.log("Build complete.");
}
