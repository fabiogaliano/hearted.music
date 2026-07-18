/**
 * operation_preview repository — the local record that gates a registry commit.
 *
 * A successful dry run persists one row here (input hash + state fingerprint +
 * the shaped preview). Commit looks the row up by id, re-gathers prod facts, and
 * refuses (409) unless both fingerprints still match. Rows are short-lived
 * (five minutes) and pruned lazily on write; this is a single-operator local
 * store, so there is no background sweeper.
 */

import type { SqliteDriver } from "./sqlite";

// A preview is only good for five minutes; after that a fresh dry run is
// required before Commit re-enables (see the preview/commit routes).
export const PREVIEW_TTL_MS = 5 * 60 * 1000;

export interface StoredPreview {
	id: string;
	prodRef: string;
	actionType: string;
	targetId: string | null;
	inputHash: string;
	stateFingerprint: string;
	previewJson: string;
	createdAt: string;
	expiresAt: string;
}

interface PreviewRecord {
	id: string;
	prod_ref: string;
	action_type: string;
	target_id: string | null;
	input_hash: string;
	state_fingerprint: string;
	preview_json: string;
	created_at: string;
	expires_at: string;
}

function mapRecord(record: PreviewRecord): StoredPreview {
	return {
		id: record.id,
		prodRef: record.prod_ref,
		actionType: record.action_type,
		targetId: record.target_id,
		inputHash: record.input_hash,
		stateFingerprint: record.state_fingerprint,
		previewJson: record.preview_json,
		createdAt: record.created_at,
		expiresAt: record.expires_at,
	};
}

export function insertPreview(db: SqliteDriver, preview: StoredPreview): void {
	db.run(
		`insert into operation_preview (
			id, prod_ref, action_type, target_id, input_hash, state_fingerprint,
			preview_json, created_at, expires_at
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			preview.id,
			preview.prodRef,
			preview.actionType,
			preview.targetId,
			preview.inputHash,
			preview.stateFingerprint,
			preview.previewJson,
			preview.createdAt,
			preview.expiresAt,
		],
	);
}

/** Fetch a preview that has not yet expired at `nowIso`. */
export function getValidPreview(
	db: SqliteDriver,
	id: string,
	nowIso: string,
): StoredPreview | null {
	const record = db.get<PreviewRecord>(
		"select * from operation_preview where id = ? and expires_at > ?",
		[id, nowIso],
	);
	return record ? mapRecord(record) : null;
}

/** Atomically consumes a still-valid preview so only one commit can proceed. */
export function consumeValidPreview(
	db: SqliteDriver,
	id: string,
	nowIso: string,
): boolean {
	return (
		db.run(
			"delete from operation_preview where id = ? and expires_at > ?",
			[id, nowIso],
		).changes === 1
	);
}

/** Drop expired rows; returns how many were removed. */
export function prunePreviews(db: SqliteDriver, nowIso: string): number {
	return db.run("delete from operation_preview where expires_at <= ?", [nowIso])
		.changes;
}
