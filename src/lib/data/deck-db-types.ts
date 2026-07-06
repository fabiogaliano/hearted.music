/**
 * TEMPORARY escape hatch for the Match deck read model (Phase 2).
 *
 * The Phase 1a/1b migrations landed the four new proposal/deck-job tables and
 * the deck-job RPCs, but `bun run gen:types` has NOT been run yet (deferred to a
 * local-DB pass — this cloud env has no Postgres). So `database.types.ts` does
 * not yet know about `match_review_deck_job`, `match_review_proposal*`, or the
 * `claim/sweep/mark_dead/enqueue` deck RPCs, and the deck worker path would not
 * typecheck against the real `Database`.
 *
 * `Database` is a plain `type` alias (not an interface), so module augmentation
 * is unavailable — a standalone synthetic schema + a single cast accessor is the
 * only way to type these calls without hand-editing the generated file. This is
 * the ONLY cast in the deck path.
 *
 * DELETE THIS FILE after `bun run gen:types` regenerates `database.types.ts`:
 * the real Row/Insert/Update shapes below become part of the generated
 * `Database`, `deckDb()` becomes `createAdminSupabaseClient()`, and every call
 * site drops the `deckDb()` accessor. The column types here mirror the migration
 * DDL precisely (payload jsonb → `Json`; nullable `session_id`/`heartbeat_at`)
 * so that swap is mechanical.
 *
 * Migrations mirrored:
 *  - 20260706000003_deck_read_model_proposal_tables.sql
 *  - 20260706000005_deck_read_model_deck_job_table.sql
 *  - 20260706000006_deck_read_model_deck_job_functions.sql
 *  - 20260706000007_read_match_deck_card_rpc.sql
 *  - 20260706000008_start_or_resume_match_deck_rpc.sql
 *  - 20260706000010_enqueue_match_review_deck_job.sql
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "./client";
import type { Json } from "./database.types";

type DeckJobRow = {
	id: string;
	account_id: string;
	orientation: string;
	session_id: string | null;
	kind: string;
	idempotency_key: string;
	status: string;
	attempts: number;
	max_attempts: number;
	available_at: string;
	heartbeat_at: string | null;
	payload: Json;
	created_at: string;
	updated_at: string;
};

type ProposalRow = {
	id: string;
	account_id: string;
	orientation: string;
	snapshot_id: string;
	visibility_config_hash: string;
	strictness_preset: string;
	strictness_min_score: number;
	read_time_filters_hash: string;
	status: string;
	total_subjects: number;
	hidden_review_item_count: number;
	created_at: string;
	updated_at: string;
};

type ProposalSubjectRow = {
	proposal_id: string;
	position: number;
	orientation: string;
	song_id: string | null;
	playlist_id: string | null;
	source_fit_score: number;
	was_new_at_enqueue: boolean;
};

type ProposalSeedPairRow = {
	proposal_id: string;
	subject_position: number;
	song_id: string;
	playlist_id: string;
	fit_score: number;
	model_rank: number;
	visible_rank: number;
};

/**
 * Minimal view of the deck-state columns added to match_review_session by
 * 20260706000004 (active_proposal_id, deck_revision, resume_position) — also
 * missing from the generated types until `gen:types`. Only the columns the
 * worker reads are declared; the real (full) Row satisfies this superset after
 * regeneration, so the swap stays mechanical.
 */
type SessionDeckRow = {
	id: string;
	account_id: string;
	strictness_min_score: number;
	active_proposal_id: string | null;
	deck_revision: number;
	resume_position: number | null;
};

/**
 * Synthetic Postgres schema declaring only the deck read-model tables + RPCs,
 * shaped like a generated supabase Database so `SupabaseClient<DeckDatabase>`
 * types `.from(...)` and `.rpc(...)` for them.
 */
