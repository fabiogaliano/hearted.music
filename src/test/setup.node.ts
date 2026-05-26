import { Result } from "better-result";
import { expect } from "vitest";

// Shared custom matchers for better-result. Loaded by every project (node and
// jsdom) since Result is used across the whole codebase, not just UI tests.
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
