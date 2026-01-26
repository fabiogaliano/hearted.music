/**
 * Theme type definitions - Single source of truth
 *
 * All theme-related types, constants, and validation derive from the
 * database-generated types (database.types.ts) to ensure consistency.
 */

import { z } from "zod";
import { type Enums, Constants } from "@/lib/data/database.types";

// ============================================================================
// Types (derived from database enum)
// ============================================================================

/** Theme color identifier - derived from DB enum */
export type ThemeColor = Enums<"theme">;

/** Theme configuration for rendering */
export interface ThemeConfig {
	name: string;
	// Surfaces (light to dark within same hue)
	bg: string;
	surface: string;
	surfaceDim: string;
	border: string;
	// Text
	text: string;
	textMuted: string;
	textOnPrimary: string;
	// Primary action
	primary: string;
	primaryHover: string;
}

// ============================================================================
// Constants (derived from database Constants)
// ============================================================================

/** All available theme colors as array - for iteration */
export const THEME_COLORS = Constants.public.Enums.theme;

/** Human-readable labels for each theme */
export const COLOR_LABELS: Record<ThemeColor, string> = {
	blue: "Calm",
	green: "Fresh",
	rose: "Warm",
	lavender: "Dreamy",
};

/**
 * Default theme for UI when user hasn't chosen (theme === null in DB).
 * This is a presentation-layer default, not stored in the database.
 */
export const DEFAULT_THEME: ThemeColor = "rose";

// ============================================================================
// Validation (Zod schema derived from database constants)
// ============================================================================

/** Zod schema for theme color validation */
export const themeSchema = z.enum(THEME_COLORS);