export type DeckDatabase = {
	public: {
		Tables: {
			match_review_deck_job: {
				Row: DeckJobRow;
				Insert: {
					id?: string;
					account_id: string;
					orientation: string;
					session_id?: string | null;
					kind: string;
					idempotency_key: string;
					status?: string;
					attempts?: number;
					max_attempts?: number;
					available_at?: string;
					heartbeat_at?: string | null;
					payload?: Json;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					account_id?: string;
					orientation?: string;
					session_id?: string | null;
					kind?: string;
					idempotency_key?: string;
					status?: string;
					attempts?: number;
					max_attempts?: number;
					available_at?: string;
					heartbeat_at?: string | null;
					payload?: Json;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			match_review_proposal: {
				Row: ProposalRow;
				Insert: {
					id?: string;
					account_id: string;
					orientation: string;
					snapshot_id: string;
					visibility_config_hash: string;
					strictness_preset: string;
					strictness_min_score: number;
					read_time_filters_hash: string;
					status?: string;
					total_subjects?: number;
					hidden_review_item_count?: number;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					status?: string;
					total_subjects?: number;
					hidden_review_item_count?: number;
					updated_at?: string;
				};
				Relationships: [];
			};
			match_review_proposal_subject: {
				Row: ProposalSubjectRow;
				Insert: {
					proposal_id: string;
					position: number;
					orientation: string;
					song_id?: string | null;
					playlist_id?: string | null;
					source_fit_score?: number;
					was_new_at_enqueue?: boolean;
				};
				Update: {
					source_fit_score?: number;
					was_new_at_enqueue?: boolean;
				};
				Relationships: [];
			};
			match_review_proposal_seed_pair: {
				Row: ProposalSeedPairRow;
				Insert: ProposalSeedPairRow;
				Update: {
					fit_score?: number;
					model_rank?: number;
					visible_rank?: number;
				};
				Relationships: [];
			};
			match_review_session: {
				Row: SessionDeckRow;
				Insert: SessionDeckRow;
				Update: Partial<SessionDeckRow>;
				Relationships: [];
			};
		};
		Views: Record<string, never>;
		Functions: {
			claim_pending_match_review_deck_job: {
				Args: { p_limit?: number };
				Returns: DeckJobRow[];
			};
			sweep_stale_match_review_deck_jobs: {
				Args: { p_lease_seconds?: number };
				Returns: DeckJobRow[];
			};
			mark_dead_match_review_deck_jobs: {
				Args: Record<PropertyKey, never>;
				Returns: DeckJobRow[];
			};
			enqueue_match_review_deck_job: {
				Args: {
					p_account_id: string;
					p_orientation: string;
					p_kind: string;
					p_idempotency_key: string;
					p_session_id?: string | null;
					p_payload?: Json;
				};
				Returns: DeckJobRow[];
			};
			// Both deck read RPCs return the full MatchDeckView / MatchReviewItemRead
			// JSONB (typed Json here); the Phase 3 TS wrappers narrow the raw payload.
			start_or_resume_match_deck: {
				Args: {
					p_account_id: string;
					p_orientation: string;
					p_visibility_config_hash: string;
					p_window?: number | null;
				};
				Returns: Json;
			};
			read_match_deck_card: {
				Args: {
					p_item_id: string;
					p_account_id: string;
					p_limit?: number | null;
					p_mark_presented?: boolean;
				};
				Returns: Json;
			};
		};
		Enums: Record<string, never>;
		CompositeTypes: Record<string, never>;
	};
};

/** The deck-job row shape, exported for the DB layer + worker dispatch. */
export type DeckJob = DeckJobRow;
/** The proposal-subject row shape, exported for the builder/appender. */
export type ProposalSubject = ProposalSubjectRow;
/** The proposal row shape, exported for the appender's ready-proposal lookup. */
export type Proposal = ProposalRow;

/**
 * The single cast in the deck path: reuse the service-role admin client but view
 * it through the synthetic deck schema. Swap the body for
 * `createAdminSupabaseClient()` once `gen:types` folds these into `Database`.
 */
export function deckDb(): SupabaseClient<DeckDatabase> {
	return createAdminSupabaseClient() as unknown as SupabaseClient<DeckDatabase>;
}
