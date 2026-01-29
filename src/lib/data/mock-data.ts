/**
 * Centralized data for Warm Pastel prototypes
 *
 * Real data from Supabase with Spotify track IDs for fetching album art.
 * All matching prototypes import from here to stay in sync.
 */

export interface SongTheme {
	name: string;
	confidence: number;
}

export interface KeyLine {
	text: string;
	meaning: string;
}

export interface JourneyStep {
	section: string;
	mood: string;
	description: string;
}

export interface Song {
	id: number;
	spotifyTrackId: string;
	name: string;
	artist: string;
	album: string;
	/** Hardcoded album art URL from Spotify CDN */
	albumArtUrl: string;
	/** Artist image URL for landing page hero (optional) */
	artistImageUrl?: string;
	keyLines: KeyLine[];
	themes: SongTheme[];
	mood: string;
	tempo: number;
	energy: number;
	bestMoments: string[];
	culturalNote: string;
	journey: JourneyStep[];
}

export interface Playlist {
	id: number;
	name: string;
	description: string;
	matchScore: number;
}

// Landing page songs - 20 curated tracks for the hero section
// Analysis data is mocked for now - will be replaced with real analysis later
export const songs: Song[] = [
	{
		id: 1,
		spotifyTrackId: "2MvvoeRt8NcOXWESkxWn3g",
		name: "Ribs",
		artist: "Lorde",
		album: "Pure Heroine",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b273187331e276c898d39764cc98",
		keyLines: [
			{
				text: "I've never felt more alone",
				meaning:
					"The isolating realization that growing up means growing apart.",
			},
			{
				text: "It feels so scary getting old",
				meaning: "Fear of time passing and losing the present moment.",
			},
			{
				text: "This dream isn't feeling sweet",
				meaning: "The bittersweet taste of youth slipping away.",
			},
		],
		themes: [
			{ name: "Coming of Age", confidence: 0.95 },
			{ name: "Fear of Time", confidence: 0.9 },
			{ name: "Isolation", confidence: 0.85 },
		],
		mood: "Anxious Nostalgia",
		tempo: 108,
		energy: 0.65,
		bestMoments: [
			"Late night existential spirals",
			"3am thoughts",
			"Driving home from parties",
		],
		culturalNote:
			"A generation-defining anthem about the terror and beauty of youth.",
		journey: [
			{
				section: "Intro",
				mood: "Building unease",
				description: "Synths pulse like a racing heartbeat.",
			},
			{
				section: "Verse 1",
				mood: "Vulnerable confession",
				description: "Lorde whispers her fears into the void.",
			},
			{
				section: "Chorus",
				mood: "Cathartic release",
				description: "The dam breaks — all the anxiety floods out.",
			},
			{
				section: "Bridge",
				mood: "Peak intensity",
				description: "Time collapses, past and future blur.",
			},
			{
				section: "Outro",
				mood: "Fading acceptance",
				description: "The party ends, but the feeling lingers.",
			},
		],
	},
	{
		id: 2,
		spotifyTrackId: "4OMJGnvZfDvsePyCwRGO7X",
		name: "Houdini",
		artist: "Dua Lipa",
		album: "Radical Optimism",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b273001d5706fddc72561f6488af",
		keyLines: [
			{
				text: "I come and I go",
				meaning:
					"Asserting independence and unpredictability in relationships.",
			},
			{
				text: "Disappeared like Houdini",
				meaning: "The power of walking away without explanation.",
			},
			{
				text: "My body's here but my mind is free",
				meaning: "Emotional detachment as self-protection.",
			},
		],
		themes: [
			{ name: "Independence", confidence: 0.9 },
			{ name: "Self-Protection", confidence: 0.85 },
			{ name: "Freedom", confidence: 0.8 },
		],
		mood: "Confident",
		tempo: 123,
		energy: 0.82,
		bestMoments: [
			"Getting ready to go out",
			"Post-breakup empowerment",
			"Dance floor moments",
		],
		culturalNote:
			"Part of Dua's evolution into disco-pop territory with a defiant edge.",
		journey: [
			{
				section: "Intro",
				mood: "Mysterious allure",
				description: "Pulsing synths hint at something magical.",
			},
			{
				section: "Verse 1",
				mood: "Playful confidence",
				description: "She sets the terms of engagement.",
			},
			{
				section: "Chorus",
				mood: "Triumphant escape",
				description: "The disappearing act becomes a superpower.",
			},
			{
				section: "Bridge",
				mood: "Defiant pause",
				description: "A moment of clarity before vanishing again.",
			},
			{
				section: "Outro",
				mood: "Liberating fade",
				description: "She's already gone.",
			},
		],
	},
	{
		id: 3,
		spotifyTrackId: "7DfFc7a6Rwfi3YQMRbDMau",
		name: "Thinkin Bout You",
		artist: "Frank Ocean",
		album: "channel ORANGE",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b2737aede4855f6d0d738012e2e5",
		keyLines: [
			{
				text: "A tornado flew around my room",
				meaning: "Emotional chaos disguised as nonchalance.",
			},
			{
				text: "Do you think about me still?",
				meaning: "The vulnerability of wondering if you mattered.",
			},
			{
				text: "Or do you not think so far ahead?",
				meaning: "Fear that you invested more emotionally than they did.",
			},
		],
		themes: [
			{ name: "Unrequited Love", confidence: 0.95 },
			{ name: "Emotional Vulnerability", confidence: 0.9 },
			{ name: "Longing", confidence: 0.85 },
		],
		mood: "Wistful",
		tempo: 68,
		energy: 0.35,
		bestMoments: [
			"Missing someone at 2am",
			"Rainy day reflection",
			"Quiet heartache",
		],
		culturalNote:
			"A masterclass in falsetto vulnerability that redefined R&B intimacy.",
		journey: [
			{
				section: "Intro",
				mood: "Gentle ache",
				description: "Stripped-back piano sets the tender stage.",
			},
			{
				section: "Verse 1",
				mood: "Casual facade",
				description: "Pretending not to care while caring deeply.",
			},
			{
				section: "Chorus",
				mood: "Raw admission",
				description: "The mask slips — he can't stop thinking.",
			},
			{
				section: "Verse 2",
				mood: "Deepening doubt",
				description: "The questions multiply.",
			},
			{
				section: "Outro",
				mood: "Lingering loneliness",
				description: "No resolution, just the ache.",
			},
		],
	},
	{
		id: 4,
		spotifyTrackId: "5xo8RrjJ9CVNrtRg2S3B1R",
		name: "Motion Sickness",
		artist: "Phoebe Bridgers",
		album: "Stranger in the Alps",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b27368b90c3b34c3ac22856ddab8",
		keyLines: [
			{
				text: "I hate you for what you did",
				meaning: "Direct anger at someone who hurt her.",
			},
			{
				text: "And I miss you like a little kid",
				meaning: "The childlike ache that coexists with resentment.",
			},
			{
				text: "I have emotional motion sickness",
				meaning: "The disorienting turbulence of complicated feelings.",
			},
		],
		themes: [
			{ name: "Bitter Heartbreak", confidence: 0.95 },
			{ name: "Power Imbalance", confidence: 0.9 },
			{ name: "Emotional Whiplash", confidence: 0.85 },
		],
		mood: "Bittersweet Anger",
		tempo: 98,
		energy: 0.45,
		bestMoments: [
			"Processing toxic relationships",
			"Late night venting",
			"Angry crying",
		],
		culturalNote:
			"Helped establish the sad-girl indie sound with sharp, specific lyrics.",
		journey: [
			{
				section: "Intro",
				mood: "Deceptive calm",
				description: "Gentle guitar belies the storm coming.",
			},
			{
				section: "Verse 1",
				mood: "Measured resentment",
				description: "Cataloging grievances with precision.",
			},
			{
				section: "Chorus",
				mood: "Conflicted explosion",
				description: "Hate and longing collide.",
			},
			{
				section: "Verse 2",
				mood: "Darker memories",
				description: "The specifics get more damning.",
			},
			{
				section: "Outro",
				mood: "Unresolved turmoil",
				description: "The motion sickness continues.",
			},
		],
	},
	{
		id: 5,
		spotifyTrackId: "3HMY0r2BAdpasXMY8rseR0",
		name: "Too Sweet",
		artist: "Hozier",
		album: "Unheard",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b273be392334d99f82bc410cb239",
		keyLines: [
			{
				text: "I take my whiskey neat",
				meaning: "A preference for rawness over softness.",
			},
			{
				text: "You're too sweet for me",
				meaning: "Incompatibility framed as a compliment.",
			},
			{
				text: "I take my coffee black",
				meaning: "Identity defined through small, dark choices.",
			},
		],
		themes: [
			{ name: "Incompatibility", confidence: 0.9 },
			{ name: "Self-Awareness", confidence: 0.85 },
			{ name: "Gentle Rejection", confidence: 0.8 },
		],
		mood: "Wry Tenderness",
		tempo: 78,
		energy: 0.42,
		bestMoments: [
			"Morning-after clarity",
			"Knowing when to walk away",
			"Bittersweet goodbyes",
		],
		culturalNote:
			"2024 viral comeback that showed Hozier's gift for intimate storytelling.",
		journey: [
			{
				section: "Intro",
				mood: "Intimate setting",
				description: "Just voice and guitar, close and confessional.",
			},
			{
				section: "Verse 1",
				mood: "Self-portrait",
				description: "Defining himself through preferences and edges.",
			},
			{
				section: "Chorus",
				mood: "Tender honesty",
				description: "The incompatibility revealed with care.",
			},
			{
				section: "Verse 2",
				mood: "Deeper contrast",
				description: "More evidence of their beautiful mismatch.",
			},
			{
				section: "Outro",
				mood: "Acceptance",
				description: "Some things just aren't meant to blend.",
			},
		],
	},
	{
		id: 6,
		spotifyTrackId: "5FVd6KXrgO9B3JPmC8OPst",
		name: "Do I Wanna Know?",
		artist: "Arctic Monkeys",
		album: "AM",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b2734ae1c4c5c45aabe565499163",
		keyLines: [
			{
				text: "Have you got colour in your cheeks?",
				meaning: "Wondering if they still feel the same physical pull.",
			},
			{
				text: "Crawling back to you",
				meaning: "The humiliation of returning despite knowing better.",
			},
			{
				text: "Maybe I'm too busy being yours",
				meaning: "Lost identity in obsessive wanting.",
			},
		],
		themes: [
			{ name: "Obsessive Desire", confidence: 0.95 },
			{ name: "Vulnerability", confidence: 0.9 },
			{ name: "Late Night Longing", confidence: 0.85 },
		],
		mood: "Brooding Desire",
		tempo: 85,
		energy: 0.58,
		bestMoments: [
			"2am texts you shouldn't send",
			"Seeing an ex",
			"Drunk confessions",
		],
		culturalNote: "The riff that launched a thousand moody playlists.",
		journey: [
			{
				section: "Intro",
				mood: "Hypnotic pull",
				description: "That bassline hooks you before you realize.",
			},
			{
				section: "Verse 1",
				mood: "Calculated cool",
				description: "Playing it casual while burning inside.",
			},
			{
				section: "Chorus",
				mood: "Desperate honesty",
				description: "The facade cracks — he needs to know.",
			},
			{
				section: "Verse 2",
				mood: "Deeper admission",
				description: "The obsession becomes undeniable.",
			},
			{
				section: "Outro",
				mood: "Unresolved tension",
				description: "The question hangs in the air.",
			},
		],
	},
	{
		id: 7,
		spotifyTrackId: "1Qrg8KqiBpW07V7PNxwwwL",
		name: "Kill Bill",
		artist: "SZA",
		album: "SOS",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b273c5276ed6cb0287df8d9be07f",
		keyLines: [
			{
				text: "I might kill my ex",
				meaning: "Violent fantasy as expression of unprocessed pain.",
			},
			{
				text: "Rather be in jail than alone",
				meaning: "Loneliness worse than any consequence.",
			},
			{
				text: "I still love him though",
				meaning: "The contradiction that makes it all worse.",
			},
		],
		themes: [
			{ name: "Jealous Rage", confidence: 0.95 },
			{ name: "Obsessive Love", confidence: 0.9 },
			{ name: "Dark Fantasies", confidence: 0.85 },
		],
		mood: "Unhinged Sweetness",
		tempo: 89,
		energy: 0.48,
		bestMoments: [
			"Seeing your ex with someone new",
			"Intrusive thoughts",
			"Venting to friends",
		],
		culturalNote:
			"A Tarantino-referencing revenge fantasy wrapped in velvet vocals.",
		journey: [
			{
				section: "Intro",
				mood: "Deceptive sweetness",
				description: "Soft strings mask murderous thoughts.",
			},
			{
				section: "Verse 1",
				mood: "Growing obsession",
				description: "The spiral begins.",
			},
			{
				section: "Chorus",
				mood: "Casually unhinged",
				description: "She's plotting crimes in a lullaby.",
			},
			{
				section: "Verse 2",
				mood: "Deeper into madness",
				description: "The plans get more elaborate.",
			},
			{
				section: "Outro",
				mood: "Love persists",
				description: "Even amid the chaos, she loves him.",
			},
		],
	},
	{
		id: 8,
		spotifyTrackId: "6AI3ezQ4o3HUoP6Dhudph3",
		name: "Not Like Us",
		artist: "Kendrick Lamar",
		album: "GNX",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b2731ea0c62b2339cbf493a999ad",
		keyLines: [
			{
				text: "They not like us",
				meaning: "Drawing a clear line between authenticity and imitation.",
			},
			{
				text: "You really a Canadian with a TDE chain",
				meaning: "Questioning someone's claimed identity and belonging.",
			},
			{
				text: "Certified lover boy? Certified pedophile",
				meaning: "Weaponizing someone's brand against them.",
			},
		],
		themes: [
			{ name: "Authenticity", confidence: 0.95 },
			{ name: "West Coast Pride", confidence: 0.9 },
			{ name: "Cultural Gatekeeping", confidence: 0.85 },
		],
		mood: "Triumphant Aggression",
		tempo: 104,
		energy: 0.88,
		bestMoments: ["Victory laps", "Making a point", "When you're proven right"],
		culturalNote:
			"The Drake diss that became the song of 2024, redefining hip-hop beefs.",
		journey: [
			{
				section: "Intro",
				mood: "Threat delivered",
				description: "The beat drops like a verdict.",
			},
			{
				section: "Verse 1",
				mood: "Surgical strikes",
				description: "Each bar lands with precision.",
			},
			{
				section: "Chorus",
				mood: "Triumphant chant",
				description: "The crowd joins the verdict.",
			},
			{
				section: "Verse 2",
				mood: "Total destruction",
				description: "No stone left unturned.",
			},
			{
				section: "Outro",
				mood: "Victory secured",
				description: "The case is closed.",
			},
		],
	},
	{
		id: 9,
		spotifyTrackId: "7r9BUOSnekEjrkMhmxD6Ae",
		name: "Taxes",
		artist: "Geese",
		album: "Getting Killed",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b273357b215562c3268ed1022942",
		keyLines: [
			{
				text: "I want to be crucified",
				meaning: "Martyrdom as escape from mundane responsibility.",
			},
			{
				text: "Filing my taxes",
				meaning: "The crushing banality of adult obligation.",
			},
			{
				text: "Kill me instead",
				meaning: "Preferring dramatic death to bureaucratic life.",
			},
		],
		themes: [
			{ name: "Existential Dread", confidence: 0.9 },
			{ name: "Mundane Horror", confidence: 0.85 },
			{ name: "Absurdist Rebellion", confidence: 0.8 },
		],
		mood: "Theatrical Despair",
		tempo: 142,
		energy: 0.78,
		bestMoments: [
			"Tax season meltdowns",
			"Questioning adulthood",
			"Absurdist rage",
		],
		culturalNote:
			"2025 breakout that turned paperwork into existential theater.",
		journey: [
			{
				section: "Intro",
				mood: "Building tension",
				description: "Something's about to snap.",
			},
			{
				section: "Verse 1",
				mood: "Simmering frustration",
				description: "The mundane becomes unbearable.",
			},
			{
				section: "Chorus",
				mood: "Operatic release",
				description: "The sky rips open.",
			},
			{
				section: "Bridge",
				mood: "Frenzied climax",
				description: "All restraint abandoned.",
			},
			{
				section: "Outro",
				mood: "Exhausted acceptance",
				description: "Back to the forms.",
			},
		],
	},
	{
		id: 10,
		spotifyTrackId: "6tNQ70jh4OwmPGpYy6R2o9",
		name: "Beautiful Things",
		artist: "Benson Boone",
		album: "Beautiful Things",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b273bef221ea02a821e7feeda9cf",
		keyLines: [
			{
				text: "Please don't take my beautiful things",
				meaning: "Bargaining with fate to preserve happiness.",
			},
			{
				text: "I found my mind, I'm feeling sane",
				meaning: "Finally achieving stability after struggle.",
			},
			{
				text: "I'm scared to death",
				meaning: "The terror that comes with having something to lose.",
			},
		],
		themes: [
			{ name: "Fear of Loss", confidence: 0.95 },
			{ name: "Gratitude", confidence: 0.9 },
			{ name: "Fragile Happiness", confidence: 0.85 },
		],
		mood: "Anxious Gratitude",
		tempo: 108,
		energy: 0.62,
		bestMoments: [
			"When things are finally going well",
			"Praying nothing changes",
			"Counting blessings",
		],
		culturalNote:
			"A prayer disguised as a pop song that resonated with millions.",
		journey: [
			{
				section: "Intro",
				mood: "Gentle plea",
				description: "A whispered request to the universe.",
			},
			{
				section: "Verse 1",
				mood: "Cataloging blessings",
				description: "Naming everything precious.",
			},
			{
				section: "Chorus",
				mood: "Desperate prayer",
				description: "The ask becomes urgent.",
			},
			{
				section: "Bridge",
				mood: "Peak vulnerability",
				description: "Raw terror of potential loss.",
			},
			{
				section: "Outro",
				mood: "Hopeful surrender",
				description: "Releasing control, keeping faith.",
			},
		],
	},
	{
		id: 11,
		spotifyTrackId: "6dOtVTDdiauQNBQEDOtlAB",
		name: "BIRDS OF A FEATHER",
		artist: "Billie Eilish",
		album: "HIT ME HARD AND SOFT",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b27371d62ea7ea8a5be92d3c1f62",
		keyLines: [
			{
				text: "I want you to stay till I'm in the grave",
				meaning: "Love expressed as a wish for permanence beyond death.",
			},
			{
				text: "Birds of a feather, we should stick together",
				meaning: "Kindred spirits belong side by side.",
			},
			{
				text: "I knew you in another life",
				meaning: "Connection that feels fated, eternal.",
			},
		],
		themes: [
			{ name: "Eternal Devotion", confidence: 0.95 },
			{ name: "Soulmates", confidence: 0.9 },
			{ name: "Mortality", confidence: 0.8 },
		],
		mood: "Tender Devotion",
		tempo: 105,
		energy: 0.52,
		bestMoments: [
			"Deep conversations",
			"Found family moments",
			"Quiet love confessions",
		],
		culturalNote:
			"#2 song globally in both 2024 and 2025 — a modern love anthem.",
		journey: [
			{
				section: "Intro",
				mood: "Intimate whisper",
				description: "She's telling you a secret.",
			},
			{
				section: "Verse 1",
				mood: "Building devotion",
				description: "The depth of feeling revealed.",
			},
			{
				section: "Chorus",
				mood: "Soaring commitment",
				description: "A vow set to melody.",
			},
			{
				section: "Verse 2",
				mood: "Past-life echoes",
				description: "The connection spans time.",
			},
			{
				section: "Outro",
				mood: "Peaceful certainty",
				description: "Some things are meant to be.",
			},
		],
	},
	{
		id: 12,
		spotifyTrackId: "7lPN2DXiMsVn7XUKtOW1CS",
		name: "drivers license",
		artist: "Olivia Rodrigo",
		album: "SOUR",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b2738ffc294c1c4362e8472d14cd",
		keyLines: [
			{
				text: "I got my driver's license last week",
				meaning: "A milestone that now feels hollow.",
			},
			{
				text: "You said forever, now I drive alone",
				meaning: "Broken promises made concrete.",
			},
			{
				text: "Red lights, stop signs",
				meaning: "The world forcing pauses when all you want is to escape.",
			},
		],
		themes: [
			{ name: "First Heartbreak", confidence: 0.95 },
			{ name: "Broken Promises", confidence: 0.9 },
			{ name: "Coming of Age", confidence: 0.85 },
		],
		mood: "Devastating Sadness",
		tempo: 72,
		energy: 0.38,
		bestMoments: [
			"Crying in your car",
			"Driving past their house",
			"First major breakup",
		],
		culturalNote:
			"The breakup ballad that broke Spotify records and launched a career.",
		journey: [
			{
				section: "Intro",
				mood: "Quiet devastation",
				description: "Piano notes like falling tears.",
			},
			{
				section: "Verse 1",
				mood: "Milestone turned bitter",
				description: "Achievement emptied of joy.",
			},
			{
				section: "Chorus",
				mood: "Full-body grief",
				description: "The emotions flood out.",
			},
			{
				section: "Bridge",
				mood: "Peak anguish",
				description: "The scream you've been holding.",
			},
			{
				section: "Outro",
				mood: "Exhausted acceptance",
				description: "Driving on anyway.",
			},
		],
	},
	{
		id: 13,
		spotifyTrackId: "1k2pQc5i348DCHwbn5KTdc",
		name: "Pink Pony Club",
		artist: "Chappell Roan",
		album: "The Rise and Fall of a Midwest Princess",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b27396fa88fb1789be437d5cb4b6",
		keyLines: [
			{
				text: "God, what have you done?",
				meaning: "A prayer reframed as self-discovery.",
			},
			{
				text: "I'm gonna dance at the Pink Pony Club",
				meaning: "Claiming joy in queer spaces.",
			},
			{
				text: "I know you wanted me to stay",
				meaning: "Choosing authenticity over approval.",
			},
		],
		themes: [
			{ name: "Queer Liberation", confidence: 0.95 },
			{ name: "Self-Discovery", confidence: 0.9 },
			{ name: "Breaking Free", confidence: 0.85 },
		],
		mood: "Euphoric Liberation",
		tempo: 128,
		energy: 0.85,
		bestMoments: [
			"Coming out moments",
			"Pride celebrations",
			"Choosing yourself",
		],
		culturalNote: "The queer anthem that made Chappell Roan a superstar.",
		journey: [
			{
				section: "Intro",
				mood: "Building anticipation",
				description: "Something big is about to happen.",
			},
			{
				section: "Verse 1",
				mood: "Nervous courage",
				description: "Taking the first steps away.",
			},
			{
				section: "Chorus",
				mood: "Explosive joy",
				description: "The arrival, the freedom, the dance.",
			},
			{
				section: "Bridge",
				mood: "Defiant declaration",
				description: "No going back now.",
			},
			{
				section: "Outro",
				mood: "Triumphant celebration",
				description: "She found where she belongs.",
			},
		],
	},
	{
		id: 14,
		spotifyTrackId: "5hVghJ4KaYES3BFUATCYn0",
		name: "EARFQUAKE",
		artist: "Tyler, the Creator",
		album: "IGOR",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b27330a635de2bb0caa4e26f6abb",
		keyLines: [
			{
				text: "Don't leave, it's my fault",
				meaning: "Taking blame to prevent abandonment.",
			},
			{
				text: "You make my earth quake",
				meaning: "Love as seismic, world-shaking force.",
			},
			{
				text: "For real, I'll even cut my hair",
				meaning: "Willing to change fundamentally to keep them.",
			},
		],
		themes: [
			{ name: "Vulnerable Love", confidence: 0.95 },
			{ name: "Fear of Abandonment", confidence: 0.9 },
			{ name: "Self-Sacrifice", confidence: 0.85 },
		],
		mood: "Tender Desperation",
		tempo: 79,
		energy: 0.45,
		bestMoments: [
			"Realizing you're in deep",
			"Making yourself smaller for love",
			"Soft boy hours",
		],
		culturalNote:
			"Tyler's pivot to vulnerable love songs that redefined his artistry.",
		journey: [
			{
				section: "Intro",
				mood: "Synth haze",
				description: "Dreamy sounds set the intimate tone.",
			},
			{
				section: "Verse 1",
				mood: "Pleading softness",
				description: "Raw vulnerability on display.",
			},
			{
				section: "Chorus",
				mood: "Aching desire",
				description: "The earth shakes with feeling.",
			},
			{
				section: "Bridge",
				mood: "Desperate offers",
				description: "What more can he give?",
			},
			{
				section: "Outro",
				mood: "Unresolved longing",
				description: "The question hangs.",
			},
		],
	},
	{
		id: 15,
		spotifyTrackId: "0VjIjW4GlUZAMYd2vXMi3b",
		name: "Blinding Lights",
		artist: "The Weeknd",
		album: "After Hours",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36",
		keyLines: [
			{
				text: "I'm running out of time",
				meaning: "Urgency to reconnect before it's too late.",
			},
			{
				text: "Sin City's cold and empty",
				meaning: "Success without love is hollow.",
			},
			{
				text: "I'm going through withdrawals",
				meaning: "Love as addiction, absence as suffering.",
			},
		],
		themes: [
			{ name: "Nostalgic Longing", confidence: 0.95 },
			{ name: "Addiction to Love", confidence: 0.9 },
			{ name: "Empty Success", confidence: 0.85 },
		],
		mood: "Euphoric Desperation",
		tempo: 171,
		energy: 0.8,
		bestMoments: ["Night drives", "Chasing memories", "Reliving the past"],
		culturalNote:
			"The most streamed song in Spotify history — 5+ billion plays.",
		journey: [
			{
				section: "Intro",
				mood: "80s neon pulse",
				description: "The synths hit like city lights.",
			},
			{
				section: "Verse 1",
				mood: "Lonely glamour",
				description: "Fame without fulfillment.",
			},
			{
				section: "Chorus",
				mood: "Driving intensity",
				description: "Speeding toward the past.",
			},
			{
				section: "Bridge",
				mood: "Peak yearning",
				description: "The desperation reaches its height.",
			},
			{
				section: "Outro",
				mood: "Endless chase",
				description: "The lights keep blinding.",
			},
		],
	},
	{
		id: 16,
		spotifyTrackId: "4Dvkj6JhhA12EX05fT7y2e",
		name: "As It Was",
		artist: "Harry Styles",
		album: "Harry's House",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b27382ce362511fb3d9dda6578ee",
		keyLines: [
			{
				text: "You know it's not the same as it was",
				meaning: "Acknowledging irreversible change.",
			},
			{
				text: "In this world, it's just us",
				meaning: "Isolation within intimacy.",
			},
			{
				text: "Leave America, two kids follow her",
				meaning: "Fragmented family across distance.",
			},
		],
		themes: [
			{ name: "Bittersweet Change", confidence: 0.95 },
			{ name: "Nostalgia", confidence: 0.9 },
			{ name: "Loneliness in Fame", confidence: 0.85 },
		],
		mood: "Melancholic Joy",
		tempo: 174,
		energy: 0.73,
		bestMoments: [
			"Reflecting on how things changed",
			"Dancing through sadness",
			"Missing simpler times",
		],
		culturalNote: "Harry's biggest hit — a deceptively upbeat song about loss.",
		journey: [
			{
				section: "Intro",
				mood: "Deceptive brightness",
				description: "Upbeat sounds mask the ache.",
			},
			{
				section: "Verse 1",
				mood: "Intimate confession",
				description: "Phone calls across distance.",
			},
			{
				section: "Chorus",
				mood: "Bittersweet acceptance",
				description: "Things change, we adapt.",
			},
			{
				section: "Bridge",
				mood: "Raw vulnerability",
				description: "The mask slips momentarily.",
			},
			{
				section: "Outro",
				mood: "Circular return",
				description: "Back to the beginning, changed.",
			},
		],
	},
	{
		id: 17,
		spotifyTrackId: "42UBPzRMh5yyz0EDPr6fr1",
		name: "Manchild",
		artist: "Sabrina Carpenter",
		album: "Manchild",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b273062c6573009fdebd43de443b",
		keyLines: [
			{
				text: "You're a manchild",
				meaning: "Calling out emotional immaturity.",
			},
			{
				text: "Throwing tantrums in a restaurant",
				meaning: "Public embarrassment from partner's behavior.",
			},
			{
				text: "I need a man, not a fan",
				meaning: "Wanting partnership, not worship.",
			},
		],
		themes: [
			{ name: "Emotional Immaturity", confidence: 0.95 },
			{ name: "Standards", confidence: 0.9 },
			{ name: "Sharp Wit", confidence: 0.85 },
		],
		mood: "Sardonic Frustration",
		tempo: 112,
		energy: 0.68,
		bestMoments: [
			"Post-bad-date venting",
			"Realizing someone's not worth it",
			"Girl talk",
		],
		culturalNote:
			"2025 song of the summer — sharp, funny, and devastatingly relatable.",
		journey: [
			{
				section: "Intro",
				mood: "Playful setup",
				description: "She's about to read him for filth.",
			},
			{
				section: "Verse 1",
				mood: "Building case",
				description: "Evidence of immaturity stacks up.",
			},
			{
				section: "Chorus",
				mood: "Verdict delivered",
				description: "The diagnosis is in.",
			},
			{
				section: "Verse 2",
				mood: "More receipts",
				description: "Oh, there's more.",
			},
			{
				section: "Outro",
				mood: "Case closed",
				description: "She's done explaining.",
			},
		],
	},
	{
		id: 18,
		spotifyTrackId: "6DCZcSspjsKoFjzjrWoCdn",
		name: "God's Plan",
		artist: "Drake",
		album: "Scorpion",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b273f907de96b9a4fbc04accc0d5",
		keyLines: [
			{
				text: "God's plan, God's plan",
				meaning: "Surrendering to fate and divine timing.",
			},
			{
				text: "I only love my bed and my momma",
				meaning: "Trust reduced to the most fundamental bonds.",
			},
			{
				text: "They wish and they wish and they wish",
				meaning: "Others' envy can't touch his blessings.",
			},
		],
		themes: [
			{ name: "Gratitude", confidence: 0.9 },
			{ name: "Fate", confidence: 0.85 },
			{ name: "Trust Issues", confidence: 0.8 },
		],
		mood: "Humble Triumph",
		tempo: 77,
		energy: 0.45,
		bestMoments: [
			"Counting blessings",
			"Reflecting on success",
			"Keeping perspective",
		],
		culturalNote:
			"The video gave away nearly a million dollars — generosity as content.",
		journey: [
			{
				section: "Intro",
				mood: "Contemplative calm",
				description: "Drake in reflection mode.",
			},
			{
				section: "Verse 1",
				mood: "Grounded success",
				description: "Acknowledging where he's at.",
			},
			{
				section: "Chorus",
				mood: "Surrendered confidence",
				description: "It's all part of the plan.",
			},
			{
				section: "Verse 2",
				mood: "Earned perspective",
				description: "Trust earned through experience.",
			},
			{
				section: "Outro",
				mood: "Peaceful acceptance",
				description: "Let fate do its thing.",
			},
		],
	},
	{
		id: 19,
		spotifyTrackId: "3sK8wGT43QFpWrvNQsrQya",
		name: "DtMF",
		artist: "Bad Bunny",
		album: "Debí Tirar Más Fotos",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b273bbd45c8d36e0e045ef640411",
		keyLines: [
			{
				text: "Debí tirar más fotos",
				meaning: "Regretting not capturing more memories.",
			},
			{
				text: "Del barrio para el mundo",
				meaning: "From humble beginnings to global stages.",
			},
			{
				text: "Boricua de corazón",
				meaning: "Puerto Rican identity as core self.",
			},
		],
		themes: [
			{ name: "Puerto Rican Pride", confidence: 0.95 },
			{ name: "Nostalgia", confidence: 0.9 },
			{ name: "Cultural Identity", confidence: 0.85 },
		],
		mood: "Proud Nostalgia",
		tempo: 95,
		energy: 0.72,
		bestMoments: [
			"Missing home",
			"Cultural celebrations",
			"Remembering where you came from",
		],
		culturalNote:
			"The biggest streaming week for a Latin song in Spotify history.",
		journey: [
			{
				section: "Intro",
				mood: "Wistful reflection",
				description: "Looking back at the journey.",
			},
			{
				section: "Verse 1",
				mood: "Proud roots",
				description: "Honoring where he started.",
			},
			{
				section: "Chorus",
				mood: "Bittersweet realization",
				description: "Should have captured more.",
			},
			{
				section: "Bridge",
				mood: "Cultural celebration",
				description: "Puerto Rico in every beat.",
			},
			{
				section: "Outro",
				mood: "Forward with roots",
				description: "Taking home everywhere.",
			},
		],
	},
	{
		id: 20,
		spotifyTrackId: "7ne4VBA60CxGM75vw0EYad",
		name: "That's So True",
		artist: "Gracie Abrams",
		album: "The Secret of Us (Deluxe)",
		albumArtUrl:
			"https://i.scdn.co/image/ab67616d0000b2731dac3694b3289cd903cb3acf",
		keyLines: [
			{
				text: "I heard you're an actor",
				meaning: "Calling out inauthentic behavior.",
			},
			{
				text: "That's so true, bestie",
				meaning: "Sarcastic agreement that stings.",
			},
			{
				text: "You played the victim",
				meaning: "Exposing manipulative patterns.",
			},
		],
		themes: [
			{ name: "Calling Out BS", confidence: 0.95 },
			{ name: "Post-Breakup Clarity", confidence: 0.9 },
			{ name: "Sharp Observations", confidence: 0.85 },
		],
		mood: "Sardonic Clarity",
		tempo: 103,
		energy: 0.55,
		bestMoments: [
			"Realizing someone was fake",
			"Venting with friends",
			"Having receipts",
		],
		culturalNote:
			"Her first billion-stream song — scathing honesty that went viral.",
		journey: [
			{
				section: "Intro",
				mood: "Quiet setup",
				description: "She's about to say something.",
			},
			{
				section: "Verse 1",
				mood: "Building case",
				description: "Observations stack up.",
			},
			{
				section: "Chorus",
				mood: "Devastating agreement",
				description: "The sarcasm hits hardest.",
			},
			{
				section: "Bridge",
				mood: "Peak clarity",
				description: "The full picture emerges.",
			},
			{
				section: "Outro",
				mood: "Case closed",
				description: "She said what she said.",
			},
		],
	},
];

