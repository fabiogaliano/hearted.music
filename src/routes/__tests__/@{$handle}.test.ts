/**
 * Route loader tests for the public /@handle route.
 *
 * §14.8 coverage:
 * - mixed-case params redirect to canonical lowercase before lookup
 * - lowercase params resolve without redirect
 * - known handle with completed onboarding renders (returns identity)
 * - null result (not found / not complete) throws notFound
 * - operational failure (server fn throws) rethrows, not converted to notFound
 * - route does NOT redirect to /settings or /login on success
 * - route calls getPublicHandleIdentity, not the admin-query module directly
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn(
	(opts: { to: string; params?: Record<string, string> }) => ({
		kind: "redirect" as const,
		...opts,
	}),
);
const notFoundMock = vi.fn(() => ({ kind: "not-found" as const }));
const mockGetPublicHandleIdentity = vi.fn();

type RouteLoader = {
	loader: (args: { params: { handle: string } }) => Promise<unknown>;
};

function isRoute(value: unknown): value is RouteLoader {
	return typeof value === "object" && value !== null && "loader" in value;
}

async function loadRoute(): Promise<RouteLoader> {
	vi.resetModules();
	vi.doMock("@tanstack/react-router", () => ({
		createFileRoute: () => (config: unknown) => config,
		redirect: redirectMock,
		notFound: notFoundMock,
	}));
	vi.doMock("@/lib/server/public-handle.functions", () => ({
		getPublicHandleIdentity: mockGetPublicHandleIdentity,
	}));
	vi.doMock("@/features/public-handle/PublicHandleComingSoonPage", () => ({
		PublicHandleComingSoonPage: () => null,
	}));

	const module = await import("../@{$handle}");
	if (!isRoute(module.Route)) {
		throw new Error("Expected Route to expose a loader");
	}
	return module.Route;
}

describe("/@{$handle} route loader", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Re-establish redirect/notFound mocks after clearAllMocks
		redirectMock.mockImplementation(
			(opts: { to: string; params?: Record<string, string> }) => ({
				kind: "redirect" as const,
				...opts,
			}),
		);
		notFoundMock.mockReturnValue({ kind: "not-found" as const });
	});

	it("redirects to canonical lowercase when params.handle contains uppercase", async () => {
		const route = await loadRoute();

		await expect(route.loader({ params: { handle: "Fabio" } })).rejects.toEqual(
			expect.objectContaining({ kind: "redirect", to: "/@{$handle}" }),
		);

		expect(redirectMock).toHaveBeenCalledWith({
			to: "/@{$handle}",
			params: { handle: "fabio" },
		});
		// Lookup must NOT have been called before the redirect
		expect(mockGetPublicHandleIdentity).not.toHaveBeenCalled();
	});

	it("does not redirect when params.handle is already lowercase", async () => {
		const route = await loadRoute();
		const identity = { handle: "fabio", imageUrl: null };
		mockGetPublicHandleIdentity.mockResolvedValue(identity);

		const data = await route.loader({ params: { handle: "fabio" } });

		expect(redirectMock).not.toHaveBeenCalled();
		expect(data).toEqual({ identity });
	});

	it("throws notFound when server function returns null (handle not live)", async () => {
		const route = await loadRoute();
		mockGetPublicHandleIdentity.mockResolvedValue(null);

		await expect(
			route.loader({ params: { handle: "notfound" } }),
		).rejects.toEqual(expect.objectContaining({ kind: "not-found" }));

		expect(notFoundMock).toHaveBeenCalled();
	});

	it("rethrows operational failures — does not convert them to notFound", async () => {
		const route = await loadRoute();
		const dbError = new Error("DB connection refused");
		mockGetPublicHandleIdentity.mockRejectedValue(dbError);

		await expect(route.loader({ params: { handle: "fabio" } })).rejects.toThrow(
			"DB connection refused",
		);

		// notFound must NOT have been called — error boundary handles this
		expect(notFoundMock).not.toHaveBeenCalled();
	});

	it("calls getPublicHandleIdentity (server fn) — not the admin query directly", async () => {
		const route = await loadRoute();
		const identity = { handle: "fabio", imageUrl: null };
		mockGetPublicHandleIdentity.mockResolvedValue(identity);

		await route.loader({ params: { handle: "fabio" } });

		expect(mockGetPublicHandleIdentity).toHaveBeenCalledWith({
			data: { handle: "fabio" },
		});
	});

	it("does not redirect to /settings or /login when the handle resolves", async () => {
		const route = await loadRoute();
		const identity = {
			handle: "alice",
			imageUrl: "https://example.com/alice.jpg",
		};
		mockGetPublicHandleIdentity.mockResolvedValue(identity);

		await route.loader({ params: { handle: "alice" } });

		expect(redirectMock).not.toHaveBeenCalled();
	});

	it("returns the identity in loader data for the component to consume", async () => {
		const route = await loadRoute();
		const identity = {
			handle: "fabio",
			imageUrl: "https://img.example.com/fabio.jpg",
		};
		mockGetPublicHandleIdentity.mockResolvedValue(identity);

		const data = await route.loader({ params: { handle: "fabio" } });

		expect(data).toEqual({ identity });
	});
});
