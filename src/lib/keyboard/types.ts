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
	| "liked-detail-analysis" // Analysis layer within detail panel
	| "playlists-list" // Playlists list view
	| "playlists-detail" // Playlists detail view
	| "matching" // Sort/matching flow
	| "modal" // Any modal (highest priority)
	| "onboarding-welcome" // Onboarding welcome step
	| "onboarding-colors" // Onboarding color picker step
	| "onboarding-extension" // Onboarding extension install step
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
export type ListScrollBlock = "nearest" | "center";
export type ListNavigationSource =
	| "keyboard"
	| "pointer"
	| "panel-nav"
	| "url"
	| "programmatic";
export type ListInteractionMode = "idle" | "keyboard" | "pointer";

export interface ListCursorChange {
	index: number;
	source: ListNavigationSource;
	sequence: number;
}

export interface ListItemNavigationProps {
	ref: (el: HTMLElement | null) => void;
	"data-focused": boolean;
	"data-nav-engaged": boolean;
	onPointerDown?: import("react").PointerEventHandler<HTMLElement>;
	onFocus?: import("react").FocusEventHandler<HTMLElement>;
	onBlur?: import("react").FocusEventHandler<HTMLElement>;
	tabIndex: number;
}

export interface ListFocusOptions {
	mode?: ListInteractionMode;
}

export interface ListCursorMoveOptions extends ListFocusOptions {
	source?: ListNavigationSource;
}

export interface ListCursorSyncOptions extends ListFocusOptions {
	focus?: boolean;
	source?: ListNavigationSource;
}

export interface ListNavigationFocusOptions extends ListFocusOptions {
	scroll?: boolean;
}

export interface ListNavigationSyncOptions extends ListCursorSyncOptions {
	scroll?: boolean;
}

export interface ListCursorOptions<T> {
	items: readonly T[];
	enabled?: boolean;
	getId: (item: T) => string | number;
	onFocusChange?: (index: number, item: T | null) => void;
	onCursorChange?: (change: ListCursorChange, item: T | null) => void;
}

export interface ListCursorResult<T> {
	focusedIndex: number;
	focusedItem: T | null;
	interactionMode: ListInteractionMode;
	lastCursorChange: ListCursorChange | null;
	getFocusedElement: () => HTMLElement | null;
	getElementAtIndex: (index: number) => HTMLElement | null;
	moveFocusedIndex: (
		step: number,
		options?: ListCursorMoveOptions,
	) => ListCursorChange | null;
	syncFocusedIndex: (
		index: number,
		options?: ListCursorSyncOptions,
	) => ListCursorChange | null;
	focusIndex: (index: number, options?: ListFocusOptions) => void;
	focusFocusedItem: (options?: ListFocusOptions) => void;
	getItemProps: (item: T, index: number) => ListItemNavigationProps;
}

export interface ListNavigationOptions<T> extends ListCursorOptions<T> {
	scope: ShortcutScope;
	/** Called with (item, index, element) on Space key (for selection/toggle) */
	onSelect?: (item: T, index: number, element: HTMLElement | null) => void;
	onLoadMore?: () => void;
	hasMore?: boolean;
	/** horizontal (h/l), vertical (j/k), or grid (all) */
	direction?: NavigationDirection;
	/** For row-major grids: down/up skips by this amount */
	columns?: number;
	/** For column-major grids: left/right skips by this amount */
	rows?: number;
	/** Scroll alignment for focused item — "center" for Vim scrolloff=999 behavior (default: "nearest") */
	scrollBlock?: ListScrollBlock;
	/** Default: true. Disable when the consumer wants to own scroll timing/policy. */
	autoScroll?: boolean;
}

export interface ListNavigationResult<T>
	extends Pick<
		ListCursorResult<T>,
		| "focusedIndex"
		| "focusedItem"
		| "interactionMode"
		| "lastCursorChange"
		| "getFocusedElement"
		| "getElementAtIndex"
		| "getItemProps"
	> {
	syncFocusedIndex: (
		index: number,
		options?: ListNavigationSyncOptions,
	) => ListCursorChange | null;
	focusFocusedItem: (options?: ListNavigationFocusOptions) => void;
}
