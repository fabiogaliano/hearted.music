/**
 * Flags the statements docs/ops/prod-db-migrations.md ("Manual-Only Changes")
 * says must not be auto-applied, so migrate-prod refuses them and the owner
 * applies them supervised instead.
 *
 *   bun scripts/db/scan-destructive-migrations.ts <file.sql>...
 *   bun scripts/db/scan-destructive-migrations.ts --warn <file.sql>...
 *   bun scripts/db/scan-destructive-migrations.ts --dry-run-output <file>
 *
 * `--dry-run-output` scans the migrations a saved `supabase db push --dry-run`
 * would apply. `--warn` reports without failing (PR-time preview). Exit codes:
 * 0 clean (or --warn), 1 destructive statements found, 2 the input could not
 * be read or parsed — the gate treats 2 as a refusal too.
 *
 * A statement that is safe in context passes with a reviewable reason on its
 * own line(s) or the comment directly above it:
 *
 *   DROP TABLE legacy_thing; -- migration-safety: allow nothing has read it since the v2 reader shipped
 *
 * Imports node builtins only: migrate-prod runs it next to the prod database
 * credential without a `bun install`, so no third-party code runs there.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export type Finding = {
	line: number;
	message: string;
	statement: string;
	/** Set when a `migration-safety: allow <reason>` comment covers the statement. */
	allowedReason: string | null;
};

type Statement = {
	/** SQL with comments removed and literal/dollar-quoted bodies blanked. */
	code: string;
	line: number;
	endLine: number;
	comments: string[];
};

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;
const QNAME = String.raw`${IDENT}(?: ?\. ?${IDENT})?`;
const ALLOW = /migration-safety:\s*allow\b(.*)/is;

function isIdentChar(c: string | undefined): boolean {
	return c !== undefined && /[\w$]/.test(c);
}

function countNewlines(text: string): number {
	let count = 0;
	for (const c of text) if (c === "\n") count++;
	return count;
}

/**
 * Splits on top-level `;`. Bodies are blanked rather than kept because a
 * function body's `DELETE FROM` or `DROP` runs only when called, not at
 * migration time.
 *
 * `unterminatedLine` is where a quote or comment opens and never closes.
 * Postgres would reject that file, so it means the lexer misread something
 * and everything after that line went unseen.
 */
