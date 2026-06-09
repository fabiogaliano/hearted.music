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

export const getPublicHandleIdentity = createServerFn({ method: "GET" })
	.inputValidator(z.object({ handle: z.string() }))
	.handler(async ({ data }): Promise<PublicHandleIdentity | null> => {
		const result = await getPublicHandleIdentityByHandle(
			data.handle.toLowerCase(),
		);

		if (Result.isError(result)) {
			// Unauthenticated endpoint: keep the operational detail in server logs
			// and throw a generic error so DB internals (table/constraint names)
			// never reach an anonymous caller.
			console.error("[getPublicHandleIdentity] lookup failed:", result.error);
			throw new Error("Failed to load profile");
		}

		return result.value;
	});
