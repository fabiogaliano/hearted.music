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
			throw result.error;
		}

		return result.value;
	});
