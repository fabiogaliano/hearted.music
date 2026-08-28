import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaggeredContent } from "../StaggeredContent";

// The global setup stubs framer's useReducedMotion and motion.* — that stub is
// exactly what hid this bug from tests, so this file uses the real library.
vi.mock("framer-motion", async () => {
	return vi.importActual<typeof import("framer-motion")>("framer-motion");
});

// Regression: for a "Reduce motion" visitor the server rendered per-child
// wrapper divs while the first client render rendered bare children — a
// structural mismatch that made React discard the server tree (#418) on every
// dashboard and match load. The test replays that exact sequence: render as the
// server would, then hydrate in a browser that prefers reduced motion.
const tree = (
	<StaggeredContent className="stack">
		<p>one</p>
		<p>two</p>
	</StaggeredContent>
);

function stubReducedMotion(matches: boolean) {
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: query.includes("prefers-reduced-motion") && matches,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn(),
	}));
}

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
});

afterEach(() => {
	act(() => root?.unmount());
	root = null;
	container.remove();
});

describe("StaggeredContent hydration", () => {
	it("hydrates the server markup cleanly for a reduced-motion visitor, then drops the wrappers", async () => {
		container.innerHTML = renderToString(tree);
		const serverWrappers = container.querySelectorAll(".stack > div").length;
		expect(serverWrappers).toBe(2);

		stubReducedMotion(true);
		const onRecoverableError = vi.fn();
		await act(async () => {
			root = hydrateRoot(container, tree, { onRecoverableError });
		});

		expect(onRecoverableError).not.toHaveBeenCalled();
		expect(container.querySelectorAll(".stack > div")).toHaveLength(0);
		expect(container.querySelectorAll(".stack > p")).toHaveLength(2);
	});
});
