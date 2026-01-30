/**
 * Dashboard feature error types.
 */

import { TaggedError } from "better-result";
import type { DbError } from "../database";

/** All possible dashboard error causes */
export type DashboardErrorCause = DbError | Error;

/** Dashboard operation failed */
export class DashboardError extends TaggedError("DashboardError")<{
	operation: string;
	cause: DashboardErrorCause;
	message: string;
}>() {
	constructor(operation: string, cause: DashboardErrorCause) {
		const tag = "_tag" in cause ? cause._tag : cause.name;
		super({
			operation,
			cause,
			message: `Dashboard operation failed: ${operation} (${tag})`,
		});
	}
}
