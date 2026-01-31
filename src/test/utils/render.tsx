import { type RenderOptions, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { KeyboardShortcutProvider } from "@/lib/keyboard/KeyboardShortcutProvider";

function TestProviders({ children }: { children: ReactNode }) {
	return <KeyboardShortcutProvider>{children}</KeyboardShortcutProvider>;
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

export { renderWithProviders as render };
export * from "@testing-library/react";
export { userEvent };
