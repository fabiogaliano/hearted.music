/**
 * Batch adapters — one per supported batch action. Each adapter knows how to
 * (1) resolve its exact targets server-side (from a filter or an explicit
 * selection) into a snapshot, and (2) process a single target through the same
 * shared domain helper the one-off route uses. The runner (see ./batches.ts)
 * owns concurrency, retries, and durability; adapters stay pure per-target.
 *
 * Resolution is always SQL/RPC over the raw prod connection (or an explicit id
 * array bound as a parameter), never a Supabase `.in()` URL filter fed a
 * DB-derived id set — the whole batch model exists to snapshot the cohort once
 * and walk it locally.
 *
 * Grants reuse the exact helpers server/operations.ts imports (a documented
 * product-import exception); approvals reuse the review modules' commit paths;
 * email reuses the panel's own render/send.
 */

import { createAdminSupabaseClient } from "@/lib/data/client";
import { grantLikedSongAccessForAccount } from "@/lib/domains/billing/liked-song-access-grant";
import { Result } from "better-result";
import { approveAudioReview } from "./audio-feature-reviews";
import { read } from "./db";
import { renderStyledEmail, sendStyledEmail } from "./email";
import { approveInstrumentalReview } from "./instrumental-reviews";
import {
	parseUsersListQuery,
	USER_FROM,
	whereForUsers,
} from "./users-list";

export interface ResolvedTarget {
	targetType: string;
	targetId: string;
	targetLabel: string | null;
	// Ineligible targets are snapshotted `skipped` with a reason; the runner never
	// processes them, but they stay in the record so the preview count is honest.
	eligible: boolean;
	skipReason?: string | null;
}

export interface BatchResolution {
	targets: ResolvedTarget[];
	warnings: string[];
	// Adapter-specific preview buckets (e.g. grant already-granted / no-library).
	summary: Record<string, number>;
	estimatedActions: number;
}

export interface ProcessOutcome {
	result: Record<string, unknown>;
	externalId?: string | null;
}

