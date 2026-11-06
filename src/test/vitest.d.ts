import "vite-plus/test";

interface ResultMatchers<R = unknown> {
	toBeOk(): R;
	toBeErr(): R;
	toHaveOkValue(expected: unknown): R;
	toHaveErrValue(expected: unknown): R;
}

declare module "vitest" {
	interface Assertion<R, T> extends ResultMatchers<R> {
		// Vitest's browser matcher types load with vitest/config and narrow this
		// to string | number, but jsdom suites run @testing-library/jest-dom's
		// matcher, which also accepts a RegExp. jest-dom's own augmentation
		// still targets Vitest 4's single-parameter Assertion, so it can't win.
		toHaveTextContent(
			text?: string | number | RegExp,
			options?: { normalizeWhitespace: boolean },
		): R;
	}
	interface AsymmetricMatchersContaining extends ResultMatchers {}
}
