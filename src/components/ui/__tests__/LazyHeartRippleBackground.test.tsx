import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@/test/utils/render";

const { mockRecover, mockCapture, mockImport } = vi.hoisted(() => ({
	mockRecover: vi.fn(),
	mockCapture: vi.fn(),
	mockImport: vi.fn(),
}));

vi.mock("@/lib/platform/routing/stale-chunk", () => ({
	recoverFromStaleChunk: mockRecover,
}));
vi.mock("@/lib/observability/sentry", () => ({
	captureRouteError: mockCapture,
}));
vi.mock("../HeartRippleBackground", () => mockImport());

const staleChunkError = new TypeError(
	"Failed to fetch dynamically imported module: https://hearted.music/assets/HeartRippleBackground-Cuspq34i.js",
);

async function mountWithFailingChunk() {
	vi.resetModules();
	mockImport.mockRejectedValue(staleChunkError);
	const { LazyHeartRippleBackground } = await import(
		"../LazyHeartRippleBackground"
	);
	render(<LazyHeartRippleBackground />);
}

beforeEach(() => {
	vi.clearAllMocks();
});

// Regression: this import lives outside the router, so a deploy-invalidated
// chunk used to escape as an unhandled rejection instead of reloading.
describe("LazyHeartRippleBackground chunk failure", () => {
	it("hands a stale chunk to the reload recovery and reports nothing", async () => {
		mockRecover.mockReturnValue(true);

		await mountWithFailingChunk();

		await waitFor(() => expect(mockRecover).toHaveBeenCalledTimes(1));
		expect(mockCapture).not.toHaveBeenCalled();
	});

	it("reports the failure when it is not staleness", async () => {
		mockRecover.mockReturnValue(false);

		await mountWithFailingChunk();

		await waitFor(() =>
			expect(mockCapture).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({ chunk: "HeartRippleBackground" }),
			),
		);
	});
});
