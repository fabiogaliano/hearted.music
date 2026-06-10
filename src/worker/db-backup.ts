import { constants as fsConstants } from "node:fs";
import {
	access,
	mkdir,
	readdir,
	rename,
	rm,
	stat,
	unlink,
} from "node:fs/promises";
import { join } from "node:path";
import * as Sentry from "@sentry/bun";
import { log } from "@/lib/observability/logger";
import { errorMessage } from "@/lib/shared/errors/error-message";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BACKUP_DIRECTORY = "/backups";
const DEFAULT_BACKUP_PREFIX = "hearted";
const DEFAULT_BACKUP_RETENTION_DAYS = 7;
const DEFAULT_BACKUP_SCHEDULE_HOUR_UTC = 3;
const DEFAULT_BACKUP_SCHEDULE_MINUTE_UTC = 0;

type BackupConnectionKind = "direct" | "session-pooler" | "transaction-pooler";

type BackupTrigger = "scheduled" | "startup-catch-up";

type BackupConfigIssueCode =
	| "invalid-backup-directory"
	| "invalid-backup-prefix"
	| "invalid-database-url"
	| "invalid-retention-days"
	| "invalid-schedule-hour"
	| "invalid-schedule-minute"
	| "missing-database-password"
	| "missing-database-url"
	| "transaction-pooler-unsupported";

type BackupConfigIssue = {
	code: BackupConfigIssueCode;
	message: string;
};

type BackupConnectionConfig = {
	database: string;
	host: string;
	kind: BackupConnectionKind;
	password: string;
	port: string;
	sslMode?: string;
	user: string;
};

type EnabledBackupConfig = {
	directory: string;
	filenamePrefix: string;
	hourUtc: number;
	minRetentionDays: number;
	minuteUtc: number;
	url: string;
	connection: BackupConnectionConfig;
};

type DatabaseBackupConfigResult =
	| { kind: "disabled" }
	| { kind: "invalid"; issue: BackupConfigIssue }
	| { kind: "enabled"; config: EnabledBackupConfig };

type BackupSchedule = {
	hourUtc: number;
	minuteUtc: number;
};

type BackupRunResult =
	| {
			kind: "ok";
			bytes: number;
			durationMs: number;
			path: string;
	  }
	| {
			kind: "error";
			message: string;
			stderr?: string;
	  };

function parseBooleanEnv(value: string | undefined): boolean {
	return value === "true";
}

function parseIntegerEnv(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (value.trim().length === 0) return undefined;
	const parsed = Number(value);
	if (!Number.isInteger(parsed)) return undefined;
	return parsed;
}

function isLocalHost(hostname: string): boolean {
	return (
		hostname === "localhost" ||
		hostname === "::1" ||
		hostname.startsWith("127.")
	);
}

function inferSslMode(url: URL): string | undefined {
	const configuredMode = url.searchParams.get("sslmode");
	if (configuredMode) return configuredMode;
	return isLocalHost(url.hostname) ? undefined : "require";
}

function formatUtcTimestamp(date: Date): string {
	const year = String(date.getUTCFullYear());
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	const hour = String(date.getUTCHours()).padStart(2, "0");
	const minute = String(date.getUTCMinutes()).padStart(2, "0");
	return `${year}-${month}-${day}-${hour}${minute}`;
}

function sanitizeDatabaseComponent(component: string): string {
	return decodeURIComponent(component);
}

function buildBackupFilename(config: EnabledBackupConfig, now: Date): string {
	return `${config.filenamePrefix}-${formatUtcTimestamp(now)}.dump`;
}

function getBackupSchedule(config: EnabledBackupConfig): BackupSchedule {
	return { hourUtc: config.hourUtc, minuteUtc: config.minuteUtc };
}

