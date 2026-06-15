import { describe, expect, it } from "vitest";
import { runCommand } from "../spawn";

describe("runCommand spawn robustness", () => {
	it("resolves with a non-zero exit when the binary cannot be spawned, never throws", async () => {
		const res = await runCommand(
			["hearted-nonexistent-binary-xyz", "--version"],
			{ timeoutMs: 5_000 },
		);
		// A spawn failure (ENOENT) is surfaced as a normal non-zero result, not an
		// exception — so checkYtDlpAvailable sees a failure instead of the worker
		// loop crashing.
		expect(res.timedOut).toBe(false);
		expect(res.exitCode).not.toBe(0);
		expect(typeof res.stdout).toBe("string");
		expect(typeof res.stderr).toBe("string");
	});
});
