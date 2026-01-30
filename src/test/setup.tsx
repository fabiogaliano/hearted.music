import "@testing-library/jest-dom/vitest";
import { Result } from "better-result";
import type React from "react";
import { expect, vi } from "vitest";

expect.extend({
	toBeOk(received: Result<unknown, unknown>) {
		const pass = Result.isOk(received);
		return {
			pass,
			message: () =>
				received.match({
					ok: () => "expected Result not to be Ok",
					err: (e) => `expected Result to be Ok, got Err: ${JSON.stringify(e)}`,
				}),
		};
	},
	toBeErr(received: Result<unknown, unknown>) {
		const pass = Result.isError(received);
		return {
			pass,
			message: () =>
				received.match({
					ok: (v) => `expected Result to be Err, got Ok: ${JSON.stringify(v)}`,
					err: () => "expected Result not to be Err",
				}),
		};
	},
	toHaveOkValue(received: Result<unknown, unknown>, expected: unknown) {
		return received.match({
			ok: (value) => ({
				pass: this.equals(value, expected),
				message: () =>
					this.equals(value, expected)
						? `expected Result.value not to equal ${JSON.stringify(expected)}`
						: `expected Result.value ${JSON.stringify(value)} to equal ${JSON.stringify(expected)}`,
			}),
			err: (error) => ({
				pass: false,
				message: () =>
					`expected Result to be Ok with value, got Err: ${JSON.stringify(error)}`,
			}),
		});
	},
	toHaveErrValue(received: Result<unknown, unknown>, expected: unknown) {
		return received.match({
			ok: (value) => ({
				pass: false,
				message: () =>
					`expected Result to be Err, got Ok: ${JSON.stringify(value)}`,
			}),
			err: (error) => ({
				pass: this.equals(error, expected),
				message: () =>
					this.equals(error, expected)
						? `expected Result.error not to equal ${JSON.stringify(expected)}`
						: `expected Result.error ${JSON.stringify(error)} to equal ${JSON.stringify(expected)}`,
			}),
		});
	},
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
			}: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
				<div {...props}>{children}</div>
			),
			button: ({
				children,
				...props
			}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
				children?: React.ReactNode;
			}) => <button {...props}>{children}</button>,
			span: ({
				children,
				...props
			}: React.HTMLAttributes<HTMLSpanElement> & { children?: React.ReactNode }) => (
				<span {...props}>{children}</span>
			),
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
