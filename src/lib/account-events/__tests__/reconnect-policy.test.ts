import { describe, expect, it } from "vitest";
import {
	initialReconnectState,
	type ReconnectState,
	reconnectPolicy,
} from "../reconnect-policy";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

function visible(nowMs: number): ReconnectState {
	return reconnectPolicy(initialReconnectState, {
		type: "visibility_changed",
		hidden: false,
		nowMs,
	});
}

/** Mint attempt times while every mint fails, driving timers as a browser would. */
function mintAttemptsWhileMintFails(
	durationMs: number,
	random: number,
): number[] {
	const attempts: number[] = [];
	let nowMs = 0;
	let state = visible(nowMs);
	while (nowMs < durationMs) {
		const { phase } = state;
		if (phase.kind === "minting") {
			attempts.push(nowMs);
			state = reconnectPolicy(state, { type: "mint_failed", nowMs, random });
		} else if (phase.kind === "waiting") {
			nowMs = phase.untilMs;
			state = reconnectPolicy(state, { type: "timer_fired", nowMs });
		} else {
			throw new Error(`unexpected phase ${phase.kind}`);
		}
	}
	return attempts;
}

describe("reconnectPolicy", () => {
	it.each([
		0, 0.5, 0.999,
	])("28-hour loop regression: a failing mint is retried no sooner than 60 s and no later than 5 min apart (jitter %s)", (random) => {
		const attempts = mintAttemptsWhileMintFails(28 * HOUR, random);

		const gaps = attempts.slice(1).map((at, i) => at - (attempts[i] ?? 0));
		expect(Math.min(...gaps)).toBeGreaterThanOrEqual(MINUTE);
		expect(Math.max(...gaps)).toBeLessThanOrEqual(5 * MINUTE);
		// The outage client retried within 30 s: >= 3,360 mints in 28 h.
		expect(attempts.length).toBeLessThanOrEqual((28 * HOUR) / MINUTE + 1);
	});

	it("does not retry a failed mint while the tab is hidden, and keeps the back-off when shown early", () => {
		let state = visible(0);
		state = reconnectPolicy(state, {
			type: "mint_failed",
			nowMs: 0,
			random: 0,
		});
		expect(state.phase).toEqual({ kind: "waiting", untilMs: MINUTE });

		state = reconnectPolicy(state, {
			type: "visibility_changed",
			hidden: true,
			nowMs: 10 * SECOND,
		});
		expect(state.phase).toEqual({ kind: "paused", notBeforeMs: MINUTE });
		// A stale timer from before the tab hid must not start an attempt.
		state = reconnectPolicy(state, { type: "timer_fired", nowMs: MINUTE });
		expect(state.phase.kind).toBe("paused");

		state = reconnectPolicy(state, {
			type: "visibility_changed",
			hidden: false,
			nowMs: 20 * SECOND,
		});
		expect(state.phase).toEqual({ kind: "waiting", untilMs: MINUTE });

		state = reconnectPolicy(state, { type: "timer_fired", nowMs: MINUTE });
		expect(state.phase).toEqual({ kind: "minting" });
	});

	it("starts nothing in a tab that opens hidden", () => {
		const state = reconnectPolicy(initialReconnectState, {
			type: "visibility_changed",
			hidden: true,
			nowMs: 0,
		});

		expect(state.phase.kind).toBe("paused");
	});

	it("reuses the token across stream closes until 30 s before it expires", () => {
		let state = visible(0);
		state = reconnectPolicy(state, {
			type: "mint_succeeded",
			token: { value: "t1", expiresAtMs: 5 * MINUTE },
			nowMs: 0,
		});
		state = reconnectPolicy(state, { type: "stream_opened" });

		state = reconnectPolicy(state, {
			type: "stream_failed",
			nowMs: MINUTE,
			random: 0,
		});
		expect(state.phase).toEqual({
			kind: "waiting",
			untilMs: MINUTE + 2 * SECOND,
		});
		state = reconnectPolicy(state, {
			type: "timer_fired",
			nowMs: MINUTE + 2 * SECOND,
		});
		expect(state.phase).toEqual({ kind: "opening", token: "t1" });

		state = reconnectPolicy(state, { type: "stream_opened" });
		state = reconnectPolicy(state, {
			type: "stream_failed",
			nowMs: 4 * MINUTE + 29 * SECOND,
			random: 0,
		});
		state = reconnectPolicy(state, {
			type: "timer_fired",
			nowMs: 4 * MINUTE + 31 * SECOND,
		});
		expect(state.phase).toEqual({ kind: "minting" });
	});

	it("opens with a freshly minted token even when it already looks expired — re-minting it would loop with no delay", () => {
		let state = visible(10 * MINUTE);
		state = reconnectPolicy(state, {
			type: "mint_succeeded",
			token: { value: "t1", expiresAtMs: 0 },
			nowMs: 10 * MINUTE,
		});

		expect(state.phase).toEqual({ kind: "opening", token: "t1" });
	});

	it("re-mints at once on one 401, but puts repeated 401s on the mint schedule", () => {
		let state = visible(0);
		state = reconnectPolicy(state, {
			type: "mint_succeeded",
			token: { value: "t1", expiresAtMs: 5 * MINUTE },
			nowMs: 0,
		});
		state = reconnectPolicy(state, {
			type: "token_rejected",
			nowMs: 0,
			random: 0,
		});
		expect(state.phase).toEqual({ kind: "minting" });

		state = reconnectPolicy(state, {
			type: "mint_succeeded",
			token: { value: "t2", expiresAtMs: 5 * MINUTE },
			nowMs: SECOND,
		});
		state = reconnectPolicy(state, {
			type: "token_rejected",
			nowMs: SECOND,
			random: 0,
		});
		expect(state.phase).toEqual({ kind: "waiting", untilMs: SECOND + MINUTE });
	});
});
