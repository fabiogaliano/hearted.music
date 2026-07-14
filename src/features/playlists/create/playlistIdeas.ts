/**
 * Derives interactive playlist IDEAS from an account's taste profile — not a
 * fixed editorial list, and not finished picks either: each idea is a
 * mad-lib with cyclable slots ("All things [indie]", "Throwbacks: [2010s]",
 * "Where [indie] meets [electronic]", "Your [last] likes, all [3 months] of them") whose options
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

// The window idea's two axes, keyed off the RPC's window ids ("last-3m",
// "first-12m", …). Anchor = which end of your liking history; length = how wide.
const ANCHOR_LABEL = {
	recent: "last",
	start: "first",
} as const;
// Recent leads — a fresh window is the more common starting point than one's origin.
const ANCHOR_ORDER = ["recent", "start"] as const;
const LENGTH_LABEL: Record<string, string> = {
	"3m": "3 months",
	"6m": "6 months",
	"12m": "12 months",
	"18m": "18 months",
	"24m": "24 months",
};
const LENGTH_RANK: Record<string, number> = {
	"3m": 0,
	"6m": 1,
	"12m": 2,
	"18m": 3,
	"24m": 4,
};

// A window this thin still makes a usable starting point the user shapes further,
// and dropping it is what made the "first" anchor vanish for accounts with a slow
// early ramp — so the floor sits low. The RPC only returns non-empty windows.
const WINDOW_MIN_COUNT = 4;

/**
 * Decompose a window id ("last-3m") into its anchor + length. The id is the
 * contract with the RPC's buckets; an unrecognised prefix or length drops out
 * (returns null) so a new SQL bucket can't surface an unlabelled blank.
 */
function parseWindow(
	id: string,
): { anchor: "recent" | "start"; length: string; lengthLabel: string } | null {
	const [prefix, length] = id.split("-");
	const anchor =
		prefix === "last" ? "recent" : prefix === "first" ? "start" : null;
	const lengthLabel = length ? LENGTH_LABEL[length] : undefined;
	if (!anchor || !length || !lengthLabel) return null;
	return { anchor, length, lengthLabel };
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

	// The window idea splits into two independent blanks — an ANCHOR (which end of
	// your liking history) and a bare LENGTH — instead of one fused "last 3 months"
	// token. The anchor carries no filter of its own; the correct liked-at window
	// for each anchor×length pair is baked onto the length option (which is why the
	// length options are anchor-dependent), so resolveIdea folds it like any other.
	const windows = profile.likedWindows
		.filter((w) => w.count >= WINDOW_MIN_COUNT)
		.map((w) => ({ ...w, parsed: parseWindow(w.id) }))
		.filter(
			(w): w is typeof w & { parsed: NonNullable<typeof w.parsed> } =>
				w.parsed !== null,
		);
	if (windows.length > 0) {
		const anchors = ANCHOR_ORDER.filter((a) =>
			windows.some((w) => w.parsed.anchor === a),
		).map((a) => ({ id: a, label: ANCHOR_LABEL[a] }));
		const lengthOptionsFor = (anchorId: string): IdeaOptionVM[] =>
			windows
				.filter((w) => w.parsed.anchor === anchorId)
				.sort(
					(a, b) => LENGTH_RANK[a.parsed.length] - LENGTH_RANK[b.parsed.length],
				)
				.map((w) => ({
					id: w.parsed.length,
					label: w.parsed.lengthLabel,
					likedAt: w.likedAt,
				}));
		ideas.push({
			id: "idea-window",
			facet: "time",
			// Two blanks at opposite ends: "Your [first|last] likes, all [3 months] of
			// them". The anchor adjective (front) carries direction, the duration
			// (back) stays bare, and the words between hold them apart so they never
			// read as one fused token.
			parts: [
				"Your ",
				{ slot: "anchor" },
				" likes, all ",
				{ slot: "length" },
				" of them",
			],
			slots: {
				anchor: anchors,
				length: (sel) => lengthOptionsFor(sel.anchor?.id ?? anchors[0].id),
			},
			describe: (sel) => {
				const w = windows.find(
					(x) =>
						x.parsed.anchor === sel.anchor?.id &&
						x.parsed.length === sel.length?.id,
				);
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
	// listener still tops out at single-digit likes per artist), so the floor sits
	// well below the genre floor — an artist you've liked 8+ times is a strong "in
	// their orbit" seed, not a thin signal.
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

/** A slot's options resolved against the current selection (fixed or derived). */
export function slotOptionsFor(
	idea: PlaylistIdeaVM,
	slot: string,
	selection: Record<string, IdeaOptionVM>,
): IdeaOptionVM[] {
	const options = idea.slots[slot];
	return typeof options === "function" ? options(selection) : (options ?? []);
}

/**
 * Fill/repair a selection so every slot holds a valid option, resolving slots in
 * declaration order so a dependent slot (window `length`) sees the slot it
 * depends on (`anchor`) already settled. A slot whose current pick is no longer
 * offered — e.g. "6 months" after switching the anchor to your history's start —
 * snaps back to its first option rather than dangling on a dead pair.
 */
export function reconcileSelection(
	idea: PlaylistIdeaVM,
	selection: Record<string, IdeaOptionVM>,
): Record<string, IdeaOptionVM> {
	const next: Record<string, IdeaOptionVM> = {};
	for (const slot of Object.keys(idea.slots)) {
		const options = slotOptionsFor(idea, slot, next);
		const current = selection[slot];
		next[slot] = options.find((o) => o.id === current?.id) ?? options[0];
	}
	return next;
}

/** Default selection: every slot filled with its first (profile-ranked) option. */
export function defaultSelection(
	idea: PlaylistIdeaVM,
): Record<string, IdeaOptionVM> {
	return reconcileSelection(idea, {});
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
