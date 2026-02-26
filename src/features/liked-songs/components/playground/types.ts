import type { ThemeColor } from "@/lib/theme/types";

export interface DesignConfig {
	headline: boolean;
	compoundMood: boolean;
	moodDescription: boolean;
	interpretation: boolean;
	keyLines: boolean;
	themes: boolean;
	journey: boolean;
	audioStats: boolean;
	genres: boolean;
	sonicTexture: boolean;

	headlineSize: "sm" | "md" | "lg";
	moodStyle: "label" | "large";
	interpretationStyle: "paragraph" | "pullquote";
	keyLinesStyle: "blockquote" | "stacked" | "focused";
	themesStyle: "list" | "pills" | "prose";
	genrePosition: "hero" | "content";
	audioPosition: "hero" | "content";
	journeyStyle: "vertical" | "stepper" | "timeline";
	themesPosition:
		| "above-headline"
		| "below-headline"
		| "after-mood"
		| "bottom"
		| "kicker"
		| "hero"
		| "above-stats";
	headlineReveal: "swap" | "push";
	sonicTextureStyle: "dissolve" | "whisper" | "blur" | "genre" | "push";

	isDark: boolean;
	themeColor: ThemeColor;
}

export interface ColorProps {
	text: string;
	textMuted: string;
	textDim: string;
	accent: string;
	accentMuted: string;
	border: string;
	surface: string;
	surfaceHover: string;
	bg: string;
}

export interface PlaygroundSong {
	id: string;
	name: string;
	artist: string;
	album: string;
	genres: string[];
	artistImageUrl: string;
	albumArtUrl: string;
	liked_at: string;
	analysis: {
		headline: string;
		compound_mood: string;
		mood_description: string;
		interpretation: string;
		themes: Array<{ name: string; description: string }>;
		journey: Array<{ section: string; mood: string; description: string }>;
		key_lines: Array<{ line: string; insight: string }>;
		sonic_texture: string;
	};
	audio_features: {
		tempo: number;
		energy: number;
		valence: number;
		danceability: number;
		acousticness: number;
		instrumentalness: number;
		liveness: number;
		loudness: number;
		speechiness: number;
	};
}

export const HEADLINE_SIZES: Record<DesignConfig["headlineSize"], number> = {
	sm: 18,
	md: 22,
	lg: 26,
};

type PresetConfig = Omit<DesignConfig, "isDark" | "themeColor">;
type Preset = { label: string; description: string; config: PresetConfig };

export const PRESETS: Record<string, Preset> = {
	"lyric-first": {
		label: "Lyric First",
		description: "Song told through its own words — focused one-by-one lyrics",
		config: {
			headline: true,
			compoundMood: true,
			moodDescription: true,
			interpretation: false,
			keyLines: true,
			themes: true,
			journey: true,
			audioStats: true,
			genres: true,
			headlineSize: "lg",
			moodStyle: "label",
			interpretationStyle: "paragraph",
			keyLinesStyle: "blockquote",
			themesStyle: "pills",
			genrePosition: "hero",
			audioPosition: "hero",
			journeyStyle: "stepper",
			themesPosition: "above-stats",
			headlineReveal: "swap",
			sonicTexture: true,
			sonicTextureStyle: "push",
		},
	},
};

export const DEFAULT_CONFIG: DesignConfig = {
	...PRESETS["lyric-first"].config,
	isDark: true,
	themeColor: "rose",
};
