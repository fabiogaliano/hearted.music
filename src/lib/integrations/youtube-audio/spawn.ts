/**
 * Thin Bun.spawn wrapper used by the yt-dlp and ffmpeg modules. Always argv
 * arrays (never a shell string) so untrusted titles/URLs can't be interpreted,
 * and a hard timeout that kills the child so a hung binary can't pin a worker.
 */

export interface SpawnResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
}

export async function runCommand(
	cmd: string[],
	opts: { timeoutMs: number },
): Promise<SpawnResult> {
	let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
	try {
		proc = Bun.spawn({
			cmd,
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
		});
	} catch (err) {
		// A missing binary (ENOENT) throws synchronously from Bun.spawn. Surface it
		// as a non-zero exit (127, the conventional "command not found") so callers
		// like checkYtDlpAvailable see a normal failure instead of an exception
		// pinning the worker loop.
		return {
			stdout: "",
			stderr: err instanceof Error ? err.message : String(err),
			exitCode: 127,
			timedOut: false,
		};
	}

	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill(9);
	}, opts.timeoutMs);

	try {
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const exitCode = await proc.exited;
		return { stdout, stderr, exitCode, timedOut };
	} finally {
		clearTimeout(timer);
	}
}
