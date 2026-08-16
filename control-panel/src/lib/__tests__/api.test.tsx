// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invalidateApiCache, useApi } from "../api";

function QueryHarness({ enabled }: { enabled: boolean }) {
	useApi<{ ok: boolean }>("/api/disabled-query-test", 0, enabled);
	return null;
}

afterEach(() => {
	vi.restoreAllMocks();
	invalidateApiCache();
});

describe("useApi disabled queries", () => {
	it("does not request a disabled endpoint and fetches once enabled", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const view = render(<QueryHarness enabled={false} />);

		expect(fetchMock).not.toHaveBeenCalled();
		view.rerender(<QueryHarness enabled />);

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(fetchMock).toHaveBeenCalledWith("/api/disabled-query-test");
	});
});
