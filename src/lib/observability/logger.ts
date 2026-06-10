type LogLevel = "info" | "warn" | "error" | "debug";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

const LEVEL_CONFIG = {
	info: { tag: "INF", color: "\x1b[32m" },
	warn: { tag: "WRN", color: "\x1b[33m" },
	error: { tag: "ERR", color: "\x1b[31m" },
	debug: { tag: "DBG", color: "\x1b[90m" },
} as const satisfies Record<LogLevel, { tag: string; color: string }>;

const KEY_SHORT: Record<string, string> = {
	jobId: "job",
	accountId: "acct",
	workflow: "wf",
	error: "err",
	activeJobs: "active",
	remainingMs: "remaining",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/;

function fmtVal(v: unknown): string {
	if (typeof v === "string") return UUID_RE.test(v) ? v.slice(0, 8) : v;
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	if (Array.isArray(v)) {
		if (v.length <= 3) return v.map(fmtVal).join(",");
		return `[${v.length} items]`;
	}
	if (v !== null && typeof v === "object") return JSON.stringify(v);
	return String(v);
}

function formatPretty(
	level: LogLevel,
	event: string,
	data?: Record<string, unknown>,
): string {
	const { tag, color } = LEVEL_CONFIG[level];
	const ts = new Date().toISOString().slice(11, 19);
	const parts = [
		`${DIM}${ts}${RESET}`,
		`${color}${tag}${RESET}`,
		`${BOLD}${event}${RESET}`,
	];

	if (data) {
		for (const [k, v] of Object.entries(data)) {
			if (v === undefined) continue;
			const key = KEY_SHORT[k] ?? k;
			parts.push(`${DIM}${key}=${RESET}${fmtVal(v)}`);
		}
	}

	return parts.join(" ");
}

function formatJson(
	level: LogLevel,
	event: string,
	data?: Record<string, unknown>,
): string {
	return JSON.stringify({
		ts: new Date().toISOString(),
		level,
		worker: true,
		event,
		...data,
	});
}

const useJson =
	process.env.NODE_ENV === "production" ||
	process.env.WORKER_LOG_FORMAT === "json";
const fmt = useJson ? formatJson : formatPretty;

export const log = {
	info: (event: string, data?: Record<string, unknown>) =>
		console.log(fmt("info", event, data)),
	warn: (event: string, data?: Record<string, unknown>) =>
		console.warn(fmt("warn", event, data)),
	error: (event: string, data?: Record<string, unknown>) =>
		console.error(fmt("error", event, data)),
	debug: (event: string, data?: Record<string, unknown>) => {
		if (process.env.WORKER_DEBUG === "true")
			console.debug(fmt("debug", event, data));
	},
};
