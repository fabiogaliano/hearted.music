/**
 * Mock PlaylistMatchFilterOptions for Ladle stories and local prototype state.
 * Mirrors the shape of the real getPlaylistMatchFilterOptions RPC result.
 *
 * Detected languages are believable (large en library, some pt/es/fr/de/ja),
 * plus plenty of catalog-only entries to exercise the full picker ordering.
 */

import type { PlaylistMatchFilterOptions } from "@/lib/domains/taste/match-filters/types";

export const MOCK_FILTER_OPTIONS: PlaylistMatchFilterOptions = {
	languages: [
		// Detected (source = "detected"), sorted by count desc
		{ code: "en", label: "English", count: 841, source: "detected" },
		{ code: "pt", label: "Portuguese", count: 312, source: "detected" },
		{ code: "es", label: "Spanish", count: 198, source: "detected" },
		{ code: "fr", label: "French", count: 97, source: "detected" },
		{ code: "de", label: "German", count: 54, source: "detected" },
		{ code: "ja", label: "Japanese", count: 33, source: "detected" },
		{ code: "ko", label: "Korean", count: 21, source: "detected" },
		{ code: "it", label: "Italian", count: 14, source: "detected" },
		// Catalog-only — these exercise the third ordering tier (alphabetical)
		{ code: "af", label: "Afrikaans", count: 0, source: "catalog" },
		{ code: "ar", label: "Arabic", count: 0, source: "catalog" },
		{ code: "bn", label: "Bengali", count: 0, source: "catalog" },
		{ code: "ca", label: "Catalan", count: 0, source: "catalog" },
		{ code: "cs", label: "Czech", count: 0, source: "catalog" },
		{ code: "da", label: "Danish", count: 0, source: "catalog" },
		{ code: "el", label: "Greek", count: 0, source: "catalog" },
		{ code: "fi", label: "Finnish", count: 0, source: "catalog" },
		{ code: "he", label: "Hebrew", count: 0, source: "catalog" },
		{ code: "hi", label: "Hindi", count: 0, source: "catalog" },
		{ code: "hr", label: "Croatian", count: 0, source: "catalog" },
		{ code: "hu", label: "Hungarian", count: 0, source: "catalog" },
		{ code: "id", label: "Indonesian", count: 0, source: "catalog" },
		{ code: "nl", label: "Dutch", count: 0, source: "catalog" },
		{ code: "pl", label: "Polish", count: 0, source: "catalog" },
		{ code: "ro", label: "Romanian", count: 0, source: "catalog" },
		{ code: "ru", label: "Russian", count: 0, source: "catalog" },
		{ code: "sv", label: "Swedish", count: 0, source: "catalog" },
		{ code: "tr", label: "Turkish", count: 0, source: "catalog" },
		{ code: "uk", label: "Ukrainian", count: 0, source: "catalog" },
		{ code: "vi", label: "Vietnamese", count: 0, source: "catalog" },
		{ code: "zh", label: "Chinese", count: 0, source: "catalog" },
	],
	releaseYears: {
		min: 1968,
		max: 2026,
		counts: [
			{ year: 2020, count: 142 },
			{ year: 2021, count: 118 },
			{ year: 2022, count: 99 },
			{ year: 2023, count: 87 },
			{ year: 2024, count: 61 },
		],
	},
	likedAt: {
		oldest: "2019-03-14",
		today: "2026-06-21",
		yearCounts: [
			{ year: 2022, count: 203 },
			{ year: 2023, count: 187 },
			{ year: 2024, count: 154 },
			{ year: 2025, count: 312 },
		],
	},
};
