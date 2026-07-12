/**
 * useCreatePlaylistFlow — owns the commit-flow lifecycle for the playlist
 * creation screen: idle → submitting → {success | partial | created-unsynced
 * → retrying} | gate-failure | error.
 *
 * Previously this state machine was split across CreateBar (submit + payload
 * assembly + isSubmitting) and CreatePlaylistScreen (a shadow FlowResult
 * union, submittedNameRef/submittedInputRef, retry), with onNameCommit /
 * onSubmitInput existing purely to smuggle snapshots up the tree across an
 * async boundary. Collecting it here makes the boundary informational
 * (submit takes the name as a call-time argument) rather than temporal.
 *
 * The submitted-input snapshot is private (a ref, never exposed) so
 * retryUnsynced() can take no arguments and still resume the EXACT original
 * draft — genre pills, filters, intent, songIds — even if the live config
 * was edited after a failed attempt. That's a structural guarantee, not a
 * caller discipline.
 *
 * isSubmitting/isRetryingUnsynced reset in a `finally`, so every terminal
 * branch — success, partial, created-unsynced, gate-failure, error, or a
 * thrown rejection — re-enables the CTA. This is what fixes the stuck-CTA
 * bug: previously, a "reconnect-required"/"extension-unavailable" result
 * left isSubmitting stuck at true because only the error/throw branches
 * reset it.
 */

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type {
	CreatePlaylistFromDraftInput,
	CreatePlaylistFromDraftResult,
} from "@/lib/extension/create-playlist-from-draft";
import {
	createPlaylistFromDraft,
	resumePlaylistCreateFromDraft,
} from "@/lib/extension/create-playlist-from-draft";
import type { SpotifyGateFailure } from "./useSpotifyGate";

/** The orchestrator input, submitted with the name as a call-time argument. */
export type CreatePlaylistFlowSubmitInput = CreatePlaylistFromDraftInput;

/**
 * Result states the screen renders. Only the terminal, user-facing statuses
 * survive here — "reconnect-required"/"extension-unavailable" are routed to
 * the gate instead, and "error" is surfaced as a toast (see applyResult).
 * Derived via Extract<> (never re-declared) so a shape change to the
 * orchestrator's union propagates here automatically.
 */
export type CreatePlaylistFlowResult =
	| (Extract<CreatePlaylistFromDraftResult, { status: "success" }> & {
			playlistName: string;
	  })
	| Extract<CreatePlaylistFromDraftResult, { status: "partial" }>
	| Extract<CreatePlaylistFromDraftResult, { status: "created-unsynced" }>;

export interface UseCreatePlaylistFlow {
	result: CreatePlaylistFlowResult | null;
	isSubmitting: boolean;
	isRetryingUnsynced: boolean;
	submit: (input: CreatePlaylistFlowSubmitInput) => Promise<void>;
	/** No args — resumes the private submitted-input snapshot verbatim. */
	retryUnsynced: () => Promise<void>;
}

const GENERIC_ERROR_MESSAGE = "Something went sideways. Let's try that again.";

export function useCreatePlaylistFlow(args: {
	reportGateFailure: (failure: SpotifyGateFailure) => void;
}): UseCreatePlaylistFlow {
	const { reportGateFailure } = args;
	const [result, setResult] = useState<CreatePlaylistFlowResult | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isRetryingUnsynced, setIsRetryingUnsynced] = useState(false);

	// Private: the exact input submitted to the orchestrator. Never exposed —
	// see module doc comment for why that's load-bearing for retryUnsynced.
	const submittedInputRef = useRef<CreatePlaylistFromDraftInput | null>(null);

	// One exhaustive switch, not an if/else chain: `default: raw satisfies
	// never` turns a new orchestrator status into a compile error instead of
	// a silently-dropped branch.
	const applyResult = useCallback(
		(raw: CreatePlaylistFromDraftResult, name: string) => {
			switch (raw.status) {
				case "success":
					setResult({ ...raw, playlistName: name });
					return;
				case "partial":
				case "created-unsynced":
					setResult(raw);
					return;
				case "reconnect-required":
				case "extension-unavailable":
					// The gate was "ok" when submit started but auth expired (or the
					// extension vanished) mid-flight. Route to the gate instead of
					// holding a result — the screen swaps to the reconnect affordance.
					reportGateFailure(raw.status);
					setResult(null);
					return;
				case "error":
					toast.error(raw.message);
					return;
				default:
					raw satisfies never;
					return;
			}
		},
		[reportGateFailure],
	);

	const submit = useCallback(
		async (input: CreatePlaylistFlowSubmitInput) => {
			submittedInputRef.current = input;
			setIsSubmitting(true);
			try {
				const raw = await createPlaylistFromDraft(input);
				applyResult(raw, input.name);
			} catch {
				toast.error(GENERIC_ERROR_MESSAGE);
			} finally {
				// Every terminal branch — success, partial, created-unsynced,
				// gate-failure, error, or throw — re-enables the CTA.
				setIsSubmitting(false);
			}
		},
		[applyResult],
	);

	const retryUnsynced = useCallback(async () => {
		const input = submittedInputRef.current;
		if (!input || result?.status !== "created-unsynced") return;
		setIsRetryingUnsynced(true);
		try {
			const raw = await resumePlaylistCreateFromDraft(
				input,
				result.playlistUri,
				result.spotifyId,
			);
			applyResult(raw, input.name);
		} catch {
			toast.error(GENERIC_ERROR_MESSAGE);
		} finally {
			setIsRetryingUnsynced(false);
		}
	}, [applyResult, result]);

	return { result, isSubmitting, isRetryingUnsynced, submit, retryUnsynced };
}
