/**
 * Database / Supabase error types.
 */

import { TaggedError } from "better-result";
import { z } from "zod";

/** Database operation types for RLS errors */
export const DbOperationSchema = z.enum([
	"select",
	"insert",
	"update",
	"delete",
]);
export type DbOperation = z.infer<typeof DbOperationSchema>;

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

/** All database-related errors */
export type DbError =
	| NotFoundError
	| ConstraintError
	| RLSError
	| DatabaseError;
