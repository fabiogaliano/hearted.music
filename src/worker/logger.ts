type LogLevel = "info" | "warn" | "error" | "debug";

function formatLog(
	level: LogLevel,
	event: string,
	data?: Record<string, unknown>,
) {
	const entry = {
		ts: new Date().toISOString(),
		level,
		worker: true,
		event,
		...data,
	};
	return JSON.stringify(entry);
}

export const log = {
	info: (event: string, data?: Record<string, unknown>) =>
		console.log(formatLog("info", event, data)),
	warn: (event: string, data?: Record<string, unknown>) =>
		console.warn(formatLog("warn", event, data)),
	error: (event: string, data?: Record<string, unknown>) =>
		console.error(formatLog("error", event, data)),
	debug: (event: string, data?: Record<string, unknown>) => {
		if (process.env.WORKER_DEBUG === "true")
			console.debug(formatLog("debug", event, data));
	},
};
