import { afterEach, describe, expect, it, vi } from "vitest";
import { browser } from "../browser";

const g = globalThis as { browser?: unknown; chrome?: unknown };

describe("browser shim", () => {
	afterEach(() => {
		g.browser = undefined;
		g.chrome = undefined;
	});

	it("resolves the global chrome namespace when browser is absent", () => {
		const get = vi.fn().mockResolvedValue({ k: 1 });
		g.chrome = { storage: { local: { get } } };
		expect(browser.storage.local.get).toBe(get);
	});

	it("prefers browser over chrome when both globals exist", () => {
		g.chrome = { runtime: { id: "from-chrome" } };
		g.browser = { runtime: { id: "from-browser" } };
		expect(browser.runtime.id).toBe("from-browser");
	});

	it("re-resolves lazily so a per-test global swap is observed", () => {
		// This is the property the snapshot one-liner in the plan would have lost:
		// expect-login-return.test.ts reassigns globalThis.chrome in beforeEach.
		g.chrome = { runtime: { id: "first" } };
		expect(browser.runtime.id).toBe("first");
		g.chrome = { runtime: { id: "second" } };
		expect(browser.runtime.id).toBe("second");
	});

	it("throws a clear error when neither global is defined", () => {
		expect(() => browser.runtime).toThrow(/No WebExtension API/);
	});
});
