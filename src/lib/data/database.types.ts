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
			app_token: {
				Row: {
					access_token: string;
					id: string;
					token_expires_at: string;
					updated_at: string;
				};
				Insert: {
					access_token: string;
					id?: string;
					token_expires_at: string;
					updated_at?: string;
				};
				Update: {
					access_token?: string;
					id?: string;
					token_expires_at?: string;
					updated_at?: string;
				};
				Relationships: [];
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
			match_context: {
				Row: {
					account_id: string;
					algorithm_version: string;
					analysis_model: string | null;
					analysis_version: string | null;
					candidate_set_hash: string;
					config_hash: string;
					context_hash: string;
					created_at: string;
					embedding_model: string | null;
					embedding_version: string | null;
					id: string;
					playlist_count: number;
					playlist_set_hash: string;
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
					context_hash: string;
					created_at?: string;
					embedding_model?: string | null;
					embedding_version?: string | null;
					id?: string;
					playlist_count?: number;
					playlist_set_hash: string;
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
					context_hash?: string;
					created_at?: string;
					embedding_model?: string | null;
					embedding_version?: string | null;
					id?: string;
					playlist_count?: number;
					playlist_set_hash?: string;
					song_count?: number;
					weights?: Json;
				};
				Relationships: [
					{
						foreignKeyName: "match_context_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: false;
						referencedRelation: "account";
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
					context_id: string;
					created_at: string;
					factors: Json;
					id: string;
					playlist_id: string;
					rank: number | null;
					score: number;
					song_id: string;
				};
				Insert: {
					context_id: string;
					created_at?: string;
					factors?: Json;
					id?: string;
					playlist_id: string;
					rank?: number | null;
					score: number;
					song_id: string;
				};
				Update: {
					context_id?: string;
					created_at?: string;
					factors?: Json;
					id?: string;
					playlist_id?: string;
					rank?: number | null;
					score?: number;
					song_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "match_result_context_id_fkey";
						columns: ["context_id"];
						isOneToOne: false;
						referencedRelation: "match_context";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_result_playlist_id_fkey";
						columns: ["playlist_id"];
						isOneToOne: false;
						referencedRelation: "playlist";
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
			playlist: {
				Row: {
					account_id: string;
					created_at: string;
					description: string | null;
					id: string;
					image_url: string | null;
					is_destination: boolean | null;
					is_public: boolean | null;
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
					is_destination?: boolean | null;
					is_public?: boolean | null;
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
					is_destination?: boolean | null;
					is_public?: boolean | null;
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
					created_at: string;
					id: string;
					model: string;
					prompt_version: string | null;
					song_id: string;
					tokens_used: number | null;
					updated_at: string;
				};
				Insert: {
					analysis: Json;
					cost_cents?: number | null;
					created_at?: string;
					id?: string;
					model: string;
					prompt_version?: string | null;
					song_id: string;
					tokens_used?: number | null;
					updated_at?: string;
				};
				Update: {
					analysis?: Json;
					cost_cents?: number | null;
					created_at?: string;
					id?: string;
					model?: string;
					prompt_version?: string | null;
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
					enrichment_job_id: string | null;
					id: string;
					onboarding_completed_at: string | null;
					onboarding_step: string;
					phase_job_ids: Json | null;
					rematch_job_id: string | null;
					theme: Database["public"]["Enums"]["theme"] | null;
					updated_at: string;
				};
				Insert: {
					account_id: string;
					created_at?: string;
					enrichment_job_id?: string | null;
					id?: string;
					onboarding_completed_at?: string | null;
					onboarding_step?: string;
					phase_job_ids?: Json | null;
					rematch_job_id?: string | null;
					theme?: Database["public"]["Enums"]["theme"] | null;
					updated_at?: string;
				};
				Update: {
					account_id?: string;
					created_at?: string;
					enrichment_job_id?: string | null;
					id?: string;
					onboarding_completed_at?: string | null;
					onboarding_step?: string;
					phase_job_ids?: Json | null;
					rematch_job_id?: string | null;
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
						foreignKeyName: "user_preferences_enrichment_job_id_fkey";
						columns: ["enrichment_job_id"];
						isOneToOne: false;
						referencedRelation: "job";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "user_preferences_rematch_job_id_fkey";
						columns: ["rematch_job_id"];
						isOneToOne: false;
						referencedRelation: "job";
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
			claim_pending_enrichment_job: {
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
			mark_dead_enrichment_jobs: {
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
			sweep_stale_enrichment_jobs: {
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
				| "rematch";
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
			],
			theme: ["blue", "green", "rose", "lavender"],
		},
	},
} as const;