function parseBackupDirectory(value: string | undefined): string | undefined {
	if (value === undefined) return DEFAULT_BACKUP_DIRECTORY;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function parseBackupPrefix(value: string | undefined): string | undefined {
	if (value === undefined) return DEFAULT_BACKUP_PREFIX;
	const trimmed = value.trim();
	if (trimmed.length === 0) return undefined;
	return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : undefined;
}

function parseHourUtc(value: string | undefined): number | undefined {
	const parsed = parseIntegerEnv(value);
	if (parsed === undefined) return DEFAULT_BACKUP_SCHEDULE_HOUR_UTC;
	if (parsed < 0 || parsed > 23) return undefined;
	return parsed;
}

function parseMinuteUtc(value: string | undefined): number | undefined {
	const parsed = parseIntegerEnv(value);
	if (parsed === undefined) return DEFAULT_BACKUP_SCHEDULE_MINUTE_UTC;
	if (parsed < 0 || parsed > 59) return undefined;
	return parsed;
}

function parseRetentionDays(value: string | undefined): number | undefined {
	const parsed = parseIntegerEnv(value);
	if (parsed === undefined) return DEFAULT_BACKUP_RETENTION_DAYS;
	if (parsed < 1) return undefined;
	return parsed;
}

export function classifyDatabaseConnection(url: URL): BackupConnectionKind {
	if (!url.hostname.includes("pooler")) return "direct";
	return url.port === "6543" ? "transaction-pooler" : "session-pooler";
}

export function getLatestScheduledSlotAtOrBefore(
	now: Date,
	schedule: BackupSchedule,
): Date {
	const latest = new Date(now.getTime());
	latest.setUTCHours(schedule.hourUtc, schedule.minuteUtc, 0, 0);
	if (latest.getTime() <= now.getTime()) return latest;
	latest.setUTCDate(latest.getUTCDate() - 1);
	return latest;
}

export function msUntilNextScheduledBackup(
	now: Date,
	schedule: BackupSchedule,
): number {
	const next = new Date(now.getTime());
	next.setUTCHours(schedule.hourUtc, schedule.minuteUtc, 0, 0);
	if (next.getTime() <= now.getTime()) {
		next.setUTCDate(next.getUTCDate() + 1);
	}
	return Math.max(0, next.getTime() - now.getTime());
}

export function shouldRunStartupCatchUp(
	latestCompletedBackupMs: number | null,
	now: Date,
	schedule: BackupSchedule,
): boolean {
	if (latestCompletedBackupMs === null) return true;
	const latestScheduledSlot = getLatestScheduledSlotAtOrBefore(now, schedule);
	return latestCompletedBackupMs < latestScheduledSlot.getTime();
}

export function createDatabaseBackupConfig(
	env: NodeJS.ProcessEnv,
): DatabaseBackupConfigResult {
	if (!parseBooleanEnv(env.BACKUP_ENABLED)) {
		return { kind: "disabled" };
	}

	const directory = parseBackupDirectory(env.BACKUP_DIR);
	if (!directory) {
		return {
			kind: "invalid",
			issue: {
				code: "invalid-backup-directory",
				message: "BACKUP_DIR must be a non-empty absolute path.",
			},
		};
	}

	if (!directory.startsWith("/")) {
		return {
			kind: "invalid",
			issue: {
				code: "invalid-backup-directory",
				message: "BACKUP_DIR must be an absolute path inside the container.",
			},
		};
	}

	const filenamePrefix = parseBackupPrefix(env.BACKUP_FILE_PREFIX);
	if (!filenamePrefix) {
		return {
			kind: "invalid",
			issue: {
				code: "invalid-backup-prefix",
				message:
					"BACKUP_FILE_PREFIX may only contain letters, numbers, dot, dash, and underscore.",
			},
		};
	}

	const retentionDays = parseRetentionDays(env.BACKUP_RETENTION_DAYS);
	if (retentionDays === undefined) {
		return {
			kind: "invalid",
			issue: {
				code: "invalid-retention-days",
				message: "BACKUP_RETENTION_DAYS must be an integer greater than 0.",
			},
		};
	}

	const hourUtc = parseHourUtc(env.BACKUP_SCHEDULE_HOUR_UTC);
	if (hourUtc === undefined) {
		return {
			kind: "invalid",
			issue: {
				code: "invalid-schedule-hour",
				message: "BACKUP_SCHEDULE_HOUR_UTC must be an integer from 0 to 23.",
			},
		};
	}

	const minuteUtc = parseMinuteUtc(env.BACKUP_SCHEDULE_MINUTE_UTC);
	if (minuteUtc === undefined) {
		return {
			kind: "invalid",
			issue: {
				code: "invalid-schedule-minute",
				message: "BACKUP_SCHEDULE_MINUTE_UTC must be an integer from 0 to 59.",
			},
		};
	}

	const url = env.BACKUP_DATABASE_URL?.trim() || env.DATABASE_URL?.trim();
	if (!url) {
		return {
			kind: "invalid",
			issue: {
				code: "missing-database-url",
				message:
					"Set BACKUP_DATABASE_URL or DATABASE_URL before enabling worker backups.",
			},
		};
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(url);
	} catch {
		return {
			kind: "invalid",
			issue: {
				code: "invalid-database-url",
				message:
					"BACKUP_DATABASE_URL must be a valid postgres connection string.",
			},
		};
	}

	if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
		return {
			kind: "invalid",
			issue: {
				code: "invalid-database-url",
				message:
					"BACKUP_DATABASE_URL must use the postgres:// or postgresql:// scheme.",
			},
		};
	}

	const connectionKind = classifyDatabaseConnection(parsedUrl);
	if (connectionKind === "transaction-pooler") {
		return {
			kind: "invalid",
			issue: {
				code: "transaction-pooler-unsupported",
				message:
					"pg_dump needs a stable session. Use a direct connection or Supabase session pooler on port 5432, never the transaction pooler on 6543.",
			},
		};
	}

	const username = sanitizeDatabaseComponent(parsedUrl.username);
	const password = sanitizeDatabaseComponent(parsedUrl.password);
	const database = sanitizeDatabaseComponent(
		parsedUrl.pathname.replace(/^\//, ""),
	);
	const host = parsedUrl.hostname;
	const port = parsedUrl.port || "5432";
	const sslMode = inferSslMode(parsedUrl);

	if (!host || !username || !database) {
		return {
			kind: "invalid",
			issue: {
				code: "invalid-database-url",
				message:
					"BACKUP_DATABASE_URL must include host, username, and database name.",
			},
		};
	}

	if (!password) {
		return {
			kind: "invalid",
			issue: {
				code: "missing-database-password",
				message:
					"BACKUP_DATABASE_URL must include a password so pg_dump can run non-interactively.",
			},
		};
	}

	return {
		kind: "enabled",
		config: {
			directory,
			filenamePrefix,
			hourUtc,
			minRetentionDays: retentionDays,
			minuteUtc,
			url,
			connection: {
				database,
				host,
				kind: connectionKind,
				password,
				port,
				sslMode,
				user: username,
			},
		},
	};
}

async function collectBackupFiles(
	config: EnabledBackupConfig,
): Promise<string[]> {
	try {
		const entries = await readdir(config.directory, { withFileTypes: true });
		return entries
			.filter(
				(entry) =>
					entry.isFile() &&
					entry.name.startsWith(`${config.filenamePrefix}-`) &&
					entry.name.endsWith(".dump"),
			)
			.map((entry) => join(config.directory, entry.name));
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

// Backup recency comes from the UTC timestamp encoded in the filename by
// buildBackupFilename, never from file mtime: a restore, rsync, or container
// remount rewrites mtime without changing backup content, which would silently
// corrupt catch-up scheduling and retention pruning.
const BACKUP_TIMESTAMP_PATTERN =
	/-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.dump$/;

function parseBackupTimestampMs(filePath: string): number | null {
	const match = BACKUP_TIMESTAMP_PATTERN.exec(filePath);
	if (!match) return null;
	const [, year, month, day, hour, minute] = match;
	return Date.UTC(
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
	);
}

async function readLatestCompletedBackupMs(
	config: EnabledBackupConfig,
): Promise<number | null> {
	const backupFiles = await collectBackupFiles(config);
	let latestBackupMs: number | null = null;

	for (const filePath of backupFiles) {
		const backupMs = parseBackupTimestampMs(filePath);
		if (backupMs === null) continue;
		if (latestBackupMs === null || backupMs > latestBackupMs) {
			latestBackupMs = backupMs;
		}
	}

	return latestBackupMs;
}

async function ensureBackupDirectory(
	config: EnabledBackupConfig,
): Promise<void> {
	await mkdir(config.directory, { recursive: true });
	await access(config.directory, fsConstants.W_OK);
}

async function removeExpiredBackups(
	config: EnabledBackupConfig,
): Promise<number> {
	const cutoffMs = Date.now() - config.minRetentionDays * DAY_MS;
	const backupFiles = await collectBackupFiles(config);
	let deletedCount = 0;

	for (const filePath of backupFiles) {
		const backupMs = parseBackupTimestampMs(filePath);
		// Leave files with an unrecognized timestamp untouched: retention must
		// never delete a backup it cannot reliably date.
		if (backupMs === null || backupMs >= cutoffMs) continue;
		await unlink(filePath);
		deletedCount += 1;
	}

	return deletedCount;
}

async function readStreamText(
	stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
	if (!stream) return "";
	return new Response(stream).text();
}

async function runBackup(
	config: EnabledBackupConfig,
	trigger: BackupTrigger,
	onProcessStart: (kill: (() => void) | undefined) => void,
): Promise<BackupRunResult> {
	const startedAt = Date.now();
	const fileName = buildBackupFilename(config, new Date(startedAt));
	const outputPath = join(config.directory, fileName);
	const temporaryPath = `${outputPath}.partial`;

	await ensureBackupDirectory(config);
	await rm(temporaryPath, { force: true });

	const pgEnv: Record<string, string> = {
		...process.env,
		PGAPPNAME: "hearted-worker-backup",
		PGDATABASE: config.connection.database,
		PGHOST: config.connection.host,
		PGPASSWORD: config.connection.password,
		PGPORT: config.connection.port,
		PGUSER: config.connection.user,
	};

	if (config.connection.sslMode) {
		pgEnv.PGSSLMODE = config.connection.sslMode;
	}

	const subprocess = Bun.spawn(
		["pg_dump", "--format=custom", "--file", temporaryPath, "--no-password"],
		{
			env: pgEnv,
			stderr: "pipe",
			stdout: "ignore",
		},
	);

	onProcessStart(() => subprocess.kill());

	const [exitCode, stderr] = await Promise.all([
		subprocess.exited,
		readStreamText(subprocess.stderr),
	]);
	onProcessStart(undefined);

	if (exitCode !== 0) {
		await rm(temporaryPath, { force: true });
		return {
			kind: "error",
			message: `pg_dump exited with code ${exitCode} during ${trigger}.`,
			stderr: stderr.trim() || undefined,
		};
	}

	await rename(temporaryPath, outputPath);
	const outputStat = await stat(outputPath);
	const deletedCount = await removeExpiredBackups(config);
	const durationMs = Date.now() - startedAt;

	log.info("db-backup-succeeded", {
		bytes: outputStat.size,
		deletedExpiredBackups: deletedCount,
		durationMs,
		path: outputPath,
		trigger,
	});

	return {
		kind: "ok",
		bytes: outputStat.size,
		durationMs,
		path: outputPath,
	};
}

export function startDatabaseBackupScheduler(): { stop: () => void } {
	const backupConfig = createDatabaseBackupConfig(process.env);
	if (backupConfig.kind === "disabled") {
		log.info("db-backup-disabled");
		return { stop: () => {} };
	}

	if (backupConfig.kind === "invalid") {
		log.error("db-backup-config-invalid", backupConfig.issue);
		Sentry.captureMessage(
			`Database backup configuration invalid: ${backupConfig.issue.message}`,
			{
				level: "error",
				tags: { feature: "db-backup", code: backupConfig.issue.code },
			},
		);
		return { stop: () => {} };
	}

	const { config } = backupConfig;
	const schedule = getBackupSchedule(config);
	let currentTimeout: ReturnType<typeof setTimeout> | undefined;
	let currentInterval: ReturnType<typeof setInterval> | undefined;
	let stopCurrentProcess: (() => void) | undefined;
	let stopped = false;
	let backupInFlight = false;

	const setCurrentProcess = (kill: (() => void) | undefined) => {
		stopCurrentProcess = kill;
	};

	const executeBackup = async (trigger: BackupTrigger) => {
		if (backupInFlight) {
			log.warn("db-backup-skipped-already-running", { trigger });
			return;
		}

		backupInFlight = true;
		try {
			const result = await runBackup(config, trigger, setCurrentProcess);
			if (result.kind === "error") {
				log.error("db-backup-failed", {
					message: result.message,
					stderr: result.stderr,
					trigger,
				});
				Sentry.captureMessage(result.message, {
					level: "error",
					extra: { stderr: result.stderr, trigger },
					tags: { feature: "db-backup" },
				});
			}
		} catch (error) {
			const message = errorMessage(error);
			log.error("db-backup-failed", { error: message, trigger });
			Sentry.captureException(error, {
				tags: { feature: "db-backup", trigger },
			});
		} finally {
			backupInFlight = false;
			setCurrentProcess(undefined);
		}
	};

	const scheduleNextRun = () => {
		const delayMs = msUntilNextScheduledBackup(new Date(), schedule);
		const nextRunAt = new Date(Date.now() + delayMs).toISOString();
		log.info("db-backup-scheduled", {
			connectionKind: config.connection.kind,
			directory: config.directory,
			nextRunAt,
			retentionDays: config.minRetentionDays,
			urlSource: process.env.BACKUP_DATABASE_URL
				? "BACKUP_DATABASE_URL"
				: "DATABASE_URL",
		});

		currentTimeout = setTimeout(() => {
			void executeBackup("scheduled");
			currentInterval = setInterval(() => {
				void executeBackup("scheduled");
			}, DAY_MS);
		}, delayMs);
	};

	void (async () => {
		const latestBackupMs = await readLatestCompletedBackupMs(config);
		if (shouldRunStartupCatchUp(latestBackupMs, new Date(), schedule)) {
			await executeBackup("startup-catch-up");
		}
		if (!stopped) scheduleNextRun();
	})().catch((error) => {
		const message = errorMessage(error);
		log.error("db-backup-scheduler-failed", { error: message });
		Sentry.captureException(error, {
			tags: { feature: "db-backup", phase: "scheduler-start" },
		});
	});

	return {
		stop: () => {
			stopped = true;
			if (currentTimeout) clearTimeout(currentTimeout);
			if (currentInterval) clearInterval(currentInterval);
			stopCurrentProcess?.();
		},
	};
}