export interface BatchAdapter {
	actionType: string;
	targetType: string;
	concurrency: number;
	// Cap on ELIGIBLE targets; resolution refuses above it (422) so the operator
	// narrows rather than silently truncating.
	maxTargets: number;
	label: string;
	resolve(input: Record<string, unknown>): Promise<BatchResolution>;
	// Throw to fail a target; the runner records error.message. Return the
	// per-target result summary (and any external id that must never be repeated).
	process(
		target: { targetId: string; targetLabel: string | null },
		input: Record<string, unknown>,
	): Promise<ProcessOutcome>;
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((v): v is string => typeof v === "string")
		: [];
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

const MIN_GRANT_LIMIT = 1;
const MAX_GRANT_LIMIT = 10000;
const DEFAULT_GRANT_LIMIT = 500;

function resolveGrantLimit(raw: unknown): number {
	const parsed =
		typeof raw === "number"
			? raw
			: typeof raw === "string"
				? Number.parseInt(raw, 10)
				: NaN;
	if (!Number.isFinite(parsed)) return DEFAULT_GRANT_LIMIT;
	return Math.min(
		Math.max(Math.trunc(parsed), MIN_GRANT_LIMIT),
		MAX_GRANT_LIMIT,
	);
}

// Rebuild a URL the users-list parser understands from a stored filter snapshot,
// so all-matching resolution reuses the exact same predicate as the Users table.
function filterToUrl(filter: Record<string, unknown>): URL {
	const url = new URL("http://local/api/users/list");
	for (const [key, value] of Object.entries(filter)) {
		if (value === null || value === undefined) continue;
		url.searchParams.set(key, String(value));
	}
	return url;
}

interface GrantCandidate {
	id: string;
	label: string;
	liked: number;
	has_grant: boolean;
	applied_at: string | null;
}

const GRANT_SELECT = `
	select a.id,
		coalesce(a.display_name, a.email, a.handle, a.id::text) as label,
		coalesce(lk.liked, 0) as liked,
		(g.account_id is not null) as has_grant,
		g.applied_at
`;

async function resolveGrantCandidates(
	input: Record<string, unknown>,
): Promise<GrantCandidate[]> {
	const accountIds = asStringArray(input.accountIds);
	if (accountIds.length > 0) {
		// Explicit selection: bind the ids as a single array parameter (not a
		// PostgREST `.in()` filter) and process each locally afterwards.
		return read<GrantCandidate>(
			`${GRANT_SELECT}
			 from account a
			 left join (select account_id, count(*) as liked from liked_song where unliked_at is null group by 1) lk on lk.account_id = a.id
			 left join account_liked_song_access_grant g on g.account_id = a.id
			 where a.id = any($1::uuid[])`,
			[accountIds],
		);
	}
	const filter = asRecord(input.filter);
	const query = parseUsersListQuery(filterToUrl(filter));
	const params: unknown[] = [];
	const where = whereForUsers(query, params);
	const predicate = where.length > 0 ? `where ${where.join(" and ")}` : "";
	return read<GrantCandidate>(
		`${GRANT_SELECT}
		 ${USER_FROM}
		 left join account_liked_song_access_grant g on g.account_id = a.id
		 ${predicate}
		 order by a.created_at desc`,
		params,
	);
}

const grantAdapter: BatchAdapter = {
	actionType: "grant-batch",
	targetType: "account",
	concurrency: 2,
	maxTargets: 100,
	label: "Grant song access",
	async resolve(input) {
		const limit = resolveGrantLimit(input.limit);
		const candidates = await resolveGrantCandidates(input);
		const summary = {
			alreadyGranted: 0,
			pending: 0,
			noLibrary: 0,
			eligible: 0,
		};
		let expectedUnlocks = 0;
		const targets: ResolvedTarget[] = candidates.map((c) => {
			const base = {
				targetType: "account",
				targetId: c.id,
				targetLabel: c.label,
			};
			if (c.has_grant && c.applied_at !== null) {
				summary.alreadyGranted += 1;
				return { ...base, eligible: false, skipReason: "Already granted" };
			}
			if (c.has_grant && c.applied_at === null) {
				summary.pending += 1;
				return { ...base, eligible: false, skipReason: "Grant already pending" };
			}
			summary.eligible += 1;
			if (Number(c.liked) === 0) summary.noLibrary += 1;
			else expectedUnlocks += Math.min(Number(c.liked), limit);
			return { ...base, eligible: true };
		});
		const warnings: string[] = [];
		if (summary.noLibrary > 0) {
			warnings.push(
				`${summary.noLibrary} account(s) have no synced library yet — a pending grant is created and applies on their next sync.`,
			);
		}
		return {
			targets,
			warnings,
			summary: { ...summary, expectedUnlocks },
			estimatedActions: summary.eligible,
		};
	},
	async process(target, input) {
		const limit = resolveGrantLimit(input.limit);
		const requestedBy =
			typeof input.requestedBy === "string" ? input.requestedBy : null;
		const note = typeof input.reason === "string" ? input.reason : null;
		const result = await grantLikedSongAccessForAccount(
			createAdminSupabaseClient(),
			{
				accountId: target.targetId,
				origin: "operator_manual",
				limit,
				requestedBy,
				note,
			},
		);
		if (Result.isError(result)) {
			throw new Error(result.error.message);
		}
		const payload = result.value;
		return {
			result: {
				status: payload.status,
				...(payload.status === "applied"
					? {
							candidateCount: payload.candidateCount,
							newlyUnlocked: payload.newlyUnlockedSongIds.length,
						}
					: {}),
			},
		};
	},
};

interface ReviewCandidate {
	id: string;
	label: string;
	live: boolean;
}

const audioApproveAdapter: BatchAdapter = {
	actionType: "audio-approve-batch",
	targetType: "audio-review",
	concurrency: 4,
	maxTargets: 200,
	label: "Approve audio reviews",
	async resolve(input) {
		const ids = asStringArray(input.reviewIds);
		if (ids.length === 0) {
			return { targets: [], warnings: [], summary: { eligible: 0 }, estimatedActions: 0 };
		}
		const rows = await read<ReviewCandidate>(
			`select r.id, s.name as label, (r.status = 'pending') as live
			 from public.audio_feature_source_review r
			 join public.song s on s.id = r.song_id
			 where r.id = any($1::uuid[])`,
			[ids],
		);
		const found = new Map(rows.map((r) => [r.id, r]));
		let eligible = 0;
		const targets: ResolvedTarget[] = ids.map((id) => {
			const row = found.get(id);
			const base = { targetType: "audio-review", targetId: id, targetLabel: row?.label ?? null };
			if (!row) return { ...base, eligible: false, skipReason: "Review not found" };
			if (!row.live) return { ...base, eligible: false, skipReason: "No longer pending" };
			eligible += 1;
			return { ...base, eligible: true };
		});
		return { targets, warnings: [], summary: { eligible }, estimatedActions: eligible };
	},
	async process(target, input) {
		const reviewedBy =
			typeof input.reviewedBy === "string" ? input.reviewedBy : "control-panel";
		const result = await approveAudioReview(target.targetId, reviewedBy);
		return { result: { ...result } };
	},
};

const instrumentalApproveAdapter: BatchAdapter = {
	actionType: "instrumental-approve-batch",
	targetType: "instrumental-review",
	concurrency: 4,
	maxTargets: 200,
	label: "Approve instrumental reviews",
	async resolve(input) {
		const ids = asStringArray(input.reviewIds);
		if (ids.length === 0) {
			return { targets: [], warnings: [], summary: { eligible: 0 }, estimatedActions: 0 };
		}
		// Live = still settled instrumental by its auto-verdict (latest song_lyrics
		// row is the 'analysis' settle), mirroring the single-item approve guard.
		const rows = await read<ReviewCandidate>(
			`select r.id, s.name as label,
				(r.status = 'pending' and latest.source = 'analysis' and latest.fetch_status = 'instrumental') as live
			 from public.song_instrumental_review r
			 join public.song s on s.id = r.song_id
			 left join lateral (
				select sl.source, sl.fetch_status
				from public.song_lyrics sl
				where sl.song_id = r.song_id
				order by sl.updated_at desc
				limit 1
			 ) latest on true
			 where r.id = any($1::uuid[])`,
			[ids],
		);
		const found = new Map(rows.map((r) => [r.id, r]));
		let eligible = 0;
		const targets: ResolvedTarget[] = ids.map((id) => {
			const row = found.get(id);
			const base = {
				targetType: "instrumental-review",
				targetId: id,
				targetLabel: row?.label ?? null,
			};
			if (!row) return { ...base, eligible: false, skipReason: "Review not found" };
			if (!row.live) return { ...base, eligible: false, skipReason: "No longer live pending" };
			eligible += 1;
			return { ...base, eligible: true };
		});
		return { targets, warnings: [], summary: { eligible }, estimatedActions: eligible };
	},
	async process(target, input) {
		const reviewedBy =
			typeof input.reviewedBy === "string" ? input.reviewedBy : "control-panel";
		const result = await approveInstrumentalReview(target.targetId, reviewedBy);
		return { result: { ...result } };
	},
};

interface RecipientCandidate {
	id: string;
	email: string | null;
	verified: boolean;
}

const emailAdapter: BatchAdapter = {
	actionType: "email-batch",
	targetType: "email",
	concurrency: 2,
	maxTargets: 50,
	label: "Send email",
	async resolve(input) {
		const ids = asStringArray(input.accountIds);
		if (ids.length === 0) {
			return {
				targets: [],
				warnings: [],
				summary: { eligible: 0, unverified: 0 },
				estimatedActions: 0,
			};
		}
		const rows = await read<RecipientCandidate>(
			`select a.id, a.email, coalesce(u.email_verified, false) as verified
			 from account a
			 left join "user" u on u.id = a.better_auth_user_id
			 where a.id = any($1::uuid[])`,
			[ids],
		);
		const found = new Map(rows.map((r) => [r.id, r]));
		let eligible = 0;
		let unverified = 0;
		const targets: ResolvedTarget[] = ids.map((id) => {
			const row = found.get(id);
			const base = { targetType: "email", targetId: id, targetLabel: row?.email ?? null };
			if (!row || !row.email) return { ...base, eligible: false, skipReason: "No email" };
			if (!row.verified) {
				unverified += 1;
				return { ...base, eligible: false, skipReason: "Email not verified" };
			}
			eligible += 1;
			return { ...base, eligible: true };
		});
		const warnings: string[] = [];
		if (unverified > 0) {
			warnings.push(`${unverified} recipient(s) skipped — email not verified.`);
		}
		return {
			targets,
			warnings,
			summary: { eligible, unverified },
			estimatedActions: eligible,
		};
	},
	async process(target, input) {
		// One Resend request per recipient — the resolved email is the target label.
		const to = target.targetLabel;
		if (!to) throw new Error("Recipient has no email address.");
		const email = renderStyledEmail({ ...input, to });
		const sent = await sendStyledEmail(email);
		return {
			result: { to: email.to, subject: email.subject },
			externalId: sent.id,
		};
	},
};

const ADAPTERS: readonly BatchAdapter[] = [
	grantAdapter,
	audioApproveAdapter,
	instrumentalApproveAdapter,
	emailAdapter,
];

export function getBatchAdapter(actionType: string): BatchAdapter | null {
	return ADAPTERS.find((a) => a.actionType === actionType) ?? null;
}
