import type { ThemeConfig } from "@/lib/theme/types";
import { vi } from "vitest";

export const mockGoToStep = vi.fn();

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
			getItemProps: (_item: unknown, index: number) => ({
				ref: { current: null },
				tabIndex: index === 0 ? 0 : -1,
				"data-focused": false,
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

export function setupJobProgressMock(state = {}) {
	return {
		useJobProgress: () => state,
	};
}
