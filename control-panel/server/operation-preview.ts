/**
 * Structured operation preview + fingerprints.
 *
 * The panel's registry operations (grant song access, gift Backstage Pass) show
 * a preview before any commit. This module turns the prod facts a dry run
 * gathers into structured impact rows the UI renders directly — target identity,
 * current state, the exact intended change, a no-op/skip reason, downstream
 * effects, and warnings — instead of the raw JSON blob the old dry run returned.
 *
 * It also derives two fingerprints used to gate Commit (see the preview/commit
 * routes): an `inputHash` over the normalized operator input, and a
 * `stateFingerprint` over the prod facts the preview asserts. Commit re-gathers
 * facts and refuses (409) if either fingerprint moved — the operator's inputs
 * changed, or prod state changed under the preview.
 *
 * Deliberately free of any `@/env`-bound product import so the preview shaping
 * and fingerprint logic stay pure and unit-testable without a prod DB.
 */

import { createHash } from "node:crypto";

export type PreviewRowKind =
	| "identity"
	| "current"
	| "change"
	| "skip"
	| "downstream"
	| "warning";

export type PreviewTone = "default" | "warning" | "danger" | "success";

export interface OperationPreviewRow {
	kind: PreviewRowKind;
	label: string;
	value: string;
	tone?: PreviewTone;
}

export interface OperationPreview {
	action: string;
	title: string;
	targetLabel: string;
	targetId: string | null;
	// false when the operation would be a no-op against current state (already
	// granted / already unlimited). The UI still lets an operator commit a no-op,
	// but it labels it plainly.
	willChange: boolean;
	rows: OperationPreviewRow[];
	// The unshaped facts, surfaced only behind a collapsed Debug disclosure.
	raw: Record<string, unknown>;
}

export interface OperationFingerprints {
	inputHash: string;
	stateFingerprint: string;
}

