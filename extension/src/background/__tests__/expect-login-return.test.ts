import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	EXPECT_LOGIN_RETURN_KEY,
	EXPECT_LOGIN_RETURN_TTL_MS,
	consumeExpectLoginReturnIfValid,
	setExpectLoginReturn,
} from "../expect-login-return";

type SessionStorage = {
	get: (key: string) => Promise<Record<string, unknown>>;
	set: (items: Record<string, unknown>) => Promise<void>;
	remove: (key: string) => Promise<void>;
};

function makeSessionStorage(): SessionStorage {
	const store = new Map<string, unknown>();
	return {
		get: vi.fn(async (key: string) => {
			const value = store.get(key);
			return value === undefined ? {} : { [key]: value };
		}),
		set: vi.fn(async (items: Record<string, unknown>) => {
			for (const [k, v] of Object.entries(items)) store.set(k, v);
		}),
		remove: vi.fn(async (key: string) => {
			store.delete(key);
		}),
	};
}

const globalAny = globalThis as unknown as { chrome?: unknown };

describe("expect-login-return helpers", () => {
	let session: SessionStorage;

	beforeEach(() => {
		session = makeSessionStorage();
		globalAny.chrome = { storage: { session } };
		vi.useRealTimers();
	});

	it("setExpectLoginReturn stores expiry in session storage with default TTL", async () => {
		const before = Date.now();
		await setExpectLoginReturn();
		const after = Date.now();

		const stored = await session.get(EXPECT_LOGIN_RETURN_KEY);
		const value = stored[EXPECT_LOGIN_RETURN_KEY];
		expect(typeof value).toBe("number");
		if (typeof value === "number") {
			expect(value).toBeGreaterThanOrEqual(before + EXPECT_LOGIN_RETURN_TTL_MS);
			expect(value).toBeLessThanOrEqual(after + EXPECT_LOGIN_RETURN_TTL_MS);
		}
	});

	it("consume returns false when no entry exists", async () => {
		const result = await consumeExpectLoginReturnIfValid();
		expect(result).toBe(false);
		expect(session.remove).not.toHaveBeenCalled();
	});

	it("consume returns true once then false (one-shot)", async () => {
		await setExpectLoginReturn(60_000);
		expect(await consumeExpectLoginReturnIfValid()).toBe(true);
		expect(await consumeExpectLoginReturnIfValid()).toBe(false);
	});

	it("consume returns false and clears when expired", async () => {
		await setExpectLoginReturn(1);
		await new Promise((r) => setTimeout(r, 5));
		expect(await consumeExpectLoginReturnIfValid()).toBe(false);
		const stored = await session.get(EXPECT_LOGIN_RETURN_KEY);
		expect(stored[EXPECT_LOGIN_RETURN_KEY]).toBeUndefined();
	});
});
