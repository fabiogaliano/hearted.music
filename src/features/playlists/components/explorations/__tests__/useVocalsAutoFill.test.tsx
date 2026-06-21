import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { useVocalsAutoFill } from "../useVocalsAutoFill";

// useVocalsAutoFill uses a 300 ms debounce; fake timers let us control it.
beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_FILTERS: PlaylistMatchFiltersV1 = { version: 1 };

function makeArgs(overrides: {
	isEditing?: boolean;
	lockManualEntry?: boolean;
	draftDescription?: string;
	draftMatchFilters?: PlaylistMatchFiltersV1;
	initialText?: string;
	setDraftMatchFilters?: (next: PlaylistMatchFiltersV1) => void;
}) {
	return {
		isEditing: true,
		lockManualEntry: false,
		draftDescription: "",
		draftMatchFilters: BASE_FILTERS,
		initialText: "",
		setDraftMatchFilters: vi.fn(),
		...overrides,
	};
}

// Advance the debounce and flush React updates.
function flush() {
	act(() => {
		vi.advanceTimersByTime(300);
	});
}

// ---------------------------------------------------------------------------
// Untouched → fills
// ---------------------------------------------------------------------------

describe("untouched vocalGender → auto-fills", () => {
	it("fills female when intent has unambiguous female text", () => {
		const setFilters = vi.fn();
		renderHook((props) => useVocalsAutoFill(props), {
			initialProps: makeArgs({
				draftDescription: "songs with female vocals",
				setDraftMatchFilters: setFilters,
			}),
		});

		flush();

		expect(setFilters).toHaveBeenCalledOnce();
		expect(setFilters.mock.calls[0][0]).toMatchObject({
			vocalGender: "female",
		});
	});

	it("fills male when intent has unambiguous male text", () => {
		const setFilters = vi.fn();
		renderHook(() =>
			useVocalsAutoFill(
				makeArgs({
					draftDescription: "deep male vocals",
					setDraftMatchFilters: setFilters,
				}),
			),
		);

		flush();

		expect(setFilters).toHaveBeenCalledOnce();
		expect(setFilters.mock.calls[0][0]).toMatchObject({
			vocalGender: "male",
		});
	});

	it("does not fill before the debounce fires", () => {
		const setFilters = vi.fn();
		renderHook(() =>
			useVocalsAutoFill(
				makeArgs({
					draftDescription: "female vocals chill",
					setDraftMatchFilters: setFilters,
				}),
			),
		);

		act(() => {
			vi.advanceTimersByTime(150);
		});

		expect(setFilters).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Manual-set vocalGender → preserved, no overwrite
// ---------------------------------------------------------------------------

describe("manual-set vocalGender → not overwritten", () => {
	it("does not call setDraftMatchFilters when vocalGender already set", () => {
		const setFilters = vi.fn();
		renderHook(() =>
			useVocalsAutoFill(
				makeArgs({
					draftDescription: "songs with female vocals",
					draftMatchFilters: { version: 1, vocalGender: "male" },
					setDraftMatchFilters: setFilters,
				}),
			),
		);

		flush();

		expect(setFilters).not.toHaveBeenCalled();
	});

	it("does not overwrite a saved female with a male detection", () => {
		const setFilters = vi.fn();
		renderHook(() =>
			useVocalsAutoFill(
				makeArgs({
					draftDescription: "deep male vocals",
					draftMatchFilters: { version: 1, vocalGender: "female" },
					setDraftMatchFilters: setFilters,
				}),
			),
		);

		flush();

		expect(setFilters).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Manual-clear (user dismissed chip) → stays cleared for same text
// ---------------------------------------------------------------------------

describe("manual-clear (user dismissed chip) → no re-add for same text", () => {
	it("does not re-add after the user clears the auto-filled chip", () => {
		const setFilters = vi.fn();

		// Start: no vocalGender, text triggers female.
		const { rerender } = renderHook((props) => useVocalsAutoFill(props), {
			initialProps: makeArgs({
				draftDescription: "female vocals",
				draftMatchFilters: BASE_FILTERS,
				setDraftMatchFilters: setFilters,
			}),
		});
		flush();
		expect(setFilters).toHaveBeenCalledOnce();

		// Simulate the auto-fill having been applied — now vocalGender is "female".
		// Then user clears it: vocalGender goes from "female" → undefined, text unchanged.
		rerender(
			makeArgs({
				draftDescription: "female vocals",
				draftMatchFilters: { version: 1, vocalGender: "female" },
				setDraftMatchFilters: setFilters,
			}),
		);
		// User clears the chip.
		rerender(
			makeArgs({
				draftDescription: "female vocals",
				draftMatchFilters: BASE_FILTERS, // vocalGender cleared
				setDraftMatchFilters: setFilters,
			}),
		);
		setFilters.mockClear();

		flush();

		// Should NOT re-add because the exact text was dismissed.
		expect(setFilters).not.toHaveBeenCalled();
	});

	it("allows re-detection after text changes post-dismissal", () => {
		const setFilters = vi.fn();

		const { rerender } = renderHook((props) => useVocalsAutoFill(props), {
			initialProps: makeArgs({
				draftDescription: "female vocals",
				draftMatchFilters: BASE_FILTERS,
				setDraftMatchFilters: setFilters,
			}),
		});
		flush();
		expect(setFilters).toHaveBeenCalledOnce();

		// Auto-fill applied → user clears → dismissal recorded.
		rerender(
			makeArgs({
				draftDescription: "female vocals",
				draftMatchFilters: { version: 1, vocalGender: "female" },
				setDraftMatchFilters: setFilters,
			}),
		);
		rerender(
			makeArgs({
				draftDescription: "female vocals",
				draftMatchFilters: BASE_FILTERS,
				setDraftMatchFilters: setFilters,
			}),
		);

		setFilters.mockClear();

		// User edits the text (different string → dismissal no longer applies).
		rerender(
			makeArgs({
				draftDescription: "female vocals and chill",
				draftMatchFilters: BASE_FILTERS,
				setDraftMatchFilters: setFilters,
			}),
		);
		flush();

		expect(setFilters).toHaveBeenCalledOnce();
		expect(setFilters.mock.calls[0][0]).toMatchObject({
			vocalGender: "female",
		});
	});
});

// ---------------------------------------------------------------------------
// Ambiguous / none → no change
// ---------------------------------------------------------------------------

describe("ambiguous or none → no auto-fill", () => {
	it("does not fill when both female and male signals present (ambiguous)", () => {
		const setFilters = vi.fn();
		renderHook(() =>
			useVocalsAutoFill(
				makeArgs({
					draftDescription: "female and male vocals duet",
					setDraftMatchFilters: setFilters,
				}),
			),
		);

		flush();

		expect(setFilters).not.toHaveBeenCalled();
	});

	it("does not fill when no vocal signal present", () => {
		const setFilters = vi.fn();
		renderHook(() =>
			useVocalsAutoFill(
				makeArgs({
					draftDescription: "chill lo-fi beats for studying",
					setDraftMatchFilters: setFilters,
				}),
			),
		);

		flush();

		expect(setFilters).not.toHaveBeenCalled();
	});

	it("does not fill on empty string", () => {
		const setFilters = vi.fn();
		renderHook(() =>
			useVocalsAutoFill(
				makeArgs({
					draftDescription: "",
					setDraftMatchFilters: setFilters,
				}),
			),
		);

		flush();

		expect(setFilters).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// No re-add on editor re-open with unchanged saved text
// ---------------------------------------------------------------------------

describe("no re-add on editor open with unchanged saved text", () => {
	it("does not auto-fill when initialText matches draftDescription (simulate re-open)", () => {
		const setFilters = vi.fn();
		// initialText = same as draftDescription → pre-seeded as dismissed.
		renderHook(() =>
			useVocalsAutoFill(
				makeArgs({
					draftDescription: "songs with female vocals",
					initialText: "songs with female vocals",
					draftMatchFilters: BASE_FILTERS,
					setDraftMatchFilters: setFilters,
				}),
			),
		);

		flush();

		// The hook pre-seeds initialText as dismissed, so detection should not fire.
		expect(setFilters).not.toHaveBeenCalled();
	});

	it("allows detection after the user types beyond the initial text", () => {
		const setFilters = vi.fn();

		const { rerender } = renderHook((props) => useVocalsAutoFill(props), {
			initialProps: makeArgs({
				draftDescription: "songs with female vocals",
				initialText: "songs with female vocals",
				draftMatchFilters: BASE_FILTERS,
				setDraftMatchFilters: setFilters,
			}),
		});
		flush();
		expect(setFilters).not.toHaveBeenCalled();

		// User adds more text → different string → no longer dismissed.
		rerender(
			makeArgs({
				draftDescription: "songs with female vocals, soft and melancholic",
				initialText: "songs with female vocals",
				draftMatchFilters: BASE_FILTERS,
				setDraftMatchFilters: setFilters,
			}),
		);
		flush();

		expect(setFilters).toHaveBeenCalledOnce();
		expect(setFilters.mock.calls[0][0]).toMatchObject({
			vocalGender: "female",
		});
	});
});

// ---------------------------------------------------------------------------
// Guided / locked mode → no auto-fill
// ---------------------------------------------------------------------------

describe("guided mode (lockManualEntry) → no auto-fill", () => {
	it("does not fill when lockManualEntry is true even with unambiguous text", () => {
		const setFilters = vi.fn();
		renderHook(() =>
			useVocalsAutoFill(
				makeArgs({
					draftDescription: "female vocals",
					lockManualEntry: true,
					setDraftMatchFilters: setFilters,
				}),
			),
		);

		flush();

		expect(setFilters).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Not in edit mode → no auto-fill
// ---------------------------------------------------------------------------

describe("not in edit mode → no auto-fill", () => {
	it("does not fill when isEditing is false", () => {
		const setFilters = vi.fn();
		renderHook(() =>
			useVocalsAutoFill(
				makeArgs({
					isEditing: false,
					draftDescription: "female vocals",
					setDraftMatchFilters: setFilters,
				}),
			),
		);

		flush();

		expect(setFilters).not.toHaveBeenCalled();
	});
});
