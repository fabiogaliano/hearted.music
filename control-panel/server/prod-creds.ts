/**
 * Production credential resolution for the control panel.
 *
 * Mirrors scripts/db/prod.ts exactly: REST creds (service-role) come from the
 * cloud env files, the SQL DSN from the prod DB password + pooler URL. We read
 * the files directly rather than process.env because bun auto-loads the LOCAL
 * .env (127.0.0.1 Supabase) — so the cloud file has to win for prod values.
 *
 * The whole point of the standalone panel is that it never ships to prod: it
 * runs on your machine with the same prod creds already on disk for the skill.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = process.cwd();
const POOLER_URL_FILE = resolve(REPO_ROOT, "supabase/.temp/pooler-url");

const CLOUD_FILES = [".env.cloud.local", ".env.cloud"];
const SQL_FILES = [".env.cloud.local", ".env.cloud", ".env"];

/** First-occurrence KEY=VALUE reader across files (authoritative file first). */
function readEnv(keys: string[], files: string[]): Record<string, string> {
	const found: Record<string, string> = {};
	for (const file of files) {
		const path = resolve(REPO_ROOT, file);
		if (!existsSync(path)) continue;
		for (const raw of readFileSync(path, "utf-8").split("\n")) {
			const line = raw.trim();
			if (!line || line.startsWith("#")) continue;
			const eq = line.indexOf("=");
			if (eq === -1) continue;
			const key = line.slice(0, eq).trim();
			if (!keys.includes(key) || key in found) continue;
			let value = line.slice(eq + 1).trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			found[key] = value;
		}
	}
	return found;
}

export interface RestCreds {
	url: string;
	key: string;
	ref: string;
}

export function getRestCreds(): RestCreds {
	const env = readEnv(
		["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
		CLOUD_FILES,
	);
	const url = env.SUPABASE_URL ?? process.env.SUPABASE_URL;
	const key =
		env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		throw new Error(
			"Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (expected in .env.cloud).",
		);
	}
	if (url.includes("127.0.0.1") || url.includes("localhost")) {
		throw new Error(
			`Refusing to run: resolved a LOCAL SUPABASE_URL (${url}). Check .env.cloud.`,
		);
	}
	const ref = new URL(url).hostname.split(".")[0] ?? "(unknown)";
	return { url, key, ref };
}

function buildFromPoolerUrl(password: string): string {
	if (!existsSync(POOLER_URL_FILE)) {
		throw new Error(
			`No PROD_DATABASE_URL and ${POOLER_URL_FILE} missing. Run \`supabase link\` or set PROD_DATABASE_URL.`,
		);
	}
	const u = new URL(readFileSync(POOLER_URL_FILE, "utf-8").trim());
	u.username = u.username || "postgres";
	u.password = password;
	return u.toString();
}

/**
 * The real Resend sending key. It lives in `.env` (the prod key — there is only
 * one), so we read the same file set as the SQL creds. `.env.cloud.local` can
 * override it locally (e.g. to point at a Resend test key).
 */
export function getResendApiKey(): string {
	const env = readEnv(["RESEND_API_KEY"], SQL_FILES);
	const key = env.RESEND_API_KEY ?? process.env.RESEND_API_KEY;
	if (!key) {
		throw new Error("Missing RESEND_API_KEY (expected in .env).");
	}
	return key;
}

export interface SqlTarget {
	connectionString: string;
	ref: string;
}

export function getSqlTarget(): SqlTarget {
	const env = readEnv(
		["PROD_DATABASE_URL", "SUPABASE_DB_PASSWORD"],
		SQL_FILES,
	);
	const explicit = env.PROD_DATABASE_URL ?? process.env.PROD_DATABASE_URL;
	const connectionString =
		explicit ??
		(() => {
			const pw = env.SUPABASE_DB_PASSWORD ?? process.env.SUPABASE_DB_PASSWORD;
			if (!pw) {
				throw new Error(
					"No prod DB password found. Expected SUPABASE_DB_PASSWORD in .env (or PROD_DATABASE_URL in .env.cloud.local).",
				);
			}
			return buildFromPoolerUrl(pw);
		})();

	const target = new URL(connectionString);
	if (target.hostname === "127.0.0.1" || target.hostname === "localhost") {
		throw new Error(
			`Refusing to run: resolved a LOCAL Postgres DSN (${target.hostname}). Check your env files.`,
		);
	}
	const ref = target.username.split(".")[1] ?? "(unknown)";
	return { connectionString, ref };
}
