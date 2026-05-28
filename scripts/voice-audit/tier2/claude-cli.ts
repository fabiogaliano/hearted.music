// Runs the local `claude` CLI in print mode as a clean, tool-free LLM call, so a
// stronger model (Opus) can judge the generator's (Gemini) output without the
// self-preference bias of judging its own family. Spawned via child_process with
// shell:false, so the user's interactive `claude` alias never applies. CLAUDECODE
// is unset and tools/MCP/slash-commands stripped to mirror a pure-LLM invocation.

import { spawn } from "node:child_process";

export interface ClaudeCliResult {
	text: string;
	costUsd?: number;
}

export interface ClaudeCliOptions {
	model?: string;
	systemPromptFile?: string;
	timeoutMs?: number;
}

// `--output-format json` returns either a single result object or, on some
// versions, the full event array. The model's text lives in the result event's
// `.result`; pull it out of whichever shape we got.
function extractResult(stdout: string): { text: string; costUsd?: number } {
	const parsed = JSON.parse(stdout) as unknown;
	const events = Array.isArray(parsed) ? parsed : [parsed];
	const result = events.find(
		(e): e is { result?: unknown; total_cost_usd?: unknown } =>
			typeof e === "object" &&
			e !== null &&
			(e as { type?: unknown }).type === "result",
	);
	const carrier = result ?? (events[events.length - 1] as Record<string, unknown>);
	const text = carrier?.result;
	if (typeof text !== "string") {
		throw new Error("claude CLI returned no result text");
	}
	const cost = (carrier as { total_cost_usd?: unknown }).total_cost_usd;
	return { text, costUsd: typeof cost === "number" ? cost : undefined };
}

export function runClaude(
	prompt: string,
	options: ClaudeCliOptions = {},
): Promise<ClaudeCliResult> {
	const args = [
		"-p",
		"--model",
		options.model ?? "opus",
		"--output-format",
		"json",
		"--no-session-persistence",
		"--disable-slash-commands",
		"--strict-mcp-config",
		"--dangerously-skip-permissions",
		"--tools",
		"",
	];
	if (options.systemPromptFile) {
		args.push("--system-prompt-file", options.systemPromptFile);
	}

	const env = { ...process.env };
	delete env.CLAUDECODE;

	return new Promise((resolve, reject) => {
		const child = spawn("claude", args, { env, stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`claude CLI timed out after ${options.timeoutMs ?? 120_000}ms`));
		}, options.timeoutMs ?? 120_000);

		child.stdout.on("data", (d) => {
			stdout += d;
		});
		child.stderr.on("data", (d) => {
			stderr += d;
		});
		child.on("error", (err) => {
			clearTimeout(timeout);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timeout);
			if (code !== 0) {
				reject(new Error(`claude CLI exited ${code}: ${stderr.trim() || stdout.trim()}`));
				return;
			}
			try {
				resolve(extractResult(stdout));
			} catch (err) {
				reject(
					new Error(
						`failed to parse claude CLI output: ${(err as Error).message}\n${stdout.slice(0, 500)}`,
					),
				);
			}
		});

		child.stdin.write(prompt);
		child.stdin.end();
	});
}
