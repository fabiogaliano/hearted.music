import { z } from "zod";

const ThemeSchema = z.object({
	name: z.string(),
	description: z.string(),
});

const JourneyPointSchema = z.object({
	section: z.string(),
	mood: z.string(),
	description: z.string(),
});

const KeyLineSchema = z.object({
	line: z.string(),
	insight: z.string(),
});

export const LyricalAnalysisSchema = z.object({
	headline: z.string(),
	compound_mood: z.string(),
	mood_description: z.string(),
	interpretation: z.string(),
	themes: z.array(ThemeSchema),
	journey: z.array(JourneyPointSchema),
	key_lines: z.array(KeyLineSchema),
	sonic_texture: z.string(),
});

export type LyricalAnalysis = z.infer<typeof LyricalAnalysisSchema>;

export const InstrumentalAnalysisSchema = z.object({
	headline: z.string(),
	compound_mood: z.string(),
	mood_description: z.string(),
	sonic_texture: z.string(),
});

export type InstrumentalAnalysis = z.infer<typeof InstrumentalAnalysisSchema>;

export type AnalysisResult = LyricalAnalysis | InstrumentalAnalysis;

export function isLyricalAnalysis(
	result: AnalysisResult,
): result is LyricalAnalysis {
	return "interpretation" in result;
}

export const DISPLAY_FIELDS = [
	"headline",
	"compound_mood",
	"mood_description",
	"interpretation",
	"themes",
	"journey",
	"key_lines",
] as const;
