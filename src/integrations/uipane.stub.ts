import type { ReactNode } from "react";

const EMPTY_PANELS: ReadonlyArray<{ id: string; name: string }> = [];
const EMPTY_VALUES: Record<string, unknown> = {};
const noop = (): void => {};

export const PaneStore = {
	getPanels: () => EMPTY_PANELS,
	getValues: (_panelId: string) => EMPTY_VALUES,
	updateValue: (
		_panelId: string,
		_path: string,
		_value: number | string | boolean,
	): void => {},
	subscribe: (_panelId: string, _cb: () => void) => noop,
	subscribeGlobal: (_cb: () => void) => noop,
	getSlotNode: (_panelId: string, _path: string): HTMLDivElement | null => null,
	subscribeSlot: (_panelId: string, _path: string, _cb: () => void) => noop,
};

export function useActiveTab(): string | null {
	return null;
}

export function usePane<C extends Record<string, unknown>>(
	_name: string,
	_config: C,
	_options?: { onAction?: (path: string) => void },
): Record<string, never> {
	return {};
}

export function PaneRoot({ children }: { children: ReactNode }): ReactNode {
	return children ?? null;
}

export function PaneSlot({ children }: { children?: ReactNode }): ReactNode {
	return children ?? null;
}

export function initPane(): void {}
