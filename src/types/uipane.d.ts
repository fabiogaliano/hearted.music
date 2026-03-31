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

	// PaneConfig is forward-referenced here via interface merging trick:
	// eslint-disable-next-line @typescript-eslint/no-use-before-define
	type FolderControl = {
		type: "folder";
		open?: boolean;
		children: PaneConfig;
	};

	type PaneControl =
		| SliderControl
		| ToggleControl
		| ActionControl
		| FolderControl;

	type PaneConfig = Record<string, PaneControl>;

	// ---- Return value type inference ----
	// Uses structural matching (not generic FolderControl<infer Ch>) so TypeScript
	// can infer the children config through the discriminant `type: "folder"`.

	type PaneControlValue<T> = T extends { type: "slider" }
		? number
		: T extends { type: "toggle" }
			? boolean
			: T extends { type: "folder"; children: infer Ch }
				? { [K in keyof Ch]: PaneControlValue<Ch[K]> }
				: never;

	type PaneValues<C extends PaneConfig> = {
		[K in keyof C]: PaneControlValue<C[K]>;
	};

	// ---- PaneStore ----

	interface Panel {
		id: string;
		name: string;
	}

	interface PaneStoreApi {
		getPanels(): Panel[];
		updateValue(panelId: string, path: string, value: number): void;
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
	export function initPane(): void;
}
