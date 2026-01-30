import "vitest";

interface ResultMatchers<R = unknown> {
	toBeOk(): R;
	toBeErr(): R;
	toHaveOkValue(expected: unknown): R;
	toHaveErrValue(expected: unknown): R;
}

declare module "vitest" {
	interface Assertion<T = unknown> extends ResultMatchers<T> {}
	interface AsymmetricMatchersContaining extends ResultMatchers {}
}
