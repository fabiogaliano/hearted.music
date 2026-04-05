export type Json =
	| string
	| number
	| boolean
	| null
	| { [key: string]: Json | undefined }
	| Json[];

export type Database = {
	graphql_public: {
		Tables: {
			[_ in never]: never;
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			graphql: {
				Args: {
					extensions?: Json;
					operationName?: string;
					query?: string;
					variables?: Json;
				};
				Returns: Json;
			};
		};
		Enums: {
			[_ in never]: never;
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
	public: {
		Tables: {
			account: {
				Row: {
					better_auth_user_id: string | null;
					created_at: string;
					display_name: string | null;
					email: string | null;
					id: string;
					image_url: string | null;
					spotify_id: string | null;
					updated_at: string;
				};
				Insert: {
					better_auth_user_id?: string | null;
					created_at?: string;
					display_name?: string | null;
					email?: string | null;
					id?: string;
					image_url?: string | null;
					spotify_id?: string | null;
					updated_at?: string;
				};
				Update: {
					better_auth_user_id?: string | null;
					created_at?: string;
					display_name?: string | null;
					email?: string | null;
					id?: string;
					image_url?: string | null;
					spotify_id?: string | null;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "account_better_auth_user_id_fkey";
						columns: ["better_auth_user_id"];
						isOneToOne: true;
						referencedRelation: "user";
						referencedColumns: ["id"];
					},
				];
			};
			account_billing: {
				Row: {
					account_id: string;
					cancel_at_period_end: boolean;
					created_at: string;
					credit_balance: number;
					plan: string;
					stripe_customer_id: string | null;
					stripe_subscription_id: string | null;
					subscription_period_end: string | null;
					subscription_status: string;
					unlimited_access_source: string | null;
					updated_at: string;
				};
				Insert: {
					account_id: string;
					cancel_at_period_end?: boolean;
					created_at?: string;
					credit_balance?: number;
					plan?: string;
					stripe_customer_id?: string | null;
					stripe_subscription_id?: string | null;
					subscription_period_end?: string | null;
					subscription_status?: string;
					unlimited_access_source?: string | null;
					updated_at?: string;
				};
				Update: {
					account_id?: string;
					cancel_at_period_end?: boolean;
					created_at?: string;
					credit_balance?: number;
					plan?: string;
					stripe_customer_id?: string | null;
					stripe_subscription_id?: string | null;
					subscription_period_end?: string | null;
					subscription_status?: string;
					unlimited_access_source?: string | null;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "account_billing_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: true;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
			};
			account_song_unlock: {
				Row: {
					account_id: string;
					created_at: string;
					granted_stripe_event_id: string | null;
					granted_stripe_subscription_id: string | null;
					granted_subscription_period_end: string | null;
					id: string;
					revoked_at: string | null;
					revoked_reason: string | null;
					revoked_stripe_event_id: string | null;
					song_id: string;
					source: string;
				};
				Insert: {
					account_id: string;
					created_at?: string;
					granted_stripe_event_id?: string | null;
					granted_stripe_subscription_id?: string | null;
					granted_subscription_period_end?: string | null;
					id?: string;
					revoked_at?: string | null;
					revoked_reason?: string | null;
					revoked_stripe_event_id?: string | null;
					song_id: string;
					source: string;
				};
				Update: {
					account_id?: string;
					created_at?: string;
					granted_stripe_event_id?: string | null;
					granted_stripe_subscription_id?: string | null;
					granted_subscription_period_end?: string | null;
					id?: string;
					revoked_at?: string | null;
					revoked_reason?: string | null;
					revoked_stripe_event_id?: string | null;
					song_id?: string;
					source?: string;
				};
				Relationships: [
					{
						foreignKeyName: "account_song_unlock_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "account_song_unlock_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "song";
						referencedColumns: ["id"];
					},
				];
			};
			api_token: {
				Row: {
					account_id: string;
					created_at: string;
					id: string;
					last_used_at: string | null;
					name: string | null;
					revoked_at: string | null;
					token_hash: string;
				};
				Insert: {
					account_id: string;
					created_at?: string;
					id?: string;
					last_used_at?: string | null;
					name?: string | null;
					revoked_at?: string | null;
					token_hash: string;
				};
				Update: {
					account_id?: string;
					created_at?: string;
					id?: string;
					last_used_at?: string | null;
					name?: string | null;
					revoked_at?: string | null;
					token_hash?: string;
				};
				Relationships: [
					{
						foreignKeyName: "api_token_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
			};
			artist: {
				Row: {
					created_at: string;
					image_url: string | null;
					name: string;
					spotify_id: string;
					updated_at: string;
				};
				Insert: {
					created_at?: string;
					image_url?: string | null;
					name: string;
					spotify_id: string;
					updated_at?: string;
				};
				Update: {
					created_at?: string;
					image_url?: string | null;
					name?: string;
					spotify_id?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			billing_activation: {
				Row: {
					account_id: string;
					created_at: string;
					id: string;
					kind: string;
					stripe_event_id: string;
					stripe_subscription_id: string;
					subscription_period_end: string;
				};
				Insert: {
					account_id: string;
					created_at?: string;
					id?: string;
					kind: string;
					stripe_event_id: string;
					stripe_subscription_id: string;
					subscription_period_end: string;
				};
				Update: {
					account_id?: string;
					created_at?: string;
					id?: string;
					kind?: string;
					stripe_event_id?: string;
					stripe_subscription_id?: string;
					subscription_period_end?: string;
				};
				Relationships: [
					{
						foreignKeyName: "billing_activation_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
			};
			billing_bridge_event: {
				Row: {
					event_kind: string;
					processed_at: string;
					stripe_event_id: string;
				};
				Insert: {
					event_kind: string;
					processed_at?: string;
					stripe_event_id: string;
				};
				Update: {
					event_kind?: string;
					processed_at?: string;
					stripe_event_id?: string;
				};
				Relationships: [];
			};
			billing_webhook_event: {
				Row: {
					created_at: string;
					error_message: string | null;
					processed_at: string | null;
					status: string;
					stripe_event_id: string;
					updated_at: string;
				};
				Insert: {
					created_at?: string;
					error_message?: string | null;
					processed_at?: string | null;
					status: string;
					stripe_event_id: string;
					updated_at?: string;
				};
				Update: {
					created_at?: string;
					error_message?: string | null;
					processed_at?: string | null;
					status?: string;
					stripe_event_id?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			credit_transaction: {
				Row: {
					account_id: string;
					amount: number;
					balance_after: number;
					created_at: string;
					id: string;
					metadata: Json;
					reason: string;
					stripe_event_id: string | null;
				};
				Insert: {
					account_id: string;
					amount: number;
					balance_after: number;
					created_at?: string;
					id?: string;
					metadata?: Json;
					reason: string;
					stripe_event_id?: string | null;
				};
				Update: {
					account_id?: string;
					amount?: number;
					balance_after?: number;
					created_at?: string;
					id?: string;
					metadata?: Json;
					reason?: string;
					stripe_event_id?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "credit_transaction_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
			};
			item_status: {
				Row: {
					account_id: string;
					created_at: string;
					id: string;
					is_new: boolean;
					item_id: string;
					item_type: Database["public"]["Enums"]["item_type"];
					updated_at: string;
					viewed_at: string | null;
				};
				Insert: {
					account_id: string;
					created_at?: string;
					id?: string;
					is_new?: boolean;
					item_id: string;
					item_type: Database["public"]["Enums"]["item_type"];
					updated_at?: string;
					viewed_at?: string | null;
				};
				Update: {
					account_id?: string;
					created_at?: string;
					id?: string;
					is_new?: boolean;
					item_id?: string;
					item_type?: Database["public"]["Enums"]["item_type"];
					updated_at?: string;
					viewed_at?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "item_status_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
			};
			job: {
				Row: {
					account_id: string;
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error: string | null;
					heartbeat_at: string | null;
					id: string;
					max_attempts: number;
					progress: Json | null;
					queue_priority: number | null;
					satisfies_requested_at: string | null;
					started_at: string | null;
					status: Database["public"]["Enums"]["job_status"];
					type: Database["public"]["Enums"]["job_type"];
					updated_at: string;
				};
				Insert: {
					account_id: string;
					attempts?: number;
					completed_at?: string | null;
					created_at?: string;
					error?: string | null;
					heartbeat_at?: string | null;
					id?: string;
					max_attempts?: number;
					progress?: Json | null;
					queue_priority?: number | null;
					satisfies_requested_at?: string | null;
					started_at?: string | null;
					status?: Database["public"]["Enums"]["job_status"];
					type: Database["public"]["Enums"]["job_type"];
					updated_at?: string;
				};
				Update: {
					account_id?: string;
					attempts?: number;
					completed_at?: string | null;
					created_at?: string;
					error?: string | null;
					heartbeat_at?: string | null;
					id?: string;
					max_attempts?: number;
					progress?: Json | null;
					queue_priority?: number | null;
					satisfies_requested_at?: string | null;
					started_at?: string | null;
					status?: Database["public"]["Enums"]["job_status"];
					type?: Database["public"]["Enums"]["job_type"];
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "job_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
			};
			job_execution_measurement: {
				Row: {
					account_id: string;
					attempt_number: number;
					created_at: string;
					details: Json | null;
					finished_at: string | null;
					id: string;
					job_id: string;
					outcome: string;
					queue_priority: number | null;
					queued_at: string | null;
					started_at: string | null;
					workflow: string;
				};
				Insert: {
					account_id: string;
					attempt_number?: number;
					created_at?: string;
					details?: Json | null;
					finished_at?: string | null;
					id?: string;
					job_id: string;
					outcome: string;
					queue_priority?: number | null;
					queued_at?: string | null;
					started_at?: string | null;
					workflow: string;
				};
				Update: {
					account_id?: string;
					attempt_number?: number;
					created_at?: string;
					details?: Json | null;
					finished_at?: string | null;
					id?: string;
					job_id?: string;
					outcome?: string;
					queue_priority?: number | null;
					queued_at?: string | null;
					started_at?: string | null;
					workflow?: string;
				};
				Relationships: [
					{
						foreignKeyName: "job_execution_measurement_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "job_execution_measurement_job_id_fkey";
						columns: ["job_id"];
						isOneToOne: false;
						referencedRelation: "job";
						referencedColumns: ["id"];
					},
				];
			};
			job_failure: {
				Row: {
					created_at: string;
					error_message: string | null;
					error_type: string | null;
					id: string;
					item_id: string;
					item_type: Database["public"]["Enums"]["item_type"];
					job_id: string;
				};
				Insert: {
					created_at?: string;
					error_message?: string | null;
					error_type?: string | null;
					id?: string;
					item_id: string;
					item_type: Database["public"]["Enums"]["item_type"];
					job_id: string;
				};
				Update: {
					created_at?: string;
					error_message?: string | null;
					error_type?: string | null;
					id?: string;
					item_id?: string;
					item_type?: Database["public"]["Enums"]["item_type"];
					job_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "job_failure_job_id_fkey";
						columns: ["job_id"];
						isOneToOne: false;
						referencedRelation: "job";
						referencedColumns: ["id"];
					},
				];
			};
			library_processing_state: {
				Row: {
					account_id: string;
					created_at: string;
					enrichment_active_job_id: string | null;
					enrichment_requested_at: string | null;
					enrichment_settled_at: string | null;
					id: string;
					match_snapshot_refresh_active_job_id: string | null;
					match_snapshot_refresh_requested_at: string | null;
					match_snapshot_refresh_settled_at: string | null;
					updated_at: string;
				};
				Insert: {
					account_id: string;
					created_at?: string;
					enrichment_active_job_id?: string | null;
					enrichment_requested_at?: string | null;
					enrichment_settled_at?: string | null;
					id?: string;
					match_snapshot_refresh_active_job_id?: string | null;
					match_snapshot_refresh_requested_at?: string | null;
					match_snapshot_refresh_settled_at?: string | null;
					updated_at?: string;
				};
				Update: {
					account_id?: string;
					created_at?: string;
					enrichment_active_job_id?: string | null;
					enrichment_requested_at?: string | null;
					enrichment_settled_at?: string | null;
					id?: string;
					match_snapshot_refresh_active_job_id?: string | null;
					match_snapshot_refresh_requested_at?: string | null;
					match_snapshot_refresh_settled_at?: string | null;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "library_processing_state_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: true;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "library_processing_state_enrichment_active_job_id_fkey";
						columns: ["enrichment_active_job_id"];
						isOneToOne: false;
						referencedRelation: "job";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "library_processing_state_match_snapshot_refresh_active_job_fkey";
						columns: ["match_snapshot_refresh_active_job_id"];
						isOneToOne: false;
						referencedRelation: "job";
						referencedColumns: ["id"];
					},
				];
			};
			liked_song: {
				Row: {
					account_id: string;
					created_at: string;
					id: string;
					liked_at: string;
					song_id: string;
					unliked_at: string | null;
					updated_at: string;
				};
				Insert: {
					account_id: string;
					created_at?: string;
					id?: string;
					liked_at: string;
					song_id: string;
					unliked_at?: string | null;
					updated_at?: string;
				};
				Update: {
					account_id?: string;
					created_at?: string;
					id?: string;
					liked_at?: string;
					song_id?: string;
					unliked_at?: string | null;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "liked_song_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "liked_song_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "song";
						referencedColumns: ["id"];
					},
				];
			};
			match_decision: {
				Row: {
					account_id: string;
					created_at: string;
					decided_at: string;
					decision: string;
					id: string;
					playlist_id: string;
					song_id: string;
				};
				Insert: {
					account_id: string;
					created_at?: string;
					decided_at?: string;
					decision: string;
					id?: string;
					playlist_id: string;
					song_id: string;
				};
				Update: {
					account_id?: string;
					created_at?: string;
					decided_at?: string;
					decision?: string;
					id?: string;
					playlist_id?: string;
					song_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "match_decision_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_decision_playlist_id_fkey";
						columns: ["playlist_id"];
						isOneToOne: false;
						referencedRelation: "playlist";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_decision_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "song";
						referencedColumns: ["id"];
					},
				];
			};
			match_result: {
				Row: {
					created_at: string;
					factors: Json;
					id: string;
					playlist_id: string;
					rank: number | null;
					score: number;
					snapshot_id: string;
					song_id: string;
				};
				Insert: {
					created_at?: string;
					factors?: Json;
					id?: string;
					playlist_id: string;
					rank?: number | null;
					score: number;
					snapshot_id: string;
					song_id: string;
				};
				Update: {
					created_at?: string;
					factors?: Json;
					id?: string;
					playlist_id?: string;
					rank?: number | null;
					score?: number;
					snapshot_id?: string;
					song_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "match_result_playlist_id_fkey";
						columns: ["playlist_id"];
						isOneToOne: false;
						referencedRelation: "playlist";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_result_snapshot_id_fkey";
						columns: ["snapshot_id"];
						isOneToOne: false;
						referencedRelation: "match_snapshot";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_result_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "song";
						referencedColumns: ["id"];
					},
				];
			};
			match_snapshot: {
				Row: {
					account_id: string;
					algorithm_version: string;
					analysis_model: string | null;
					analysis_version: string | null;
					candidate_set_hash: string;
					config_hash: string;
					created_at: string;
					embedding_model: string | null;
					embedding_version: string | null;
					id: string;
					playlist_count: number;
					playlist_set_hash: string;
					snapshot_hash: string;
					song_count: number;
					weights: Json;
				};
				Insert: {
					account_id: string;
					algorithm_version: string;
					analysis_model?: string | null;
					analysis_version?: string | null;
					candidate_set_hash: string;
					config_hash: string;
					created_at?: string;
					embedding_model?: string | null;
					embedding_version?: string | null;
					id?: string;
					playlist_count?: number;
					playlist_set_hash: string;
					snapshot_hash: string;
					song_count?: number;
					weights?: Json;
				};
				Update: {
					account_id?: string;
					algorithm_version?: string;
					analysis_model?: string | null;
					analysis_version?: string | null;
					candidate_set_hash?: string;
					config_hash?: string;
					created_at?: string;
					embedding_model?: string | null;
					embedding_version?: string | null;
					id?: string;
					playlist_count?: number;
					playlist_set_hash?: string;
					snapshot_hash?: string;
					song_count?: number;
					weights?: Json;
				};
				Relationships: [
					{
						foreignKeyName: "match_snapshot_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
			};
			oauth_account: {
				Row: {
					access_token: string | null;
					access_token_expires_at: string | null;
					account_id: string;
					created_at: string;
					id: string;
					id_token: string | null;
					provider_id: string;
					refresh_token: string | null;
					scope: string | null;
					updated_at: string;
					user_id: string;
				};
				Insert: {
					access_token?: string | null;
					access_token_expires_at?: string | null;
					account_id: string;
					created_at?: string;
					id: string;
					id_token?: string | null;
					provider_id: string;
					refresh_token?: string | null;
					scope?: string | null;
					updated_at?: string;
					user_id: string;
				};
				Update: {
					access_token?: string | null;
					access_token_expires_at?: string | null;
					account_id?: string;
					created_at?: string;
					id?: string;
					id_token?: string | null;
					provider_id?: string;
					refresh_token?: string | null;
					scope?: string | null;
					updated_at?: string;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "oauth_account_user_id_fkey";
						columns: ["user_id"];
						isOneToOne: false;
						referencedRelation: "user";
						referencedColumns: ["id"];
					},
				];
			};
			pack_credit_lot: {
				Row: {
					account_id: string;
					created_at: string;
					id: string;
					offer_id: string;
					original_credits: number;
					price_cents: number;
					remaining_credits: number;
					stripe_event_id: string;
				};
				Insert: {
					account_id: string;
					created_at?: string;
					id?: string;
					offer_id: string;
					original_credits: number;
					price_cents: number;
					remaining_credits: number;
					stripe_event_id: string;
				};
				Update: {
					account_id?: string;
					created_at?: string;
					id?: string;
					offer_id?: string;
					original_credits?: number;
					price_cents?: number;
					remaining_credits?: number;
					stripe_event_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "pack_credit_lot_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
			};
			playlist: {
				Row: {
					account_id: string;
					created_at: string;
					description: string | null;
					id: string;
					image_url: string | null;
					is_public: boolean | null;
					is_target: boolean | null;
					name: string;
					snapshot_id: string | null;
					song_count: number | null;
					spotify_id: string;
					updated_at: string;
				};
				Insert: {
					account_id: string;
					created_at?: string;
					description?: string | null;
					id?: string;
					image_url?: string | null;
					is_public?: boolean | null;
					is_target?: boolean | null;
					name: string;
					snapshot_id?: string | null;
					song_count?: number | null;
					spotify_id: string;
					updated_at?: string;
				};
				Update: {
					account_id?: string;
					created_at?: string;
					description?: string | null;
					id?: string;
					image_url?: string | null;
					is_public?: boolean | null;
					is_target?: boolean | null;
					name?: string;
					snapshot_id?: string | null;
					song_count?: number | null;
					spotify_id?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "playlist_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
			};
			playlist_analysis: {
				Row: {
					analysis: Json;
					cost_cents: number | null;
					created_at: string;
					id: string;
					model: string;
					playlist_id: string;
					prompt_version: string | null;
					tokens_used: number | null;
					updated_at: string;
				};
				Insert: {
					analysis: Json;
					cost_cents?: number | null;
					created_at?: string;
					id?: string;
					model: string;
					playlist_id: string;
					prompt_version?: string | null;
					tokens_used?: number | null;
					updated_at?: string;
				};
				Update: {
					analysis?: Json;
					cost_cents?: number | null;
					created_at?: string;
					id?: string;
					model?: string;
					playlist_id?: string;
					prompt_version?: string | null;
					tokens_used?: number | null;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "playlist_analysis_playlist_id_fkey";
						columns: ["playlist_id"];
						isOneToOne: false;
						referencedRelation: "playlist";
						referencedColumns: ["id"];
					},
				];
			};
			playlist_profile: {
				Row: {
					audio_centroid: Json | null;
					content_hash: string;
					created_at: string;
					dims: number;
					embedding: string | null;
					emotion_distribution: Json | null;
					genre_distribution: Json | null;
					id: string;
					kind: string;
					model_bundle_hash: string;
					playlist_id: string;
					song_count: number | null;
					song_ids: string[] | null;
					updated_at: string;
				};
				Insert: {
					audio_centroid?: Json | null;
					content_hash: string;
					created_at?: string;
					dims: number;
					embedding?: string | null;
					emotion_distribution?: Json | null;
					genre_distribution?: Json | null;
					id?: string;
					kind: string;
					model_bundle_hash: string;
					playlist_id: string;
					song_count?: number | null;
					song_ids?: string[] | null;
					updated_at?: string;
				};
				Update: {
					audio_centroid?: Json | null;
					content_hash?: string;
					created_at?: string;
					dims?: number;
					embedding?: string | null;
					emotion_distribution?: Json | null;
					genre_distribution?: Json | null;
					id?: string;
					kind?: string;
					model_bundle_hash?: string;
					playlist_id?: string;
					song_count?: number | null;
					song_ids?: string[] | null;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "playlist_profile_playlist_id_fkey";
						columns: ["playlist_id"];
						isOneToOne: false;
						referencedRelation: "playlist";
						referencedColumns: ["id"];
					},
				];
			};
			playlist_song: {
				Row: {
					added_at: string | null;
					created_at: string;
					id: string;
					playlist_id: string;
					position: number;
					song_id: string;
					updated_at: string;
				};
				Insert: {
					added_at?: string | null;
					created_at?: string;
					id?: string;
					playlist_id: string;
					position?: number;
					song_id: string;
					updated_at?: string;
				};
				Update: {
					added_at?: string | null;
					created_at?: string;
					id?: string;
					playlist_id?: string;
					position?: number;
					song_id?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "playlist_song_playlist_id_fkey";
						columns: ["playlist_id"];
						isOneToOne: false;
						referencedRelation: "playlist";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "playlist_song_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "song";
						referencedColumns: ["id"];
					},
				];
			};
			session: {
				Row: {
					created_at: string;
					expires_at: string;
					id: string;
					ip_address: string | null;
					token: string;
					updated_at: string;
					user_agent: string | null;
					user_id: string;
				};
				Insert: {
					created_at?: string;
					expires_at: string;
					id: string;
					ip_address?: string | null;
					token: string;
					updated_at?: string;
					user_agent?: string | null;
					user_id: string;
				};
				Update: {
					created_at?: string;
					expires_at?: string;
					id?: string;
					ip_address?: string | null;
					token?: string;
					updated_at?: string;
					user_agent?: string | null;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "session_user_id_fkey";
						columns: ["user_id"];
						isOneToOne: false;
						referencedRelation: "user";
						referencedColumns: ["id"];
					},
				];
			};
			song: {
				Row: {
					album_id: string | null;
					album_name: string | null;
					artist_ids: string[];
					artists: string[];
					created_at: string;
					duration_ms: number | null;
					genres: string[];
					id: string;
					image_url: string | null;
					isrc: string | null;
					name: string;
					popularity: number | null;
					preview_url: string | null;
					spotify_id: string;
					updated_at: string;
				};
				Insert: {
					album_id?: string | null;
					album_name?: string | null;
					artist_ids?: string[];
					artists?: string[];
					created_at?: string;
					duration_ms?: number | null;
					genres?: string[];
					id?: string;
					image_url?: string | null;
					isrc?: string | null;
					name: string;
					popularity?: number | null;
					preview_url?: string | null;
					spotify_id: string;
					updated_at?: string;
				};
				Update: {
					album_id?: string | null;
					album_name?: string | null;
					artist_ids?: string[];
					artists?: string[];
					created_at?: string;
					duration_ms?: number | null;
					genres?: string[];
					id?: string;
					image_url?: string | null;
					isrc?: string | null;
					name?: string;
					popularity?: number | null;
					preview_url?: string | null;
					spotify_id?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			song_analysis: {
				Row: {
					analysis: Json;
					cost_cents: number | null;
					cost_usd: number | null;
					created_at: string;
					id: string;
					input_tokens: number | null;
					model: string;
					output_tokens: number | null;
					prompt_version: string | null;
					provider: string | null;
					song_id: string;
					tokens_used: number | null;
					updated_at: string;
				};
				Insert: {
					analysis: Json;
					cost_cents?: number | null;
					cost_usd?: number | null;
					created_at?: string;
					id?: string;
					input_tokens?: number | null;
					model: string;
					output_tokens?: number | null;
					prompt_version?: string | null;
					provider?: string | null;
					song_id: string;
					tokens_used?: number | null;
					updated_at?: string;
				};
				Update: {
					analysis?: Json;
					cost_cents?: number | null;
					cost_usd?: number | null;
					created_at?: string;
					id?: string;
					input_tokens?: number | null;
					model?: string;
					output_tokens?: number | null;
					prompt_version?: string | null;
					provider?: string | null;
					song_id?: string;
					tokens_used?: number | null;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "song_analysis_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "song";
						referencedColumns: ["id"];
					},
				];
			};
			song_audio_feature: {
				Row: {
					acousticness: number | null;
					created_at: string;
					danceability: number | null;
					energy: number | null;
					id: string;
					instrumentalness: number | null;
					key: number | null;
					liveness: number | null;
					loudness: number | null;
					mode: number | null;
					song_id: string;
					speechiness: number | null;
					tempo: number | null;
					time_signature: number | null;
					updated_at: string;
					valence: number | null;
				};
				Insert: {
					acousticness?: number | null;
					created_at?: string;
					danceability?: number | null;
					energy?: number | null;
					id?: string;
					instrumentalness?: number | null;
					key?: number | null;
					liveness?: number | null;
					loudness?: number | null;
					mode?: number | null;
					song_id: string;
					speechiness?: number | null;
					tempo?: number | null;
					time_signature?: number | null;
					updated_at?: string;
					valence?: number | null;
				};
				Update: {
					acousticness?: number | null;
					created_at?: string;
					danceability?: number | null;
					energy?: number | null;
					id?: string;
					instrumentalness?: number | null;
					key?: number | null;
					liveness?: number | null;
					loudness?: number | null;
					mode?: number | null;
					song_id?: string;
					speechiness?: number | null;
					tempo?: number | null;
					time_signature?: number | null;
					updated_at?: string;
					valence?: number | null;
				};
				Relationships: [
					{
						foreignKeyName: "song_audio_feature_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: true;
						referencedRelation: "song";
						referencedColumns: ["id"];
					},
				];
			};
			song_embedding: {
				Row: {
					content_hash: string;
					created_at: string;
					dims: number;
					embedding: string;
					id: string;
					kind: string;
					model: string;
					model_version: string | null;
					song_id: string;
					updated_at: string;
				};
				Insert: {
					content_hash: string;
					created_at?: string;
					dims: number;
					embedding: string;
					id?: string;
					kind: string;
					model: string;
					model_version?: string | null;
					song_id: string;
					updated_at?: string;
				};
				Update: {
					content_hash?: string;
					created_at?: string;
					dims?: number;
					embedding?: string;
					id?: string;
					kind?: string;
					model?: string;
					model_version?: string | null;
					song_id?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "song_embedding_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "song";
						referencedColumns: ["id"];
					},
				];
			};
			subscription_credit_conversion: {
				Row: {
					account_id: string;
					applied_stripe_event_id: string | null;
					checkout_session_id: string | null;
					converted_credits: number;
					created_at: string;
					discount_cents: number;
					id: string;
					status: string;
					stripe_invoice_id: string | null;
					stripe_subscription_id: string | null;
					target_plan: string;
					updated_at: string;
				};
				Insert: {
					account_id: string;
					applied_stripe_event_id?: string | null;
					checkout_session_id?: string | null;
					converted_credits: number;
					created_at?: string;
					discount_cents: number;
					id?: string;
					status: string;
					stripe_invoice_id?: string | null;
					stripe_subscription_id?: string | null;
					target_plan: string;
					updated_at?: string;
				};
				Update: {
					account_id?: string;
					applied_stripe_event_id?: string | null;
					checkout_session_id?: string | null;
					converted_credits?: number;
					created_at?: string;
					discount_cents?: number;
					id?: string;
					status?: string;
					stripe_invoice_id?: string | null;
					stripe_subscription_id?: string | null;
					target_plan?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "subscription_credit_conversion_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
			};
			subscription_credit_conversion_allocation: {
				Row: {
					conversion_id: string;
					pack_credit_lot_id: string;
					reserved_credits: number;
					reserved_discount_cents: number;
				};
				Insert: {
					conversion_id: string;
					pack_credit_lot_id: string;
					reserved_credits: number;
					reserved_discount_cents: number;
				};
				Update: {
					conversion_id?: string;
					pack_credit_lot_id?: string;
					reserved_credits?: number;
					reserved_discount_cents?: number;
				};
				Relationships: [
					{
						foreignKeyName: "subscription_credit_conversion_allocati_pack_credit_lot_id_fkey";
						columns: ["pack_credit_lot_id"];
						isOneToOne: false;
						referencedRelation: "pack_credit_lot";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "subscription_credit_conversion_allocation_conversion_id_fkey";
						columns: ["conversion_id"];
						isOneToOne: false;
						referencedRelation: "subscription_credit_conversion";
						referencedColumns: ["id"];
					},
				];
			};
			user: {
				Row: {
					created_at: string;
					email: string;
					email_verified: boolean;
					id: string;
					image: string | null;
					name: string;
					updated_at: string;
				};
				Insert: {
					created_at?: string;
					email: string;
					email_verified?: boolean;
					id: string;
					image?: string | null;
					name: string;
					updated_at?: string;
				};
				Update: {
					created_at?: string;
					email?: string;
					email_verified?: boolean;
					id?: string;
					image?: string | null;
					name?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			user_preferences: {
				Row: {
					account_id: string;
					created_at: string;
					id: string;
					onboarding_completed_at: string | null;
					onboarding_step: string;
					phase_job_ids: Json | null;
					theme: Database["public"]["Enums"]["theme"] | null;
					updated_at: string;
				};
				Insert: {
					account_id: string;
					created_at?: string;
					id?: string;
					onboarding_completed_at?: string | null;
					onboarding_step?: string;
					phase_job_ids?: Json | null;
					theme?: Database["public"]["Enums"]["theme"] | null;
					updated_at?: string;
				};
				Update: {
					account_id?: string;
					created_at?: string;
					id?: string;
					onboarding_completed_at?: string | null;
					onboarding_step?: string;
					phase_job_ids?: Json | null;
					theme?: Database["public"]["Enums"]["theme"] | null;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "user_preferences_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: true;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
			};
			verification: {
				Row: {
					created_at: string | null;
					expires_at: string;
					id: string;
					identifier: string;
					updated_at: string | null;
					value: string;
				};
				Insert: {
					created_at?: string | null;
					expires_at: string;
					id: string;
					identifier: string;
					updated_at?: string | null;
					value: string;
				};
				Update: {
					created_at?: string | null;
					expires_at?: string;
					id?: string;
					identifier?: string;
					updated_at?: string | null;
					value?: string;
				};
				Relationships: [];
			};
			waitlist: {
				Row: {
					created_at: string;
					email: string;
					id: number;
				};
				Insert: {
					created_at?: string;
					email: string;
					id?: never;
				};
				Update: {
					created_at?: string;
					email?: string;
					id?: never;
				};
				Relationships: [];
			};
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			activate_subscription: {
				Args: {
					p_account_id: string;
					p_plan: string;
					p_stripe_customer_id: string;
					p_stripe_subscription_id: string;
					p_subscription_period_end: string;
				};
				Returns: undefined;
			};
			activate_unlimited_songs: {
				Args: {
					p_account_id: string;
					p_granted_stripe_subscription_id: string;
					p_granted_subscription_period_end: string;
				};
				Returns: {
					song_id: string;
				}[];
			};
			apply_subscription_upgrade_conversion: {
				Args: {
					p_applied_stripe_event_id: string;
					p_conversion_id: string;
					p_stripe_invoice_id: string;
					p_stripe_subscription_id: string;
				};
				Returns: undefined;
			};
			claim_pending_library_processing_job: {
				Args: never;
				Returns: {
					account_id: string;
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error: string | null;
					heartbeat_at: string | null;
					id: string;
					max_attempts: number;
					progress: Json | null;
					queue_priority: number | null;
					satisfies_requested_at: string | null;
					started_at: string | null;
					status: Database["public"]["Enums"]["job_status"];
					type: Database["public"]["Enums"]["job_type"];
					updated_at: string;
				}[];
				SetofOptions: {
					from: "*";
					to: "job";
					isOneToOne: false;
					isSetofReturn: true;
				};
			};
			claim_pending_lightweight_enrichment_job: {
				Args: never;
				Returns: {
					account_id: string;
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error: string | null;
					heartbeat_at: string | null;
					id: string;
					max_attempts: number;
					progress: Json | null;
					queue_priority: number | null;
					satisfies_requested_at: string | null;
					started_at: string | null;
					status: Database["public"]["Enums"]["job_status"];
					type: Database["public"]["Enums"]["job_type"];
					updated_at: string;
				}[];
				SetofOptions: {
					from: "*";
					to: "job";
					isOneToOne: false;
					isSetofReturn: true;
				};
			};
			claim_pending_rematch_job: {
				Args: never;
				Returns: {
					account_id: string;
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error: string | null;
					heartbeat_at: string | null;
					id: string;
					max_attempts: number;
					progress: Json | null;
					queue_priority: number | null;
					satisfies_requested_at: string | null;
					started_at: string | null;
					status: Database["public"]["Enums"]["job_status"];
					type: Database["public"]["Enums"]["job_type"];
					updated_at: string;
				}[];
				SetofOptions: {
					from: "*";
					to: "job";
					isOneToOne: false;
					isSetofReturn: true;
				};
			};
			count_analyzed_songs_for_account: {
				Args: { p_account_id: string };
				Returns: number;
			};
			deactivate_subscription: {
				Args: { p_account_id: string };
				Returns: undefined;
			};
			fulfill_pack_purchase: {
				Args: {
					p_account_id: string;
					p_credits: number;
					p_offer_id: string;
					p_price_cents: number;
					p_stripe_event_id: string;
				};
				Returns: Json;
			};
			get_liked_songs_page: {
				Args: {
					p_account_id: string;
					p_cursor?: string;
					p_filter?: string;
					p_limit?: number;
				};
				Returns: {
					analysis_content: Json;
					analysis_created_at: string;
					analysis_id: string;
					analysis_model: string;
					artist_image_url: string;
					audio_energy: number;
					audio_tempo: number;
					audio_valence: number;
					id: string;
					liked_at: string;
					matching_status: string;
					song_album_name: string;
					song_artist_ids: string[];
					song_artists: string[];
					song_genres: string[];
					song_id: string;
					song_image_url: string;
					song_name: string;
					song_spotify_id: string;
				}[];
			};
			get_liked_songs_stats: {
				Args: { p_account_id: string };
				Returns: {
					analyzed: number;
					has_suggestions: number;
					matched: number;
					new_suggestions: number;
					pending: number;
					total: number;
				}[];
			};
			grant_credits: {
				Args: {
					p_account_id: string;
					p_amount: number;
					p_reason: string;
					p_stripe_event_id?: string;
				};
				Returns: number;
			};
			insert_song_unlocks_without_charge: {
				Args: {
					p_account_id: string;
					p_granted_stripe_event_id?: string;
					p_song_ids: string[];
					p_source: string;
				};
				Returns: {
					song_id: string;
				}[];
			};
			is_account_song_entitled: {
				Args: { p_account_id: string; p_song_id: string };
				Returns: boolean;
			};
			link_subscription_upgrade_checkout: {
				Args: { p_checkout_session_id: string; p_conversion_id: string };
				Returns: undefined;
			};
			mark_dead_library_processing_jobs: {
				Args: { stale_threshold: string };
				Returns: {
					account_id: string;
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error: string | null;
					heartbeat_at: string | null;
					id: string;
					max_attempts: number;
					progress: Json | null;
					queue_priority: number | null;
					satisfies_requested_at: string | null;
					started_at: string | null;
					status: Database["public"]["Enums"]["job_status"];
					type: Database["public"]["Enums"]["job_type"];
					updated_at: string;
				}[];
				SetofOptions: {
					from: "*";
					to: "job";
					isOneToOne: false;
					isSetofReturn: true;
				};
			};
			mark_dead_rematch_jobs: {
				Args: { stale_threshold: string };
				Returns: {
					account_id: string;
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error: string | null;
					heartbeat_at: string | null;
					id: string;
					max_attempts: number;
					progress: Json | null;
					queue_priority: number | null;
					satisfies_requested_at: string | null;
					started_at: string | null;
					status: Database["public"]["Enums"]["job_status"];
					type: Database["public"]["Enums"]["job_type"];
					updated_at: string;
				}[];
				SetofOptions: {
					from: "*";
					to: "job";
					isOneToOne: false;
					isSetofReturn: true;
				};
			};
			prepare_subscription_upgrade_conversion: {
				Args: { p_account_id: string; p_target_plan: string };
				Returns: {
					conversion_id: string;
					converted_credits: number;
					discount_cents: number;
				}[];
			};
			publish_match_snapshot: {
				Args: {
					p_account_id: string;
					p_algorithm_version: string;
					p_candidate_set_hash: string;
					p_config_hash: string;
					p_playlist_count: number;
					p_playlist_set_hash: string;
					p_results?: Json;
					p_snapshot_hash: string;
					p_song_count: number;
				};
				Returns: string;
			};
			release_subscription_upgrade_conversion: {
				Args: { p_conversion_id: string };
				Returns: undefined;
			};
			reprioritize_pending_jobs_for_account: {
				Args: { p_account_id: string };
				Returns: number;
			};
			reverse_pack_entitlement: {
				Args: {
					p_account_id: string;
					p_pack_stripe_event_id: string;
					p_reason: string;
					p_stripe_event_id: string;
				};
				Returns: Json;
			};
			reverse_subscription_upgrade_conversion: {
				Args: { p_conversion_id: string; p_stripe_event_id: string };
				Returns: undefined;
			};
			reverse_unlimited_period_entitlement: {
				Args: {
					p_revoked_reason: string;
					p_stripe_event_id: string;
					p_stripe_subscription_id: string;
					p_subscription_period_end: string;
				};
				Returns: {
					song_id: string;
				}[];
			};
			select_data_enriched_liked_song_ids: {
				Args: { p_account_id: string };
				Returns: {
					song_id: string;
				}[];
			};
			select_entitled_data_enriched_liked_song_ids: {
				Args: { p_account_id: string };
				Returns: {
					song_id: string;
				}[];
			};
			select_liked_song_ids_needing_enrichment_work: {
				Args: { p_account_id: string; p_limit: number };
				Returns: {
					needs_analysis: boolean;
					needs_audio_features: boolean;
					needs_content_activation: boolean;
					needs_embedding: boolean;
					needs_genre_tagging: boolean;
					song_id: string;
				}[];
			};
			select_liked_song_ids_needing_pipeline_processing: {
				Args: { p_account_id: string; p_limit: number };
				Returns: {
					song_id: string;
				}[];
			};
			sweep_stale_library_processing_jobs: {
				Args: { stale_threshold: string };
				Returns: {
					account_id: string;
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error: string | null;
					heartbeat_at: string | null;
					id: string;
					max_attempts: number;
					progress: Json | null;
					queue_priority: number | null;
					satisfies_requested_at: string | null;
					started_at: string | null;
					status: Database["public"]["Enums"]["job_status"];
					type: Database["public"]["Enums"]["job_type"];
					updated_at: string;
				}[];
				SetofOptions: {
					from: "*";
					to: "job";
					isOneToOne: false;
					isSetofReturn: true;
				};
			};
			sweep_stale_rematch_jobs: {
				Args: { stale_threshold: string };
				Returns: {
					account_id: string;
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error: string | null;
					heartbeat_at: string | null;
					id: string;
					max_attempts: number;
					progress: Json | null;
					queue_priority: number | null;
					satisfies_requested_at: string | null;
					started_at: string | null;
					status: Database["public"]["Enums"]["job_status"];
					type: Database["public"]["Enums"]["job_type"];
					updated_at: string;
				}[];
				SetofOptions: {
					from: "*";
					to: "job";
					isOneToOne: false;
					isSetofReturn: true;
				};
			};
			unlock_songs_for_account: {
				Args: { p_account_id: string; p_song_ids: string[] };
				Returns: Json;
			};
			update_subscription_state: {
				Args: {
					p_account_id: string;
					p_cancel_at_period_end: boolean;
					p_subscription_period_end: string;
					p_subscription_status: string;
				};
				Returns: undefined;
			};
		};
		Enums: {
			item_type: "song" | "playlist";
			job_status: "pending" | "running" | "completed" | "failed";
			job_type:
				| "sync_liked_songs"
				| "sync_playlists"
				| "song_analysis"
				| "playlist_analysis"
				| "matching"
				| "sync_playlist_tracks"
				| "audio_features"
				| "song_embedding"
				| "playlist_profiling"
				| "genre_tagging"
				| "enrichment"
				| "rematch"
				| "playlist_lightweight_enrichment"
				| "target_playlist_match_refresh"
				| "match_snapshot_refresh";
			theme: "blue" | "green" | "rose" | "lavender";
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
	keyof Database,
	"public"
>];

export type Tables<
	DefaultSchemaTableNameOrOptions extends
		| keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
				DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
			DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
			Row: infer R;
		}
		? R
		: never
	: DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
				DefaultSchema["Views"])
		? (DefaultSchema["Tables"] &
				DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
				Row: infer R;
			}
			? R
			: never
		: never;

export type TablesInsert<
	DefaultSchemaTableNameOrOptions extends
		| keyof DefaultSchema["Tables"]
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
			Insert: infer I;
		}
		? I
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
		? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
				Insert: infer I;
			}
			? I
			: never
		: never;

export type TablesUpdate<
	DefaultSchemaTableNameOrOptions extends
		| keyof DefaultSchema["Tables"]
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
			Update: infer U;
		}
		? U
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
		? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
				Update: infer U;
			}
			? U
			: never
		: never;

export type Enums<
	DefaultSchemaEnumNameOrOptions extends
		| keyof DefaultSchema["Enums"]
		| { schema: keyof DatabaseWithoutInternals },
	EnumName extends DefaultSchemaEnumNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
		: never = never,
> = DefaultSchemaEnumNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
	: DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
		? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
		: never;

export type CompositeTypes<
	PublicCompositeTypeNameOrOptions extends
		| keyof DefaultSchema["CompositeTypes"]
		| { schema: keyof DatabaseWithoutInternals },
	CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
		: never = never,
> = PublicCompositeTypeNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
	: PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
		? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
		: never;

export const Constants = {
	graphql_public: {
		Enums: {},
	},
	public: {
		Enums: {
			item_type: ["song", "playlist"],
			job_status: ["pending", "running", "completed", "failed"],
			job_type: [
				"sync_liked_songs",
				"sync_playlists",
				"song_analysis",
				"playlist_analysis",
				"matching",
				"sync_playlist_tracks",
				"audio_features",
				"song_embedding",
				"playlist_profiling",
				"genre_tagging",
				"enrichment",
				"rematch",
				"playlist_lightweight_enrichment",
				"target_playlist_match_refresh",
				"match_snapshot_refresh",
			],
			theme: ["blue", "green", "rose", "lavender"],
		},
	},
} as const;
