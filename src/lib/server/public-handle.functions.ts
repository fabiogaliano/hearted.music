/**
 * Public server function for the /@handle route.
 *
 * No auth middleware — this endpoint is intentionally unauthenticated.
 * Canonicalization is lowercase-only; all other repair/validation is the
 * caller's responsibility so malformed-but-lowercase handles simply miss
 * the lookup and the route surfaces notFound().
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import {
	getPublicHandleIdentityByHandle,
	type PublicHandleIdentity,
} from "@/lib/domains/library/accounts/queries";
import { captureServerError } from "@/lib/observability/capture-server-error";

// .max() is a transport guard only — it bounds the payload on this
// unauthenticated endpoint (hit on every /@handle load) so an anonymous caller
// can't ship multi-megabyte strings into the DB lookup. It is NOT handle repair:
// canonicalization stays lowercase-only per this module's contract, and any
// well-formed handle is ≤30 chars (account_handle_format_check), so 100 is pure
// headroom that never affects a real lookup.
export const getPublicHandleIdentity = createServerFn({ method: "GET" })
	.inputValidator(z.object({ handle: z.string().max(100) }))
	.handler(async ({ data }): Promise<PublicHandleIdentity | null> => {
		const result = await getPublicHandleIdentityByHandle(
			data.handle.toLowerCase(),
		);

		if (Result.isError(result)) {
			// Unauthenticated endpoint: keep the operational detail in server logs
			// and throw a generic error so DB internals (table/constraint names)
			// never reach an anonymous caller.
			console.error("[getPublicHandleIdentity] lookup failed:", result.error);
			// console.error never reaches Sentry with enableLogs:false; capture explicitly
			captureServerError(result.error, {
				area: "public_handle",
				operation: "get_public_handle_identity",
				extra: { handle: data.handle },
			});
			throw new Error("Failed to load profile", { cause: result.error });
		}

		return result.value;
	});
