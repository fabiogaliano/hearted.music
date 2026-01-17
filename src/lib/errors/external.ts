/**
 * External service error types (DeepInfra, network, etc.).
 */

import { TaggedError } from "better-result";

/** DeepInfra API error */
export class DeepInfraError extends TaggedError("DeepInfraError")<{
	status: number;
	message: string;
}>() {}

/** Network request failed (timeout, DNS, connection refused) */
export class NetworkError extends TaggedError("NetworkError")<{
	reason: "timeout" | "dns" | "connection" | "unknown";
	message: string;
}>() {
	constructor(reason: "timeout" | "dns" | "connection" | "unknown") {
		super({
			reason,
			message: `Network error: ${reason}`,
		});
	}
}
