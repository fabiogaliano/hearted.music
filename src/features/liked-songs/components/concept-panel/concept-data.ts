/**
 * Step 0 hand-written reads for the four voice-audit exemplars.
 *
 * Each `read` was rewritten from the source exemplar (scripts/voice-audit/
 * exemplars/*.json) by collapsing redundant fields and adding `lens` +
 * optional `contradiction`. `image` and `tension` carry over directly from
 * the existing `headline` and `compound_mood`; `take` folds the old
 * `interpretation` and `mood_description`; `texture` tightens the old
 * `sonic_texture` to one contrast-ending sentence.
 */

import type { ConceptSong } from "./concept-types";

export const CONCEPT_SONGS: ConceptSong[] = [
	{
		id: "drivers-license",
		spotifyTrackId: "4ml4WlnHDEpOK8HRVYTCWf",
		title: "drivers license",
		artist: "Olivia Rodrigo",
		album: "SOUR",
		year: 2021,
		genres: ["pop", "bedroom pop"],
		audioFeatures: { tempo: 144, energy: 0.44, valence: 0.13 },
		theme: "rose",
		read: {
			image: "the long way home, alone this time",
			lens: "license as eulogy",
			tension: "Aching Disbelief",
			take: "She passed the test she swore she would pass for him, and now the win only measures how far the car can go without him in it. The streets she learned to drive on belong to someone she thought she'd be with by now. The whole song is the sound of a private promise turning into an ordinary errand.",
			contradiction: "She got everything she wanted. She got it alone.",
			arc: [
				{
					label: "Verse",
					mood: "Hushed",
					scene:
						"Just her voice and a few chords, a diary left open on the dashboard.",
				},
				{
					label: "Bridge",
					mood: "Overwhelmed",
					scene:
						"Red lights and stop signs blur. The harmonies stack up like thoughts she cannot stop having.",
				},
				{
					label: "Final chorus",
					mood: "Cathartic",
					scene:
						"The dam breaks. What started as a whisper ends as the loudest she has been all song.",
				},
			],
			lines: [
				{
					line: "I got my driver's license like I told you I would",
					insight:
						"A win that only counts as a loss. The accomplishment is addressed to someone who is not there to hear it.",
				},
				{
					line: "And you're probably with that blonde girl",
					insight:
						"Heartbreak does its worst work in the imagination, casting the exact scene it dreads.",
				},
			],
			texture:
				"A ballad that grows a spine — sparse piano swells into stacked harmonies and a pounding bridge.",
		},
	},
	{
		id: "not-like-us",
		spotifyTrackId: "6AI3ezQ4o3HUoP6Dhudph3",
		title: "Not Like Us",
		artist: "Kendrick Lamar",
		album: "Not Like Us",
		year: 2024,
		genres: ["hip hop", "west coast rap"],
		audioFeatures: { tempo: 101, energy: 0.78, valence: 0.21 },
		theme: "blue",
		read: {
			image: "the block party draws the line",
			lens: "diss as block party",
			tension: "Triumphant Contempt",
			take: "A hometown verdict on a rivalry, said loud enough for the whole country to overhear. The insults are not the point. The certainty is, and he stitches it into a beat the block can dance to. By the time he calls Drake a colonizer, the diss has already become an anthem, and that is its own kind of cruelty.",
			contradiction: "He is reading a verdict, and you can dance to it.",
			arc: [
				{
					label: "Intro",
					mood: "Coiled",
					scene:
						"A whispered 'I see dead people' breaks the silence. Mustard's beat rolls in easy, almost friendly, the swing of a smile before the first punch.",
				},
				{
					label: "Verse 1",
					mood: "Pointed",
					scene:
						"The names start landing. Drake by name, the 'A minor' pun, the receipts in order. He is not arguing. He is reading a verdict.",
				},
				{
					label: "Hook",
					mood: "Communal",
					scene:
						"'They not like us' becomes a whole city singing back. You are either in the room or you are the target.",
				},
				{
					label: "Verse 2",
					mood: "Accusatory",
					scene:
						"He does not argue. He convicts. 'You not a colleague, you a fuckin' colonizer' lands like a sentence handed down.",
				},
				{
					label: "Bridge",
					mood: "Celebratory",
					scene:
						"The taunts turn into a dance. The crowd is chanting it back before the next line drops.",
				},
				{
					label: "Outro",
					mood: "Settled",
					scene:
						"The beat coasts out. Nothing is left to argue. Compton has already moved on to the next song of the summer.",
				},
			],
			lines: [
				{
					line: "They not like us",
					insight:
						"Four words doing the work of a manifesto. The line draws a circle and leaves someone outside it.",
				},
				{
					line: "Tryna strike a chord and it's probably A minor",
					insight:
						"The cruelest bar wears a pun, so the room laughs a half second before the meaning lands.",
				},
				{
					line: "No, you not a colleague, you a fuckin' colonizer",
					insight:
						"The verdict in plain language. Not collaboration. Extraction.",
				},
				{
					line: "Say, Drake, I hear you like 'em young",
					insight:
						"The line that turned the diss into something the song could not take back. Direct address, on purpose.",
				},
			],
			texture:
				"A West Coast bounce that struts without breaking a sweat, where the menace lives entirely in how relaxed it sounds.",
		},
	},
	{
		id: "motion-sickness",
		spotifyTrackId: "5xo8RrjJ9CVNrtRg2S3B1R",
		title: "Motion Sickness",
		artist: "Phoebe Bridgers",
		album: "Stranger in the Alps",
		year: 2017,
		genres: ["indie rock", "indie folk"],
		audioFeatures: { tempo: 138, energy: 0.62, valence: 0.34 },
		theme: "green",
		read: {
			image: "loving someone you would not call back",
			lens: "anger with receipts",
			tension: "Tender Resentment",
			take: "The specific nausea of being tangled up with someone who hurt you and still takes up room in your day. She isn't asking for closure — she is naming the dizziness of missing a person she also can't stand. Anger and longing share the same sentence and refuse to resolve.",
			contradiction:
				"She hates him for what he did and misses him anyway. Both stay true.",
			arc: [
				{
					label: "Verse 1",
					mood: "Wry",
					scene:
						"She lists the damage in an almost conversational shrug, like recounting a bad trip to a friend.",
				},
				{
					label: "Chorus",
					mood: "Restless",
					scene:
						"The motion sickness hits. The melody lifts while the stomach drops.",
				},
				{
					label: "Bridge",
					mood: "Exposed",
					scene:
						"The bravado thins out. For a second she just admits she has no clean way to feel about this.",
				},
			],
			lines: [
				{
					line: "I have emotional motion sickness",
					insight:
						"The whole song folded into one image. Feelings as a moving car you cannot get out of.",
				},
				{
					line: "I hate you for what you did and I miss you like a little kid",
					insight:
						"Two opposite truths in one breath, and she refuses to pick one.",
				},
			],
			texture:
				"Jangly, propulsive indie rock — the drums keep things moving even when the lyrics would rather lie down.",
		},
	},
	{
		id: "blinding-lights",
		spotifyTrackId: "0VjIjW4GlUZAMYd2vXMi3b",
		title: "Blinding Lights",
		artist: "The Weeknd",
		album: "After Hours",
		year: 2019,
		genres: ["synthwave", "pop"],
		audioFeatures: { tempo: 171, energy: 0.73, valence: 0.33 },
		theme: "lavender",
		read: {
			image: "neon, and no one to call",
			lens: "speed as avoidance",
			tension: "Euphoric Loneliness",
			take: "Chasing a high, a city, a person — anything to outrun being alone at night. The euphoria is real, and so is the emptiness underneath it. He floors it through the dark and hopes the motion will pass for connection.",
			contradiction:
				"The thing that thrills him is the thing keeping him blind.",
			arc: [
				{
					label: "Intro",
					mood: "Surging",
					scene:
						"The synth hits and the song is already at full speed, like flooring it the second the light turns.",
				},
				{
					label: "Verses",
					mood: "Yearning",
					scene:
						"Under all the gloss he's just asking someone to be there. The need keeps peeking through the shine.",
				},
				{
					label: "Outro",
					mood: "Spent",
					scene:
						"The lights keep flashing but the feeling never arrives. Still driving, still alone.",
				},
			],
			lines: [
				{
					line: "I can't sleep until I feel your touch",
					insight:
						"Insomnia dressed up as devotion. The glamour barely covers how plainly he needs someone.",
				},
				{
					line: "I'm blinded by the lights",
					insight:
						"The thing that thrills him is the thing keeping him from seeing clearly. The high is also the blindfold.",
				},
			],
			texture:
				"Glossy retro synthwave — bright, propulsive, all chrome and cold night air.",
		},
	},
];
