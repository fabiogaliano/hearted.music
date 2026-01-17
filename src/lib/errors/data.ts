/**
 * Database / Supabase error types.
 */

import { TaggedError } from "better-result";
import { z } from "zod";

/** Database operation types for RLS errors */
export const DB_OPERATIONS = z.enum(["select", "insert", "update", "delete"]);
export type DbOperation = z.infer<typeof DB_OPERATIONS>;

// ============================================================================
// Query Errors
// ============================================================================

/** Record not found in database */
export class NotFoundError extends TaggedError("NotFoundError")<{
	entity: string;
	id?: string;
	message: string;
}>() {
	constructor(entity: string, id?: string) {
		super({
			entity,
			id,
			message: id ? `${entity} not found: ${id}` : `${entity} not found`,
		});
	}
}

/** Database constraint violation (unique, foreign key, etc.) */
export class ConstraintError extends TaggedError("ConstraintError")<{
	constraint: string;
	detail?: string;
	message: string;
}>() {
	constructor(constraint: string, detail?: string) {
		super({
			constraint,
			detail,
			message: `Constraint violation: ${constraint}${detail ? ` - ${detail}` : ""}`,
		});
	}
}

/** Row-level security policy blocked the operation */
export class RLSError extends TaggedError("RLSError")<{
	operation: DbOperation;
	table: string;
	message: string;
}>() {
	constructor(operation: DbOperation, table: string) {
		super({
			operation,
			table,
			message: `RLS policy blocked ${operation} on ${table}`,
		});
	}
}

/** Generic database error for unexpected Supabase failures */
export class DatabaseError extends TaggedError("DatabaseError")<{
	code: string;
	message: string;
}>() {}

// ============================================================================
// Job Errors
// ============================================================================

/** Job was cancelled by user or system */
export class JobCancelledError extends TaggedError("JobCancelledError")<{
	jobId: string;
	reason?: string;
	message: string;
}>() {
	constructor(jobId: string, reason?: string) {
		super({
			jobId,
			reason,
			message: `Job ${jobId} cancelled${reason ? `: ${reason}` : ""}`,
		});
	}
}

/** Job exceeded maximum retries */
export class JobRetriesExhaustedError extends TaggedError(
	"JobRetriesExhaustedError",
)<{
	jobId: string;
	attempts: number;
	message: string;
}>() {
	constructor(jobId: string, attempts: number) {
		super({
			jobId,
			attempts,
			message: `Job ${jobId} failed after ${attempts} attempts`,
		});
	}
}

// ============================================================================
// Validation Errors
// ============================================================================

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

// ============================================================================
// Union Types
// ============================================================================

/** All database-related errors */
export type DbError =
	| NotFoundError
	| ConstraintError
	| RLSError
	| DatabaseError;

/** All job pipeline errors */
export type JobError = JobCancelledError | JobRetriesExhaustedError;
