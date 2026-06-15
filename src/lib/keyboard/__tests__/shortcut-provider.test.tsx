import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KeyboardShortcutProvider } from "@/lib/keyboard/KeyboardShortcutProvider";
import { useShortcut } from "@/lib/keyboard/useShortcut";

function ShortcutHarness({ onTrigger }: { onTrigger: () => void }) {
	useShortcut({
		key: "l",
		handler: onTrigger,
		description: "test shortcut",
		scope: "global",
		category: "navigation",
	});
	return <input data-testid="real-input" />;
}

function mount(onTrigger: () => void) {
	return render(
		<KeyboardShortcutProvider>
			<ShortcutHarness onTrigger={onTrigger} />
		</KeyboardShortcutProvider>,
	);
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("KeyboardShortcutProvider focus gating", () => {
	it("fires a shortcut for a bare keystroke on the document", () => {
		const onTrigger = vi.fn();
		mount(onTrigger);

		fireEvent.keyDown(window, { key: "l" });

		expect(onTrigger).toHaveBeenCalledTimes(1);
	});

	it("ignores keystrokes typed into a real input field", () => {
		const onTrigger = vi.fn();
		const { getByTestId } = mount(onTrigger);

		fireEvent.keyDown(getByTestId("real-input"), { key: "l" });

		expect(onTrigger).not.toHaveBeenCalled();
	});

	it("ignores keystrokes typed inside a shadow-DOM widget (UserJot panel)", () => {
		const onTrigger = vi.fn();
		mount(onTrigger);

		// Re-create the UserJot shape: a host whose UI lives in a shadow root. The
		// event retargets to the host, so only composedPath() can see the textarea.
		const host = document.createElement("div");
		const shadow = host.attachShadow({ mode: "open" });
		const textarea = document.createElement("textarea");
		shadow.appendChild(textarea);
		document.body.appendChild(host);

		textarea.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "l",
				bubbles: true,
				composed: true,
			}),
		);

		expect(onTrigger).not.toHaveBeenCalled();

		host.remove();
	});
});