function sha256(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export interface GrantSongsFacts {
	kind: "songs";
	accountId: string;
	email: string | null;
	spotifyId: string | null;
	displayName: string | null;
	activeLikedSongs: number;
	requestedLimit: number;
	existingGrantExists: boolean;
	existingGrantAppliedAt: string | null;
}

export interface BackstageFacts {
	kind: "backstage";
	accountId: string;
	email: string | null;
	spotifyId: string | null;
	displayName: string | null;
	activeLikedSongs: number;
	alreadyUnlimited: boolean;
	unlimitedSource: string | null;
	subscriptionStatus: string | null;
	// Intended period end is derived from the wall clock at preview time, so it is
	// shown to the operator but deliberately excluded from the state fingerprint.
	periodEnd: string;
}

function accountLabel(f: {
	displayName: string | null;
	email: string | null;
	accountId: string;
}): string {
	return f.displayName || f.email || f.accountId;
}

function identityRows(f: {
	accountId: string;
	email: string | null;
	spotifyId: string | null;
	displayName: string | null;
}): OperationPreviewRow[] {
	const rows: OperationPreviewRow[] = [
		{ kind: "identity", label: "Account", value: accountLabel(f) },
		{ kind: "identity", label: "Account ID", value: f.accountId },
	];
	if (f.email) rows.push({ kind: "identity", label: "Email", value: f.email });
	if (f.spotifyId)
		rows.push({ kind: "identity", label: "Spotify ID", value: f.spotifyId });
	return rows;
}

export function buildGrantSongsPreview(f: GrantSongsFacts): OperationPreview {
	const rows: OperationPreviewRow[] = identityRows(f);
	rows.push({
		kind: "current",
		label: "Active liked songs",
		value: f.activeLikedSongs.toLocaleString("en-US"),
	});
	rows.push({
		kind: "current",
		label: "Existing grant",
		value: f.existingGrantAppliedAt
			? `applied ${f.existingGrantAppliedAt}`
			: f.existingGrantExists
				? "pending (not yet applied)"
				: "none",
	});

	let willChange: boolean;
	if (f.existingGrantAppliedAt) {
		willChange = false;
		rows.push({
			kind: "skip",
			label: "No-op",
			value: "Already granted — nothing would change.",
			tone: "warning",
		});
	} else if (f.activeLikedSongs === 0) {
		// A first pending row is a real change; re-previewing an existing pending
		// row with still-zero liked songs changes nothing.
		willChange = !f.existingGrantExists;
		rows.push({
			kind: f.existingGrantExists ? "skip" : "change",
			label: f.existingGrantExists ? "No-op" : "Intended change",
			value: f.existingGrantExists
				? "Pending row already exists; no active liked songs yet."
				: "Create a pending grant (no active liked songs yet; the next sync applies it).",
			tone: f.existingGrantExists ? "warning" : "default",
		});
	} else {
		willChange = true;
		const unlock = Math.min(f.activeLikedSongs, f.requestedLimit);
		rows.push({
			kind: "change",
			label: "Intended change",
			value: `${f.existingGrantExists ? "Apply the pending grant" : "Grant access"} and unlock the top ${unlock.toLocaleString("en-US")} liked songs (cap ${f.requestedLimit.toLocaleString("en-US")}).`,
			tone: "success",
		});
		rows.push({
			kind: "downstream",
			label: "Downstream",
			value:
				"Queues enrichment (lightweight + full) for the newly unlocked songs.",
		});
	}

	return {
		action: "grant-access",
		title: "Grant song access",
		targetLabel: accountLabel(f),
		targetId: f.accountId,
		willChange,
		rows,
		raw: { ...f },
	};
}

export function grantSongsFingerprints(
	f: GrantSongsFacts,
): OperationFingerprints {
	return {
		inputHash: sha256({
			action: "grant-access",
			grantType: "songs",
			accountId: f.accountId,
			limit: f.requestedLimit,
		}),
		stateFingerprint: sha256({
			existingGrantExists: f.existingGrantExists,
			existingGrantAppliedAt: f.existingGrantAppliedAt,
			activeLikedSongs: f.activeLikedSongs,
		}),
	};
}

export function buildBackstagePreview(f: BackstageFacts): OperationPreview {
	const rows: OperationPreviewRow[] = identityRows(f);
	rows.push({
		kind: "current",
		label: "Unlimited access",
		value: f.alreadyUnlimited
			? `active (${f.unlimitedSource ?? "unknown source"})`
			: "none",
	});

	if (f.alreadyUnlimited) {
		rows.push({
			kind: "skip",
			label: "No-op",
			value: `Already has unlimited access (${f.unlimitedSource ?? "unknown source"}) — nothing would change.`,
			tone: "warning",
		});
	} else {
		rows.push({
			kind: "change",
			label: "Intended change",
			value: `Gift a 1-year Backstage Pass (yearly unlimited) through ${f.periodEnd}.`,
			tone: "success",
		});
		rows.push({
			kind: "downstream",
			label: "Downstream",
			value: `Unlocks all ${f.activeLikedSongs.toLocaleString("en-US")} active liked songs; queues enrichment + match refresh.`,
		});
		rows.push({
			kind: "warning",
			label: "Warning",
			value:
				"Does not auto-expire — revoke manually at expiry (no Stripe webhook arrives for a synthetic subscription).",
			tone: "warning",
		});
	}

	return {
		action: "grant-access",
		title: "Gift Backstage Pass (1 year unlimited)",
		targetLabel: accountLabel(f),
		targetId: f.accountId,
		willChange: !f.alreadyUnlimited,
		rows,
		raw: { ...f },
	};
}

export function backstageFingerprints(f: BackstageFacts): OperationFingerprints {
	return {
		inputHash: sha256({
			action: "grant-access",
			grantType: "backstage",
			accountId: f.accountId,
		}),
		stateFingerprint: sha256({
			alreadyUnlimited: f.alreadyUnlimited,
			unlimitedSource: f.unlimitedSource,
			subscriptionStatus: f.subscriptionStatus,
		}),
	};
}
