/**
 * Minimal type declarations for uipane (github:fabiogaliano/uipane).
 * The package ships no types — these cover the API surface used in DevWorkflowPanel.
 */
declare module "uipane" {
	import type { ReactNode } from "react";

	// ---- Config schema (discriminated union) ----

	type SliderControl = {
		type: "slider";
		value: number;
		min: number;
		max: number;
		step?: number;
	};

	type ToggleControl = {
		type: "toggle";
		value: boolean;
	};

	type ActionControl = {
		type: "action";
		label?: string;
	};

	type SlotControl = {
		type: "slot";
		label?: string;
	};

	// PaneConfig is forward-referenced here via interface merging trick:
	// eslint-disable-next-line @typescript-eslint/no-use-before-define
	type FolderControl = {
		type: "folder";
		open?: boolean;
		children: PaneConfig;
	};

	type SelectOption = string | { value: string; label: string };

	type SelectControl = {
		type: "select";
		value?: string;
		options: SelectOption[];
	};

	type PaneControl =
		| SliderControl
		| ToggleControl
		| ActionControl
		| SlotControl
		| SelectControl
		| FolderControl;

	type PaneConfig = Record<string, PaneControl>;

	// ---- Return value type inference ----

	type PaneControlValue<T> = T extends { type: "slider" }
		? number
		: T extends { type: "toggle" }
			? boolean
			: T extends { type: "select" }
				? string
				: T extends { type: "folder"; children: infer Ch }
					? { [K in keyof Ch]: PaneControlValue<Ch[K]> }
					: never;

	type PaneValues<C extends PaneConfig> = {
		[K in keyof C as C[K] extends ActionControl | SlotControl
			? never
			: K]: PaneControlValue<C[K]>;
	};

	// ---- PaneStore ----

	interface Panel {
		id: string;
		name: string;
	}

	interface PaneStoreApi {
		getPanels(): Panel[];
		getValues(panelId: string): Record<string, unknown>;
		updateValue(
			panelId: string,
			path: string,
			value: number | string | boolean,
		): void;
		subscribe(panelId: string, cb: () => void): () => void;
		subscribeGlobal(cb: () => void): () => void;
		getSlotNode(panelId: string, path: string): HTMLDivElement | null;
		subscribeSlot(panelId: string, path: string, cb: () => void): () => void;
	}

	export const PaneStore: PaneStoreApi;

	// ---- Hooks ----

	export function useActiveTab(): string | null;

	export function usePane<C extends PaneConfig>(
		name: string,
		config: C,
		options?: { onAction?: (path: string) => void },
	): PaneValues<C>;

	// ---- Components ----

	export function PaneRoot(props: { children: ReactNode }): JSX.Element;
	export function PaneSlot(props: {
		panel: string;
		path: string;
		children?: ReactNode;
	}): ReactNode;
	export function initPane(): void;
}
