/**
 * rank_playlist_draft_preview (20261028130200) against the TypeScript
 * reference it replaces on the request path: loadPhase1Candidates →
 * selectEligibleCandidates → buildDraftProfile → rankCandidates, assembled the
 * way runPreviewPlaylistDraft did before the ranking moved into Postgres.
 *
 * Both sides read the same seeded library, so any difference is the SQL
 * diverging from the reference: same order (score, then liked_at, then song
 * id), same total_eligible and pool size, scores within 1e-9. A
 * hand-calculated trio keeps the reference itself honest.
 *
 * Seeds via postgres.js (DATABASE_URL) and reads through the admin Supabase
 * client. Auto-skipped unless both point at the local stack.
 */

import { Result } from "better-result";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { getSongEmbeddingsBatch } from "@/lib/domains/enrichment/embeddings/queries";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import {
	makePreviewRankLibrary,
	makePreviewRankTrio,
	PREVIEW_RANK_EMBEDDING_MODEL,
	type PreviewRankSong,
} from "@/test/fixtures";
import { loadPhase1Candidates } from "../candidate-loader";
import { SUGGESTIONS_COUNT } from "../constants";
import {
	buildDraftProfile,
	composePlaylistPreview,
	type RankedSong,
	rankCandidates,
	selectEligibleCandidates,
} from "../draft-engine";
import {
	type PreviewRankInput,
	type PreviewRanking,
	rankPreviewCandidates,
} from "../preview-rank-queries";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const IS_LOCAL =
	(DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost")) &&
	SUPABASE_URL.startsWith("http://127.0.0.1");

const sql = IS_LOCAL
	? postgres(DATABASE_URL, { prepare: false, max: 2, fetch_types: false })
	: null;

function db() {
	if (!sql) throw new Error("postgres client not initialised");
	return sql;
}

const SCORE_TOLERANCE = 1e-9;
const NOW = new Date("2024-02-10T15:00:00.000Z");

async function seedLibrary(accountId: string, songs: PreviewRankSong[]) {
	const client = db();
	await client`INSERT INTO account(id, spotify_id) VALUES (${accountId}, ${`test-${accountId}`})`;
	const songRows = songs.map((s) => ({
		id: s.id,
		spotify_id: `sp-${s.id}`,
		name: `Song ${s.id.slice(0, 8)}`,
		artists: ["Artist"],
		genres: s.genres,
		language: s.language,
		language_secondary: s.languageSecondary,
		release_year: s.releaseYear,
		vocal_gender: s.vocalGender,
		liked_at: s.likedAt,
		unliked_at: s.unlikedAt,
	}));
	await client`
    INSERT INTO song(id, spotify_id, name, artists, genres, language, language_secondary, release_year, album_name, duration_ms)
    SELECT id, spotify_id, name, artists, genres, language, language_secondary, release_year, 'Album', 200000
    FROM jsonb_to_recordset(${client.json(songRows)}) AS x(
      id uuid, spotify_id text, name text, artists text[], genres text[],
      language text, language_secondary text, release_year smallint)
  `;
	// The insert trigger derives vocal_gender from artist rows; set it after.
	await client`
    UPDATE song s SET vocal_gender = x.vocal_gender
    FROM jsonb_to_recordset(${client.json(songRows)}) AS x(id uuid, vocal_gender text)
    WHERE s.id = x.id
  `;
	await client`
    INSERT INTO liked_song(account_id, song_id, liked_at, unliked_at)
    SELECT ${accountId}, id, liked_at, unliked_at
    FROM jsonb_to_recordset(${client.json(songRows)}) AS x(id uuid, liked_at timestamptz, unliked_at timestamptz)
  `;
	const audioRows = songs.flatMap((s) =>
		s.audio ? [{ song_id: s.id, ...s.audio }] : [],
	);
	await client`
    INSERT INTO song_audio_feature(song_id, energy, valence, danceability, acousticness, instrumentalness, speechiness, liveness, tempo, loudness)
    SELECT song_id, energy, valence, danceability, acousticness, instrumentalness, speechiness, liveness, tempo, loudness
    FROM jsonb_to_recordset(${client.json(audioRows)}) AS x(
      song_id uuid, energy real, valence real, danceability real, acousticness real,
      instrumentalness real, speechiness real, liveness real, tempo real, loudness real)
  `;
	const embeddingRows = songs.flatMap((s) =>
		s.embeddings.map((e, i) => ({
			song_id: s.id,
			kind: e.kind,
			model: e.model,
			content_hash: `hash-${s.id}-${i}`,
			created_at: e.createdAt,
			embedding: JSON.stringify(e.vector),
		})),
	);
	await client`
    INSERT INTO song_embedding(song_id, kind, model, dims, content_hash, created_at, embedding)
    SELECT song_id, kind, model, 512, content_hash, created_at, embedding::extensions.vector
    FROM jsonb_to_recordset(${client.json(embeddingRows)}) AS x(
      song_id uuid, kind text, model text, content_hash text, created_at timestamptz, embedding text)
  `;
}

async function teardown(accountId: string, songIds: string[]) {
	const client = db();
	// song cascades to liked_song, song_audio_feature and song_embedding.
	await client`
    DELETE FROM song
    WHERE id IN (SELECT jsonb_array_elements_text(${client.json(songIds)})::uuid)
  `;
	await client`DELETE FROM account WHERE id = ${accountId}`;
}

afterAll(async () => {
	if (sql) await sql.end();
});

interface Reference {
	totalEligible: number;
	rankedPoolCount: number;
	ranked: RankedSong[];
	pinned: RankedSong[];
	/** The full ranking, as composePlaylistPreview received it before. */
	ranking: RankedSong[];
	/** Rows per signal feeding the z-score stats (eligible + pinned extras). */
	samples: { embedding: number; audio: number; genre: number };
}

/** runPreviewPlaylistDraft's ranking as it was before the move to SQL. */
async function reference(
	accountId: string,
	input: PreviewRankInput,
): Promise<Reference> {
	const candidates = await loadPhase1Candidates(accountId);
	const eligible = selectEligibleCandidates(
		candidates,
		input.matchFilters,
		input.now.getTime(),
	);
	const eligibleIds = new Set(eligible.map((c) => c.song.id));
	const pinned = new Set(input.pinnedSongIds);
	const rankable = [
		...eligible,
		...candidates.filter(
			(c) => pinned.has(c.song.id) && !eligibleIds.has(c.song.id),
		),
	];

	let songEmbeddings: Map<string, number[]> | undefined;
	if (input.intent) {
		const stored = await getSongEmbeddingsBatch(
			rankable.map((c) => c.song.id),
			input.intent.model,
			"full",
		);
		if (Result.isError(stored)) throw stored.error;
		songEmbeddings = new Map(
			[...stored.value].map(([id, row]) => [
				id,
				JSON.parse(row.embedding as string) as number[],
			]),
		);
	}

	const profile = buildDraftProfile(
		eligible,
		input.genrePills,
		input.intent?.embedding,
	);
	const ranking = await rankCandidates(rankable, profile, songEmbeddings);
	const excluded = new Set(input.excludedSongIds);
	const pool = ranking.filter(
		(e) =>
			!pinned.has(e.candidate.song.id) && !excluded.has(e.candidate.song.id),
	);
	return {
		totalEligible: eligible.length,
		rankedPoolCount: pool.length,
		ranked: pool.slice(0, input.rankedLimit),
		pinned: ranking.filter((e) => pinned.has(e.candidate.song.id)),
		ranking,
		samples: {
			embedding: rankable.filter((c) => songEmbeddings?.has(c.song.id)).length,
			audio: rankable.filter((c) => c.song.audioFeatures).length,
			genre: rankable.filter((c) => (c.song.genres ?? []).length > 0).length,
		},
	};
}

async function rankInSql(
	accountId: string,
	input: PreviewRankInput,
): Promise<PreviewRanking> {
	const result = await rankPreviewCandidates(
		createAdminSupabaseClient(),
		accountId,
		input,
	);
	if (Result.isError(result)) throw result.error;
	return result.value;
}

const ids = (rows: RankedSong[]) => rows.map((r) => r.candidate.song.id);
const byId = (rows: RankedSong[]) =>
	new Map(rows.map((r) => [r.candidate.song.id, r.score]));

function expectParity(actual: PreviewRanking, expected: Reference) {
	expect(actual.totalEligible).toBe(expected.totalEligible);
	expect(actual.rankedPoolCount).toBe(expected.rankedPoolCount);
	expect(ids(actual.ranked)).toEqual(ids(expected.ranked));
	expect(ids(actual.pinned).toSorted()).toEqual(
		ids(expected.pinned).toSorted(),
	);

	const expectedScores = byId([...expected.ranked, ...expected.pinned]);
	for (const row of [...actual.ranked, ...actual.pinned]) {
		const want = expectedScores.get(row.candidate.song.id) ?? Number.NaN;
		expect(
			Math.abs(row.score - want),
			`score of ${row.candidate.song.id}: ${row.score} vs ${want}`,
		).toBeLessThan(SCORE_TOLERANCE);
	}
}

describe.skipIf(!IS_LOCAL)("rank_playlist_draft_preview parity", () => {
	const library = makePreviewRankLibrary();
	const { special } = library;
	const intent = {
		embedding: library.intent,
		model: PREVIEW_RANK_EMBEDDING_MODEL,
	};

	const input = (
		overrides: Partial<PreviewRankInput> = {},
	): PreviewRankInput => ({
		matchFilters: { version: 1 },
		genrePills: [],
		intent: null,
		pinnedSongIds: [],
		excludedSongIds: [],
		// Past the pool, so the whole ranking is compared.
		rankedLimit: 100,
		now: NOW,
		...overrides,
	});
	const filters = (f: Omit<PlaylistMatchFiltersV1, "version">) => ({
		version: 1 as const,
		...f,
	});

	beforeAll(async () => {
		await seedLibrary(library.accountId, library.songs);
	});

	afterAll(async () => {
		await teardown(
			library.accountId,
			library.songs.map((s) => s.id),
		);
	});

	const cases: [string, Partial<PreviewRankInput>][] = [
		["no pills, no intent (redistribute policy)", {}],
		[
			"pills incl. an alias spelling (neutral policy, pill weights)",
			{ genrePills: ["rock", "hip hop"] },
		],
		[
			// Under a narrow filter the raw genre score is used, so stray mass on an
			// empty pill would show; z-scores would hide it.
			"an empty pill keeps pill weights but adds no genre mass",
			{
				genrePills: [""],
				matchFilters: filters({ languages: { codes: ["ja"] } }),
			},
		],
		["intent (z-scored cosine, neutral policy)", { intent }],
		["intent and pills", { intent, genrePills: ["jazz", "soul"] }],
		[
			"zero intent vector scores every cosine 0 (pgvector NaN)",
			{ intent: { ...intent, embedding: Array(512).fill(0) } },
		],
		[
			"language filter matches primary or secondary",
			{ matchFilters: filters({ languages: { codes: ["en"] } }) },
		],
		[
			"release year exact",
			{ matchFilters: filters({ releaseYear: { kind: "exact", year: 2015 } }) },
		],
		[
			"release year before",
			{ matchFilters: filters({ releaseYear: { kind: "before", end: 2015 } }) },
		],
		[
			"release year after",
			{
				matchFilters: filters({ releaseYear: { kind: "after", start: 2015 } }),
			},
		],
		[
			"release year range",
			{
				matchFilters: filters({
					releaseYear: { kind: "range", start: 1980, end: 2015 },
				}),
			},
		],
		[
			"liked before (inclusive end day)",
			{
				matchFilters: filters({
					likedAt: { kind: "before", endDate: "2024-01-20" },
				}),
			},
		],
		[
			"liked after",
			{
				matchFilters: filters({
					likedAt: { kind: "after", startDate: "2024-02-01" },
				}),
			},
		],
		[
			// Songs are liked at midnight on 2024-01-30, so the end day is only
			// included if the range is half-open on the day after.
			"liked range to a date (inclusive end day)",
			{
				matchFilters: filters({
					likedAt: {
						kind: "range",
						startDate: "2024-01-10",
						end: { kind: "date", date: "2024-01-30" },
					},
				}),
			},
		],
		[
			"liked range to today (p_now)",
			{
				matchFilters: filters({
					likedAt: {
						kind: "range",
						startDate: "2024-01-25",
						end: { kind: "today" },
					},
				}),
			},
		],
		["vocal gender", { matchFilters: filters({ vocalGender: "female" }) }],
		[
			"excludes leave scoring alone and drop rows from the pool",
			{
				excludedSongIds: [
					special.twinA.id,
					special.genreOnly.id,
					special.zeroVector.id,
				],
			},
		],
		["ranked limit truncates the pool", { intent, rankedLimit: 5 }],
		[
			"offset past the end returns the whole pool",
			{ rankedLimit: 10 + 1000 + SUGGESTIONS_COUNT },
		],
	];

	it.each(cases)("%s", async (_name, overrides) => {
		const rankInput = input(overrides);
		expectParity(
			await rankInSql(library.accountId, rankInput),
			await reference(library.accountId, rankInput),
		);
	});

	it("both normalisation paths run: n >= 8 for every signal on the full library", async () => {
		const ref = await reference(library.accountId, input({ intent }));
		expect(ref.samples.embedding).toBeGreaterThanOrEqual(8);
		expect(ref.samples.audio).toBeGreaterThanOrEqual(8);
		expect(ref.samples.genre).toBeGreaterThanOrEqual(8);
	});

	it("n < 8 falls back to raw scores (embedding stretch) under a narrow filter", async () => {
		const rankInput = input({
			intent,
			matchFilters: filters({ languages: { codes: ["ja"] } }),
		});
		const ref = await reference(library.accountId, rankInput);
		expect(ref.samples.embedding).toBeGreaterThan(0);
		expect(ref.samples.embedding).toBeLessThan(8);
		expect(ref.samples.audio).toBeLessThan(8);
		expect(ref.samples.genre).toBeLessThan(8);
		expectParity(await rankInSql(library.accountId, rankInput), ref);
	});

	it("pins: out-of-filter pins are scored but not eligible; unliked and non-Phase-1 pins never rank", async () => {
		const rankInput = input({
			intent,
			matchFilters: filters({ vocalGender: "male" }),
			pinnedSongIds: [
				special.noMetadata.id, // fails the filter: pinned extra
				special.zeroVector.id, // vocal gender null: pinned extra
				special.unliked.id,
				special.notPhase1.id,
				special.twinB.id,
			],
			excludedSongIds: [special.twinB.id],
		});
		const sqlRanking = await rankInSql(library.accountId, rankInput);
		expectParity(sqlRanking, await reference(library.accountId, rankInput));
		expect(ids(sqlRanking.pinned).toSorted()).toEqual(
			[
				special.noMetadata.id,
				special.zeroVector.id,
				special.twinB.id,
			].toSorted(),
		);
	});

	it("composing the SQL prefix equals composing the full reference ranking, offset past the end included", async () => {
		const maxSongs = 10;
		const pinnedSongIds = [special.noMetadata.id, special.unliked.id];
		const excludedSongIds = [special.twinA.id];
		for (const suggestionsOffset of [0, 12, 1000]) {
			const rankInput = input({
				pinnedSongIds,
				excludedSongIds,
				rankedLimit: maxSongs + suggestionsOffset + SUGGESTIONS_COUNT,
			});
			const sqlRanking = await rankInSql(library.accountId, rankInput);
			const ref = await reference(library.accountId, rankInput);
			const common = {
				pinnedSongIds,
				excludedSongIds,
				maxSongs,
				intentApplied: false,
				suggestionsOffset,
			};
			const fromSql = composePlaylistPreview({
				...common,
				ranking: [...sqlRanking.ranked, ...sqlRanking.pinned],
				totalEligible: sqlRanking.totalEligible,
			});
			const fromRef = composePlaylistPreview({
				...common,
				ranking: ref.ranking,
				totalEligible: ref.totalEligible,
			});
			const shape = (p: typeof fromSql) => ({
				tracklist: p.tracklist.map((s) => s.id),
				suggestions: p.suggestions.map((s) => s.id),
				dropped: p.droppedPinnedSongIds,
				totalEligible: p.totalEligible,
			});
			expect(shape(fromSql)).toEqual(shape(fromRef));
			expect(fromSql.suggestions).toHaveLength(SUGGESTIONS_COUNT);
		}
	});
});

describe.skipIf(!IS_LOCAL)("rank_playlist_draft_preview by hand", () => {
	const trio = makePreviewRankTrio();
	const songs = Object.values(trio.songs);

	beforeAll(async () => {
		await seedLibrary(trio.accountId, songs);
	});

	afterAll(async () => {
		await teardown(
			trio.accountId,
			songs.map((s) => s.id),
		);
	});

	it("scores three songs with raw signals and redistributed weights", async () => {
		const rankInput: PreviewRankInput = {
			matchFilters: { version: 1 },
			genrePills: [],
			intent: null,
			pinnedSongIds: [],
			excludedSongIds: [],
			rankedLimit: 10,
			now: NOW,
		};
		// Profile: rock, hard rock, jazz at 1/3 each; audio centroid energy 0.55,
		// valence 0.35, so both audio songs score (0.75 + 0.75) / 2 = 0.75.
		// Without intent the 0.5 embedding weight moves to audio/genre in
		// proportion (0.3 -> 0.6, 0.2 -> 0.4); the jazz song has only genre (1.0).
		const expected = [
			[trio.songs.hardRock.id, 0.75 * 0.6 + ((0.6 + 1) / 3) * 0.4],
			[trio.songs.rock.id, 0.75 * 0.6 + ((1 + 0.45) / 3) * 0.4],
			[trio.songs.jazz.id, 1 / 3],
		] as const;

		for (const ranking of [
			await rankInSql(trio.accountId, rankInput),
			await reference(trio.accountId, rankInput),
		]) {
			expect(ranking.totalEligible).toBe(3);
			expect(ids(ranking.ranked)).toEqual(expected.map(([id]) => id));
			ranking.ranked.forEach((row, i) => {
				expect(row.score).toBeCloseTo(expected[i][1], 12);
			});
		}
	});
});

describe.skipIf(!IS_LOCAL)("rank_playlist_draft_preview candidate cap", () => {
	const accountId = crypto.randomUUID();
	const tag = accountId.slice(0, 8);
	const phase1 = (likedAt: string) => ({
		id: crypto.randomUUID(),
		genres: ["rock"],
		audio: null,
		language: "en",
		languageSecondary: null,
		releaseYear: 2015,
		vocalGender: null,
		likedAt,
		unlikedAt: null,
		embeddings: [],
	});
	const recent = [1, 2, 3].map((d) => phase1(`2024-07-0${d}T00:00:00.000Z`));
	const beyondCap = [1, 2].map((d) => phase1(`2023-01-0${d}T00:00:00.000Z`));

	beforeAll(async () => {
		await seedLibrary(accountId, [...recent, ...beyondCap]);
		// 9,997 newer likes with neither genres nor audio: they fill the
		// 10,000-row cap without being candidates.
		await db()`
      WITH filler AS (
        INSERT INTO song(id, spotify_id, name)
        SELECT gen_random_uuid(), ${`cap-${tag}-`} || i, 'Filler'
        FROM generate_series(1, 9997) AS i
        RETURNING id
      )
      INSERT INTO liked_song(account_id, song_id, liked_at)
      SELECT ${accountId}, id, '2024-06-01T00:00:00Z' FROM filler
    `;
	});

	afterAll(async () => {
		await db()`DELETE FROM song WHERE spotify_id LIKE ${`cap-${tag}-%`}`;
		await teardown(
			accountId,
			[...recent, ...beyondCap].map((s) => s.id),
		);
	});

	it("applies the 10,000-like cap before the Phase-1 check", async () => {
		const rankInput: PreviewRankInput = {
			matchFilters: { version: 1 },
			genrePills: [],
			intent: null,
			pinnedSongIds: [beyondCap[0].id],
			excludedSongIds: [],
			rankedLimit: 10,
			now: NOW,
		};
		const sqlRanking = await rankInSql(accountId, rankInput);
		expectParity(sqlRanking, await reference(accountId, rankInput));
		expect(sqlRanking.totalEligible).toBe(3);
		// A pin past the cap is not a candidate, so it cannot be honoured.
		expect(sqlRanking.pinned).toEqual([]);
	});
});
