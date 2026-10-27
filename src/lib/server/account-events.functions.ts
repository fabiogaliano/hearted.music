import { createServerFn } from "@tanstack/react-start";
import type { EventTokenClaims } from "@/lib/account-events/contract";
import { signEventToken } from "@/lib/account-events/token";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { withinRateLimit } from "@/lib/platform/rate-limit/rate-limit";

export const getAccountEventsToken = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
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
			ver: session.createdAt.getTime(),
			iat,
			exp,
			jti: crypto.randomUUID(),
		};

		const token = await signEventToken(claims);
		// The client reuses the token until shortly before it lapses, so
		// reconnects don't each cost an app-server mint. A lifetime rather than
		// an instant, because the client's clock may disagree with ours.
		return { token, expiresInMs: (exp - iat) * 1000 };
	});
