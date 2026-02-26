import type { PlaygroundSong } from "./types";

/**
 * Real data sourced from DB (song, song_analysis, song_audio_feature)
 * and Spotify API (artist images via Client Credentials flow).
 */
export const MOCK_SONGS: PlaygroundSong[] = [
	{
		id: "0RDqNCRBGrSegk16Avfzuq",
		name: "Talk that Talk",
		artist: "TWICE",
		album: "BETWEEN 1&2",
		genres: ["k-pop", "kpop", "pop"],
		artistImageUrl:
			"https://i.scdn.co/image/ab6761610000e5eb3d8820046fd455b38d644864",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b273c3040848e6ef0e132c5c8340",
		liked_at: "2026-01-11T01:44:45+00:00",
		analysis: {
			headline:
				"Flirty and direct, cutting to the chase for a love that's both simple and sweet. It's all about saying what you mean.",
			compound_mood: "Sweet Urgency",
			mood_description:
				"Heart-fluttering anticipation before the confession. Playful hints and coy smiles, but craving something real. A rush of sugar and adrenaline.",
			interpretation:
				"Sometimes the most profound thing you can say is simply \"I love you.\" Tired of games and mixed signals, it's about wanting someone to skip the small talk and be upfront. The repeated requests aren't a sign of insecurity; they're about wanting to hear those words out loud, making the feeling real.",
			themes: [
				{
					name: "verbal affirmation",
					description:
						"The need to hear love expressed directly, not just implied.",
				},
				{
					name: "directness",
					description:
						"Cutting through ambiguity to get to the heart of the matter.",
				},
				{
					name: "simplicity",
					description:
						"Finding profound meaning in straightforward expressions of love.",
				},
				{
					name: "playful pursuit",
					description:
						"Teasing and flirting as a prelude to deeper connection.",
				},
			],
			journey: [
				{
					section: "Verse 1",
					mood: "Coy Teasing",
					description:
						"Playing hard to get, acknowledging the attraction but pushing for something more concrete.",
				},
				{
					section: "Refrain",
					mood: "Anxious Curiosity",
					description:
						"Needing hints and clues, piecing together the puzzle of their feelings while time runs out.",
				},
				{
					section: "Pre-Chorus",
					mood: "Confident Demand",
					description:
						"Knowing the answer already but wanting the satisfaction of hearing it said aloud, done with the back and forth.",
				},
				{
					section: "Chorus",
					mood: "Excited Expectation",
					description:
						"A burst of energy, directly asking for what's desired, needing to hear those three little words.",
				},
				{
					section: "Verse 2",
					mood: "Knowing Smirks",
					description:
						"Reading between the lines, playfully replaying the moment, savoring the unspoken connection.",
				},
				{
					section: "Bridge",
					mood: "Raw Honesty",
					description:
						"Stripping away the fluff, admitting that simple words are enough, wanting to express feelings without pretense.",
				},
				{
					section: "Chorus",
					mood: "Pure Bliss",
					description:
						"Lost in the moment, reveling in the sound of those words, wanting to hear them again and again as it fades out.",
				},
			],
			key_lines: [
				{
					line: "본론을 원해 빙빙 돌린 / 서론 따위 말고 (I mean L-word)",
					insight:
						"Cutting to the chase, no need for elaborate introductions when the feeling is clear.",
				},
				{
					line: "단순한 words, 사랑한다는 말 / 그게 다야 난 꾸밈없이 듣길 원하지",
					insight: "Finding comfort in simple, unadorned expressions of love.",
				},
				{
					line: "Talk that talk, L-O-V-E",
					insight: "Reducing affection to its most basic, essential form.",
				},
				{
					line: "A to Z, 다 말해봐 / But 시작은 이렇게 해",
					insight:
						"While grand gestures are appreciated, starting with those fundamental words holds the most weight.",
				},
			],
			sonic_texture:
				"Synth-pop rhythms with bright melodies, layered vocals creating a playful atmosphere. Sparkling and bubbly, like the excitement of a new crush.",
		},
		audio_features: {
			tempo: 119.973,
			energy: 0.907,
			valence: 0.783,
			danceability: 0.772,
			acousticness: 0.136,
			instrumentalness: 0,
			liveness: 0.334,
			loudness: -2.438,
			speechiness: 0.124,
		},
	},
	{
		id: "0QQDaKW7eRRoqvbLCylzrn",
		name: "Gone Baby, Don't Be Long",
		artist: "Erykah Badu",
		album: "New Amerykah Part Two: Return Of The Ankh",
		genres: ["soul", "neo-soul", "rnb"],
		artistImageUrl:
			"https://i.scdn.co/image/ab6761610000e5ebfb1bc9e7ca44d473641b7842",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b2732c1b088d399087bd3a1de30b",
		liked_at: "2026-01-21T11:10:40+00:00",
		analysis: {
			headline:
				"Suspended between adoration and impatience. Wanting to believe, but seeing the cracks.",
			compound_mood: "Hopeful Suspicion",
			mood_description:
				"Caught in a loop of longing, the feeling of almost having someone. The push and pull is the whole world.",
			interpretation:
				"It's about seeing a love that's always just out of reach. Believing in potential while fighting the urge to demand more. Trust is a tightrope walk, not a solid foundation. Seeing the other person hustle is thrilling, but the constant departures erode faith.",
			themes: [
				{
					name: "fleeting presence",
					description:
						"Someone always on the move, in pursuit of something more.",
				},
				{
					name: "conditional love",
					description:
						"Affection hinged on potential rather than present reality.",
				},
				{
					name: "masked feelings",
					description:
						"Hiding vulnerabilities, creating distance where intimacy is craved.",
				},
			],
			journey: [
				{
					section: "Verse 1",
					mood: "Gentle Curiosity",
					description:
						"A breeze of infatuation. Head over heels and just noticing the fall.",
				},
				{
					section: "Chorus",
					mood: "Yearning Repetition",
					description:
						"The mantra of absence. Begging for a return, already knowing it's temporary.",
				},
				{
					section: "Verse 2",
					mood: "Fiendish Craving",
					description:
						"The rush of desire morphing into something sharper, a need verging on desperation.",
				},
				{
					section: "Post-Chorus",
					mood: "Earnest Belief",
					description:
						"Hanging on hope. Choosing to see the best, ready to follow wherever it leads.",
				},
				{
					section: "Verse 3",
					mood: "Lingering Doubt",
					description:
						"A nagging question, a feeling of something hidden beneath the surface.",
				},
				{
					section: "Verse 4",
					mood: "Teasing Confrontation",
					description:
						"Dancing around the issue. Playful questioning masking a deeper insecurity, the cycle continuing.",
				},
			],
			key_lines: [
				{
					line: "Where you go when you gone baby? Whatcha do?",
					insight:
						"Simple curiosity, but also a deep anxiety about the unknown.",
				},
				{
					line: "You got me feelin like a girl with a fiendish crush",
					insight:
						"Love as obsession, teetering on the edge of something unhealthy.",
				},
				{
					line: "Why is it I feel you masking?",
					insight: "Acknowledging the barrier, the unacknowledged distance.",
				},
				{
					line: "When we touch, wanna know if it's love or lust, oh",
					insight: "The fear of being used, of misreading the connection.",
				},
			],
			sonic_texture:
				"A raw, intimate feel. Erykah's vocal is what we are meant to focus on with minimal production, letting her words be the forefront.",
		},
		audio_features: {
			tempo: 172.513,
			energy: 0.763,
			valence: 0.725,
			danceability: 0.689,
			acousticness: 0.158,
			instrumentalness: 0.00437,
			liveness: 0.0856,
			loudness: -3.837,
			speechiness: 0.222,
		},
	},
];
