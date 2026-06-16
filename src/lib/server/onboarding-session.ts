/**
 * Guard-critical session loading and derivation primitives.
 *
 * Extracted so both `getOnboardingSession` and `getOnboardingData` route
 * through the same construction helper and can never disagree on
 * `session.status` for the same DB row.
 */

import { Result } from "better-result";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { AnalysisContent } from "@/lib/domains/enrichment/content-analysis/analysis-content";
import type {
	OnboardingAuthPayload,
	OnboardingSession,
	WalkthroughSong,
} from "@/lib/domains/library/accounts/onboarding-session";
import {
	ONBOARDING_STEP_VALUES,
	type OnboardingStep,
} from "@/lib/domains/library/accounts/onboarding-steps";
import {
	getOrCreatePreferences,
	ONBOARDING_STEPS,
	type UserPreferences,
} from "@/lib/domains/library/accounts/preferences-queries";
import { OnboardingError } from "@/lib/shared/errors/domain/onboarding";
import { generateSongSlug } from "@/lib/utils/slug";

/**
 * Project a persisted `(onboarding_step, demo_song_id)` pair plus the
 * account handle into the canonical `OnboardingSession` discriminated union.
 *
 * Pure — never writes to the DB.
 *
 * Handle prerequisite: if the account has no handle yet but the persisted step
 * is `claim-handle` or any later token (i.e. the account should have claimed a
 * handle by now but hasn't), pin the session to `{ status: "claim-handle" }`.
 * This overrides the persisted step for unfinished onboarding so route guards
 * cannot skip the claim-handle screen. The completion timestamp remains the
 * top authority — a completed row with a null handle is NOT dragged back.
 *
 * Task 08 may refactor the "claim-handle or later" set check to
 * `isOnboardingStepBefore` once that helper exists.
 */
function deriveSession(
	accountId: string,
	accountHandle: string | null,
	onboardingStep: OnboardingStep,
	onboardingCompletedAt: string | null,
	walkthroughSong: WalkthroughSong | null,
): OnboardingSession {
	// `session.status === "complete"` is ONLY producible from a non-null
	// completion timestamp. The persisted step column is advisory; the
	// timestamp is the authority so partial writes can't fabricate a
	// ghost-complete session.
	if (onboardingCompletedAt !== null) {
		return { status: "complete" };
	}

	// Handle prerequisite for unfinished onboarding. Every step before
	// claim-handle (the welcome hook + the fake-demo + connect steps) runs
	// without a handle. If the handle is missing and the persisted step is
	// claim-handle or later (including the inconsistent complete-without-timestamp
	// case), pin to claim-handle so the user cannot bypass the handle screen.
	// Using an indexOf comparison rather than a hard-coded set so the ordering
	// is derived from the single source of truth (ONBOARDING_STEP_VALUES).
	const claimHandleIndex = ONBOARDING_STEP_VALUES.indexOf("claim-handle");
	const stepIndex = ONBOARDING_STEP_VALUES.indexOf(onboardingStep);
	if (accountHandle === null && stepIndex >= claimHandleIndex) {
		return { status: "claim-handle" };
	}

	// Inconsistent row: step="complete" without a timestamp. Loud in dev so
	// the offending write path gets fixed; safe fallback in prod to the final
	// pre-complete step so the user doesn't get stuck in a bogus complete
	// state that skips `markOnboardingComplete`'s side effects.
	if (onboardingStep === "complete") {
		const message =
			`[onboarding invariant] step="complete" for account ${accountId} ` +
			`has no onboarding_completed_at. Falling back to "plan-selection".`;
		if (import.meta.env.DEV) {
			throw new Error(message);
		}
		console.error(message);
		return { status: "plan-selection" };
	}

	const needsDemoSong =
		onboardingStep === "song-walkthrough" ||
		onboardingStep === "match-walkthrough";

	if (needsDemoSong && walkthroughSong === null) {
		const message =
			`[onboarding invariant] step=${onboardingStep} for account ${accountId} ` +
			`has no demo_song_id. Atomic transitions should make this impossible.`;
		if (import.meta.env.DEV) {
			// Loud: surface the invariant violation immediately during local
			// development. If this fires, fix the code path that produced it
			// instead of relying on the prod fallback below.
			throw new Error(message);
		}
		console.error(message);
		return { status: "pick-demo-song" };
	}

	if (onboardingStep === "song-walkthrough" && walkthroughSong) {
		return { status: "song-walkthrough", song: walkthroughSong };
	}
	if (onboardingStep === "match-walkthrough" && walkthroughSong) {
		return { status: "match-walkthrough", song: walkthroughSong };
	}

	// Exhaustive projection for the remaining non-complete, non-walkthrough
	// steps. TypeScript verifies every `OnboardingStep` value is handled.
	switch (onboardingStep) {
		case "welcome":
		case "pick-color":
		case "install-extension":
		case "syncing":
		case "claim-handle":
		case "flag-playlists":
		case "pick-demo-song":
		case "plan-selection":
			return { status: onboardingStep };
		case "song-walkthrough":
		case "match-walkthrough":
			// Unreachable: walkthrough-with-song returns above; walkthrough
			// without song is coerced by the invariant branch. Kept so the
			// compiler treats the switch as exhaustive without a `never`
			// assertion on `onboardingStep`.
			return { status: "pick-demo-song" };
	}
}

