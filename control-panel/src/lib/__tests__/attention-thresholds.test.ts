// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_ATTENTION_THRESHOLDS,
	readAttentionThresholds,
	writeAttentionThresholds,
} from "../attention-thresholds";

describe("attention thresholds", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("defaults to the documented thresholds when nothing is stored", () => {
		expect(readAttentionThresholds()).toEqual(DEFAULT_ATTENTION_THRESHOLDS);
	});

	it("round-trips a valid override", () => {
		writeAttentionThresholds({
			...DEFAULT_ATTENTION_THRESHOLDS,
			pendingJobsMinAgeMinutes: 30,
			noLibraryMinAgeHours: 48,
		});

		expect(readAttentionThresholds()).toEqual({
			...DEFAULT_ATTENTION_THRESHOLDS,
			pendingJobsMinAgeMinutes: 30,
			noLibraryMinAgeHours: 48,
		});
	});

	it("falls back to defaults for corrupt or invalid stored values", () => {
		window.localStorage.setItem(
			"hearted-control-panel.attention-thresholds.v1",
			JSON.stringify({
				pendingJobsMinAgeMinutes: -5,
				noLibraryMinAgeHours: "soon",
			}),
		);

		expect(readAttentionThresholds()).toEqual(DEFAULT_ATTENTION_THRESHOLDS);
	});
});
