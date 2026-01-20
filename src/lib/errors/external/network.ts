/**
 * Generic network error types.
 */

import { TaggedError } from "better-result";
import { z } from "zod";

/** Reasons for network failures */
export const NetworkErrorReasonSchema = z.enum([
	"timeout",
	"dns",
	"connection",
	"unknown",
]);
export type NetworkErrorReason = z.infer<typeof NetworkErrorReasonSchema>;

/** Network request failed (timeout, DNS, connection refused) */
export class NetworkError extends TaggedError("NetworkError")<{
	reason: NetworkErrorReason;
	message: string;
}>() {
	constructor(reason: NetworkErrorReason) {
		super({
			reason,
			message: `Network error: ${reason}`,
		});
	}
}
