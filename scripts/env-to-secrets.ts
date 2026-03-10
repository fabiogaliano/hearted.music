/**
 * Reads .env (or specified env file) and outputs a JSON file
 * compatible with `wrangler secret bulk`.
 *
 * Usage:
 *   bun scripts/env-to-secrets.ts                          # all secrets (released mode)
 *   bun scripts/env-to-secrets.ts --mode waitlist           # waitlist-only (minimal secrets)
 *   bun scripts/env-to-secrets.ts --mode released           # explicit released mode
 *   bun scripts/env-to-secrets.ts .env.cloud                # custom env file
 *   bun scripts/env-to-secrets.ts .env -o out.json          # custom output path
 *
 * Then: wrangler secret bulk < prod-secrets.json && rm prod-secrets.json
 */

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// VITE_ vars are baked in at build time, not needed as runtime secrets
const SKIP_PREFIXES = ["VITE_"];
const SKIP_KEYS = new Set(["ML_PROVIDER"]);

const WAITLIST_KEYS = new Set([
	"SUPABASE_URL",
	"SUPABASE_ANON_KEY",
	"SUPABASE_SERVICE_ROLE_KEY",
	"BETTER_AUTH_SECRET",
	"BETTER_AUTH_URL",
	"DATABASE_URL",
	"RESEND_API_KEY",
]);

const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	options: {
		output: { type: "string", short: "o", default: "prod-secrets.json" },
		mode: { type: "string", short: "m", default: "released" },
	},
	allowPositionals: true,
	strict: true,
});

const mode = values.mode as "waitlist" | "released";
if (mode !== "waitlist" && mode !== "released") {
	console.error(`Invalid mode: "${mode}". Use "waitlist" or "released".`);
	process.exit(1);
}

const envFile = positionals[0] ?? ".env";
const outputFile = values.output!;
const envPath = resolve(process.cwd(), envFile);

if (!existsSync(envPath)) {
	console.error(`File not found: ${envPath}`);
	process.exit(1);
}

const content = readFileSync(envPath, "utf-8");
const secrets: Record<string, string> = {};
const skipped: string[] = [];

for (const line of content.split("\n")) {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("#")) continue;

	const eqIndex = trimmed.indexOf("=");
	if (eqIndex === -1) continue;

	const key = trimmed.slice(0, eqIndex).trim();
	const value = trimmed.slice(eqIndex + 1).trim();

	if (!value || value.includes("your_") || value.includes("_here")) {
		skipped.push(key);
		continue;
	}

	if (SKIP_PREFIXES.some((p) => key.startsWith(p))) {
		skipped.push(key);
		continue;
	}

	if (SKIP_KEYS.has(key)) {
		skipped.push(key);
		continue;
	}

	if (mode === "waitlist" && !WAITLIST_KEYS.has(key)) {
		skipped.push(key);
		continue;
	}

	secrets[key] = value;
}

const outputPath = resolve(process.cwd(), outputFile);
writeFileSync(outputPath, JSON.stringify(secrets, null, 2) + "\n");

console.log(`Mode: ${mode}`);
console.log(`Wrote ${Object.keys(secrets).length} secrets to ${outputFile}`);
if (skipped.length > 0) {
	console.log(`Skipped ${skipped.length}: ${skipped.join(", ")}`);
}
console.log(`\nNext: wrangler secret bulk < ${outputFile} && rm ${outputFile}`);
