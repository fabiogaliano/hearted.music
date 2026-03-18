import { describe, it, expect, vi, beforeEach } from "vitest";
import { Result } from "better-result";
import type { MatchDecision } from "./match-decision-queries";

let upsertResponse: { data: unknown; error: unknown };
let selectResponse: { data: unknown; error: unknown };

let lastUpsertArgs: { data: unknown; options: unknown } | null = null;
let isUpsertPath = false;
let lastChain: Record<string, ReturnType<typeof vi.fn>> | null = null;

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(() => ({
		from: vi.fn((_table: string) => {
			isUpsertPath = false;

			const chain: Record<string, ReturnType<typeof vi.fn>> = {
				select: vi.fn().mockReturnThis(),
				upsert: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				in: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				single: vi.fn(),
			};

			chain.upsert = vi.fn((data: unknown, options: unknown) => {
				isUpsertPath = true;
				lastUpsertArgs = { data, options };
				return chain;
			});

			chain.select = vi.fn(() => {
				if (isUpsertPath) {
					// For upsert().select() — return chain so .single() can resolve
					return chain;
				}
				// For select("*") read path — the chain continues with .eq()
				return chain;
			});

			chain.single = vi.fn(() => {
				return upsertResponse;
			});

			// Terminal for many-row queries (no .single())
			const originalOrder = chain.order;
			chain.order = vi.fn((...args: unknown[]) => {
				originalOrder(...args);
				if (!isUpsertPath) {
					return selectResponse;
				}
				return chain;
			});

			// For upsert().select() without .single() (batch path)
			chain.select = vi.fn((..._args: unknown[]) => {
				if (isUpsertPath) {
					return {
						...upsertResponse,
						single: vi.fn(() => upsertResponse),
					};
				}
				return chain;
			});

			lastChain = chain;
			return chain;
		}),
	})),
}));

import {
	insertMatchDecision,
	insertMatchDecisions,
	getMatchDecisions,
	getMatchDecisionsForSongs,
} from "./match-decision-queries";

const ACCOUNT_ID = "acct-test-123";
const SONG_ID = "song-001";
const PLAYLIST_ID = "playlist-001";

function fakeDecision(overrides: Partial<MatchDecision> = {}): MatchDecision {
	return {
		id: "dec-001",
		account_id: ACCOUNT_ID,
		song_id: SONG_ID,
		playlist_id: PLAYLIST_ID,
		decision: "added",
		decided_at: "2026-03-17T00:00:00Z",
		created_at: "2026-03-17T00:00:00Z",
		...overrides,
	};
}

describe("insertMatchDecision", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		upsertResponse = { data: null, error: null };
		selectResponse = { data: null, error: null };
		lastUpsertArgs = null;
		lastChain = null;
	});

	it("returns the upserted decision on success", async () => {
		const decision = fakeDecision();
		upsertResponse = { data: decision, error: null };

		const result = await insertMatchDecision(
			ACCOUNT_ID,
			SONG_ID,
			PLAYLIST_ID,
			"added",
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.id).toBe("dec-001");
			expect(result.value.decision).toBe("added");
			expect(result.value.account_id).toBe(ACCOUNT_ID);
		}
	});

	it("uses upsert with the correct onConflict clause and mapped data", async () => {
		upsertResponse = { data: fakeDecision(), error: null };

		await insertMatchDecision(ACCOUNT_ID, SONG_ID, PLAYLIST_ID, "added");

		expect(lastUpsertArgs).not.toBeNull();
		expect(lastUpsertArgs!.options).toEqual({
			onConflict: "account_id,song_id,playlist_id",
		});

		const data = lastUpsertArgs!.data as Record<string, unknown>;
		expect(data.account_id).toBe(ACCOUNT_ID);
		expect(data.song_id).toBe(SONG_ID);
		expect(data.playlist_id).toBe(PLAYLIST_ID);
		expect(data.decision).toBe("added");
		expect(data.decided_at).toBeDefined();
	});

	it("returns a ConstraintError on foreign key violation", async () => {
		upsertResponse = {
			data: null,
			error: {
				code: "23503",
				message: "foreign key violation",
				details: "song_id does not exist",
			},
		};

		const result = await insertMatchDecision(
			ACCOUNT_ID,
			"bad-song",
			PLAYLIST_ID,
			"added",
		);

		expect(result).toBeErr();
		if (Result.isError(result)) {
			expect(result.error._tag).toBe("ConstraintError");
		}
	});

	it("returns a DatabaseError on unexpected failure", async () => {
		upsertResponse = {
			data: null,
			error: { code: "PGRST301", message: "connection refused" },
		};

		const result = await insertMatchDecision(
			ACCOUNT_ID,
			SONG_ID,
			PLAYLIST_ID,
			"added",
		);

		expect(result).toBeErr();
		if (Result.isError(result)) {
			expect(result.error._tag).toBe("DatabaseError");
			expect(result.error.message).toBe("connection refused");
		}
	});
});

