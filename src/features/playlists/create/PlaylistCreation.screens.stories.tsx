/**
 * Playlist Creation — the seeded landing (beat 1), promoted to prod.
 *
 * This is the real `SeedStage` from `./seed/`, reading the taste profile and
 * intent gate from the query cache (seeded here per control). Beat 2 — the
 * studio — is the live `CreatePlaylistScreen`, which needs the router/auth
 * context, so it's exercised by the composable stories rather than here; this
 * story owns the landing's own decisions: how the template spread adapts to a
 * library's depth, and how the own-words premium gate reads locked vs unlocked.
 *
 * Flip the library control (rich / sparse / brand-new) to watch the template
 * spread thin out; flip intentAccess to swap the own-words row between an open
 * field and the "show then lock" treatment. Best viewed at the desktop preset.
 */

import type { Story } from "@ladle/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { IntentGateVM } from "@/lib/domains/playlists/intent-eligibility";
import { fonts } from "@/lib/theme/fonts";
import { intentEligibilityQueryOptions } from "./intentEligibility";
import { SeedStage } from "./seed/SeedStage";
import type { PresetVM, TasteProfileVM } from "./seedTypes";
import { tasteProfileQueryOptions } from "./tasteProfile";

export default { title: "Playlist Creation" };

// Canned likedAt filters for the window fixtures. In prod these come from the
// RPC's per-window date bounds (rolling "last N days" → an open `after`; anchored
// "first 3 months" → a closed `range`); the exact dates don't matter to the story.
const last30d = { kind: "after", startDate: "2026-06-12" } as const;
const last3m = { kind: "after", startDate: "2026-04-12" } as const;
const last6m = { kind: "after", startDate: "2026-01-12" } as const;
const first3m = {
	kind: "range",
	startDate: "2024-01-10",
	end: { kind: "date", date: "2024-04-10" },
} as const;

// Three library depths for judging the dynamic seed stage: rich derives the full
// template spread with well-stocked slots, sparse only what clears the floors
// (fewer cards, fewer options per blank), brand-new derives nothing (the stage
// explains itself instead of showing hollow cards).
const TASTE_PROFILES: Record<"rich" | "sparse" | "brand-new", TasteProfileVM> =
	{
		rich: {
			totalLikedCount: 1238,
			likedWindows: [
				{ id: "last-30d", label: "last 30 days", count: 47, likedAt: last30d },
				{ id: "last-3m", label: "last 3 months", count: 132, likedAt: last3m },
				{ id: "last-6m", label: "last 6 months", count: 257, likedAt: last6m },
				{
					id: "first-3m",
					label: "first 3 months",
					count: 64,
					likedAt: first3m,
				},
			],
			topGenres: [
				{ name: "indie", count: 340 },
				{ name: "electronic", count: 185 },
				{ name: "pop", count: 121 },
				{ name: "house", count: 78 },
				{ name: "indie rock", count: 45 },
			],
			topArtists: [
				{ name: "KAYTRANADA", count: 26 },
				{ name: "Dua Lipa", count: 19 },
				{ name: "The Strokes", count: 14 },
			],
			decades: [
				{ label: "2010s", from: 2010, to: 2019, count: 214 },
				{ label: "2000s", from: 2000, to: 2009, count: 88 },
				{ label: "1990s", from: 1990, to: 1999, count: 41 },
			],
		},
		sparse: {
			totalLikedCount: 86,
			likedWindows: [
				{ id: "last-30d", label: "last 30 days", count: 12, likedAt: last30d },
				{ id: "last-3m", label: "last 3 months", count: 31, likedAt: last3m },
				{ id: "first-3m", label: "first 3 months", count: 5, likedAt: first3m },
			],
			topGenres: [
				{ name: "pop", count: 34 },
				{ name: "dance pop", count: 18 },
			],
			topArtists: [{ name: "Dua Lipa", count: 9 }],
			decades: [{ label: "2020s", from: 2020, to: 2026, count: 15 }],
		},
		"brand-new": {
			totalLikedCount: 23,
			likedWindows: [
				{ id: "last-30d", label: "last 30 days", count: 6, likedAt: last30d },
			],
			topGenres: [],
			topArtists: [],
			decades: [],
		},
	};

