/**
 * Input validation error types.
 */

import { TaggedError } from "better-result";

/** Input validation failed */
export class ValidationError extends TaggedError("ValidationError")<{
	field: string;
	reason: string;
	message: string;
}>() {
	constructor(field: string, reason: string) {
		super({
			field,
			reason,
			message: `Validation failed for ${field}: ${reason}`,
		});
	}
}
