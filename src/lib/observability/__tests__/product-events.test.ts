import { describe, expect, it } from "vitest";
import {
	EVENT_SCHEMA_VERSION,
	formatProductEventPayload,
	type ProductEventMap,
} from "../product-events";

describe("product-events contract", () => {
	it("formats payload with schema_version", () => {
		const payload = formatProductEventPayload("login_attempted", {
			provider: "google",
		});

		expect(payload).toEqual({
			schema_version: EVENT_SCHEMA_VERSION,
			provider: "google",
		});
	});

	it("formats propertyless events with schema_version only", () => {
		const payload = formatProductEventPayload("free_plan_selected");

		expect(payload).toEqual({
			schema_version: EVENT_SCHEMA_VERSION,
		});
	});

	it("enforces snake_case on match_deck_materialize_on_read", () => {
		const payload = formatProductEventPayload(
			"match_deck_materialize_on_read",
			{
				item_id: "test-song-id",
				recovered: true,
				orientation: "song",
			},
		);

		expect(payload).toEqual({
			schema_version: EVENT_SCHEMA_VERSION,
			item_id: "test-song-id",
			recovered: true,
			orientation: "song",
		});
	});

	it("rejects unknown events and missing required properties at compile time", () => {
		const invalidCallsMustNotCompile = () => {
			// @ts-expect-error login_attempted requires provider properties
			formatProductEventPayload("login_attempted");
			// @ts-expect-error event names are restricted to ProductEventMap keys
			formatProductEventPayload("unknown_event", {});
			// @ts-expect-error properties must match the selected event
			formatProductEventPayload("login_attempted", { songs: 1 });
		};

		expect(invalidCallsMustNotCompile).toBeTypeOf("function");
	});

	it("compiles with strict static type assertions", () => {
		// Type check assertions:
		type AssertHasKey<T, K extends string> = K extends keyof T ? true : false;

		const hasLogin: AssertHasKey<ProductEventMap, "login_attempted"> = true;
		const hasOnboarding: AssertHasKey<ProductEventMap, "onboarding_completed"> =
			true;
		const hasSongAdded: AssertHasKey<
			ProductEventMap,
			"song_added_to_playlist"
		> = true;
		const hasMaterialize: AssertHasKey<
			ProductEventMap,
			"match_deck_materialize_on_read"
		> = true;

		expect(hasLogin).toBe(true);
		expect(hasOnboarding).toBe(true);
		expect(hasSongAdded).toBe(true);
		expect(hasMaterialize).toBe(true);
	});
});