const INTENT_GATES: Record<"unlocked" | "locked", IntentGateVM> = {
	unlocked: {
		allowed: true,
		criteria: [{ id: "backstage-pass", label: "Backstage Pass", met: true }],
	},
	locked: {
		allowed: false,
		criteria: [{ id: "backstage-pass", label: "Backstage Pass", met: false }],
	},
};

// A fresh client whose cache already holds the seed stage's two queries, so the
// component's useQuery reads resolve synchronously without touching the server.
function seededClient(
	profile: TasteProfileVM,
	gate: IntentGateVM,
): QueryClient {
	const qc = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				refetchOnWindowFocus: false,
				gcTime: Number.POSITIVE_INFINITY,
				staleTime: Number.POSITIVE_INFINITY,
			},
		},
	});
	qc.setQueryData(tasteProfileQueryOptions().queryKey, profile);
	qc.setQueryData(intentEligibilityQueryOptions().queryKey, gate);
	return qc;
}

interface SeedStageArgs {
	library: "rich" | "sparse" | "brand-new";
	intentAccess: "unlocked" | "locked";
}

export const ScreenSeedStage: Story<SeedStageArgs> = ({
	library,
	intentAccess,
}) => {
	const [seeded, setSeeded] = useState<{
		preset: PresetVM | null;
		intentText: string;
	} | null>(null);
	const [unlockOpened, setUnlockOpened] = useState(false);

	// New client per control combo so flipping a control re-seeds the cache and
	// resets the seed state below it.
	const client = useMemo(
		() => seededClient(TASTE_PROFILES[library], INTENT_GATES[intentAccess]),
		[library, intentAccess],
	);

	return (
		<QueryClientProvider client={client}>
			<SeedStage
				key={`${library}-${intentAccess}`}
				onSeed={(preset, intentText) => setSeeded({ preset, intentText })}
				onUnlock={() => setUnlockOpened(true)}
			/>
			{unlockOpened && (
				<p
					className="theme-text-muted mx-auto mt-6 max-w-2xl px-8 text-xs"
					style={{ fontFamily: fonts.body }}
				>
					Unlock CTA → would open the paywall (UpgradeDialog) in the real
					screen.
				</p>
			)}
			{seeded && (
				<p
					className="theme-text-muted mx-auto mt-6 max-w-2xl px-8 text-xs"
					style={{ fontFamily: fonts.body }}
				>
					Seeded → name:{" "}
					<span className="theme-text">{seeded.preset?.label ?? "—"}</span> ·
					genres:{" "}
					<span className="theme-text">
						{seeded.preset?.genrePills.join(", ") || "—"}
					</span>{" "}
					· intent:{" "}
					<span className="theme-text">{seeded.intentText || "—"}</span>
				</p>
			)}
		</QueryClientProvider>
	);
};
ScreenSeedStage.storyName = "Screen: Seed Stage (beat 1)";
ScreenSeedStage.args = {
	library: "rich",
	intentAccess: "unlocked",
};
ScreenSeedStage.argTypes = {
	library: {
		options: ["rich", "sparse", "brand-new"],
		control: { type: "select" },
	},
	intentAccess: {
		options: ["unlocked", "locked"],
		control: { type: "radio" },
	},
};
ScreenSeedStage.meta = {
	description:
		"The promoted seed landing: interactive mad-lib TEMPLATES derived from the taste profile — a dashed blank ('All things [indie]', 'Throwbacks: [2010s]', 'Where [indie] meets [electronic]', 'Around [artist]') opens a popover listing its profile-ranked options; the arrow starts from the tuned result. 'From your whole library' names the scratch and its count. Flip the library control (rich / sparse / brand-new) to see the spread adapt; flip intentAccess to see the own-words premium gate (available with Backstage Pass). Picking a seed shows the config it would carry into the studio.",
};
