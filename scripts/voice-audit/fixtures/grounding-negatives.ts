import type { SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";

// A small, checked-in set of SUBTLE grounding negatives: an otherwise-grounded gold read with
// exactly ONE ungrounded claim spliced in. The other claims stay genuinely grounded, so each
// fixture isolates a single import — the calibration question is whether the judge catches it.
//
// All are based on "no-sex-for-ben" on purpose: it is the one gold carrying ZERO vote-gated
// annotations, so an injected claim cannot be accidentally grounded by an annotation — the only
// support a claim could have is its short, fully-known heard lyrics. The correct verdict for
// every fixture is grounded:false, citing the one imported claim. This is a directional
// calibration signal, not a labeling project; keep it small and explicit. See plan WP4.

export interface GroundingNegativeFixture {
	id: string;
	/** Gold whose heard lyrics + annotations supply the grounding context. */
	baseKey: string;
	label: "fail";
	severity: "subtle";
	/** GRD-2 reception / GRD-3 biography / imported real-world fact / IMG-3 fabricated setting. */
	claimType: "reception" | "biography" | "real-world-fact" | "fabricated-setting";
	/** What was injected and why it is ungrounded for the base song. */
	note: string;
	/** The base gold read with one ungrounded claim spliced in; everything else stays grounded. */
	mutate: (read: SongRead) => SongRead;
}

const appendToTake =
	(extra: string) =>
	(read: SongRead): SongRead => ({ ...read, take: `${read.take} ${extra}` });

export const GROUNDING_NEGATIVES: GroundingNegativeFixture[] = [
	{
		id: "nsfb-reception",
		baseKey: "no-sex-for-ben",
		label: "fail",
		severity: "subtle",
		claimType: "reception",
		note: "Injects crowd/chart reception the lyrics never state (GRD-2).",
		mutate: appendToTake("It became the floor-filler everyone screamed that summer."),
	},
	{
		id: "nsfb-biography",
		baseKey: "no-sex-for-ben",
		label: "fail",
		severity: "subtle",
		claimType: "biography",
		note: "Injects band backstory (The Rapture roasting a former producer) absent from lyrics and annotations (GRD-3).",
		mutate: appendToTake(
			"The Rapture wrote it to roast the producer who walked out on the band.",
		),
	},
	{
		id: "nsfb-real-world-fact",
		baseKey: "no-sex-for-ben",
		label: "fail",
		severity: "subtle",
		claimType: "real-world-fact",
		note: 'The NAME "Arthur Baker" is heard, but the gloss of who he is, is imported real-world knowledge.',
		mutate: appendToTake(
			"Arthur Baker, the legendary producer who built the eighties electro sound, is the bar he falls short of.",
		),
	},
	{
		id: "nsfb-fabricated-setting",
		baseKey: "no-sex-for-ben",
		label: "fail",
		severity: "subtle",
		claimType: "fabricated-setting",
		note: "Invents a physical setting (rain, a basement club, windows) the lyrics never reference (IMG-3).",
		mutate: (read) => ({
			...read,
			arc: read.arc.map((beat, i) =>
				i === 0
					? {
							...beat,
							scene: `${beat.scene} Rain streaks the windows of the basement club where they corner him.`,
						}
					: beat,
			),
		}),
	},
];
