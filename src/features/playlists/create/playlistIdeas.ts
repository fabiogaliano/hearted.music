/**
 * Derives interactive playlist IDEAS from an account's taste profile — not a
 * fixed editorial list, and not finished picks either: each idea is a
 * mad-lib with cyclable slots ("All things [indie]", "Throwbacks: [2010s]",
 * "Where [indie] meets [electronic]", "Liked in the [last 3 months]") whose options
 * and default fills come from the profile. Each rule has a floor so thin
 * signals don't produce hollow cards — a sparse library yields fewer
 * ideas with fewer slot options, a brand-new one yields none.
 *
 * Ideas are deliberately structured-only (genres, windows, decades —
 * never free-text `intent`): describing the vibe in words is the premium
 * gated capability, and ideas must not leak it to free accounts.
 */

import type { IntentGateVM } from "@/lib/domains/playlists/intent-eligibility";
import type {
	IdeaOptionVM,
	PlaylistIdeaVM,
	ResolvedIdeaVM,
	TasteProfileVM,
} from "./ideaTypes";

/** Rotate so a random element leads — the genre blank defaults differently per visit. */
function rotateRandom<T>(items: T[]): T[] {
	const start = Math.floor(Math.random() * items.length);
	return [...items.slice(start), ...items.slice(0, start)];
}

// Emission is facet-ordered — genre (single, then blend), time (liked-window,
// then decade), artist — so the flat list still scans dimension-by-dimension
// without the UI adding group chrome.
export function buildPlaylistIdeas(profile: TasteProfileVM): PlaylistIdeaVM[] {
	const ideas: PlaylistIdeaVM[] = [];

	const genres = profile.topGenres.filter((g) => g.count >= 20).slice(0, 5);
	const genreChoices: IdeaOptionVM[] = genres.map((g) => ({
		id: g.name,
		label: g.name,
		genrePills: [g.name],
	}));
	const genreCount = (id: string | undefined) =>
		genres.find((g) => g.name === id)?.count ?? 0;

	if (genreChoices.length > 0) {
		ideas.push({
			id: "idea-genre",
			facet: "genre",
			parts: ["All things ", { slot: "genre" }],
			slots: { genre: rotateRandom(genreChoices) },
			// Pills bias the ranking, not a hard filter — phrase the count as the pool
			// it leans on, never a promise the whole playlist is this genre.
			describe: (sel) =>
				`leans ${sel.genre?.id}, drawn from ${genreCount(sel.genre?.id)} you've liked`,
		});
	}

	if (genreChoices.length >= 2) {
		ideas.push({
			id: "idea-blend",
			facet: "genre",
			parts: ["Where ", { slot: "a" }, " meets ", { slot: "b" }],
			slots: {
				a: genreChoices,
				// Offset by one so the default pairing is the top two, not a self-blend.
				b: [...genreChoices.slice(1), genreChoices[0]],
			},
			// A sum, not an intersection — say "across both", never "overlap".
			// Pills bias the ranking, so it leans toward the blend rather than
			// guaranteeing every track sits in one genre or the other.
			describe: (sel) =>
				sel.a?.id === sel.b?.id
					? "pick two different genres to blend"
					: `leans toward both, from ${genreCount(sel.a?.id) + genreCount(sel.b?.id)} you've liked`,
		});
	}

	const windows = profile.likedWindows.filter((w) => w.count >= 8);
	if (windows.length > 0) {
		ideas.push({
			id: "idea-window",
			facet: "time",
			parts: ["Liked in the ", { slot: "window" }],
			slots: {
				window: windows.map((w) => ({
					id: w.id,
					label: w.label,
					likedAt: w.likedAt,
				})),
			},
			describe: (sel) => {
				const w = windows.find((x) => x.id === sel.window?.id);
				return `${w?.count ?? 0} liked songs from that stretch of your history`;
			},
		});
	}

	const decades = profile.decades.filter((d) => d.count >= 3);
	if (decades.length > 0) {
		ideas.push({
			id: "idea-decade",
			facet: "time",
			parts: ["Throwbacks: ", { slot: "period" }],
			slots: {
				period: decades.map((d) => ({
					id: d.label,
					label: d.label,
					releaseYear: { kind: "range", start: d.from, end: d.to },
				})),
			},
			describe: (sel) => {
				const d = decades.find((x) => x.label === sel.period?.id);
				return d ? `${d.count} liked songs released ${d.from}–${d.to}` : "";
			},
		});
	}

	// Artists spread far thinner than genres across real libraries (a heavy
	// listener still tops out at single-digit likes per artist), so the floor
	// sits at the window floor, not the genre floor — an artist you've liked 8+
	// times is a strong "in their orbit" seed, not a thin signal.
	const artists = profile.topArtists.filter((a) => a.count >= 8).slice(0, 5);
	if (artists.length > 0) {
		ideas.push({
			id: "idea-artist",
			facet: "artist",
			parts: ["Around ", { slot: "artist" }],
			slots: {
				artist: artists.map((a) => ({
					id: a.name,
					label: a.name,
					artist: a.name,
				})),
			},
			describe: (sel) => {
				const a = artists.find((x) => x.name === sel.artist?.id);
				return `${a?.count ?? 0} liked songs in their orbit`;
			},
		});
	}

	return ideas;
}