/**
 * Loads the persisted demo song (if any) as a `WalkthroughSong`. Returns
 * `null` if no demo song is selected, or if the join fails — callers are
 * expected to handle the null case (and `deriveSession` encodes what that
 * null means for the session variant).
 */
async function loadWalkthroughSong(
	supabase: AdminSupabaseClient,
	demoSongId: string | null,
): Promise<WalkthroughSong | null> {
	if (!demoSongId) return null;

	const [{ data: song }, { data: analysisRow }] = await Promise.all([
		supabase
			.from("song")
			.select(
				"id, spotify_id, name, artists, artist_ids, genres, album_name, image_url",
			)
			.eq("id", demoSongId)
			.single(),
		supabase
			.from("song_analysis")
			.select("id, analysis, model, created_at")
			.eq("song_id", demoSongId)
			.order("created_at", { ascending: false })
			.limit(1)
			.maybeSingle(),
	]);

	if (!song) return null;

	const artist = song.artists[0] ?? "Unknown Artist";
	const artistSpotifyId = song.artist_ids?.[0] ?? null;

	let artistImageUrl: string | null = null;
	if (artistSpotifyId) {
		const { data: artistRow } = await supabase
			.from("artist")
			.select("image_url")
			.eq("spotify_id", artistSpotifyId)
			.maybeSingle();
		artistImageUrl = artistRow?.image_url ?? null;
	}

	return {
		id: song.id,
		spotifyTrackId: song.spotify_id,
		slug: generateSongSlug(artist, song.name),
		name: song.name,
		artist,
		artistId: artistSpotifyId,
		artistImageUrl,
		album: song.album_name,
		albumArtUrl: song.image_url,
		genres: song.genres ?? [],
		analysis: analysisRow
			? {
					id: analysisRow.id,
					content: analysisRow.analysis as AnalysisContent,
					model: analysisRow.model,
					createdAt: analysisRow.created_at,
				}
			: null,
	};
}

/**
 * Derives an `OnboardingAuthPayload` from already-fetched preferences so
 * callers that need both session + additional page data can share a single
 * prefs fetch. Resolves the walkthrough song lazily (only when `demo_song_id`
 * is set) so the no-walkthrough path stays one round-trip.
 *
 * This is the single session-construction helper — both `loadOnboardingSession`
 * and `loadOnboardingData` must call this so they can never disagree on
 * `session.status` for the same row.
 */
export async function deriveAuthPayloadFromPrefs(args: {
	accountId: string;
	accountHandle: string | null;
	prefs: UserPreferences;
	supabase: AdminSupabaseClient;
}): Promise<OnboardingAuthPayload> {
	const { accountId, accountHandle, prefs, supabase } = args;

	// Falls back to "welcome" on parse failure so invalid/unknown step tokens
	// are treated as pre-claim — they correctly do NOT trigger the handle pin
	// because "welcome" is before "claim-handle" in ONBOARDING_STEP_VALUES.
	const stepParse = ONBOARDING_STEPS.safeParse(prefs.onboarding_step);
	const onboardingStep: OnboardingStep = stepParse.success
		? stepParse.data
		: "welcome";

	const walkthroughSong = await loadWalkthroughSong(
		supabase,
		prefs.demo_song_id,
	);

	const session = deriveSession(
		accountId,
		accountHandle,
		onboardingStep,
		prefs.onboarding_completed_at,
		walkthroughSong,
	);

	return { session, theme: prefs.theme };
}

/**
 * Guard-critical loader. Fetches only prefs + (optionally) the demo song.
 * Used by `getOnboardingSession`, which the auth layout polls on every
 * navigation with `staleTime: 0`. Small object, cheap refetch.
 */
export async function loadOnboardingSession(args: {
	accountId: string;
	accountHandle: string | null;
}): Promise<OnboardingAuthPayload> {
	const { accountId, accountHandle } = args;
	const supabase = createAdminSupabaseClient();
	const prefsResult = await getOrCreatePreferences(accountId);
	if (Result.isError(prefsResult)) {
		throw new OnboardingError("load_preferences", prefsResult.error);
	}

	return deriveAuthPayloadFromPrefs({
		accountId,
		accountHandle,
		prefs: prefsResult.value,
		supabase,
	});
}
