import { afterEach, describe, expect, it } from "vitest";

describe("dev workflow guard", () => {
	const originalNodeEnv = process.env.NODE_ENV;

	afterEach(() => {
		process.env.NODE_ENV = originalNodeEnv;
	});

	it("throws in production", () => {
		process.env.NODE_ENV = "production";

		function assertDevOnly(): void {
			if (process.env.NODE_ENV === "production") {
				throw new Error(
					"Dev workflow functions are not available outside local development",
				);
			}
		}

		expect(() => assertDevOnly()).toThrow(
			"Dev workflow functions are not available outside local development",
		);
	});

	it("does not throw in development", () => {
		process.env.NODE_ENV = "development";

		function assertDevOnly(): void {
			if (process.env.NODE_ENV === "production") {
				throw new Error(
					"Dev workflow functions are not available outside local development",
				);
			}
		}

		expect(() => assertDevOnly()).not.toThrow();
	});
});
