import { createServerFn } from "@tanstack/react-start";
import type { EventTokenClaims } from "@/lib/account-events/contract";
import { signEventToken } from "@/lib/account-events/token";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { withinRateLimit } from "@/lib/platform/rate-limit/edge-rate-limit";

export const getAccountEventsToken = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<{ token: string }> => {
		const { session } = context;

		const allowed = await withinRateLimit(
			"ACCOUNT_EVENTS_TOKEN_LIMITER",
			session.id,
		);
		if (!allowed) {
			throw new Error("Rate limit exceeded");
		}

		const iat = Math.floor(Date.now() / 1000);
		const exp = iat + 5 * 60; // 5 minutes

		const claims: EventTokenClaims = {
			sub: session.accountId,
			sid: session.id,
			ver: 1, // Static for now until a revocation version exists
			iat,
			exp,
			jti: crypto.randomUUID(),
		};

		const token = await signEventToken(claims);
		return { token };
	});
