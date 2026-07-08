import type postgres from "postgres";
import {
	type AccountEventPayloadMap,
	type AccountEventType,
	NOTIFY_CHANNEL_INSERTED,
} from "./contract";

export interface WriteAccountEventInput<T extends AccountEventType> {
	accountId: string;
	type: T;
	payload: AccountEventPayloadMap[T];
}

/**
 * Writes a durable account event and wakes the publisher within the caller's transaction.
 *
 * This must be called inside a `sql.begin(async (tx) => { ... })` block.
 * The `publish_id` is left NULL; the publisher process will assign it later.
 * If the transaction rolls back, neither the row nor the NOTIFY are committed.
 */
export async function writeAccountEvent<T extends AccountEventType>(
	tx: postgres.TransactionSql<Record<string, never>>,
	input: WriteAccountEventInput<T>,
): Promise<void> {
	await tx`
		INSERT INTO account_event (account_id, type, payload)
		VALUES (${input.accountId}, ${input.type}, ${tx.json(input.payload)})
	`;

	// Emit empty NOTIFY to wake the publisher. Transactional: only sent on commit.
	await tx`SELECT pg_notify(${NOTIFY_CHANNEL_INSERTED}, '')`;
}
