/**
 * Derives interactive seed TEMPLATES from an account's taste profile — not a
 * fixed editorial list, and not finished picks either: each template is a
 * mad-lib with cyclable slots ("All things [indie]", "Throwbacks: [2010s]",
 * "Where [indie] meets [electronic]", "Liked in the [last 3 months]") whose options
 * and default fills come from the profile. Each rule has a floor so thin
 * signals don't produce hollow cards — a sparse library yields fewer
 * templates with fewer slot options, a brand-new one yields none.
 *
 * Templates are deliberately structured-only (genres, windows, decades —
 * never free-text `intent`): describing the vibe in words is the premium
 * gated capability, and templates must not leak it to free accounts.
 */

import type {
	IntentGateVM,
	PresetVM,
	SeedChoiceVM,
	SeedTemplateVM,
	TasteProfileVM,
} from "./types";

/** Rotate so a random element leads — the genre blank defaults differently per visit. */
function rotateRandom<T>(items: T[]): T[] {
	const start = Math.floor(Math.random() * items.length);
	return [...items.slice(start), ...items.slice(0, start)];
}

export function buildSeedTemplates(profile: TasteProfileVM): SeedTemplateVM[] {
	const templates: SeedTemplateVM[] = [];

	const windows = profile.likedWindows.filter((w) => w.count >= 8);
	if (windows.length > 0) {
		templates.push({
			id: "tpl-window",
			parts: ["Liked in the ", { slot: "window" }],
			slots: {
				window: windows.map((w) => ({ id: w.id, label: w.label })),
			},
			describe: (sel) => {
				const w = windows.find((x) => x.id === sel.window?.id);
				return `${w?.count ?? 0} liked songs from that stretch of your history`;
			},
		});
	}

	const genres = profile.topGenres.filter((g) => g.count >= 20).slice(0, 5);
	const genreChoices: SeedChoiceVM[] = genres.map((g) => ({
		id: g.name,
		label: g.name,
		genrePills: [g.name],
	}));
	const genreCount = (id: string | undefined) =>
		genres.find((g) => g.name === id)?.count ?? 0;

	if (genreChoices.length > 0) {
		templates.push({
			id: "tpl-genre",
			parts: ["All things ", { slot: "genre" }],
			slots: { genre: rotateRandom(genreChoices) },
			describe: (sel) =>
				`${genreCount(sel.genre?.id)} liked songs and counting`,
		});
	}

	const decades = profile.decades.filter((d) => d.count >= 20);
	if (decades.length > 0) {
		templates.push({
			id: "tpl-decade",
			parts: ["Throwbacks: ", { slot: "period" }],
			slots: {
				period: decades.map((d) => ({ id: d.label, label: d.label })),
			},
			describe: (sel) => {
				const d = decades.find((x) => x.label === sel.period?.id);
				return d ? `${d.count} liked songs released ${d.from}–${d.to}` : "";
			},
		});
	}

	if (genreChoices.length >= 2) {
		templates.push({
			id: "tpl-blend",
			parts: ["Where ", { slot: "a" }, " meets ", { slot: "b" }],
			slots: {
				a: genreChoices,
				// Offset by one so the default pairing is the top two, not a self-blend.
				b: [...genreChoices.slice(1), genreChoices[0]],
			},
			// A sum, not an intersection — say "across both", never "overlap".
			describe: (sel) =>
				sel.a?.id === sel.b?.id
					? "pick two different genres to blend"
					: `${genreCount(sel.a?.id) + genreCount(sel.b?.id)} liked songs across both`,
		});
	}

	const artists = profile.topArtists.filter((a) => a.count >= 12).slice(0, 5);
	if (artists.length > 0) {
		templates.push({
			id: "tpl-artist",
			parts: ["Around ", { slot: "artist" }],
			slots: {
				artist: artists.map((a) => ({ id: a.name, label: a.name })),
			},
			describe: (sel) => {
				const a = artists.find((x) => x.name === sel.artist?.id);
				return `${a?.count ?? 0} liked songs in their orbit`;
			},
		});
	}

	return templates;
}

/** Default selection: every slot filled with its first (profile-ranked) option. */
export function defaultSelection(
	template: SeedTemplateVM,
): Record<string, SeedChoiceVM> {
	return Object.fromEntries(
		Object.entries(template.slots).map(([slot, options]) => [slot, options[0]]),
	);
}

/** Collapse a tuned template into the concrete PresetVM the draft stage consumes. */
export function resolveTemplate(
	template: SeedTemplateVM,
	selection: Record<string, SeedChoiceVM>,
): PresetVM {
	const label = template.parts
		.map((part) =>
			typeof part === "string" ? part : selection[part.slot].label,
		)
		.join("");
	const genrePills = [
		...new Set(
			Object.values(selection).flatMap((choice) => choice.genrePills ?? []),
		),
	];
	return {
		id: `${template.id}:${Object.values(selection)
			.map((c) => c.id)
			.join("+")}`,
		label,
		description: template.describe(selection),
		genrePills,
	};
}

/**
 * One-line explanation of every unmet path through the gate, for the locked
 * treatment — e.g. "Backstage Pass · or 1,000 songs from packs — 500 / 1,000".
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
