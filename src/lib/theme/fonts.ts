/**
 * Font configuration for editorial style
 *
 * Display: Instrument Serif - elegant Google Font serif for headlines
 * Body: Geist - refined geometric sans by Vercel (9 weights)
 *
 * Fonts loaded via Google Fonts link in root layout
 */

export const fonts = {
	display: "'Instrument Serif', Georgia, serif",
	body: "'Geist', -apple-system, BlinkMacSystemFont, sans-serif",
} as const;

/**
 * Google Fonts URL for required fonts
 */
export const GOOGLE_FONTS_URL =
	"https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@100..900&display=swap";
