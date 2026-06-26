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
					handle: string | null;
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
					handle?: string | null;
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
					handle?: string | null;
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
			account_activity: {
				Row: {
					account_id: string;
					last_seen_at: string;
				};
				Insert: {
					account_id: string;
					last_seen_at?: string;
				};
				Update: {
					account_id?: string;
					last_seen_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "account_activity_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: true;
						referencedRelation: "account";
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
					last_subscription_state_event_created_at: string | null;
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
					last_subscription_state_event_created_at?: string | null;
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
					last_subscription_state_event_created_at?: string | null;
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
			account_item_newness: {
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
						foreignKeyName: "account_item_newness_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
			};
			account_liked_song_access_grant: {
				Row: {
					account_id: string;
					applied_at: string | null;
					created_at: string;
					note: string | null;
					origin: string;
					requested_by: string | null;
				};
				Insert: {
					account_id: string;
					applied_at?: string | null;
					created_at?: string;
					note?: string | null;
					origin: string;
					requested_by?: string | null;
				};
				Update: {
					account_id?: string;
					applied_at?: string | null;
					created_at?: string;
					note?: string | null;
					origin?: string;
					requested_by?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "account_liked_song_access_grant_account_id_fkey";
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
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
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
			annotation_distillation: {
				Row: {
					content_hash: string;
					created_at: string;
					distilled_text: string;
					distiller_version: string;
					model: string;
					raw_text: string;
				};
				Insert: {
					content_hash: string;
					created_at?: string;
					distilled_text: string;
					distiller_version: string;
					model: string;
					raw_text: string;
				};
				Update: {
					content_hash?: string;
					created_at?: string;
					distilled_text?: string;
					distiller_version?: string;
					model?: string;
					raw_text?: string;
				};
				Relationships: [];
			};
			artist: {
				Row: {
					band_gender: string | null;
					bio: string | null;
					created_at: string;
					gender: string | null;
					image_url: string | null;
					musicbrainz_checked_at: string | null;
					name: string;
					spotify_id: string;
					updated_at: string;
					wikidata_checked_at: string | null;
					wikidata_id: string | null;
				};
				Insert: {
					band_gender?: string | null;
					bio?: string | null;
					created_at?: string;
					gender?: string | null;
					image_url?: string | null;
					musicbrainz_checked_at?: string | null;
					name: string;
					spotify_id: string;
					updated_at?: string;
					wikidata_checked_at?: string | null;
					wikidata_id?: string | null;
				};
				Update: {
					band_gender?: string | null;
					bio?: string | null;
					created_at?: string;
					gender?: string | null;
					image_url?: string | null;
					musicbrainz_checked_at?: string | null;
					name?: string;
					spotify_id?: string;
					updated_at?: string;
					wikidata_checked_at?: string | null;
					wikidata_id?: string | null;
				};
				Relationships: [];
			};
			audio_feature_backfill_job: {
				Row: {
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error_code: string | null;
					error_message: string | null;
					id: string;
					lease_expires_at: string | null;
					locked_at: string | null;
					locked_by: string | null;
					max_attempts: number;
					not_before: string;
					progress: Json;
					requested_by_account_id: string | null;
					song_id: string;
					source_type: string;
					source_url: string | null;
					started_at: string | null;
					status: string;
					superseded_by_job_id: string | null;
					updated_at: string;
				};
				Insert: {
					attempts?: number;
					completed_at?: string | null;
					created_at?: string;
					error_code?: string | null;
					error_message?: string | null;
					id?: string;
					lease_expires_at?: string | null;
					locked_at?: string | null;
					locked_by?: string | null;
					max_attempts?: number;
					not_before?: string;
					progress?: Json;
					requested_by_account_id?: string | null;
					song_id: string;
					source_type: string;
					source_url?: string | null;
					started_at?: string | null;
					status?: string;
					superseded_by_job_id?: string | null;
					updated_at?: string;
				};
				Update: {
					attempts?: number;
					completed_at?: string | null;
					created_at?: string;
					error_code?: string | null;
					error_message?: string | null;
					id?: string;
					lease_expires_at?: string | null;
					locked_at?: string | null;
					locked_by?: string | null;
					max_attempts?: number;
					not_before?: string;
					progress?: Json;
					requested_by_account_id?: string | null;
					song_id?: string;
					source_type?: string;
					source_url?: string | null;
					started_at?: string | null;
					status?: string;
					superseded_by_job_id?: string | null;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "audio_feature_backfill_job_requested_by_account_id_fkey";
						columns: ["requested_by_account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "audio_feature_backfill_job_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
					},
					{
						foreignKeyName: "audio_feature_backfill_job_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "song";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "audio_feature_backfill_job_superseded_by_job_id_fkey";
						columns: ["superseded_by_job_id"];
						isOneToOne: false;
						referencedRelation: "audio_feature_backfill_job";
						referencedColumns: ["id"];
					},
				];
			};
			audio_feature_source_review: {
				Row: {
					aggregation_metadata: Json;
					audio_feature_id: string | null;
					averaged_features: Json;
					backfill_job_id: string | null;
					candidate_rank: number | null;
					clip_features: Json;
					clip_starts_seconds: number[];
					created_at: string;
					id: string;
					match_reasons: Json;
					match_score: number | null;
					rejected_candidates: Json;
					rejection_reason: string | null;
					reviewed_at: string | null;
					reviewed_by: string | null;
					search_query: string | null;
					song_id: string;
					source_type: string;
					status: string;
					updated_at: string;
					youtube_channel: string | null;
					youtube_duration_seconds: number | null;
					youtube_thumbnail_url: string | null;
					youtube_title: string | null;
					youtube_url: string;
					youtube_video_id: string | null;
				};
				Insert: {
					aggregation_metadata?: Json;
					audio_feature_id?: string | null;
					averaged_features: Json;
					backfill_job_id?: string | null;
					candidate_rank?: number | null;
					clip_features: Json;
					clip_starts_seconds: number[];
					created_at?: string;
					id?: string;
					match_reasons?: Json;
					match_score?: number | null;
					rejected_candidates?: Json;
					rejection_reason?: string | null;
					reviewed_at?: string | null;
					reviewed_by?: string | null;
					search_query?: string | null;
					song_id: string;
					source_type: string;
					status?: string;
					updated_at?: string;
					youtube_channel?: string | null;
					youtube_duration_seconds?: number | null;
					youtube_thumbnail_url?: string | null;
					youtube_title?: string | null;
					youtube_url: string;
					youtube_video_id?: string | null;
				};
				Update: {
					aggregation_metadata?: Json;
					audio_feature_id?: string | null;
					averaged_features?: Json;
					backfill_job_id?: string | null;
					candidate_rank?: number | null;
					clip_features?: Json;
					clip_starts_seconds?: number[];
					created_at?: string;
					id?: string;
					match_reasons?: Json;
					match_score?: number | null;
					rejected_candidates?: Json;
					rejection_reason?: string | null;
					reviewed_at?: string | null;
					reviewed_by?: string | null;
					search_query?: string | null;
					song_id?: string;
					source_type?: string;
					status?: string;
					updated_at?: string;
					youtube_channel?: string | null;
					youtube_duration_seconds?: number | null;
					youtube_thumbnail_url?: string | null;
					youtube_title?: string | null;
					youtube_url?: string;
					youtube_video_id?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "audio_feature_source_review_audio_feature_id_fkey";
						columns: ["audio_feature_id"];
						isOneToOne: false;
						referencedRelation: "song_audio_feature";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "audio_feature_source_review_backfill_job_id_fkey";
						columns: ["backfill_job_id"];
						isOneToOne: false;
						referencedRelation: "audio_feature_backfill_job";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "audio_feature_source_review_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
					},
					{
						foreignKeyName: "audio_feature_source_review_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "song";
						referencedColumns: ["id"];
					},
				];
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
			billing_admin_task: {
				Row: {
					charge_id: string;
					created_at: string;
					description: string;
					id: string;
					resolved_at: string | null;
					status: string;
					stripe_event_id: string;
					updated_at: string;
				};
				Insert: {
					charge_id: string;
					created_at?: string;
					description: string;
					id?: string;
					resolved_at?: string | null;
					status: string;
					stripe_event_id: string;
					updated_at?: string;
				};
				Update: {
					charge_id?: string;
					created_at?: string;
					description?: string;
					id?: string;
					resolved_at?: string | null;
					status?: string;
					stripe_event_id?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			billing_bridge_event: {
				Row: {
					created_at: string;
					error_message: string | null;
					event_kind: string;
					processed_at: string | null;
					processing_started_at: string | null;
					status: string;
					stripe_event_id: string;
					updated_at: string;
				};
				Insert: {
					created_at?: string;
					error_message?: string | null;
					event_kind: string;
					processed_at?: string | null;
					processing_started_at?: string | null;
					status: string;
					stripe_event_id: string;
					updated_at?: string;
				};
				Update: {
					created_at?: string;
					error_message?: string | null;
					event_kind?: string;
					processed_at?: string | null;
					processing_started_at?: string | null;
					status?: string;
					stripe_event_id?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			billing_webhook_event: {
				Row: {
					created_at: string;
					error_message: string | null;
					processed_at: string | null;
					processing_started_at: string | null;
					status: string;
					stripe_event_id: string;
					updated_at: string;
				};
				Insert: {
					created_at?: string;
					error_message?: string | null;
					processed_at?: string | null;
					processing_started_at?: string | null;
					status: string;
					stripe_event_id: string;
					updated_at?: string;
				};
				Update: {
					created_at?: string;
					error_message?: string | null;
					processed_at?: string | null;
					processing_started_at?: string | null;
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
			extension_api_token: {
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
						foreignKeyName: "extension_api_token_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
			};
			extension_sync_diagnostic: {
				Row: {
					account_id: string;
					backend_failure_code: string | null;
					backend_status: number | null;
					client_created_at: string;
					created_at: string;
					duration_ms: number;
					error_message: string | null;
					extension_version: string;
					failed_playlist_track_fetch_count: number;
					id: string;
					liked_songs_count: number;
					outcome: string;
					phase: string;
					playlist_count: number;
					playlist_tracks_count: number;
					playlists_with_tracks_count: number;
					request_policy: Json;
					request_stats: Json;
					retry_after_seconds: number | null;
					skipped_empty_playlists_count: number;
				};
				Insert: {
					account_id: string;
					backend_failure_code?: string | null;
					backend_status?: number | null;
					client_created_at: string;
					created_at?: string;
					duration_ms: number;
					error_message?: string | null;
					extension_version: string;
					failed_playlist_track_fetch_count?: number;
					id: string;
					liked_songs_count?: number;
					outcome: string;
					phase: string;
					playlist_count?: number;
					playlist_tracks_count?: number;
					playlists_with_tracks_count?: number;
					request_policy: Json;
					request_stats: Json;
					retry_after_seconds?: number | null;
					skipped_empty_playlists_count?: number;
				};
				Update: {
					account_id?: string;
					backend_failure_code?: string | null;
					backend_status?: number | null;
					client_created_at?: string;
					created_at?: string;
					duration_ms?: number;
					error_message?: string | null;
					extension_version?: string;
					failed_playlist_track_fetch_count?: number;
					id?: string;
					liked_songs_count?: number;
					outcome?: string;
					phase?: string;
					playlist_count?: number;
					playlist_tracks_count?: number;
					playlists_with_tracks_count?: number;
					request_policy?: Json;
					request_stats?: Json;
					retry_after_seconds?: number | null;
					skipped_empty_playlists_count?: number;
				};
				Relationships: [
					{
						foreignKeyName: "extension_sync_diagnostic_account_id_fkey";
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
					available_at: string;
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
					available_at?: string;
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
					available_at?: string;
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
			job_item_failure: {
				Row: {
					created_at: string;
					error_message: string | null;
					failure_code: string;
					id: string;
					is_terminal: boolean;
					item_id: string;
					item_type: Database["public"]["Enums"]["item_type"];
					job_id: string;
					resolved_at: string | null;
					stage: string | null;
					suppress_until: string | null;
				};
				Insert: {
					created_at?: string;
					error_message?: string | null;
					failure_code: string;
					id?: string;
					is_terminal?: boolean;
					item_id: string;
					item_type: Database["public"]["Enums"]["item_type"];
					job_id: string;
					resolved_at?: string | null;
					stage?: string | null;
					suppress_until?: string | null;
				};
				Update: {
					created_at?: string;
					error_message?: string | null;
					failure_code?: string;
					id?: string;
					is_terminal?: boolean;
					item_id?: string;
					item_type?: Database["public"]["Enums"]["item_type"];
					job_id?: string;
					resolved_at?: string | null;
					stage?: string | null;
					suppress_until?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "job_item_failure_job_id_fkey";
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
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
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
			llm_usage: {
				Row: {
					cache_read_tokens: number;
					content_hash: string | null;
					cost_usd: number | null;
					created_at: string;
					function_id: string;
					id: string;
					input_tokens: number;
					model: string;
					output_tokens: number;
					playlist_id: string | null;
					price_version: string | null;
					prompt_version: string | null;
					provider: string;
					reasoning_tokens: number;
					song_id: string | null;
				};
				Insert: {
					cache_read_tokens?: number;
					content_hash?: string | null;
					cost_usd?: number | null;
					created_at?: string;
					function_id: string;
					id?: string;
					input_tokens: number;
					model: string;
					output_tokens: number;
					playlist_id?: string | null;
					price_version?: string | null;
					prompt_version?: string | null;
					provider: string;
					reasoning_tokens?: number;
					song_id?: string | null;
				};
				Update: {
					cache_read_tokens?: number;
					content_hash?: string | null;
					cost_usd?: number | null;
					created_at?: string;
					function_id?: string;
					id?: string;
					input_tokens?: number;
					model?: string;
					output_tokens?: number;
					playlist_id?: string | null;
					price_version?: string | null;
					prompt_version?: string | null;
					provider?: string;
					reasoning_tokens?: number;
					song_id?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "llm_usage_playlist_id_fkey";
						columns: ["playlist_id"];
						isOneToOne: false;
						referencedRelation: "playlist";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "llm_usage_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
					},
					{
						foreignKeyName: "llm_usage_song_id_fkey";
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
					model_rank: number | null;
					playlist_id: string;
					queue_item_id: string | null;
					served_orientation: string | null;
					snapshot_id: string | null;
					song_id: string;
					visible_rank: number | null;
				};
				Insert: {
					account_id: string;
					created_at?: string;
					decided_at?: string;
					decision: string;
					id?: string;
					model_rank?: number | null;
					playlist_id: string;
					queue_item_id?: string | null;
					served_orientation?: string | null;
					snapshot_id?: string | null;
					song_id: string;
					visible_rank?: number | null;
				};
				Update: {
					account_id?: string;
					created_at?: string;
					decided_at?: string;
					decision?: string;
					id?: string;
					model_rank?: number | null;
					playlist_id?: string;
					queue_item_id?: string | null;
					served_orientation?: string | null;
					snapshot_id?: string | null;
					song_id?: string;
					visible_rank?: number | null;
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
						foreignKeyName: "match_decision_queue_item_id_fkey";
						columns: ["queue_item_id"];
						isOneToOne: false;
						referencedRelation: "match_review_queue_item";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_decision_snapshot_id_fkey";
						columns: ["snapshot_id"];
						isOneToOne: false;
						referencedRelation: "match_snapshot";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_decision_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
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
			match_event: {
				Row: {
					account_id: string;
					event: string;
					id: string;
					model_rank: number | null;
					occurred_at: string;
					playlist_id: string;
					queue_item_id: string | null;
					served_orientation: string | null;
					session_id: string | null;
					snapshot_id: string | null;
					song_id: string;
					visible_rank: number | null;
				};
				Insert: {
					account_id: string;
					event: string;
					id?: string;
					model_rank?: number | null;
					occurred_at?: string;
					playlist_id: string;
					queue_item_id?: string | null;
					served_orientation?: string | null;
					session_id?: string | null;
					snapshot_id?: string | null;
					song_id: string;
					visible_rank?: number | null;
				};
				Update: {
					account_id?: string;
					event?: string;
					id?: string;
					model_rank?: number | null;
					occurred_at?: string;
					playlist_id?: string;
					queue_item_id?: string | null;
					served_orientation?: string | null;
					session_id?: string | null;
					snapshot_id?: string | null;
					song_id?: string;
					visible_rank?: number | null;
				};
				Relationships: [
					{
						foreignKeyName: "match_event_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_event_playlist_id_fkey";
						columns: ["playlist_id"];
						isOneToOne: false;
						referencedRelation: "playlist";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_event_queue_item_id_fkey";
						columns: ["queue_item_id"];
						isOneToOne: false;
						referencedRelation: "match_review_queue_item";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_event_session_id_fkey";
						columns: ["session_id"];
						isOneToOne: false;
						referencedRelation: "match_review_session";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_event_snapshot_id_fkey";
						columns: ["snapshot_id"];
						isOneToOne: false;
						referencedRelation: "match_snapshot";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_event_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
					},
					{
						foreignKeyName: "match_event_song_id_fkey";
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
					fused_score: number | null;
					id: string;
					normalized_factors: Json;
					playlist_id: string;
					rank: number | null;
					score: number;
					snapshot_id: string;
					song_id: string;
				};
				Insert: {
					created_at?: string;
					factors?: Json;
					fused_score?: number | null;
					id?: string;
					normalized_factors?: Json;
					playlist_id: string;
					rank?: number | null;
					score: number;
					snapshot_id: string;
					song_id: string;
				};
				Update: {
					created_at?: string;
					factors?: Json;
					fused_score?: number | null;
					id?: string;
					normalized_factors?: Json;
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
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
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
			match_result_ranking: {
				Row: {
					created_at: string;
					document_mode: string;
					id: string;
					ordering_score: number;
					orientation: string;
					playlist_id: string;
					rank: number;
					reranker_score: number | null;
					snapshot_id: string;
					song_id: string;
					source: string;
				};
				Insert: {
					created_at?: string;
					document_mode: string;
					id?: string;
					ordering_score: number;
					orientation: string;
					playlist_id: string;
					rank: number;
					reranker_score?: number | null;
					snapshot_id: string;
					song_id: string;
					source: string;
				};
				Update: {
					created_at?: string;
					document_mode?: string;
					id?: string;
					ordering_score?: number;
					orientation?: string;
					playlist_id?: string;
					rank?: number;
					reranker_score?: number | null;
					snapshot_id?: string;
					song_id?: string;
					source?: string;
				};
				Relationships: [
					{
						foreignKeyName: "match_result_ranking_playlist_id_fkey";
						columns: ["playlist_id"];
						isOneToOne: false;
						referencedRelation: "playlist";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_result_ranking_snapshot_id_song_id_playlist_id_fkey";
						columns: ["snapshot_id", "song_id", "playlist_id"];
						isOneToOne: false;
						referencedRelation: "match_result";
						referencedColumns: ["snapshot_id", "song_id", "playlist_id"];
					},
					{
						foreignKeyName: "match_result_ranking_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
					},
					{
						foreignKeyName: "match_result_ranking_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "song";
						referencedColumns: ["id"];
					},
				];
			};
			match_review_item_visible_pair: {
				Row: {
					account_id: string;
					captured_at: string;
					fit_score: number;
					model_rank: number;
					orientation: string;
					playlist_id: string;
					queue_item_id: string;
					session_id: string;
					snapshot_id: string | null;
					song_id: string;
					visible_rank: number;
				};
				Insert: {
					account_id: string;
					captured_at?: string;
					fit_score: number;
					model_rank: number;
					orientation: string;
					playlist_id: string;
					queue_item_id: string;
					session_id: string;
					snapshot_id?: string | null;
					song_id: string;
					visible_rank: number;
				};
				Update: {
					account_id?: string;
					captured_at?: string;
					fit_score?: number;
					model_rank?: number;
					orientation?: string;
					playlist_id?: string;
					queue_item_id?: string;
					session_id?: string;
					snapshot_id?: string | null;
					song_id?: string;
					visible_rank?: number;
				};
				Relationships: [
					{
						foreignKeyName: "match_review_item_visible_pair_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_review_item_visible_pair_playlist_id_fkey";
						columns: ["playlist_id"];
						isOneToOne: false;
						referencedRelation: "playlist";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_review_item_visible_pair_queue_item_id_fkey";
						columns: ["queue_item_id"];
						isOneToOne: false;
						referencedRelation: "match_review_queue_item";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_review_item_visible_pair_session_id_fkey";
						columns: ["session_id"];
						isOneToOne: false;
						referencedRelation: "match_review_session";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_review_item_visible_pair_snapshot_id_fkey";
						columns: ["snapshot_id"];
						isOneToOne: false;
						referencedRelation: "match_snapshot";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_review_item_visible_pair_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
					},
					{
						foreignKeyName: "match_review_item_visible_pair_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "song";
						referencedColumns: ["id"];
					},
				];
			};
			match_review_queue_item: {
				Row: {
					account_id: string;
					created_at: string;
					id: string;
					orientation: string;
					playlist_id: string | null;
					position: number;
					presented_at: string | null;
					resolution: string | null;
					resolved_at: string | null;
					session_id: string;
					song_id: string | null;
					source_fit_score: number;
					source_snapshot_id: string;
					state: string;
					updated_at: string;
					visible_pairs_captured_at: string | null;
					was_new_at_enqueue: boolean;
				};
				Insert: {
					account_id: string;
					created_at?: string;
					id?: string;
					orientation?: string;
					playlist_id?: string | null;
					position: number;
					presented_at?: string | null;
					resolution?: string | null;
					resolved_at?: string | null;
					session_id: string;
					song_id?: string | null;
					source_fit_score?: number;
					source_snapshot_id: string;
					state: string;
					updated_at?: string;
					visible_pairs_captured_at?: string | null;
					was_new_at_enqueue?: boolean;
				};
				Update: {
					account_id?: string;
					created_at?: string;
					id?: string;
					orientation?: string;
					playlist_id?: string | null;
					position?: number;
					presented_at?: string | null;
					resolution?: string | null;
					resolved_at?: string | null;
					session_id?: string;
					song_id?: string | null;
					source_fit_score?: number;
					source_snapshot_id?: string;
					state?: string;
					updated_at?: string;
					visible_pairs_captured_at?: string | null;
					was_new_at_enqueue?: boolean;
				};
				Relationships: [
					{
						foreignKeyName: "match_review_queue_item_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_review_queue_item_playlist_id_fkey";
						columns: ["playlist_id"];
						isOneToOne: false;
						referencedRelation: "playlist";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_review_queue_item_session_id_fkey";
						columns: ["session_id"];
						isOneToOne: false;
						referencedRelation: "match_review_session";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_review_queue_item_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
					},
					{
						foreignKeyName: "match_review_queue_item_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "song";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_review_queue_item_source_snapshot_id_fkey";
						columns: ["source_snapshot_id"];
						isOneToOne: false;
						referencedRelation: "match_snapshot";
						referencedColumns: ["id"];
					},
				];
			};
			match_review_session: {
				Row: {
					account_id: string;
					completed_at: string | null;
					created_at: string;
					id: string;
					orientation: string;
					status: string;
					strictness_min_score: number;
					strictness_preset: string;
					updated_at: string;
				};
				Insert: {
					account_id: string;
					completed_at?: string | null;
					created_at?: string;
					id?: string;
					orientation?: string;
					status: string;
					strictness_min_score: number;
					strictness_preset: string;
					updated_at?: string;
				};
				Update: {
					account_id?: string;
					completed_at?: string | null;
					created_at?: string;
					id?: string;
					orientation?: string;
					status?: string;
					strictness_min_score?: number;
					strictness_preset?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "match_review_session_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
			};
			match_review_session_snapshot: {
				Row: {
					appended_item_count: number;
					applied_at: string;
					session_id: string;
					snapshot_id: string;
					visibility_config_hash: string;
				};
				Insert: {
					appended_item_count?: number;
					applied_at?: string;
					session_id: string;
					snapshot_id: string;
					visibility_config_hash?: string;
				};
				Update: {
					appended_item_count?: number;
					applied_at?: string;
					session_id?: string;
					snapshot_id?: string;
					visibility_config_hash?: string;
				};
				Relationships: [
					{
						foreignKeyName: "match_review_session_snapshot_session_id_fkey";
						columns: ["session_id"];
						isOneToOne: false;
						referencedRelation: "match_review_session";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_review_session_snapshot_snapshot_id_fkey";
						columns: ["snapshot_id"];
						isOneToOne: false;
						referencedRelation: "match_snapshot";
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
			match_snapshot_playlist_profile: {
				Row: {
					playlist_id: string;
					profile_id: string;
					snapshot_id: string;
				};
				Insert: {
					playlist_id: string;
					profile_id: string;
					snapshot_id: string;
				};
				Update: {
					playlist_id?: string;
					profile_id?: string;
					snapshot_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "match_snapshot_playlist_profile_playlist_id_fkey";
						columns: ["playlist_id"];
						isOneToOne: false;
						referencedRelation: "playlist";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_snapshot_playlist_profile_profile_id_fkey";
						columns: ["profile_id"];
						isOneToOne: false;
						referencedRelation: "playlist_profile";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_snapshot_playlist_profile_snapshot_id_fkey";
						columns: ["snapshot_id"];
						isOneToOne: false;
						referencedRelation: "match_snapshot";
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
					password: string | null;
					provider_id: string;
					refresh_token: string | null;
					refresh_token_expires_at: string | null;
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
					password?: string | null;
					provider_id: string;
					refresh_token?: string | null;
					refresh_token_expires_at?: string | null;
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
					password?: string | null;
					provider_id?: string;
					refresh_token?: string | null;
					refresh_token_expires_at?: string | null;
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
					checkout_session_id: string | null;
					created_at: string;
					id: string;
					offer_id: string;
					original_credits: number;
					price_cents: number;
					remaining_credits: number;
					reversed_at: string | null;
					stripe_event_id: string;
				};
				Insert: {
					account_id: string;
					checkout_session_id?: string | null;
					created_at?: string;
					id?: string;
					offer_id: string;
					original_credits: number;
					price_cents: number;
					remaining_credits: number;
					reversed_at?: string | null;
					stripe_event_id: string;
				};
				Update: {
					account_id?: string;
					checkout_session_id?: string | null;
					created_at?: string;
					id?: string;
					offer_id?: string;
					original_credits?: number;
					price_cents?: number;
					remaining_credits?: number;
					reversed_at?: string | null;
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
					genre_pills: string[];
					id: string;
					image_url: string | null;
					is_public: boolean | null;
					is_target: boolean | null;
					match_filters: Json;
					match_intent: string | null;
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
					genre_pills?: string[];
					id?: string;
					image_url?: string | null;
					is_public?: boolean | null;
					is_target?: boolean | null;
					match_filters?: Json;
					match_intent?: string | null;
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
					genre_pills?: string[];
					id?: string;
					image_url?: string | null;
					is_public?: boolean | null;
					is_target?: boolean | null;
					match_filters?: Json;
					match_intent?: string | null;
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
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
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
			provider_concurrency_lease: {
				Row: {
					acquired_at: string | null;
					holder: string | null;
					lease_expires_at: string | null;
					max_concurrency: number;
					provider: string;
					updated_at: string;
				};
				Insert: {
					acquired_at?: string | null;
					holder?: string | null;
					lease_expires_at?: string | null;
					max_concurrency?: number;
					provider: string;
					updated_at?: string;
				};
				Update: {
					acquired_at?: string | null;
					holder?: string | null;
					lease_expires_at?: string | null;
					max_concurrency?: number;
					provider?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			rate_limit: {
				Row: {
					count: number | null;
					id: string;
					key: string | null;
					last_request: number | null;
				};
				Insert: {
					count?: number | null;
					id: string;
					key?: string | null;
					last_request?: number | null;
				};
				Update: {
					count?: number | null;
					id?: string;
					key?: string | null;
					last_request?: number | null;
				};
				Relationships: [];
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
					language: string | null;
					language_checked_at: string | null;
					language_confidence: number | null;
					language_secondary: string | null;
					name: string;
					release_year: number | null;
					release_year_checked_at: string | null;
					spotify_id: string;
					updated_at: string;
					vocal_gender: string | null;
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
					language?: string | null;
					language_checked_at?: string | null;
					language_confidence?: number | null;
					language_secondary?: string | null;
					name: string;
					release_year?: number | null;
					release_year_checked_at?: string | null;
					spotify_id: string;
					updated_at?: string;
					vocal_gender?: string | null;
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
					language?: string | null;
					language_checked_at?: string | null;
					language_confidence?: number | null;
					language_secondary?: string | null;
					name?: string;
					release_year?: number | null;
					release_year_checked_at?: string | null;
					spotify_id?: string;
					updated_at?: string;
					vocal_gender?: string | null;
				};
				Relationships: [];
			};
			song_analysis: {
				Row: {
					analysis: Json;
					cleanup_error: string | null;
					cleanup_passes: number | null;
					cleanup_tells_after: number | null;
					cleanup_tells_before: number | null;
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
					cleanup_error?: string | null;
					cleanup_passes?: number | null;
					cleanup_tells_after?: number | null;
					cleanup_tells_before?: number | null;
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
					cleanup_error?: string | null;
					cleanup_passes?: number | null;
					cleanup_tells_after?: number | null;
					cleanup_tells_before?: number | null;
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
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
					},
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
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
					},
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
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
					},
					{
						foreignKeyName: "song_embedding_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "song";
						referencedColumns: ["id"];
					},
				];
			};
			song_failure_compensation: {
				Row: {
					account_id: string;
					created_at: string;
					credit_amount: number;
					failure_code: string;
					id: string;
					song_id: string;
				};
				Insert: {
					account_id: string;
					created_at?: string;
					credit_amount?: number;
					failure_code: string;
					id?: string;
					song_id: string;
				};
				Update: {
					account_id?: string;
					created_at?: string;
					credit_amount?: number;
					failure_code?: string;
					id?: string;
					song_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "song_failure_compensation_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "song_failure_compensation_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
					},
					{
						foreignKeyName: "song_failure_compensation_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "song";
						referencedColumns: ["id"];
					},
				];
			};
			song_instrumental_review: {
				Row: {
					created_at: string;
					id: string;
					instrumentalness: number | null;
					matched_genre: string | null;
					rejection_reason: string | null;
					reviewed_at: string | null;
					reviewed_by: string | null;
					signal: string;
					song_id: string;
					status: string;
					updated_at: string;
				};
				Insert: {
					created_at?: string;
					id?: string;
					instrumentalness?: number | null;
					matched_genre?: string | null;
					rejection_reason?: string | null;
					reviewed_at?: string | null;
					reviewed_by?: string | null;
					signal: string;
					song_id: string;
					status?: string;
					updated_at?: string;
				};
				Update: {
					created_at?: string;
					id?: string;
					instrumentalness?: number | null;
					matched_genre?: string | null;
					rejection_reason?: string | null;
					reviewed_at?: string | null;
					reviewed_by?: string | null;
					signal?: string;
					song_id?: string;
					status?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "song_instrumental_review_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: true;
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
					},
					{
						foreignKeyName: "song_instrumental_review_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: true;
						referencedRelation: "song";
						referencedColumns: ["id"];
					},
				];
			};
			song_lyrics: {
				Row: {
					content_hash: string;
					created_at: string;
					document: Json | null;
					fetch_source: string | null;
					fetch_status: string;
					has_annotations: boolean;
					id: string;
					schema_version: number;
					song_id: string;
					source: string;
					updated_at: string;
				};
				Insert: {
					content_hash: string;
					created_at?: string;
					document?: Json | null;
					fetch_source?: string | null;
					fetch_status: string;
					has_annotations?: boolean;
					id?: string;
					schema_version?: number;
					song_id: string;
					source: string;
					updated_at?: string;
				};
				Update: {
					content_hash?: string;
					created_at?: string;
					document?: Json | null;
					fetch_source?: string | null;
					fetch_status?: string;
					has_annotations?: boolean;
					id?: string;
					schema_version?: number;
					song_id?: string;
					source?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "song_lyrics_song_id_fkey";
						columns: ["song_id"];
						isOneToOne: false;
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
					},
					{
						foreignKeyName: "song_lyrics_song_id_fkey";
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
					consent_status: string | null;
					consent_updated_at: string | null;
					consent_version: number | null;
					created_at: string;
					demo_song_id: string | null;
					id: string;
					match_strictness: string;
					match_view_mode: string;
					onboarding_completed_at: string | null;
					onboarding_step: string;
					phase_job_ids: Json | null;
					theme: Database["public"]["Enums"]["theme"] | null;
					updated_at: string;
				};
				Insert: {
					account_id: string;
					consent_status?: string | null;
					consent_updated_at?: string | null;
					consent_version?: number | null;
					created_at?: string;
					demo_song_id?: string | null;
					id?: string;
					match_strictness?: string;
					match_view_mode?: string;
					onboarding_completed_at?: string | null;
					onboarding_step?: string;
					phase_job_ids?: Json | null;
					theme?: Database["public"]["Enums"]["theme"] | null;
					updated_at?: string;
				};
				Update: {
					account_id?: string;
					consent_status?: string | null;
					consent_updated_at?: string | null;
					consent_version?: number | null;
					created_at?: string;
					demo_song_id?: string | null;
					id?: string;
					match_strictness?: string;
					match_view_mode?: string;
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
					{
						foreignKeyName: "user_preferences_demo_song_id_fkey";
						columns: ["demo_song_id"];
						isOneToOne: false;
						referencedRelation: "liked_song_decorated";
						referencedColumns: ["song_id"];
					},
					{
						foreignKeyName: "user_preferences_demo_song_id_fkey";
						columns: ["demo_song_id"];
						isOneToOne: false;
						referencedRelation: "song";
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
			liked_song_decorated: {
				Row: {
					account_id: string | null;
					analysis_content: Json | null;
					analysis_created_at: string | null;
					analysis_id: string | null;
					analysis_model: string | null;
					artist_image_url: string | null;
					artists_joined: string | null;
					audio_energy: number | null;
					audio_tempo: number | null;
					audio_valence: number | null;
					content_fetch_status: string | null;
					display_state: string | null;
					has_analysis: boolean | null;
					has_newness: boolean | null;
					has_terminal_failure: boolean | null;
					id: string | null;
					is_entitled: boolean | null;
					liked_at: string | null;
					matching_status: string | null;
					slug: string | null;
					song_album_name: string | null;
					song_artist_ids: string[] | null;
					song_artists: string[] | null;
					song_genres: string[] | null;
					song_id: string | null;
					song_image_url: string | null;
					song_name: string | null;
					song_spotify_id: string | null;
					total_results: number | null;
					undecided_count: number | null;
					unliked_at: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "liked_song_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
			};
		};
		Functions: {
			acquire_provider_lease: {
				Args: { p_holder: string; p_lease_seconds: number; p_provider: string };
				Returns: boolean;
			};
			activate_subscription: {
				Args: {
					p_account_id: string;
					p_plan: string;
					p_stripe_customer_id: string;
					p_stripe_event_created_at: string;
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
			add_match_review_item_decision_atomic: {
				Args: {
					p_account_id: string;
					p_item_id: string;
					p_suggestion_playlist_id?: string;
					p_suggestion_song_id?: string;
				};
				Returns: string;
			};
			apply_artist_gender_resolution: {
				Args: { p_rows: Json };
				Returns: number;
			};
			apply_release_year_lookups: { Args: { p_rows: Json }; Returns: number };
			apply_song_language: { Args: { p_rows: Json }; Returns: number };
			apply_subscription_upgrade_conversion: {
				Args: {
					p_applied_stripe_event_id: string;
					p_conversion_id: string;
					p_stripe_invoice_id: string;
					p_stripe_subscription_id: string;
				};
				Returns: undefined;
			};
			audio_feature_state: { Args: { p_song_id: string }; Returns: string };
			begin_extension_sync: {
				Args: {
					p_account_id: string;
					p_payload_bytes: number;
					p_payload_path: string;
				};
				Returns: Json;
			};
			capture_match_review_item_visible_pairs_atomic: {
				Args: { p_account_id: string; p_item_id: string; p_pairs: Json };
				Returns: Json;
			};
			claim_billing_bridge_event: {
				Args: {
					p_event_kind: string;
					p_lease_ms: number;
					p_stripe_event_id: string;
				};
				Returns: string;
			};
			claim_billing_webhook_event: {
				Args: { p_lease_ms: number; p_stripe_event_id: string };
				Returns: string;
			};
			claim_extension_sync_payload_cleanup: {
				Args: never;
				Returns: {
					account_id: string;
					job_id: string;
					payload_path: string;
				}[];
			};
			claim_handle: {
				Args: { p_account_id: string; p_handle: string };
				Returns: {
					owned_handle: string;
					status: string;
				}[];
			};
			claim_pending_audio_feature_backfill_job: {
				Args: {
					p_lease_seconds?: number;
					p_limit?: number;
					p_worker_id: string;
				};
				Returns: {
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error_code: string | null;
					error_message: string | null;
					id: string;
					lease_expires_at: string | null;
					locked_at: string | null;
					locked_by: string | null;
					max_attempts: number;
					not_before: string;
					progress: Json;
					requested_by_account_id: string | null;
					song_id: string;
					source_type: string;
					source_url: string | null;
					started_at: string | null;
					status: string;
					superseded_by_job_id: string | null;
					updated_at: string;
				}[];
				SetofOptions: {
					from: "*";
					to: "audio_feature_backfill_job";
					isOneToOne: false;
					isSetofReturn: true;
				};
			};
			claim_pending_extension_sync_job: {
				Args: never;
				Returns: {
					account_id: string;
					attempts: number;
					available_at: string;
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
			claim_pending_library_processing_job: {
				Args: never;
				Returns: {
					account_id: string;
					attempts: number;
					available_at: string;
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
					available_at: string;
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
					available_at: string;
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
			complete_audio_feature_backfill_job: {
				Args: { p_job_id: string; p_worker_id: string };
				Returns: {
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error_code: string | null;
					error_message: string | null;
					id: string;
					lease_expires_at: string | null;
					locked_at: string | null;
					locked_by: string | null;
					max_attempts: number;
					not_before: string;
					progress: Json;
					requested_by_account_id: string | null;
					song_id: string;
					source_type: string;
					source_url: string | null;
					started_at: string | null;
					status: string;
					superseded_by_job_id: string | null;
					updated_at: string;
				}[];
				SetofOptions: {
					from: "*";
					to: "audio_feature_backfill_job";
					isOneToOne: false;
					isSetofReturn: true;
				};
			};
			compute_song_vocal_gender: {
				Args: { p_artist_ids: string[] };
				Returns: string;
			};
			count_analyzed_songs_for_account: {
				Args: { p_account_id: string };
				Returns: number;
			};
			count_unresolved_job_item_failures: {
				Args: {
					p_account_id: string;
					p_failure_code: string;
					p_item_id: string;
					p_stage: string;
				};
				Returns: number;
			};
			create_account_with_billing: {
				Args: {
					p_better_auth_user_id: string;
					p_display_name: string;
					p_email: string;
					p_unlimited_access_source?: string;
				};
				Returns: {
					better_auth_user_id: string | null;
					created_at: string;
					display_name: string | null;
					email: string | null;
					handle: string | null;
					id: string;
					image_url: string | null;
					spotify_id: string | null;
					updated_at: string;
				};
				SetofOptions: {
					from: "*";
					to: "account";
					isOneToOne: true;
					isSetofReturn: false;
				};
			};
			deactivate_subscription: {
				Args: { p_account_id: string; p_stripe_event_created_at: string };
				Returns: undefined;
			};
			defer_audio_feature_backfill_job: {
				Args: {
					p_error_code: string;
					p_error_message: string;
					p_job_id: string;
					p_retry_seconds: number;
					p_worker_id: string;
				};
				Returns: {
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error_code: string | null;
					error_message: string | null;
					id: string;
					lease_expires_at: string | null;
					locked_at: string | null;
					locked_by: string | null;
					max_attempts: number;
					not_before: string;
					progress: Json;
					requested_by_account_id: string | null;
					song_id: string;
					source_type: string;
					source_url: string | null;
					started_at: string | null;
					status: string;
					superseded_by_job_id: string | null;
					updated_at: string;
				}[];
				SetofOptions: {
					from: "*";
					to: "audio_feature_backfill_job";
					isOneToOne: false;
					isSetofReturn: true;
				};
			};
			dismiss_match_review_item_atomic: {
				Args: { p_account_id: string; p_item_id: string };
				Returns: string;
			};
			enqueue_audio_feature_backfill_manual: {
				Args: {
					p_requested_by_account_id?: string;
					p_song_id: string;
					p_source_url: string;
				};
				Returns: {
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error_code: string | null;
					error_message: string | null;
					id: string;
					lease_expires_at: string | null;
					locked_at: string | null;
					locked_by: string | null;
					max_attempts: number;
					not_before: string;
					progress: Json;
					requested_by_account_id: string | null;
					song_id: string;
					source_type: string;
					source_url: string | null;
					started_at: string | null;
					status: string;
					superseded_by_job_id: string | null;
					updated_at: string;
				};
				SetofOptions: {
					from: "*";
					to: "audio_feature_backfill_job";
					isOneToOne: true;
					isSetofReturn: false;
				};
			};
			enqueue_audio_feature_backfill_search: {
				Args: { p_requested_by_account_id?: string; p_song_id: string };
				Returns: {
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error_code: string | null;
					error_message: string | null;
					id: string;
					lease_expires_at: string | null;
					locked_at: string | null;
					locked_by: string | null;
					max_attempts: number;
					not_before: string;
					progress: Json;
					requested_by_account_id: string | null;
					song_id: string;
					source_type: string;
					source_url: string | null;
					started_at: string | null;
					status: string;
					superseded_by_job_id: string | null;
					updated_at: string;
				};
				SetofOptions: {
					from: "*";
					to: "audio_feature_backfill_job";
					isOneToOne: true;
					isSetofReturn: false;
				};
			};
			fail_audio_feature_backfill_job: {
				Args: {
					p_error_code: string;
					p_error_message: string;
					p_job_id: string;
					p_worker_id: string;
				};
				Returns: {
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error_code: string | null;
					error_message: string | null;
					id: string;
					lease_expires_at: string | null;
					locked_at: string | null;
					locked_by: string | null;
					max_attempts: number;
					not_before: string;
					progress: Json;
					requested_by_account_id: string | null;
					song_id: string;
					source_type: string;
					source_url: string | null;
					started_at: string | null;
					status: string;
					superseded_by_job_id: string | null;
					updated_at: string;
				}[];
				SetofOptions: {
					from: "*";
					to: "audio_feature_backfill_job";
					isOneToOne: false;
					isSetofReturn: true;
				};
			};
			finish_match_review_item_atomic: {
				Args: { p_account_id: string; p_item_id: string };
				Returns: string;
			};
			fulfill_pack_purchase: {
				Args: {
					p_account_id: string;
					p_bonus_unlocks?: number;
					p_checkout_session_id?: string;
					p_credits: number;
					p_offer_id: string;
					p_price_cents: number;
					p_stripe_event_id: string;
				};
				Returns: Json;
			};
			get_account_top_genres: {
				Args: { p_account_id: string; p_limit?: number };
				Returns: {
					genre: string;
					occurrences: number;
				}[];
			};
			get_audio_feature_availability: {
				Args: { p_song_ids: string[] };
				Returns: {
					audio_feature_id: string;
					error_code: string;
					job_id: string;
					song_id: string;
					state: string;
				}[];
			};
			get_entitled_likers_of_song: {
				Args: { p_song_id: string };
				Returns: {
					account_id: string;
				}[];
			};
			get_library_artist_count: {
				Args: { p_account_id: string };
				Returns: number;
			};
			get_liked_song_by_slug: {
				Args: { p_account_id: string; p_min_score?: number; p_slug: string };
				Returns: {
					analysis_content: Json;
					analysis_created_at: string;
					analysis_id: string;
					analysis_model: string;
					artist_image_url: string;
					audio_energy: number;
					audio_tempo: number;
					audio_valence: number;
					content_fetch_status: string;
					display_state: string;
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
			get_liked_songs_bootstrap_by_slug: {
				Args: {
					p_account_id: string;
					p_min_score?: number;
					p_slug: string;
					p_trailing_limit?: number;
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
					content_fetch_status: string;
					display_state: string;
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
			get_liked_songs_page: {
				Args: {
					p_account_id: string;
					p_cursor?: string;
					p_cursor_id?: string;
					p_filter?: string;
					p_limit?: number;
					p_min_score?: number;
					p_search?: string;
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
					content_fetch_status: string;
					display_state: string;
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
				Args: { p_account_id: string; p_min_score?: number };
				Returns: {
					analyzed: number;
					has_suggestions: number;
					locked: number;
					matched: number;
					new_suggestions: number;
					pending: number;
					total: number;
				}[];
			};
			grant_analysis_failure_replacement_credit: {
				Args: {
					p_account_id: string;
					p_failure_code: string;
					p_song_id: string;
				};
				Returns: Json;
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
			grant_liked_song_access: {
				Args: {
					p_account_id: string;
					p_limit?: number;
					p_note?: string;
					p_origin: string;
					p_requested_by?: string;
				};
				Returns: Json;
			};
			insert_queue_song_items: {
				Args: { p_account_id: string; p_items: Json; p_session_id: string };
				Returns: undefined;
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
			is_waitlist_eligible_for_liked_song_grant: {
				Args: { p_account_id: string };
				Returns: boolean;
			};
			link_subscription_upgrade_checkout: {
				Args: { p_checkout_session_id: string; p_conversion_id: string };
				Returns: undefined;
			};
			mark_audio_feature_backfill_manual_needed: {
				Args: {
					p_error_code: string;
					p_error_message: string;
					p_job_id: string;
					p_worker_id: string;
				};
				Returns: {
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error_code: string | null;
					error_message: string | null;
					id: string;
					lease_expires_at: string | null;
					locked_at: string | null;
					locked_by: string | null;
					max_attempts: number;
					not_before: string;
					progress: Json;
					requested_by_account_id: string | null;
					song_id: string;
					source_type: string;
					source_url: string | null;
					started_at: string | null;
					status: string;
					superseded_by_job_id: string | null;
					updated_at: string;
				}[];
				SetofOptions: {
					from: "*";
					to: "audio_feature_backfill_job";
					isOneToOne: false;
					isSetofReturn: true;
				};
			};
			mark_billing_bridge_event_failed: {
				Args: { p_error_message: string; p_stripe_event_id: string };
				Returns: undefined;
			};
			mark_billing_bridge_event_processed: {
				Args: { p_stripe_event_id: string };
				Returns: undefined;
			};
			mark_dead_extension_sync_jobs: {
				Args: { stale_threshold: string };
				Returns: {
					account_id: string;
					attempts: number;
					available_at: string;
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
			mark_dead_library_processing_jobs: {
				Args: { stale_threshold: string };
				Returns: {
					account_id: string;
					attempts: number;
					available_at: string;
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
					available_at: string;
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
			mark_stale_extension_sync_jobs: {
				Args: { p_account_id: string; p_stale_threshold: string };
				Returns: {
					account_id: string;
					attempts: number;
					available_at: string;
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
			quote_subscription_upgrade_conversion: {
				Args: { p_account_id: string };
				Returns: {
					converted_credits: number;
					discount_cents: number;
				}[];
			};
			refresh_song_vocal_gender: { Args: never; Returns: number };
			refresh_song_vocal_gender_for: {
				Args: { p_song_ids: string[] };
				Returns: number;
			};
			release_provider_lease: {
				Args: { p_holder: string; p_provider: string };
				Returns: undefined;
			};
			release_subscription_upgrade_conversion: {
				Args: { p_conversion_id: string };
				Returns: undefined;
			};
			reprioritize_pending_jobs_for_account: {
				Args: { p_account_id: string };
				Returns: number;
			};
			resolve_job_item_stage_failures: {
				Args: { p_account_id: string; p_item_id: string; p_stage: string };
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
			select_songs_needing_language_detection: {
				Args: { p_song_ids: string[] };
				Returns: {
					lyrics_text: string;
					song_id: string;
				}[];
			};
			settle_audio_feature_backfill_job: {
				Args: {
					p_aggregation_metadata?: Json;
					p_candidate_rank?: number;
					p_clip_features?: Json;
					p_clip_starts_seconds?: number[];
					p_features: Json;
					p_job_id: string;
					p_match_reasons?: Json;
					p_match_score?: number;
					p_rejected_candidates?: Json;
					p_review_status: string;
					p_reviewed_by?: string;
					p_search_query?: string;
					p_song_id: string;
					p_source_type: string;
					p_worker_id: string;
					p_youtube_channel?: string;
					p_youtube_duration_seconds?: number;
					p_youtube_thumbnail_url?: string;
					p_youtube_title?: string;
					p_youtube_url?: string;
					p_youtube_video_id?: string;
				};
				Returns: {
					audio_feature_id: string;
					did_skip: boolean;
					job_id: string;
					review_id: string;
				}[];
			};
			song_artists_joined: { Args: { p_artists: string[] }; Returns: string };
			song_slug: {
				Args: { p_artists: string[]; p_name: string };
				Returns: string;
			};
			sweep_stale_audio_feature_backfill_jobs: {
				Args: never;
				Returns: {
					attempts: number;
					completed_at: string | null;
					created_at: string;
					error_code: string | null;
					error_message: string | null;
					id: string;
					lease_expires_at: string | null;
					locked_at: string | null;
					locked_by: string | null;
					max_attempts: number;
					not_before: string;
					progress: Json;
					requested_by_account_id: string | null;
					song_id: string;
					source_type: string;
					source_url: string | null;
					started_at: string | null;
					status: string;
					superseded_by_job_id: string | null;
					updated_at: string;
				}[];
				SetofOptions: {
					from: "*";
					to: "audio_feature_backfill_job";
					isOneToOne: false;
					isSetofReturn: true;
				};
			};
			sweep_stale_extension_sync_jobs: {
				Args: { stale_threshold: string };
				Returns: {
					account_id: string;
					attempts: number;
					available_at: string;
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
			sweep_stale_library_processing_jobs: {
				Args: { stale_threshold: string };
				Returns: {
					account_id: string;
					attempts: number;
					available_at: string;
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
					available_at: string;
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
			touch_account_last_seen: {
				Args: { p_account_id: string };
				Returns: undefined;
			};
			unlock_songs_for_account: {
				Args: { p_account_id: string; p_song_ids: string[] };
				Returns: Json;
			};
			update_subscription_state: {
				Args: {
					p_account_id: string;
					p_cancel_at_period_end: boolean;
					p_stripe_event_created_at: string;
					p_subscription_period_end: string;
					p_subscription_status: string;
				};
				Returns: undefined;
			};
			upsert_song_analysis: {
				Args: {
					p_analysis: Json;
					p_cleanup_error?: string;
					p_cleanup_passes?: number;
					p_cleanup_tells_after?: number;
					p_cleanup_tells_before?: number;
					p_cost_cents?: number;
					p_model: string;
					p_prompt_version?: string;
					p_song_id: string;
					p_tokens_used?: number;
				};
				Returns: {
					analysis: Json;
					cleanup_error: string | null;
					cleanup_passes: number | null;
					cleanup_tells_after: number | null;
					cleanup_tells_before: number | null;
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
				}[];
				SetofOptions: {
					from: "*";
					to: "song_analysis";
					isOneToOne: false;
					isSetofReturn: true;
				};
			};
			uuidv7: { Args: never; Returns: string };
			validate_extension_token: {
				Args: { p_token_hash: string };
				Returns: string;
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
				| "match_snapshot_refresh"
				| "extension_sync";
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
				"extension_sync",
			],
			theme: ["blue", "green", "rose", "lavender"],
		},
	},
} as const;
