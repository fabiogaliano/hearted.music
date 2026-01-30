/**
 * Keyboard Shortcuts System - Type Definitions
 */

/**
 * Shortcut scopes determine when shortcuts are active.
 * Higher-priority scopes (modal > detail > list > global) take precedence
 * when multiple shortcuts match the same key.
 */
export type ShortcutScope =
	| "global" // Always active (lowest priority)
	| "liked-list" // Liked songs list view
	| "liked-detail" // Liked songs detail view
	| "playlists-list" // Playlists list view
	| "playlists-detail" // Playlists detail view
	| "matching" // Sort/matching flow
	| "modal" // Any modal (highest priority)
	| "onboarding-welcome" // Onboarding welcome step
	| "onboarding-colors" // Onboarding color picker step
	| "onboarding-playlists" // Onboarding playlists step
	| "onboarding-ready"; // Onboarding ready/complete step

/**
 * Category for grouping shortcuts in help modal
 */
export type ShortcutCategory =
	| "navigation" // j/k, arrows, page navigation
	| "actions" // Enter, ESC, quick actions
	| "global"; // Go-to shortcuts, help

export interface Shortcut {
	/** Auto-generated if not provided */
	id: string;
	/**
	 * Key or key combination
	 * Examples: 'j', 'escape', 'mod+s', 'shift+?'
	 * 'mod' = cmd on mac, ctrl on windows
	 */
	key: string;
	handler: () => void;
	/** Shown in help modal */
	description: string;
	scope: ShortcutScope;
	/** For grouping in help modal */
	category?: ShortcutCategory;
	/** Default: true */
	enabled?: boolean;
	/** Default: true */
	preventDefault?: boolean;
}

export type ShortcutRegistration = Omit<Shortcut, "id"> & { id?: string };

export interface ShortcutContextValue {
	register: (shortcut: ShortcutRegistration) => string;
	unregister: (id: string) => void;
	activeScopes: ShortcutScope[];
	shortcuts: Shortcut[];
	/** Help modal state (press ? to toggle) */
	isHelpOpen: boolean;
	openHelp: () => void;
	closeHelp: () => void;
}

export type NavigationDirection = "horizontal" | "vertical" | "grid";

export interface ListNavigationOptions<T> {
	items: readonly T[];
	scope: ShortcutScope;
	enabled?: boolean;
	/** Called with (item, index, element) on Space key (for selection/toggle) */
	onSelect?: (item: T, index: number, element: HTMLElement | null) => void;
	getId: (item: T) => string | number;
	onFocusChange?: (index: number, item: T | null) => void;
	onLoadMore?: () => void;
	hasMore?: boolean;
	/** horizontal (h/l), vertical (j/k), or grid (all) */
	direction?: NavigationDirection;
	/** For row-major grids: down/up skips by this amount */
	columns?: number;
	/** For column-major grids: left/right skips by this amount */
	rows?: number;
}

export interface ListNavigationResult<T> {
	focusedIndex: number;
	setFocusedIndex: (index: number) => void;
	getItemProps: (
		item: T,
		index: number,
	) => {
		ref: (el: HTMLElement | null) => void;
		"data-focused": boolean;
		tabIndex: number;
	};
	focusedItem: T | null;
}
