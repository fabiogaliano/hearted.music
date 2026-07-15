/**
 * Typed mutation wrapper. Every mutating panel route runs its production work
 * through `recordAction`, which writes a `started` row before the prod call and
 * records the outcome after. If the local store is unavailable it throws 503
 * before any prod side effect runs — a write must never happen while its local
 * record cannot be created.
 *
 * Sensitive bodies (email content, manual lyrics) are never stored: callers pass
 * `redactText` output (length + hash) into the input summary instead of the text.
 */

import { createHash } from "node:crypto";
import { HttpError } from "../http-error";
import { prodRef } from "../db";
import {
	completeRun,
	insertStartedRun,
	type ActionRunMode,
} from "./action-runs";
import { getLocalStore, isLocalStoreReady } from "./store";

export interface RedactedText {
	length: number;
	sha256: string;
}

export function redactText(text: string): RedactedText {
	return {
		length: text.length,
		sha256: createHash("sha256").update(text, "utf8").digest("hex"),
	};
}

export interface ActionOutcomeSummary {
	// Defaults to "succeeded" when the work resolves; a caller can downgrade a
	// resolved-but-no-op result (e.g. "account not found") to "failed"/"partial".
	status?: "succeeded" | "failed" | "partial";
	result?: Record<string, unknown> | null;
	externalId?: string | null;
	targetLabel?: string | null;
}

export interface RecordActionArgs<T> {
	actionType: string;
	mode: ActionRunMode;
	targetType?: string | null;
	targetId?: string | null;
	targetLabel?: string | null;
	inputSummary?: Record<string, unknown> | null;
	parentRunId?: string | null;
	run: () => Promise<T>;
	summarize?: (result: T) => ActionOutcomeSummary;
	// Called with the generated run id once the `started` row is written (before
	// the prod call), so a route can echo the id back for a history deep link.
	onRecorded?: (runId: string) => void;
}

export async function recordAction<T>(args: RecordActionArgs<T>): Promise<T> {
	if (!isLocalStoreReady()) {
		throw new HttpError(
			503,
			"Local action history is unavailable; refusing to mutate production.",
		);
	}

	const db = getLocalStore();
	const id = crypto.randomUUID();
	const startedAt = new Date().toISOString();

	// A failure to write the started row is itself a reason to refuse the prod
	// call — there would be no local record of what we were about to do.
	try {
		insertStartedRun(db, {
			id,
			prodRef: prodRef(),
			actionType: args.actionType,
			mode: args.mode,
			targetType: args.targetType ?? null,
			targetId: args.targetId ?? null,
			targetLabel: args.targetLabel ?? null,
			inputSummary: args.inputSummary ?? null,
			startedAt,
			parentRunId: args.parentRunId ?? null,
		});
	} catch (error) {
		throw new HttpError(
			503,
			`Could not record local action history; refusing to mutate production: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	args.onRecorded?.(id);

	try {
		const result = await args.run();
		const summary = args.summarize?.(result) ?? {};
		completeRun(db, id, {
			status: summary.status ?? "succeeded",
			resultSummary: summary.result ?? null,
			externalId: summary.externalId ?? null,
			errorMessage: null,
			completedAt: new Date().toISOString(),
			targetLabel: summary.targetLabel,
		});
		return result;
	} catch (error) {
		completeRun(db, id, {
			status: "failed",
			resultSummary: null,
			externalId: null,
			errorMessage: error instanceof Error ? error.message : String(error),
			completedAt: new Date().toISOString(),
		});
		throw error;
	}
}