describe("insertMatchDecisions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		upsertResponse = { data: null, error: null };
		selectResponse = { data: null, error: null };
		lastUpsertArgs = null;
		lastChain = null;
	});

	it("returns empty array for empty input without calling supabase", async () => {
		const result = await insertMatchDecisions([]);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toEqual([]);
		}
	});

	it("returns upserted decisions on success", async () => {
		const decisions = [
			fakeDecision({ id: "dec-001", song_id: "song-001" }),
			fakeDecision({ id: "dec-002", song_id: "song-002" }),
		];
		upsertResponse = { data: decisions, error: null };

		const result = await insertMatchDecisions([
			{
				accountId: ACCOUNT_ID,
				songId: "song-001",
				playlistId: PLAYLIST_ID,
				decision: "added",
			},
			{
				accountId: ACCOUNT_ID,
				songId: "song-002",
				playlistId: PLAYLIST_ID,
				decision: "dismissed",
			},
		]);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toHaveLength(2);
		}
	});

	it("passes correct onConflict and maps camelCase to snake_case", async () => {
		upsertResponse = { data: [fakeDecision()], error: null };

		await insertMatchDecisions([
			{
				accountId: ACCOUNT_ID,
				songId: SONG_ID,
				playlistId: PLAYLIST_ID,
				decision: "added",
			},
		]);

		expect(lastUpsertArgs).not.toBeNull();
		expect(lastUpsertArgs!.options).toEqual({
			onConflict: "account_id,song_id,playlist_id",
		});

		const rows = lastUpsertArgs!.data as Record<string, unknown>[];
		expect(rows).toHaveLength(1);
		expect(rows[0].account_id).toBe(ACCOUNT_ID);
		expect(rows[0].song_id).toBe(SONG_ID);
		expect(rows[0].playlist_id).toBe(PLAYLIST_ID);
		expect(rows[0].decision).toBe("added");
	});

	it("returns error on database failure", async () => {
		upsertResponse = {
			data: null,
			error: { code: "PGRST301", message: "timeout" },
		};

		const result = await insertMatchDecisions([
			{
				accountId: ACCOUNT_ID,
				songId: SONG_ID,
				playlistId: PLAYLIST_ID,
				decision: "added",
			},
		]);

		expect(result).toBeErr();
		if (Result.isError(result)) {
			expect(result.error._tag).toBe("DatabaseError");
		}
	});
});

describe("getMatchDecisions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		upsertResponse = { data: null, error: null };
		selectResponse = { data: null, error: null };
	});

	it("returns all decisions for an account", async () => {
		const decisions = [
			fakeDecision({ id: "dec-001" }),
			fakeDecision({ id: "dec-002", decision: "dismissed" }),
		];
		selectResponse = { data: decisions, error: null };

		const result = await getMatchDecisions(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toHaveLength(2);
			expect(result.value[0].id).toBe("dec-001");
		}
	});

	it("returns empty array when no decisions exist", async () => {
		selectResponse = { data: [], error: null };

		const result = await getMatchDecisions(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toEqual([]);
		}
	});

	it("returns error on database failure", async () => {
		selectResponse = {
			data: null,
			error: { code: "PGRST301", message: "connection refused" },
		};

		const result = await getMatchDecisions(ACCOUNT_ID);

		expect(result).toBeErr();
		if (Result.isError(result)) {
			expect(result.error._tag).toBe("DatabaseError");
		}
	});
});

describe("getMatchDecisionsForSongs", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		upsertResponse = { data: null, error: null };
		selectResponse = { data: null, error: null };
		lastChain = null;
	});

	it("returns empty array for empty songIds without calling supabase", async () => {
		const result = await getMatchDecisionsForSongs(ACCOUNT_ID, []);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toEqual([]);
		}
	});

	it("returns decisions filtered by account and song IDs", async () => {
		const decisions = [
			fakeDecision({ id: "dec-001", song_id: "song-001" }),
			fakeDecision({ id: "dec-002", song_id: "song-002" }),
		];
		selectResponse = { data: decisions, error: null };

		const result = await getMatchDecisionsForSongs(ACCOUNT_ID, [
			"song-001",
			"song-002",
		]);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toHaveLength(2);
		}

		expect(lastChain!.eq).toHaveBeenCalledWith("account_id", ACCOUNT_ID);
		expect(lastChain!.in).toHaveBeenCalledWith("song_id", [
			"song-001",
			"song-002",
		]);
	});

	it("returns error on database failure", async () => {
		selectResponse = {
			data: null,
			error: { code: "42501", message: "permission denied" },
		};

		const result = await getMatchDecisionsForSongs(ACCOUNT_ID, ["song-001"]);

		expect(result).toBeErr();
		if (Result.isError(result)) {
			expect(result.error._tag).toBe("RLSError");
		}
	});
});
