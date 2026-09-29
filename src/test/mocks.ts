import { type Mock, vi } from "vitest";
import type { ThemeConfig } from "@/lib/theme/types";

// Default: successful transition. Tests that need transition_failed override per-case.
export const mockGoToStep = vi
	.fn()
	.mockResolvedValue({ status: "transitioned" });

export const mockTheme: ThemeConfig = {
	name: "Test Theme",
	bg: "#1a1a1a",
	surface: "#2a2a2a",
	surfaceDim: "#151515",
	border: "#333333",
	text: "#ffffff",
	textMuted: "#888888",
	textOnPrimary: "#ffffff",
	primary: "#ff6b6b",
	primaryHover: "#ff8080",
};

export function setupOnboardingNavigationMock() {
	return {
		useOnboardingNavigation: () => ({ goToStep: mockGoToStep }),
	};
}

export function setupListNavigationMock() {
	return {
		useListNavigation: () => ({
			focusedIndex: -1,
			focusedItem: null,
			interactionMode: "idle",
			lastCursorChange: null,
			syncFocusedIndex: () => null,
			focusFocusedItem: () => {},
			getFocusedElement: () => null,
			getElementAtIndex: () => null,
			getItemProps: (_item: unknown, index: number) => ({
				ref: () => {},
				tabIndex: index === 0 ? 0 : -1,
				"data-focused": false,
				"data-nav-engaged": false,
				"data-tab-focused": false,
				onPointerDown: () => {},
				onFocus: () => {},
				onBlur: () => {},
			}),
		}),
	};
}

export function setupShortcutMock() {
	return {
		useShortcut: () => {},
	};
}

export function setupFlagPlaylistsScrollMock() {
	return {
		useFlagPlaylistsScroll: () => {},
	};
}

export function setupRouterLocationMock(search = {}) {
	return {
		useLocation: () => ({ search }),
	};
}

interface InFilterCall {
	table: string;
	col: string;
	batch: string[];
}

interface InFilterQuery {
	table: string;
	col: string | null;
	batch: string[] | null;
}

/**
 * Drives a mocked Supabase `from()` for chunked `.in()` reads. Awaiting the
 * chain resolves to `resolver(query)` so each chunk can answer for its own id
 * batch regardless of which builder method terminates the query; `.in()` and
 * `.eq()` calls are recorded so tests can assert batch shape and that per-query
 * filters are reapplied to every chunk.
 */
export function installInFilterCapturingClient(
	fromMock: Mock,
	resolver: (query: InFilterQuery) => { data: unknown; error: unknown },
): { inCalls: InFilterCall[]; eqCalls: Array<[string, unknown]> } {
	const inCalls: InFilterCall[] = [];
	const eqCalls: Array<[string, unknown]> = [];
	fromMock.mockImplementation((table: string) => {
		const query: InFilterQuery = { table, col: null, batch: null };
		const chain: Record<string, unknown> = {};
		const passthrough = () => chain;
		chain.select = vi.fn(passthrough);
		chain.is = vi.fn(passthrough);
		chain.order = vi.fn(passthrough);
		chain.eq = vi.fn((col: string, value: unknown) => {
			eqCalls.push([col, value]);
			return chain;
		});
		chain.in = vi.fn((col: string, batch: string[]) => {
			query.col = col;
			query.batch = batch;
			inCalls.push({ table, col, batch });
			return chain;
		});
		// biome-ignore lint/suspicious/noThenProperty: the chain must be thenable so awaiting the query resolves to the per-batch response.
		chain.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
			Promise.resolve()
				.then(() => resolver(query))
				.then(onF, onR);
		return chain;
	});
	return { inCalls, eqCalls };
}
