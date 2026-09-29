import {
	type AnyRootRoute,
	type AnyRoute,
	createMemoryHistory,
	createRootRouteWithContext,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { act, type RenderOptions, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactElement, type ReactNode, useSyncExternalStore } from "react";
import { vi } from "vitest";
import { KeyboardShortcutProvider } from "@/lib/keyboard/KeyboardShortcutProvider";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";

function TestProviders({ children }: { children: ReactNode }) {
	return (
		<ThemeHueProvider>
			<KeyboardShortcutProvider>{children}</KeyboardShortcutProvider>
		</ThemeHueProvider>
	);
}

function renderWithProviders(
	ui: ReactElement,
	options?: Omit<RenderOptions, "wrapper">,
) {
	const renderResult = render(ui, { wrapper: TestProviders, ...options });
	return {
		user: userEvent.setup(),
		...renderResult,
	};
}

interface MemoryRouterOptions {
	url?: string;
	/** Real routes to mount under the test root; `ui` must render an `<Outlet />` to show them. */
	routes?: (root: AnyRootRoute) => AnyRoute[];
	context?: Record<string, unknown>;
}

/**
 * Renders `ui` as the root layout of a real TanStack memory router, so real
 * `Link`/`useNavigate`/`useLocation` work and tests assert the resulting
 * `router.state.location` or rendered hrefs instead of stubbing the router.
 */
async function renderWithRouter(
	ui: ReactElement,
	{ url = "/", routes, context = {} }: MemoryRouterOptions = {},
) {
	// The router restores scroll on navigation; jsdom has no scrollTo.
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	// `rerender` must swap the layout without replacing RouterProvider, which
	// would drop the router context; a tiny store lets the root pick it up.
	let currentUi = ui;
	const listeners = new Set<() => void>();
	const subscribe = (listener: () => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};
	const root = createRootRouteWithContext<Record<string, unknown>>()({
		component: () => useSyncExternalStore(subscribe, () => currentUi),
	});
	// Without a catch-all, every URL outside `routes` resolves to notFound and
	// the router warns instead of rendering the layout.
	const catchAll = createRoute({ getParentRoute: () => root, path: "$" });
	const history = createMemoryHistory({ initialEntries: [url] });
	const router = createRouter({
		routeTree: root.addChildren([...(routes?.(root) ?? []), catchAll]),
		history,
		context,
	});
	// Resolving matches before mount makes the first render synchronous, so
	// tests can query immediately like a plain render.
	await act(() => router.load());
	const result = renderWithProviders(<RouterProvider router={router} />);
	const rerender = (nextUi: ReactElement) =>
		act(() => {
			currentUi = nextUi;
			for (const listener of listeners) listener();
		});
	return { ...result, rerender, router, history };
}

export * from "@testing-library/react";
export { renderWithProviders as render, renderWithRouter, userEvent };