// Mock playlists for matching UI
export const playlists: Playlist[] = [
	{
		id: 1,
		name: "Late Night Feels",
		description: "Moody vibes for 2am thoughts",
		matchScore: 0.94,
	},
	{
		id: 2,
		name: "Soul & Groove",
		description: "Funk, soul, and smooth beats",
		matchScore: 0.89,
	},
	{
		id: 3,
		name: "Relationship Therapy",
		description: "Working through the feels",
		matchScore: 0.82,
	},
	{
		id: 4,
		name: "Morning Coffee",
		description: "Easy listening to start the day",
		matchScore: 0.45,
	},
];

// Helper to get all Spotify track IDs for fetching album art
export const getSpotifyTrackIds = (): string[] =>
	songs.map((s) => s.spotifyTrackId);

// Fallback placeholder image generator
export const getPlaceholderImage = (
	spotifyTrackId: string,
	size = 400,
): string => `https://picsum.photos/seed/${spotifyTrackId}/${size}/${size}`;

// Real playlist data from Supabase - your actual playlists
// Matching playlists are used as sorting destinations during matching
// Using picsum.photos for placeholder images since Spotify playlist images aren't stored
const generatePlaylistImage = (id: number) =>
	`https://picsum.photos/seed/playlist-${id}/300/300`;