function splitStatements(sql: string): {
	statements: Statement[];
	unterminatedLine: number | null;
} {
	const statements: Statement[] = [];
	let code = "";
	let start = 0;
	let comments: string[] = [];
	let line = 1;
	let i = 0;
	let unterminatedLine: number | null = null;
	const unterminated = () => {
		unterminatedLine ??= line;
	};

	// `DROP x; -- reason` reads as annotating the statement it trails, not the next one.
	const addComment = (text: string, commentLine: number) => {
		const previous = statements.at(-1);
		if (code.trim() === "" && previous && previous.endLine === commentLine) {
			previous.comments.push(text);
		} else {
			comments.push(text);
		}
	};
	const markStart = () => {
		if (start === 0) start = line;
	};
	const flush = () => {
		if (code.trim() !== "") {
			statements.push({ code, line: start, endLine: line, comments });
		}
		code = "";
		start = 0;
		comments = [];
	};

	while (i < sql.length) {
		const c = sql[i];
		const next = sql[i + 1];

		if (c === "-" && next === "-") {
			const newline = sql.indexOf("\n", i);
			const stop = newline === -1 ? sql.length : newline;
			addComment(sql.slice(i + 2, stop), line);
			code += " ";
			i = stop;
			continue;
		}

		if (c === "/" && next === "*") {
			const commentLine = line;
			let depth = 1;
			let j = i + 2;
			while (j < sql.length && depth > 0) {
				if (sql[j] === "/" && sql[j + 1] === "*") {
					depth++;
					j += 2;
				} else if (sql[j] === "*" && sql[j + 1] === "/") {
					depth--;
					j += 2;
				} else {
					j++;
				}
			}
			if (depth > 0) unterminated();
			const body = sql.slice(i + 2, depth === 0 ? j - 2 : j);
			addComment(body, commentLine);
			line += countNewlines(sql.slice(i, j));
			code += " ";
			i = j;
			continue;
		}

		if (c === "'") {
			markStart();
			const backslashEscapes =
				(sql[i - 1] === "E" || sql[i - 1] === "e") && !isIdentChar(sql[i - 2]);
			let j = i + 1;
			while (j < sql.length) {
				if (backslashEscapes && sql[j] === "\\") {
					j += 2;
				} else if (sql[j] === "'" && sql[j + 1] === "'") {
					j += 2;
				} else if (sql[j] === "'") {
					break;
				} else {
					j++;
				}
			}
			if (j >= sql.length) unterminated();
			line += countNewlines(sql.slice(i, j));
			code += "''";
			i = j + 1;
			continue;
		}

		if (c === "$" && !isIdentChar(sql[i - 1])) {
			const tag = /^\$(?:[A-Za-z_][\w]*)?\$/.exec(sql.slice(i, i + 66))?.[0];
			if (tag) {
				markStart();
				const close = sql.indexOf(tag, i + tag.length);
				if (close === -1) unterminated();
				const stop = close === -1 ? sql.length : close + tag.length;
				line += countNewlines(sql.slice(i, stop));
				code += "$$";
				i = stop;
				continue;
			}
		}

		if (c === '"') {
			markStart();
			let j = i + 1;
			while (j < sql.length) {
				if (sql[j] === '"' && sql[j + 1] === '"') j += 2;
				else if (sql[j] === '"') break;
				else j++;
			}
			if (j >= sql.length) unterminated();
			const quoted = sql.slice(i, j + 1);
			line += countNewlines(quoted);
			code += quoted;
			i = j + 1;
			continue;
		}

		if (c === ";") {
			flush();
			i++;
			continue;
		}

		if (c === "\n") line++;
		else if (!/\s/.test(c)) markStart();
		code += c;
		i++;
	}
	flush();
	return { statements, unterminatedLine };
}

function splitTopLevel(text: string, separator: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	for (const c of text) {
		if (c === "(") depth++;
		if (c === ")") depth--;
		if (c === separator && depth === 0) {
			parts.push(current.trim());
			current = "";
		} else {
			current += c;
		}
	}
	parts.push(current.trim());
	return parts.filter((part) => part !== "");
}

