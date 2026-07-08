import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "@/lib/observability/logger";
import { startNotifyListener } from "../notify-listener";

const state = vi.hoisted(() => ({
	databaseUrl: "postgres://user:pass@db.internal:5432/app",
	subscriptions: new Map<
		string,
		{ onListen: () => void; onNotify: () => void }
	>(),
	listenMock: vi.fn(),
	endMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/env", () => ({
	env: new Proxy(
		{},
		{
			get: (_target, prop) =>
				prop === "DATABASE_URL" ? state.databaseUrl : undefined,
		},
	),
}));

vi.mock("postgres", () => ({
	default: () => ({
		listen: state.listenMock,
		end: state.endMock,
	}),
}));

vi.mock("@/lib/observability/logger", () => ({
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

describe("startNotifyListener", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		state.databaseUrl = "postgres://user:pass@db.internal:5432/app";
		state.subscriptions.clear();
		state.listenMock.mockImplementation(
			async (channel: string, onNotify: () => void, onListen: () => void) => {
				state.subscriptions.set(channel, { onListen, onNotify });
			},
		);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("coalesces bursts per channel and runs reconnect catch-up", async () => {
		const onLibraryWake = vi.fn();
		const onDeckWake = vi.fn();
		const listener = startNotifyListener(
			{
				library_processing_job_created: onLibraryWake,
				match_deck_job_created: onDeckWake,
			},
			100,
		);

		expect(state.listenMock).toHaveBeenCalledTimes(2);

		state.subscriptions.get("library_processing_job_created")?.onListen();
		state.subscriptions.get("library_processing_job_created")?.onNotify();
		state.subscriptions.get("library_processing_job_created")?.onNotify();
		state.subscriptions.get("match_deck_job_created")?.onNotify();

		await vi.advanceTimersByTimeAsync(99);
		expect(onLibraryWake).not.toHaveBeenCalled();
		expect(onDeckWake).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(onLibraryWake).toHaveBeenCalledTimes(1);
		expect(onDeckWake).toHaveBeenCalledTimes(1);

		await listener.stop();
		expect(state.endMock).toHaveBeenCalledWith({ timeout: 5 });
	});

	it("disables LISTEN on the transaction pooler and leaves poll as the fallback", async () => {
		state.databaseUrl =
			"postgres://user:pass@aws-0-us-east-1.pooler.supabase.com:6543/app";

		const listener = startNotifyListener({
			library_processing_job_created: vi.fn(),
		});

		expect(state.listenMock).not.toHaveBeenCalled();
		expect(log.warn).toHaveBeenCalledWith(
			"notify-listener-disabled",
			expect.objectContaining({
				reason: expect.stringContaining("transaction-mode pooler"),
			}),
		);

		await listener.stop();
		expect(state.endMock).not.toHaveBeenCalled();
	});
});
