/**
 * Typed client & server product event contract.
 *
 * Centralizes all PostHog behavioral telemetry definitions, schema versioning,
 * and property validation. Durable business facts (onboarding completion, billing,
 * matching events) live canonically in Supabase; PostHog events represent observed
 * client behavior and are marked with `schema_version: EVENT_SCHEMA_VERSION`.
 */

export const EVENT_SCHEMA_VERSION = 1;

export type AuthProvider = "google" | "credentials" | "spotify";

export type EmptyProperties = Record<string, never>;

export interface ProductEventMap {
	// Authentication & Onboarding
	login_attempted: { provider: AuthProvider };
	login_succeeded: { provider: AuthProvider };
	login_error: { provider: AuthProvider };
	signup_attempted: { provider: AuthProvider };
	signup_succeeded: { provider: AuthProvider };
	signup_error: { provider: AuthProvider };
	user_logged_out: EmptyProperties;
	password_reset_requested: EmptyProperties;
	password_reset_failed: EmptyProperties;
	password_reset_succeeded: EmptyProperties;
	onboarding_completed: { songs: number; playlists: number };

	// Monetization & Billing
	checkout_started: { plan_kind: string; offer: string };
	checkout_cancelled: EmptyProperties;
	free_plan_selected: EmptyProperties;
	billing_portal_opened: EmptyProperties;
	/** @deprecated Legacy client confirmation; billing_activation in DB is canonical. */
	purchase_confirmed: { plan_kind?: string; offer?: string };

	// Match Deck & Interaction Telemetry
	song_dismissed: { song_id: string };
	song_added_to_playlist: {
		playlist_id?: string;
		song_id?: string;
		playlist_name?: string;
		orientation?: string;
	};
	match_suggestion_dismissed: { suggestion_id: string; orientation?: string };
	matching_session_completed: { total_songs: number };
	match_deck_hit: {
		orientation: string;
		source: "active" | "promoted";
		revision: number | null;
		remaining: number;
	};
	match_deck_miss_reason: {
		orientation: string;
		reason: "no_snapshot" | "promotion_incomplete";
	};
	match_deck_materialize_on_read: {
		item_id: string;
		recovered: boolean;
		orientation: string | null;
	};
	match_deck_action: {
		orientation: string;
		action_type: string;
		action_status: string;
		revision: number | null;
	};
	matching_setup_completed: { account_id: string };
	match_intent_set: {
		playlist_id: string;
		has_intent: boolean;
		intent_length: number;
	};
}

export type ProductEventName = keyof ProductEventMap;

export type ProductEventArgs<E extends ProductEventName> =
	ProductEventMap[E] extends EmptyProperties
		? [event: E, properties?: ProductEventMap[E]]
		: [event: E, properties: ProductEventMap[E]];

/**
 * Attaches metadata (schema_version) and formats product event payload structure.
 */
export function formatProductEventPayload<E extends ProductEventName>(
	...args: ProductEventArgs<E>
): Record<string, unknown> {
	const properties = args[1];
	return {
		schema_version: EVENT_SCHEMA_VERSION,
		...(properties ?? {}),
	};
}