function normalizeName(raw: string): string {
	return raw
		.replace(/\s+/g, "")
		.replace(/"/g, "")
		.toLowerCase()
		.replace(/^public\./, "");
}

type Recreatable = "function" | "view";

const CREATE_FUNCTION = new RegExp(
	String.raw`^CREATE (?:OR REPLACE )?FUNCTION (${QNAME}) ?\(`,
	"i",
);
const CREATE_VIEW = new RegExp(
	`^CREATE (?:OR REPLACE )?(?:MATERIALIZED )?VIEW (?:IF NOT EXISTS )?(${QNAME})`,
	"i",
);
const ALTER_TABLE = new RegExp(
	String.raw`^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?${QNAME} ?\*? (.*)$`,
	"is",
);
const ALTER_COLUMN_TYPE = new RegExp(
	String.raw`^ALTER (?:COLUMN )?${IDENT} (?:SET DATA )?TYPE\b`,
	"i",
);
const DROP =
	/^DROP (TABLE|SCHEMA|MATERIALIZED VIEW|VIEW|TYPE|FUNCTION|INDEX)( CONCURRENTLY)?(?: IF EXISTS)? (.*?)( CASCADE| RESTRICT)?$/is;

function createdObject(sql: string): string | null {
	const fn = CREATE_FUNCTION.exec(sql);
	if (fn) return `function:${normalizeName(fn[1])}`;
	const view = CREATE_VIEW.exec(sql);
	if (view) return `view:${normalizeName(view[1])}`;
	return null;
}

const RECREATABLE: Record<string, Recreatable> = {
	FUNCTION: "function",
	VIEW: "view",
	"MATERIALIZED VIEW": "view",
};

function alterTableReasons(actions: string): string[] {
	return splitTopLevel(actions, ",").flatMap((action) => {
		if (
			/^RENAME (?!CONSTRAINT\b)/i.test(action) ||
			/^SET SCHEMA\b/i.test(action)
		) {
			return [
				"renaming a table or column breaks readers on the running deploy",
			];
		}
		const cascade = /^DROP\b.* CASCADE$/i.test(action);
		const cascadeReason = "DROP ... CASCADE also drops every dependent object";
		if (/^DROP (?!CONSTRAINT\b)/i.test(action)) {
			return cascade
				? [`DROP COLUMN deletes data; ${cascadeReason}`]
				: ["DROP COLUMN deletes data"];
		}
		// Not covered by the constraint exemption: dropping a key with CASCADE
		// also drops the foreign keys on every table that references it.
		if (cascade) return [cascadeReason];
		if (ALTER_COLUMN_TYPE.test(action)) {
			return [
				"ALTER COLUMN ... TYPE can rewrite the table under an ACCESS EXCLUSIVE lock",
			];
		}
		return [];
	});
}

/**
 * `laterCreates` holds the functions and views created after this statement
 * in the same file: dropping one to re-create it with a new signature or
 * column list is routine here, so only a drop with no replacement counts.
 */
function dropReasons(
	drop: RegExpExecArray,
	laterCreates: ReadonlySet<string>,
): string[] {
	const keyword = drop[1].toUpperCase();
	if (drop[2])
		return [
			`DROP ${keyword} CONCURRENTLY cannot run inside a transaction block`,
		];
	const cascade = drop[4]?.trim().toUpperCase() === "CASCADE";
	const cascadeReason = `DROP ${keyword} ... CASCADE also drops every dependent object`;
	// Lead with the data loss: it is why tables and schemas are manual-only,
	// and the cascade is collateral on top of it.
	if (keyword === "TABLE") {
		return cascade
			? [`DROP TABLE deletes data; ${cascadeReason}`]
			: ["DROP TABLE deletes data"];
	}
	if (keyword === "SCHEMA") {
		return cascade
			? [`DROP SCHEMA deletes everything in it; ${cascadeReason}`]
			: ["DROP SCHEMA deletes everything in it"];
	}
	if (cascade) return [cascadeReason];
	const kind = RECREATABLE[keyword];
	// Without CASCADE a type still in use refuses to drop and rolls the
	// migration back, and an index drop loses no data and locks only briefly.
	if (!kind) return [];
	const missing = splitTopLevel(drop[3], ",")
		// Name only, ignoring the argument list: dropping the old overload and
		// creating the new signature is the routine RPC change here, so a
		// re-create under any signature counts as the replacement.
		.map((target) => normalizeName(target.split("(")[0]))
		.filter((name) => !laterCreates.has(`${kind}:${name}`));
	if (missing.length === 0) return [];
	return [
		`DROP ${keyword} ${missing.join(", ")} without re-creating it here breaks callers on the running deploy`,
	];
}

/**
 * True when some `DELETE FROM` in the statement has no WHERE of its own.
 * Not anchored to the statement start: a data-modifying CTE
 * (`WITH x AS (DELETE FROM song RETURNING *) SELECT …`) runs at migration
 * time too. The WHERE has to sit at the DELETE's own paren depth, before the
 * paren that closes it — one in a subquery or in the outer SELECT scopes
 * nothing.
 */
function hasUnscopedDelete(sql: string): boolean {
	for (const match of sql.matchAll(/\bDELETE FROM\b/gi)) {
		let depth = 0;
		let scoped = false;
		for (let i = match.index + match[0].length; i < sql.length; i++) {
			const c = sql[i];
			if (c === "(") depth++;
			else if (c === ")") {
				if (depth === 0) break;
				depth--;
			} else if (
				depth === 0 &&
				/^WHERE\b/i.test(sql.slice(i, i + 6)) &&
				!isIdentChar(sql[i - 1])
			) {
				scoped = true;
				break;
			}
		}
		if (!scoped) return true;
	}
	return false;
}

function destructiveReasons(
	sql: string,
	laterCreates: ReadonlySet<string>,
): string[] {
	// TRUNCATE stays anchored: it cannot appear in a CTE, and unanchored it
	// would match `GRANT TRUNCATE ON …`.
	if (/^TRUNCATE\b/i.test(sql)) return ["TRUNCATE deletes every row"];
	if (hasUnscopedDelete(sql)) {
		return ["DELETE without WHERE deletes every row"];
	}
	if (/^CREATE (?:UNIQUE )?INDEX CONCURRENTLY\b/i.test(sql)) {
		return [
			"CREATE INDEX CONCURRENTLY is long-running and cannot run inside a transaction block",
		];
	}
	const alter = ALTER_TABLE.exec(sql);
	if (alter) return [...new Set(alterTableReasons(alter[1]))];
	const drop = DROP.exec(sql);
	if (drop) return dropReasons(drop, laterCreates);
	return [];
}

type Allowance =
	| { kind: "none" }
	| { kind: "missing-reason" }
	| { kind: "allowed"; reason: string };

function allowance(comments: string[]): Allowance {
	for (const comment of comments) {
		const match = ALLOW.exec(comment);
		if (!match) continue;
		const reason = match[1].replace(/\s+/g, " ").trim();
		return reason === ""
			? { kind: "missing-reason" }
			: { kind: "allowed", reason };
	}
	return { kind: "none" };
}

export function scanMigrationSql(sql: string): Finding[] {
	const split = splitStatements(sql);
	const statements = split.statements.map((statement) => ({
		...statement,
		code: statement.code.replace(/\s+/g, " ").trim(),
	}));
	const findings: Finding[] = [];
	const laterCreates = new Set<string>();

	// Walk backwards so each statement sees only what is created after it.
	for (let index = statements.length - 1; index >= 0; index--) {
		const statement = statements[index];
		const reasons = destructiveReasons(statement.code, laterCreates);
		const created = createdObject(statement.code);
		if (created) laterCreates.add(created);
		if (reasons.length === 0) continue;

		const allow = allowance(statement.comments);
		const excerpt =
			statement.code.length > 120
				? `${statement.code.slice(0, 117)}...`
				: statement.code;
		for (const reason of reasons) {
			findings.push({
				line: statement.line,
				message:
					allow.kind === "missing-reason"
						? `${reason} (the migration-safety: allow comment needs a reason)`
						: reason,
				statement: excerpt,
				allowedReason: allow.kind === "allowed" ? allow.reason : null,
			});
		}
	}
	findings.reverse();
	if (split.unterminatedLine !== null) {
		findings.push({
			line: split.unterminatedLine,
			message:
				"unterminated quote or comment; the scanner cannot see the statements after it",
			statement: "",
			allowedReason: null,
		});
	}
	return findings;
}

export type DryRunPlan =
	| { kind: "pending"; files: string[] }
	| { kind: "unrecognized"; detail: string };

const PLAN_HEADER = "Would push these migrations:";

/**
 * Reads the migration filenames a `supabase db push --dry-run` transcript
 * (stdout + stderr) says it would apply; "up to date" is an empty list.
 * Anything else is `unrecognized` — it must stop the apply, never read as
 * "nothing pending" — and `detail` says which part stopped matching, so a
 * CLI upgrade that changes the wording points at the line to fix.
 */
export function parsePendingMigrations(transcript: string): DryRunPlan {
	const lines = transcript.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/);
	const header = lines.findIndex((line) => line.trim() === PLAN_HEADER);
	if (header === -1) {
		return lines.some((line) => /\bdatabase is up to date\.$/.test(line.trim()))
			? { kind: "pending", files: [] }
			: {
					kind: "unrecognized",
					detail: `neither "${PLAN_HEADER}" nor "… database is up to date." found`,
				};
	}
	// Every bullet after the header, not just the first run of them: stdout and
	// stderr share the transcript, and a line interleaved into the list must
	// not cut it short. Over-collecting only scans more.
	const files = lines
		.slice(header + 1)
		.map((line) => /^\s*•\s+(\S+\.sql)$/.exec(line.trimEnd())?.[1])
		.filter((file) => file !== undefined)
		.map((file) => basename(file));
	if (files.length === 0) {
		return {
			kind: "unrecognized",
			detail: `found "${PLAN_HEADER}" but no " • <file>.sql" lines after it; the bullet format changed`,
		};
	}
	return { kind: "pending", files };
}

