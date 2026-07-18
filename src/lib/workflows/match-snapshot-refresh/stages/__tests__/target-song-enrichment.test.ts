import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunLightweightEnrichment = vi.fn();
vi.mock("@/lib/workflows/playlist-sync/lightweight-enrichment", () => ({
	runLightweightEnrichment: (...args: unknown[]) =>
		mockRunLightweightEnrichment(...args),
}));

const { runTargetSongEnrichment } = await import("../target-song-enrichment");

describe("runTargetSongEnrichment", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns succeeded:true and forwards accountId on success", async () => {
		mockRunLightweightEnrichment.mockResolvedValue(undefined);

		const outcome = await runTargetSongEnrichment("acc-1", "test-user");

		expect(outcome).toEqual({ succeeded: true });
		expect(mockRunLightweightEnrichment).toHaveBeenCalledWith({
			accountId: "acc-1",
		});
	});

	it("returns succeeded:false and does not throw when enrichment fails", async () => {
		mockRunLightweightEnrichment.mockRejectedValue(new Error("boom"));

		const outcome = await runTargetSongEnrichment("acc-1", "test-user");

		expect(outcome).toEqual({ succeeded: false });
	});
});
