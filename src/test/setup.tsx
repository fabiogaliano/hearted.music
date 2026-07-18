import "@testing-library/jest-dom/vitest";
import "./setup.node";
import { cleanup } from "@testing-library/react";
import type React from "react";
import { afterEach, vi } from "vitest";

afterEach(() => {
	cleanup();
});

Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
});

// jsdom's default origin ("about:blank") is opaque, which leaves
// window.localStorage undefined. Polyfill it with a real in-memory Storage so
// localStorage-backed modules (control-panel saved views, attention
// thresholds) can be tested like a real browser tab.
if (typeof window.localStorage === "undefined") {
	const store = new Map<string, string>();
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: {
			getItem: (key: string) =>
				store.has(key) ? (store.get(key) as string) : null,
			setItem: (key: string, value: string) => {
				store.set(key, String(value));
			},
			removeItem: (key: string) => {
				store.delete(key);
			},
			clear: () => {
				store.clear();
			},
			key: (index: number) => Array.from(store.keys())[index] ?? null,
			get length() {
				return store.size;
			},
		} satisfies Storage,
	});
}

vi.mock("framer-motion", async () => {
	const actual =
		await vi.importActual<typeof import("framer-motion")>("framer-motion");
	return {
		...actual,
		AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
		motion: {
			div: ({
				children,
				...props
			}: React.HTMLAttributes<HTMLDivElement> & {
				children?: React.ReactNode;
			}) => <div {...props}>{children}</div>,
			button: ({
				children,
				...props
			}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
				children?: React.ReactNode;
			}) => <button {...props}>{children}</button>,
			span: ({
				children,
				...props
			}: React.HTMLAttributes<HTMLSpanElement> & {
				children?: React.ReactNode;
			}) => <span {...props}>{children}</span>,
			p: ({
				children,
				...props
			}: React.HTMLAttributes<HTMLParagraphElement> & {
				children?: React.ReactNode;
			}) => <p {...props}>{children}</p>,
			h1: ({
				children,
				...props
			}: React.HTMLAttributes<HTMLHeadingElement> & {
				children?: React.ReactNode;
			}) => <h1 {...props}>{children}</h1>,
			h2: ({
				children,
				...props
			}: React.HTMLAttributes<HTMLHeadingElement> & {
				children?: React.ReactNode;
			}) => <h2 {...props}>{children}</h2>,
		},
		useReducedMotion: () => true,
	};
});

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
		info: vi.fn(),
	},
}));