/** Default selection: every slot filled with its first (profile-ranked) option. */
export function defaultSelection(
	idea: PlaylistIdeaVM,
): Record<string, IdeaOptionVM> {
	return Object.fromEntries(
		Object.entries(idea.slots).map(([slot, options]) => [slot, options[0]]),
	);
}

/**
 * Collapse a tuned idea into the concrete ResolvedIdeaVM the studio consumes.
 *
 * Each choice carries at most one structured dimension, and no idea mixes
 * them (genre/blend contribute pills, decade a release-year window, window a
 * liked-at window, artist a pin target), so folding is a union: pills dedupe
 * across slots; release-year/liked-at/artist take the first choice that carries
 * them. A decade or window resolves into a `matchFilters` object; an artist into
 * `anchorArtist`. Genre-only ideas leave both unset (the previous behaviour).
 */
export function resolveIdea(
	idea: PlaylistIdeaVM,
	selection: Record<string, IdeaOptionVM>,
): ResolvedIdeaVM {
	const choices = Object.values(selection);
	const label = idea.parts
		.map((part) =>
			typeof part === "string" ? part : selection[part.slot].label,
		)
		.join("");
	const genrePills = [
		...new Set(choices.flatMap((choice) => choice.genrePills ?? [])),
	];
	const releaseYear = choices.find((c) => c.releaseYear)?.releaseYear;
	const likedAt = choices.find((c) => c.likedAt)?.likedAt;
	const anchorArtist = choices.find((c) => c.artist)?.artist;
	const matchFilters =
		releaseYear || likedAt
			? {
					version: 1 as const,
					...(releaseYear ? { releaseYear } : {}),
					...(likedAt ? { likedAt } : {}),
				}
			: undefined;
	return {
		id: `${idea.id}:${choices.map((c) => c.id).join("+")}`,
		label,
		description: idea.describe(selection),
		genrePills,
		matchFilters,
		anchorArtist,
	};
}

/**
 * One-line explanation of every unmet path through the gate, for the locked
 * treatment — e.g. "Backstage Pass" (or, if an accumulating path is re-added,
 * "Backstage Pass · or 1,000 songs from packs — 500 / 1,000").
 */
export function formatGateHint(gate: IntentGateVM): string {
	return gate.criteria
		.filter((c) => !c.met)
		.map((c) =>
			c.progress
				? `${c.label} — ${c.progress.current.toLocaleString()} / ${c.progress.target.toLocaleString()}`
				: c.label,
		)
		.join(" · or ");
}
