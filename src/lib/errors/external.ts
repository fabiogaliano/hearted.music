/**
 * External service error types (DeepInfra, network, etc.).
 */

import { TaggedError } from "better-result";
import { z } from "zod";

/** Reasons for network failures */
export const NETWORK_ERROR_REASONS = z.enum(["timeout", "dns", "connection", "unknown"]);
export type NetworkErrorReason = z.infer<typeof NETWORK_ERROR_REASONS>;

/** DeepInfra API error */
export class DeepInfraError extends TaggedError("DeepInfraError")<{
	status: number;
	message: string;
}>() {}

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
