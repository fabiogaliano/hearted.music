export const EXPECT_LOGIN_RETURN_KEY = "expectLoginReturnUntilMs";
export const EXPECT_LOGIN_RETURN_TTL_MS = 5 * 60_000;

export async function setExpectLoginReturn(
	ttlMs: number = EXPECT_LOGIN_RETURN_TTL_MS,
): Promise<void> {
	const expiresAtMs = Date.now() + ttlMs;
	await chrome.storage.session.set({ [EXPECT_LOGIN_RETURN_KEY]: expiresAtMs });
}

export async function consumeExpectLoginReturnIfValid(): Promise<boolean> {
	const stored = await chrome.storage.session.get(EXPECT_LOGIN_RETURN_KEY);
	const expiresAtMs = stored[EXPECT_LOGIN_RETURN_KEY];
	if (typeof expiresAtMs !== "number") return false;
	await chrome.storage.session.remove(EXPECT_LOGIN_RETURN_KEY);
	return Date.now() < expiresAtMs;
}
