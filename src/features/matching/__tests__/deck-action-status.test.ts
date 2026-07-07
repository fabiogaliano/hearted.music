import { describe, expect, it } from "vitest";
import { isDeckActionSuccess } from "@/features/matching/deck-action-status";

// Rejection token sets are the non-success remainder of each atomic RPC's status
// enum (match-review-queue/queries.ts). Enumerated here so a token silently added
// to a success set — or dropped from one — trips a failing case.
const ADD_REJECTIONS = [
	"not_found",
	"already_resolved",
	"not_entitled",
	"foreign_playlist",
	"invalid_target",
	"not_visible",
];
const DISMISS_SUGGESTION_REJECTIONS = [
	"not_found",
	"already_resolved",
	"not_entitled",
	"foreign_playlist",
	"invalid_target",
	"not_visible",
	"already_added",
];
const WHOLE_CARD_REJECTIONS = [
	"not_found",
	"already_resolved",
	"no_captured_pairs",
];

describe("isDeckActionSuccess", () => {
	it("classifies add-suggestion success only on 'added'", () => {
		expect(isDeckActionSuccess("add-suggestion", "added")).toBe(true);
		for (const rejection of ADD_REJECTIONS) {
			expect(isDeckActionSuccess("add-suggestion", rejection)).toBe(false);
		}
	});

	it("classifies dismiss-suggestion success only on 'dismissed'", () => {
		expect(isDeckActionSuccess("dismiss-suggestion", "dismissed")).toBe(true);
		for (const rejection of DISMISS_SUGGESTION_REJECTIONS) {
			expect(isDeckActionSuccess("dismiss-suggestion", rejection)).toBe(false);
		}
	});

	it("classifies finish-card success on 'completed_added' or 'skipped'", () => {
		expect(isDeckActionSuccess("finish-card", "completed_added")).toBe(true);
		expect(isDeckActionSuccess("finish-card", "skipped")).toBe(true);
		for (const rejection of WHOLE_CARD_REJECTIONS) {
			expect(isDeckActionSuccess("finish-card", rejection)).toBe(false);
		}
	});

	it("classifies dismiss-card success only on 'dismissed'", () => {
		expect(isDeckActionSuccess("dismiss-card", "dismissed")).toBe(true);
		for (const rejection of WHOLE_CARD_REJECTIONS) {
			expect(isDeckActionSuccess("dismiss-card", rejection)).toBe(false);
		}
	});

	it("treats unknown and empty tokens as not-success for every action", () => {
		const types = [
			"add-suggestion",
			"dismiss-suggestion",
			"finish-card",
			"dismiss-card",
		] as const;
		for (const type of types) {
			expect(isDeckActionSuccess(type, "")).toBe(false);
			expect(isDeckActionSuccess(type, "totally_unknown")).toBe(false);
		}
	});

	it("does not leak a success token across action types", () => {
		// "dismissed" is success for dismiss-* but not for add/finish; "skipped"
		// is finish-only. Cross-type leakage would advance or roll back wrongly.
		expect(isDeckActionSuccess("add-suggestion", "dismissed")).toBe(false);
		expect(isDeckActionSuccess("finish-card", "dismissed")).toBe(false);
		expect(isDeckActionSuccess("dismiss-suggestion", "completed_added")).toBe(
			false,
		);
		expect(isDeckActionSuccess("dismiss-card", "skipped")).toBe(false);
	});
});
