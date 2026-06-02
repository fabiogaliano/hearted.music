import { describe, expect, it } from "vitest";
import {
	escapeLikePattern,
	parseArgs,
	previewDryRunOutcome,
} from "../grant-liked-song-access";

function argv(...args: string[]): string[] {
	return ["bun", "grant-liked-song-access.ts", ...args];
}

describe("parseArgs", () => {
	it("resolves a positional email selector", () => {
		const options = parseArgs(argv("user@example.com"));
		expect(options.selector).toEqual({ kind: "email", value: "user@example.com" });
		expect(options.dryRun).toBe(false);
	});

	it("resolves an --account-id selector", () => {
		const options = parseArgs(argv("--account-id", "abc-123"));
		expect(options.selector).toEqual({ kind: "account-id", value: "abc-123" });
	});

	it("resolves a --spotify-id selector", () => {
		const options = parseArgs(argv("--spotify-id", "spotify-user"));
		expect(options.selector).toEqual({
			kind: "spotify-id",
			value: "spotify-user",
		});
	});

	it("parses audit flags and dry-run alongside an email without confusing flag values", () => {
		const options = parseArgs(
			argv(
				"user@example.com",
				"--reason",
				"VIP beta",
				"--requested-by",
				"ops@hearted",
				"--dry-run",
			),
		);
		expect(options.selector).toEqual({ kind: "email", value: "user@example.com" });
		expect(options.reason).toBe("VIP beta");
		expect(options.requestedBy).toBe("ops@hearted");
		expect(options.dryRun).toBe(true);
	});

	it("throws when no selector is provided", () => {
		expect(() => parseArgs(argv("--dry-run"))).toThrow(/selector/i);
	});

	it("throws when a flag is missing its value", () => {
		expect(() => parseArgs(argv("user@example.com", "--reason"))).toThrow(
			/Missing value for --reason/,
		);
	});
});

describe("previewDryRunOutcome", () => {
	it("reports already_applied when the grant row is already applied", () => {
		expect(
			previewDryRunOutcome({ applied_at: "2026-01-01T00:00:00Z" }, 25),
		).toEqual({ status: "already_applied" });
	});

	it("reports pending_no_liked_songs when a pending row already exists", () => {
		expect(previewDryRunOutcome({ applied_at: null }, 0)).toEqual({
			status: "pending_no_liked_songs",
		});
	});

	it("reports pending-row creation when no row exists and no songs are liked", () => {
		expect(previewDryRunOutcome(null, 0)).toEqual({
			status: "would_create_pending",
		});
	});

	it("caps the projected apply count at 500 and distinguishes pending-vs-new", () => {
		expect(previewDryRunOutcome(null, 620)).toEqual({
			status: "would_apply",
			candidateCount: 500,
			fromPending: false,
		});
		expect(previewDryRunOutcome({ applied_at: null }, 12)).toEqual({
			status: "would_apply",
			candidateCount: 12,
			fromPending: true,
		});
	});
});

describe("escapeLikePattern", () => {
	it("escapes ilike wildcards so literal email characters are not patterns", () => {
		expect(escapeLikePattern("john_doe@example.com")).toBe(
			"john\\_doe@example.com",
		);
		expect(escapeLikePattern("a%b@example.com")).toBe("a\\%b@example.com");
		expect(escapeLikePattern("back\\slash@example.com")).toBe(
			"back\\\\slash@example.com",
		);
	});

	it("leaves a plain email unchanged", () => {
		expect(escapeLikePattern("plain@example.com")).toBe("plain@example.com");
	});
});