export const recentActivity = [
	{
		id: 1,
		song: "Blinding Lights",
		artist: "The Weeknd",
		playlist: "Workout Energy",
		time: "2h ago",
		image: "https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36",
	},
	{
		id: 2,
		song: "Levitating",
		artist: "Dua Lipa",
		playlist: "Party Mix",
		time: "3h ago",
		image: "https://i.scdn.co/image/ab67616d0000b273bd26ede1ae69327010d49946",
	},
	{
		id: 3,
		song: "Heat Waves",
		artist: "Glass Animals",
		playlist: "Chill Vibes",
		time: "1d ago",
		image: "https://i.scdn.co/image/ab67616d0000b273712701c5e263efc8726b1464",
	},
	{
		id: 4,
		song: "Bad Guy",
		artist: "Billie Eilish",
		playlist: "Late Night",
		time: "2d ago",
		image: "https://i.scdn.co/image/ab67616d0000b27350a3147b4edd7701a876c6ce",
	},
];

export const initialUserPlaylists = [
	// Matching playlists (active for matching) - from real Supabase data
	{
		id: 2762,
		name: "feelin' it $",
		trackCount: 2,
		image: generatePlaylistImage(2762),
		description: "self-confidence hip-hop and rap!",
		lastUpdated: "Dec 22",
		flagged: true,
	},
	{
		id: 3090,
		name: "hello",
		trackCount: 0,
		image: generatePlaylistImage(3090),
		description: "make it make sense bestie",
		lastUpdated: "Jun 11",
		flagged: true,
	},
	{
		id: 2976,
		name: "house?",
		trackCount: 6,
		image: generatePlaylistImage(2976),
		description: "house music",
		lastUpdated: "Apr 10",
		flagged: true,
	},
	{
		id: 3091,
		name: "main character energy!!!!",
		trackCount: 0,
		image: generatePlaylistImage(3091),
		description:
			"songs that make me feel like the main character in my own movie!!!!!",
		lastUpdated: "Jun 21",
		flagged: true,
	},
	{
		id: 2755,
		name: "my reset ritual",
		trackCount: 26,
		image: generatePlaylistImage(2755),
		description:
			"the feel good playlist for my weekend reset ritual. light a scented candle, take a long slow shower while singing along",
		lastUpdated: "Dec 22",
		flagged: true,
	},
	{
		id: 2754,
		name: "reset 0",
		trackCount: 3,
		image: generatePlaylistImage(2754),
		description: "just testing",
		lastUpdated: "Apr 4",
		flagged: true,
	},
	{
		id: 3087,
		name: "souvenir",
		trackCount: 0,
		image: generatePlaylistImage(3087),
		description: "make it make sense bestie",
		lastUpdated: "Jun 5",
		flagged: true,
	},
	{
		id: 2978,
		name: "yilkes!",
		trackCount: 0,
		image: generatePlaylistImage(2978),
		description: "",
		lastUpdated: "Jun 20",
		flagged: true,
	},

	// Other playlists (not used for matching) - from real Supabase data
	{
		id: 2800,
		name: "#1: just dance",
		trackCount: 8,
		image: generatePlaylistImage(2800),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2717,
		name: "2009~2013",
		trackCount: 244,
		image: generatePlaylistImage(2717),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2718,
		name: '2010\'s."old times" alt/indie rock',
		trackCount: 100,
		image: generatePlaylistImage(2718),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2779,
		name: "2013 - t.",
		trackCount: 63,
		image: generatePlaylistImage(2779),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2719,
		name: "2014 - sugestões spotify",
		trackCount: 29,
		image: generatePlaylistImage(2719),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2721,
		name: "2016.got ounce to burn, got a trip to make",
		trackCount: 31,
		image: generatePlaylistImage(2721),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2723,
		name: "2016. mantra.",
		trackCount: 27,
		image: generatePlaylistImage(2723),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2722,
		name: "2016.top",
		trackCount: 102,
		image: generatePlaylistImage(2722),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2724,
		name: "2017.goosebumps",
		trackCount: 16,
		image: generatePlaylistImage(2724),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2725,
		name: "2017.songs f",
		trackCount: 64,
		image: generatePlaylistImage(2725),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2720,
		name: "2020. Your Top Songs",
		trackCount: 100,
		image: generatePlaylistImage(2720),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2799,
		name: "#2: be you",
		trackCount: 9,
		image: generatePlaylistImage(2799),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2798,
		name: "#3: trippy",
		trackCount: 11,
		image: generatePlaylistImage(2798),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2797,
		name: "#4: ambient",
		trackCount: 9,
		image: generatePlaylistImage(2797),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2796,
		name: "#5: lovey",
		trackCount: 6,
		image: generatePlaylistImage(2796),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2688,
		name: "60s to 80s",
		trackCount: 9,
		image: generatePlaylistImage(2688),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2795,
		name: "#6: lo-fi kind of shit",
		trackCount: 5,
		image: generatePlaylistImage(2795),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2794,
		name: "#7: got some indie?",
		trackCount: 5,
		image: generatePlaylistImage(2794),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2793,
		name: "#8: rhyme vibe",
		trackCount: 5,
		image: generatePlaylistImage(2793),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2765,
		name: "#afro",
		trackCount: 1,
		image: generatePlaylistImage(2765),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2756,
		name: "albums that i listen on airports",
		trackCount: 39,
		image: generatePlaylistImage(2756),
		description:
			"each album represents one step of the journey: pre caffeine - caffeinated - boarding - flying",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2709,
		name: "alt. love",
		trackCount: 4,
		image: generatePlaylistImage(2709),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2763,
		name: "anime algorithm based",
		trackCount: 100,
		image: generatePlaylistImage(2763),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2726,
		name: "archive: discover weekly (sesimbra with simona)",
		trackCount: 30,
		image: generatePlaylistImage(2726),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2691,
		name: "around the world",
		trackCount: 21,
		image: generatePlaylistImage(2691),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2774,
		name: "as músicas do séc. XXI",
		trackCount: 187,
		image: generatePlaylistImage(2774),
		description: "edição contra-ataque",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2746,
		name: "a.s.o. - a.s.o., Alias Error",
		trackCount: 11,
		image: generatePlaylistImage(2746),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2697,
		name: "atoms form delericts - tripz",
		trackCount: 12,
		image: generatePlaylistImage(2697),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2708,
		name: "breakup",
		trackCount: 1,
		image: generatePlaylistImage(2708),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2784,
		name: "c",
		trackCount: 27,
		image: generatePlaylistImage(2784),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2778,
		name: "CANÇÕES - t.",
		trackCount: 147,
		image: generatePlaylistImage(2778),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2786,
		name: "clairo",
		trackCount: 7,
		image: generatePlaylistImage(2786),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2752,
		name: "cooking",
		trackCount: 49,
		image: generatePlaylistImage(2752),
		description:
			'"Open?" - "yeah, to the world, to yourself, to other people." - the bear s2',
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2740,
		name: "Copy- Acoustic Ecology",
		trackCount: 15,
		image: generatePlaylistImage(2740),
		description:
			"an escape through the caverns of silence, into the beauty of stillness",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2741,
		name: "Copy- Humanature",
		trackCount: 20,
		image: generatePlaylistImage(2741),
		description:
			"bridge our natural instinct and technological compulsion with open waters and singing birds",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2739,
		name: "Copy- Nature of Being",
		trackCount: 77,
		image: generatePlaylistImage(2739),
		description: "explorations through the frenzied beauty of our world",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2748,
		name: "Dark Times - Vince Staples",
		trackCount: 13,
		image: generatePlaylistImage(2748),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2764,
		name: "Dissan Na M'bera - Super Mama Djombo",
		trackCount: 10,
		image: generatePlaylistImage(2764),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 3094,
		name: "dreamy vocals",
		trackCount: 88,
		image: generatePlaylistImage(3094),
		description: "electro & chill-hop vibes",
		lastUpdated: "Dec 22",
		flagged: false,
	},
	{
		id: 2977,
		name: "Dubolt Mix",
		trackCount: 25,
		image: generatePlaylistImage(2977),
		description: "Kendrick Lamar / Ross from Friends / KAYTRANADA",
		lastUpdated: "Apr 10",
		flagged: false,
	},
	{
		id: 2776,
		name: "elli",
		trackCount: 31,
		image: generatePlaylistImage(2776),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2704,
		name: "feel like you're in love with life again",
		trackCount: 95,
		image: generatePlaylistImage(2704),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
	{
		id: 2696,
		name: "focus - v2",
		trackCount: 202,
		image: generatePlaylistImage(2696),
		description: "",
		lastUpdated: "Apr 4",
		flagged: false,
	},
];

// Library songs - mix of sorted and unsorted
export const librarySongs = [
	{
		id: 1,
		name: "Blinding Lights",
		artist: "The Weeknd",
		album: "After Hours",
		addedAt: "2 days ago",
		sorted: true,
		playlists: ["Upbeat", "workout"],
		image: "https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36",
	},
	{
		id: 2,
		name: "Levitating",
		artist: "Dua Lipa",
		album: "Future Nostalgia",
		addedAt: "3 days ago",
		sorted: true,
		playlists: ["Upbeat", "pop hits"],
		image: "https://i.scdn.co/image/ab67616d0000b273bd26ede1ae69327010d49946",
	},
	{
		id: 3,
		name: "Heat Waves",
		artist: "Glass Animals",
		album: "Dreamland",
		addedAt: "1 week ago",
		sorted: true,
		playlists: ["chill", "late night"],
		image: "https://i.scdn.co/image/ab67616d0000b273712701c5e263efc8726b1464",
	},
	{
		id: 4,
		name: "Bad Guy",
		artist: "Billie Eilish",
		album: "When We All Fall Asleep",
		addedAt: "1 week ago",
		sorted: false,
		playlists: [],
		image: "https://i.scdn.co/image/ab67616d0000b27350a3147b4edd7701a876c6ce",
	},
	{
		id: 5,
		name: "Watermelon Sugar",
		artist: "Harry Styles",
		album: "Fine Line",
		addedAt: "2 weeks ago",
		sorted: true,
		playlists: ["Upbeat", "summer vibes"],
		image: "https://i.scdn.co/image/ab67616d0000b27377fdcfda6535601aff081b6a",
	},
	{
		id: 6,
		name: "drivers license",
		artist: "Olivia Rodrigo",
		album: "SOUR",
		addedAt: "2 weeks ago",
		sorted: false,
		playlists: [],
		image: "https://i.scdn.co/image/ab67616d0000b273a91c10fe9472d9bd535f637d",
	},
	{
		id: 7,
		name: "Stay",
		artist: "The Kid LAROI & Justin Bieber",
		album: "F*CK LOVE 3",
		addedAt: "3 weeks ago",
		sorted: true,
		playlists: ["Upbeat", "pop hits"],
		image: "https://i.scdn.co/image/ab67616d0000b2734718e2b124f79258be7571d1",
	},
	{
		id: 8,
		name: "good 4 u",
		artist: "Olivia Rodrigo",
		album: "SOUR",
		addedAt: "3 weeks ago",
		sorted: false,
		playlists: [],
		image: "https://i.scdn.co/image/ab67616d0000b273a91c10fe9472d9bd535f637d",
	},
];