function escapeData(text: string): string {
	return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(text: string): string {
	return escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

const RUNBOOK = "docs/ops/prod-db-migrations.md (Manual-Only Changes)";

function main(argv: string[]): number {
	const inActions = process.env.GITHUB_ACTIONS === "true";
	const annotate = (
		level: "error" | "warning" | "notice",
		title: string,
		message: string,
		location?: { file: string; line: number },
	) => {
		if (!inActions) {
			const where = location ? `${location.file}:${location.line}: ` : "";
			console.log(`${where}${level}: ${message}`);
			return;
		}
		const props = [
			location && `file=${escapeProperty(location.file)}`,
			location && `line=${location.line}`,
			`title=${escapeProperty(title)}`,
		]
			.filter(Boolean)
			.join(",");
		console.log(`::${level} ${props}::${escapeData(message)}`);
	};

	const warnOnly = argv[0] === "--warn";
	let files: string[];
	if (argv[0] === "--dry-run-output") {
		const transcriptPath = argv[1];
		if (!transcriptPath || !existsSync(transcriptPath)) {
			annotate(
				"error",
				"Migration gate",
				`dry-run transcript not found: ${transcriptPath ?? "(no path given)"}`,
			);
			return 2;
		}
		const plan = parsePendingMigrations(readFileSync(transcriptPath, "utf8"));
		if (plan.kind === "unrecognized") {
			annotate(
				"error",
				"Migration gate",
				`Could not read the pending migrations from \`supabase db push --dry-run\` (${plan.detail}); refusing to apply. Update parsePendingMigrations in scripts/db/scan-destructive-migrations.ts to the CLI output above.`,
			);
			return 2;
		}
		if (plan.files.length === 0) {
			console.log("No pending migrations.");
			return 0;
		}
		files = plan.files.map((name) => join("supabase", "migrations", name));
		console.log(
			`Pending migrations:\n${files.map((f) => `  ${f}`).join("\n")}`,
		);
	} else {
		files = warnOnly ? argv.slice(1) : argv;
	}

	if (files.length === 0) {
		annotate("error", "Migration gate", "no migration files given");
		return 2;
	}
	const missing = files.filter((file) => !existsSync(file));
	if (missing.length > 0) {
		annotate(
			"error",
			"Migration gate",
			`migration file not found: ${missing.join(", ")}`,
		);
		return 2;
	}

	let blocked = 0;
	for (const file of files) {
		for (const finding of scanMigrationSql(readFileSync(file, "utf8"))) {
			const location = { file, line: finding.line };
			if (finding.allowedReason !== null) {
				annotate(
					"notice",
					"Destructive statement allowed",
					`${finding.message}. Allowed: ${finding.allowedReason}`,
					location,
				);
				continue;
			}
			blocked++;
			annotate(
				warnOnly ? "warning" : "error",
				"Destructive migration",
				finding.statement
					? `${finding.message}: ${finding.statement}`
					: finding.message,
				location,
			);
		}
	}

	if (blocked === 0) {
		console.log(`No destructive statements in ${files.length} migration(s).`);
		return 0;
	}
	if (warnOnly) {
		annotate(
			"warning",
			"Destructive migration",
			`${blocked} destructive statement(s): after merge, migrate-prod will refuse to auto-apply them and block deploys until they are applied supervised per ${RUNBOOK}. If a statement is safe in context, annotate it with \`-- migration-safety: allow <reason>\`.`,
		);
		return 0;
	}
	annotate(
		"error",
		"Destructive migration pending",
		`${blocked} destructive statement(s) pending; not auto-applying. Apply them supervised per ${RUNBOOK}, then re-run this job. Annotate statements that are safe in context with \`-- migration-safety: allow <reason>\`.`,
	);
	return 1;
}

if (import.meta.main) {
	process.exit(main(process.argv.slice(2)));
}
