import { Result } from "better-result";
import { z } from "zod";

const CURRENT_BRIDGE_SCHEMA_VERSION = 2;

const BridgeEventKindSchema = z.enum([
	"pack_fulfilled",
	"unlimited_activated",
	"pack_reversed",
	"unlimited_period_reversed",
	"subscription_deactivated",
]);

const BridgeEnvelopeSchema = z
	.object({
		stripe_event_id: z.string().min(1),
		event_kind: BridgeEventKindSchema,
		schema_version: z.number().int().positive(),
	})
	.passthrough();

const PackFulfilledSchema = z
	.object({
		stripe_event_id: z.string().min(1),
		event_kind: z.literal("pack_fulfilled"),
		schema_version: z.literal(CURRENT_BRIDGE_SCHEMA_VERSION),
		account_id: z.string().uuid(),
		bonus_unlocked_song_ids: z.array(z.string().uuid()),
	})
	.transform(({ schema_version: _schemaVersion, ...payload }) => payload);

const UnlimitedActivatedSchema = z
	.object({
		stripe_event_id: z.string().min(1),
		event_kind: z.literal("unlimited_activated"),
		schema_version: z.literal(CURRENT_BRIDGE_SCHEMA_VERSION),
		account_id: z.string().uuid(),
		stripe_subscription_id: z.string().min(1),
		subscription_period_end: z.string().min(1),
	})
	.transform(({ schema_version: _schemaVersion, ...payload }) => payload);

const PackReversedSchema = z
	.object({
		stripe_event_id: z.string().min(1),
		event_kind: z.literal("pack_reversed"),
		schema_version: z.literal(CURRENT_BRIDGE_SCHEMA_VERSION),
		account_id: z.string().uuid(),
		pack_stripe_event_id: z.string().min(1),
		reason: z.enum(["refund", "chargeback"]),
		access_removed: z.boolean(),
	})
	.transform(({ schema_version: _schemaVersion, ...payload }) => payload);

const UnlimitedPeriodReversedSchema = z
	.object({
		stripe_event_id: z.string().min(1),
		event_kind: z.literal("unlimited_period_reversed"),
		schema_version: z.literal(CURRENT_BRIDGE_SCHEMA_VERSION),
		account_id: z.string().uuid(),
		stripe_subscription_id: z.string().min(1),
		subscription_period_end: z.string().min(1),
		reason: z.enum(["refund", "chargeback"]),
		access_removed: z.boolean(),
	})
	.transform(({ schema_version: _schemaVersion, ...payload }) => payload);

const SubscriptionDeactivatedSchema = z
	.object({
		stripe_event_id: z.string().min(1),
		event_kind: z.literal("subscription_deactivated"),
		schema_version: z.literal(CURRENT_BRIDGE_SCHEMA_VERSION),
		account_id: z.string().uuid(),
	})
	.transform(({ schema_version: _schemaVersion, ...payload }) => payload);

export type BridgePayload =
	| z.output<typeof PackFulfilledSchema>
	| z.output<typeof UnlimitedActivatedSchema>
	| z.output<typeof PackReversedSchema>
	| z.output<typeof UnlimitedPeriodReversedSchema>
	| z.output<typeof SubscriptionDeactivatedSchema>;

export type BridgePayloadParseError =
	| { kind: "invalid_payload" }
	| {
			kind: "unsupported_schema_version";
			eventKind: z.infer<typeof BridgeEventKindSchema>;
			schemaVersion: number;
	  };

function invalidPayloadResult<T>(): Result<T, BridgePayloadParseError> {
	return Result.err({ kind: "invalid_payload" });
}

function parseWithSchema<T extends BridgePayload>(
	schema: z.ZodType<T>,
	raw: unknown,
): Result<T, BridgePayloadParseError> {
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		return invalidPayloadResult<T>();
	}
	return Result.ok(parsed.data);
}

export function parseBridgePayload(
	raw: unknown,
): Result<BridgePayload, BridgePayloadParseError> {
	const envelope = BridgeEnvelopeSchema.safeParse(raw);
	if (!envelope.success) {
		return invalidPayloadResult<BridgePayload>();
	}

	const { event_kind: eventKind, schema_version: schemaVersion } =
		envelope.data;

	if (schemaVersion !== CURRENT_BRIDGE_SCHEMA_VERSION) {
		return Result.err({
			kind: "unsupported_schema_version",
			eventKind,
			schemaVersion,
		});
	}

	switch (eventKind) {
		case "pack_fulfilled":
			return parseWithSchema(PackFulfilledSchema, raw);
		case "unlimited_activated":
			return parseWithSchema(UnlimitedActivatedSchema, raw);
		case "pack_reversed":
			return parseWithSchema(PackReversedSchema, raw);
		case "unlimited_period_reversed":
			return parseWithSchema(UnlimitedPeriodReversedSchema, raw);
		case "subscription_deactivated":
			return parseWithSchema(SubscriptionDeactivatedSchema, raw);
	}
}
