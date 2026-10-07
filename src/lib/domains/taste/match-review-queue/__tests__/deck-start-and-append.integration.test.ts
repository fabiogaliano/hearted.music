/**
 * The two SQL paths that create queue items, against the real plpgsql:
 * start_or_resume_match_deck (latest: 20260708000020) and
 * insert_queue_song_items (20260625060000). Their unit suites mock the RPC
 * response, so branch selection (resume vs promote vs miss), the seed copy that
 * re-checks dismissals, the promotion-race re-read, and the insert's
 * dedupe-vs-position-collision split only exist here.
 *
 * Expected values come from the SQL: branch 1 returns any active session as-is;
 * branch 2 promotes only the latest snapshot's ready proposal whose subject rows
 * are all written, copying seed pairs minus dismissed ones and activating every
 * seeded subject; a unique_violation on the session insert re-reads the active
 * session and misses if there is none. insert_queue_song_items arbitrates only
 * on (session_id, song_id), so a position collision still raises.
 *
 * Seeds via postgres.js (DATABASE_URL) and drives the production wrappers
 * (admin Supabase client) except where a transaction must be held open.
 * Auto-skipped unless both point at the local stack.
 */

import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	activeDeckOrNull,
	callStartOrResumeMatchDeck,
} from "../deck-read-queries";
import { insertQueueItems } from "../queries";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const IS_LOCAL =
	(DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost")) &&
	SUPABASE_URL.startsWith("http://127.0.0.1");

const sql = IS_LOCAL
	? postgres(DATABASE_URL, { prepare: false, max: 4, fetch_types: false })
	: null;

function db() {
	if (!sql) throw new Error("postgres client not initialised");
	return sql;
}

const HASH = "vc-test";

interface Fixture {
	accountId: string;
	songs: [string, string, string];
	playlists: [string, string];
}

let fx: Fixture | null = null;

function fixture(): Fixture {
	if (!fx) throw new Error("fixture not seeded");
	return fx;
}

async function seedFixture(): Promise<Fixture> {
	const client = db();
	const accountId = crypto.randomUUID();
	const songs: Fixture["songs"] = [
		crypto.randomUUID(),
		crypto.randomUUID(),
		crypto.randomUUID(),
	];
	const playlists: Fixture["playlists"] = [
		crypto.randomUUID(),
		crypto.randomUUID(),
	];
	await client`INSERT INTO account(id, spotify_id) VALUES (${accountId}, ${`test-${accountId}`})`;
	for (const id of songs) {
		// fetch_types:false disables array inference, so bind array literals.
		await client`
      INSERT INTO song(id, spotify_id, name, artists, artist_ids, genres)
      VALUES (${id}, ${`sp-${id}`}, ${"Song"}, ${"{Artist}"}::text[], ${"{artist-1}"}::text[], ${"{pop}"}::text[])
    `;
	}
	for (const id of playlists) {
		await client`
      INSERT INTO playlist(id, account_id, spotify_id, name)
      VALUES (${id}, ${accountId}, ${`sp-pl-${id}`}, ${"Playlist"})
    `;
	}
	return { accountId, songs, playlists };
}

async function teardownFixture(f: Fixture) {
	// match_event → session and ledger → snapshot are NO ACTION FKs the account
	// cascade can trip over, so clear sessions (and the events pinning them)
	// first; the account cascade handles the rest. Songs are global.
	await db()`DELETE FROM match_event WHERE account_id = ${f.accountId}`;
	await db()`DELETE FROM match_review_session WHERE account_id = ${f.accountId}`;
	await db()`DELETE FROM account WHERE id = ${f.accountId}`;
	await db()`DELETE FROM song WHERE id IN ${db()(f.songs)}`;
}

/** Snapshots are ordered by created_at; `ageMinutes` places one in the past. */
async function makeSnapshot(ageMinutes = 0): Promise<string> {
	const id = crypto.randomUUID();
	await db()`
    INSERT INTO match_snapshot(id, account_id, algorithm_version, config_hash, playlist_set_hash, candidate_set_hash, snapshot_hash, created_at)
    VALUES (${id}, ${fixture().accountId}, ${"v1"}, ${"c"}, ${"p"}, ${"cand"}, ${`snap-${id}`}, now() - make_interval(mins => ${ageMinutes}))
  `;
	return id;
}

/** A song-orientation proposal: subjects at positions 0..n-1, seed pairs keyed by position. */
async function makeProposal(opts: {
	snapshotId: string;
	subjects: string[];
	seeds: Array<{ position: number; playlistId: string; visibleRank: number }>;
	totalSubjects?: number;
	hidden?: number;
}): Promise<string> {
	const id = crypto.randomUUID();
	await db()`
    INSERT INTO match_review_proposal(id, account_id, orientation, snapshot_id, visibility_config_hash, strictness_preset, strictness_min_score, read_time_filters_hash, status, total_subjects, hidden_review_item_count)
    VALUES (${id}, ${fixture().accountId}, ${"song"}, ${opts.snapshotId}, ${HASH}, ${"balanced"}, ${0.5}, ${"rtf"}, ${"ready"}, ${opts.totalSubjects ?? opts.subjects.length}, ${opts.hidden ?? 0})
  `;
	for (const [position, songId] of opts.subjects.entries()) {
		await db()`
      INSERT INTO match_review_proposal_subject(proposal_id, position, orientation, song_id, source_fit_score)
      VALUES (${id}, ${position}, ${"song"}, ${songId}, ${0.8})
    `;
	}
	for (const seed of opts.seeds) {
		await db()`
      INSERT INTO match_review_proposal_seed_pair(proposal_id, subject_position, song_id, playlist_id, fit_score, model_rank, visible_rank)
      VALUES (${id}, ${seed.position}, ${opts.subjects[seed.position]}, ${seed.playlistId}, ${0.8}, ${seed.visibleRank + 10}, ${seed.visibleRank})
    `;
	}
	return id;
}

async function sessionIds(): Promise<string[]> {
	const rows = await db()`
    SELECT id FROM match_review_session WHERE account_id = ${fixture().accountId}
  `;
	return rows.map((r) => r.id);
}

async function queueItems(sessionId: string) {
	return db()`
    SELECT qi.id, qi.song_id, qi.position, qi.state,
           qi.visible_pairs_captured_at IS NOT NULL AS captured,
           (SELECT count(*)::int FROM match_review_item_visible_pair vp WHERE vp.queue_item_id = qi.id) AS pairs
    FROM match_review_queue_item qi
    WHERE qi.session_id = ${sessionId}
    ORDER BY qi.position
  `;
}

beforeEach(async () => {
	if (!IS_LOCAL) return;
	fx = await seedFixture();
});

afterEach(async () => {
	if (!IS_LOCAL || !fx) return;
	await teardownFixture(fx);
	fx = null;
});

afterAll(async () => {
	await sql?.end();
});

describe.skipIf(!IS_LOCAL)("start_or_resume_match_deck", () => {
	/** Latest snapshot; subject 1's only seed pair is already dismissed. */
	async function seedPromotable() {
		const { accountId, songs, playlists } = fixture();
		const snapshotId = await makeSnapshot();
		await db()`
      INSERT INTO match_decision(account_id, song_id, playlist_id, decision)
      VALUES (${accountId}, ${songs[1]}, ${playlists[0]}, ${"dismissed"})
    `;
		const proposalId = await makeProposal({
			snapshotId,
			subjects: [songs[0], songs[1]],
			seeds: [
				{ position: 0, playlistId: playlists[0], visibleRank: 1 },
				{ position: 0, playlistId: playlists[1], visibleRank: 2 },
				{ position: 1, playlistId: playlists[0], visibleRank: 1 },
			],
			hidden: 3,
		});
		return { snapshotId, proposalId };
	}

	it("promotes the ready proposal: seeds pairs minus dismissed ones and activates even an all-dismissed subject", async () => {
		const { accountId, songs } = fixture();
		const { snapshotId, proposalId } = await seedPromotable();

		const result = await callStartOrResumeMatchDeck(accountId, "song", HASH);

		expect(result).toBeOk();
		const view = result.unwrap();
		const [sessionId] = await sessionIds();
		expect(view).toMatchObject({
			status: "active",
			sessionId,
			snapshotId,
			visibilityConfigHash: HASH,
			revision: 0,
			progress: {
				total: 2,
				remaining: 2,
				caughtUp: false,
				hiddenReviewItemCount: 3,
			},
			cards: { current: { position: 0 }, next: { position: 1 } },
		});
		const items = await queueItems(sessionId);
		expect(items).toMatchObject([
			{
				song_id: songs[0],
				position: 0,
				state: "active",
				captured: true,
				pairs: 2,
			},
			{
				song_id: songs[1],
				position: 1,
				state: "active",
				captured: true,
				pairs: 0,
			},
		]);
		const [session] = await db()`
      SELECT active_proposal_id FROM match_review_session WHERE id = ${sessionId}
    `;
		expect(session.active_proposal_id).toBe(proposalId);
		// The ledger row is what stops the worker appender from re-appending
		// this snapshot's subjects into the new session.
		const ledger = await db()`
      SELECT snapshot_id, appended_item_count, visibility_config_hash
      FROM match_review_session_snapshot WHERE session_id = ${sessionId}
    `;
		expect(ledger).toEqual([
			{
				snapshot_id: snapshotId,
				appended_item_count: 2,
				visibility_config_hash: HASH,
			},
		]);
	});

	it.each([
		{
			name: "the ready proposal belongs to an older snapshot",
			seed: async (songs: Fixture["songs"]) => {
				const older = await makeSnapshot(10);
				await makeSnapshot();
				await makeProposal({
					snapshotId: older,
					subjects: [songs[0]],
					seeds: [],
				});
			},
		},
		{
			name: "the ready proposal's subject rows are not all written",
			seed: async (songs: Fixture["songs"]) => {
				await makeProposal({
					snapshotId: await makeSnapshot(),
					subjects: [songs[0]],
					seeds: [],
					totalSubjects: 2,
				});
			},
		},
	])("misses without creating a session when $name", async ({ seed }) => {
		const { accountId, songs } = fixture();
		await seed(songs);

		const result = await callStartOrResumeMatchDeck(accountId, "song", HASH);

		expect(result).toHaveOkValue({
			status: "miss",
			reason: "no_ready_proposal",
		});
		expect(await sessionIds()).toEqual([]);
	});

	it("resumes the active session after a finished card and never promotes a newer ready proposal over it", async () => {
		const { accountId, songs, playlists } = fixture();
		const { snapshotId } = await seedPromotable();
		const started = activeDeckOrNull(
			(await callStartOrResumeMatchDeck(accountId, "song", HASH)).unwrap(),
		);
		if (!started) throw new Error("expected the promotion to start a deck");
		const [first, second] = started.itemIds;
		const [finished] =
			await db()`SELECT finish_match_review_item_atomic(${first}, ${accountId}) AS r`;
		expect(finished.r).toBe("skipped");
		await makeProposal({
			snapshotId: await makeSnapshot(-10),
			subjects: [songs[2]],
			seeds: [{ position: 0, playlistId: playlists[0], visibleRank: 1 }],
		});

		const resumed = await callStartOrResumeMatchDeck(accountId, "song", HASH);

		expect(resumed.unwrap()).toMatchObject({
			status: "active",
			sessionId: started.sessionId,
			snapshotId,
			revision: 1,
			progress: { total: 2, remaining: 1, caughtUp: false },
			itemIds: [second],
			cards: { current: { itemId: second, position: 1 }, next: null },
		});
		expect(await sessionIds()).toEqual([started.sessionId]);
	});

	it("a promotion that loses the one-active-session race returns the winner's deck instead of failing or duplicating it", async () => {
		const { accountId } = fixture();
		await seedPromotable();
		const appName = `deck-race-${crypto.randomUUID()}`;
		const loser = postgres(DATABASE_URL, {
			prepare: false,
			max: 1,
			fetch_types: false,
			connection: { application_name: appName },
		});
		const call = (client: postgres.Sql | postgres.TransactionSql) =>
			client`SELECT start_or_resume_match_deck(${accountId}, ${"song"}, ${HASH}, NULL::int) AS r`;

		try {
			let loserCall: Promise<postgres.RowList<postgres.Row[]>> | null = null;
			// Hold the winner's promotion uncommitted until the loser is blocked on
			// its session insert, so the loser deterministically takes the
			// unique_violation branch rather than resuming.
			const winner = await db().begin(async (tx) => {
				const [row] = await call(tx);
				// postgres.js queries are lazy; execute() sends it now.
				loserCall = call(loser).execute();
				await waitUntilLockBlocked(appName);
				return row.r;
			});
			if (!loserCall) throw new Error("loser call never started");
			const [loserRow] = await (loserCall as Promise<
				postgres.RowList<postgres.Row[]>
			>);

			expect(winner.status).toBe("active");
			expect(loserRow.r).toMatchObject({
				status: "active",
				sessionId: winner.sessionId,
				progress: { total: 2, remaining: 2 },
			});
			expect(await sessionIds()).toEqual([winner.sessionId]);
			expect(await queueItems(winner.sessionId)).toHaveLength(2);
		} finally {
			await loser.end();
		}
	});

	it("a promotion conflict with no readable active session falls back to a miss, not an active deck without a session", async () => {
		const { accountId } = fixture();
		await seedPromotable();
		// Stands in for a winner that committed and was completed/abandoned
		// between the loser's unique_violation and its re-read — a window no
		// test can hit by timing. Scoped to this fixture's account.
		const fn = `test_session_conflict_${accountId.replaceAll("-", "")}`;
		await db().unsafe(`
      CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.account_id = '${accountId}'::uuid THEN
          RAISE EXCEPTION USING ERRCODE = 'unique_violation';
        END IF;
        RETURN NEW;
      END $$
    `);
		await db().unsafe(
			`CREATE TRIGGER ${fn} BEFORE INSERT ON match_review_session FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
		);

		try {
			const result = await callStartOrResumeMatchDeck(accountId, "song", HASH);

			expect(result).toHaveOkValue({
				status: "miss",
				reason: "no_ready_proposal",
			});
			expect(await sessionIds()).toEqual([]);
		} finally {
			await db().unsafe(`DROP TRIGGER ${fn} ON match_review_session`);
			await db().unsafe(`DROP FUNCTION ${fn}()`);
		}
	});
});

async function waitUntilLockBlocked(appName: string) {
	for (let attempt = 0; attempt < 100; attempt++) {
		const rows = await db()`
      SELECT 1 FROM pg_stat_activity
      WHERE application_name = ${appName} AND wait_event_type = ${"Lock"}
    `;
		if (rows.length > 0) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("loser never blocked on the winner's session insert");
}

describe.skipIf(!IS_LOCAL)("insert_queue_song_items", () => {
	async function seedSessionWithResolvedItem() {
		const { accountId, songs } = fixture();
		const snapshotId = await makeSnapshot();
		const sessionId = crypto.randomUUID();
		await db()`
      INSERT INTO match_review_session(id, account_id, status, strictness_preset, strictness_min_score, orientation)
      VALUES (${sessionId}, ${accountId}, ${"active"}, ${"balanced"}, ${0.5}, ${"song"})
    `;
		await db()`
      INSERT INTO match_review_queue_item(session_id, account_id, song_id, orientation, source_snapshot_id, position, state, resolution)
      VALUES (${sessionId}, ${accountId}, ${songs[0]}, ${"song"}, ${snapshotId}, ${0}, ${"resolved"}, ${"skipped"})
    `;
		const item = (songId: string, position: number) => ({
			sessionId,
			accountId,
			songId,
			sourceSnapshotId: snapshotId,
			position,
			sourceScore: 0.7,
			wasNewAtEnqueue: true,
		});
		return { sessionId, item };
	}

	it("skips a song already in the session without reviving it, and still lands the rest of the batch", async () => {
		const { songs } = fixture();
		const { sessionId, item } = await seedSessionWithResolvedItem();

		const result = await insertQueueItems([
			item(songs[0], 5),
			item(songs[1], 6),
		]);

		expect(result).toBeOk();
		expect(await queueItems(sessionId)).toMatchObject([
			{ song_id: songs[0], position: 0, state: "resolved" },
			{ song_id: songs[1], position: 6, state: "pending" },
		]);
	});

	it("a new song colliding on an occupied position fails the whole batch as a unique ConstraintError so the append defers", async () => {
		const { songs } = fixture();
		const { sessionId, item } = await seedSessionWithResolvedItem();

		const result = await insertQueueItems([
			item(songs[1], 0),
			item(songs[2], 7),
		]);

		expect(result).toBeErr();
		expect(result.isErr() && result.error).toMatchObject({
			_tag: "ConstraintError",
			constraint: "unique",
		});
		expect(await queueItems(sessionId)).toMatchObject([
			{ song_id: songs[0], position: 0 },
		]);
		expect(await queueItems(sessionId)).toHaveLength(1);
	});
});
