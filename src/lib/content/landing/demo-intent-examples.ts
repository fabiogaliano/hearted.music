/**
 * Per-playlist matching-intent examples for the flag-playlists onboarding
 * preview, keyed by DEMO_PLAYLISTS id ("1"–"7"). Each onboarding playlist shows
 * only its own three examples instead of the generic shuffle list.
 *
 * These phrases are written for the cold-start matcher specifically: an empty
 * playlist has no songs, so its intent IS the entire profile (intent weight 1.0,
 * expanded by the HyDE step in taste/playlist-profiling/intent-expansion.ts).
 * That expansion reads the phrase and imagines a prototypical song — its mood,
 * audio features, and genres — so each phrase deliberately names a compound mood,
 * a concrete scene (which implies energy/tempo/valence), and a sonic cue, rather
 * than a vague vibe that would embed to a diffuse, weakly-discriminating vector.
 * Genres are canonical whitelist forms (see lastfm/whitelist.ts) so they land as
 * real, selectable pills.
 */

export interface DemoIntentExample {
	description: string;
	genres: readonly string[];
}

export const DEMO_INTENT_EXAMPLES: Record<
	string,
	readonly DemoIntentExample[]
> = {
	// crying in the car
	"1": [
		{
			description:
				"parked outside the house, engine off, letting the whole day finally hit",
			genres: ["indie", "folk", "singer-songwriter"],
		},
		{
			description: "driving nowhere at midnight just to fall apart in private",
			genres: ["indie", "alternative", "rnb"],
		},
		{
			description:
				"swelling, voice-cracking ballads for when i need to actually feel it",
			genres: ["soul", "indie", "folk"],
		},
	],
	// golden hour bike ride
	"2": [
		{
			description:
				"low sun, warm wind, that floaty feeling like the day might never end",
			genres: ["indie pop", "dream pop", "indie"],
		},
		{
			description:
				"pedaling into the light with everything glowing soft and gold",
			genres: ["dream pop", "indie", "synthpop"],
		},
		{
			description: "the happy buzz of coasting home as the sky turns peach",
			genres: ["indie", "funk", "pop"],
		},
	],
	// feeling everything
	"3": [
		{
			description: "heart wide open, taking all of it in instead of going numb",
			genres: ["indie", "indie folk", "soul"],
		},
		{
			description:
				"bittersweet songs that hold the joy and the ache in the same breath",
			genres: ["indie folk", "singer-songwriter", "alternative"],
		},
		{
			description: "no walls up, just letting every feeling land where it hits",
			genres: ["indie", "indie folk", "singer-songwriter"],
		},
	],
	// main character energy
	"4": [
		{
			description: "bold anthems for the version of me that fears nothing",
			genres: ["pop", "indie pop", "dance"],
		},
		{
			description:
				"head up, shoulders back, life happening in glorious widescreen",
			genres: ["synthpop", "pop", "electronic"],
		},
		{
			description:
				"owning the sidewalk like the world rearranges itself around me",
			genres: ["hip-hop", "pop", "dance"],
		},
	],
	// 3am thoughts
	"5": [
		{
			description:
				"wide awake at 3am, brain replaying everything in slow motion",
			genres: ["ambient", "lo-fi", "indie"],
		},
		{
			description:
				"hazy, half-asleep songs for thoughts that only show up in the dark",
			genres: ["lo-fi", "dream pop", "downtempo"],
		},
		{
			description: "the lonely blue hum of a city that won't sleep either",
			genres: ["ambient", "electronic", "downtempo"],
		},
	],
	// sunday softness
	"6": [
		{
			description:
				"slow morning light, coffee going cold, nowhere i have to be",
			genres: ["folk", "acoustic", "jazz"],
		},
		{
			description:
				"soft, warm, unhurried — the gentlest possible way to start the day",
			genres: ["acoustic", "indie folk", "bossa nova"],
		},
		{
			description:
				"wrapped in a blanket while the world stays quiet a little longer",
			genres: ["acoustic", "indie folk", "ambient"],
		},
	],
	// revenge era
	"7": [
		{
			description:
				"thriving out of pure spite, looking better than i ever did with you",
			genres: ["pop", "hip-hop", "dance"],
		},
		{
			description:
				"the glow-up anthem playing while i become their biggest regret",
			genres: ["hip-hop", "pop", "hyperpop"],
		},
		{
			description:
				"petty, polished, and winning so loudly they can hear it from there",
			genres: ["pop", "hip-hop", "dance"],
		},
	],
};

/**
 * The per-playlist sets flattened into one global pool. Onboarding scopes
 * examples to each demo playlist; the production /playlists intent editor has no
 * such scope, so its "examples" popover shuffles across all of them.
 */
export const ALL_DEMO_INTENT_EXAMPLES: readonly DemoIntentExample[] =
	Object.values(DEMO_INTENT_EXAMPLES).flat();
