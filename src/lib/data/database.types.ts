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
	pgbouncer: {
		Tables: {
			[_ in never]: never;
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			get_auth: {
				Args: { p_usename: string };
				Returns: {
					password: string;
					username: string;
				}[];
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
					action_type: string | null;
					actioned_at: string | null;
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
					action_type?: string | null;
					actioned_at?: string | null;
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
					action_type?: string | null;
					actioned_at?: string | null;
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
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
			};
			job: {
				Row: {
					account_id: string;
					completed_at: string | null;
					created_at: string;
					error: string | null;
					id: string;
					progress: Json | null;
					started_at: string | null;
					status: Database["public"]["Enums"]["job_status"];
					type: Database["public"]["Enums"]["job_type"];
					updated_at: string;
				};
				Insert: {
					account_id: string;
					completed_at?: string | null;
					created_at?: string;
					error?: string | null;
					id?: string;
					progress?: Json | null;
					started_at?: string | null;
					status?: Database["public"]["Enums"]["job_status"];
					type: Database["public"]["Enums"]["job_type"];
					updated_at?: string;
				};
				Update: {
					account_id?: string;
					completed_at?: string | null;
					created_at?: string;
					error?: string | null;
					id?: string;
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
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "liked_song_song_id_fkey";
						columns: ["song_id"];
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
						referencedRelation: "account";
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
						referencedRelation: "match_context";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_result_playlist_id_fkey";
						columns: ["playlist_id"];
						referencedRelation: "playlist";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "match_result_song_id_fkey";
						columns: ["song_id"];
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
						referencedRelation: "playlist";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "playlist_song_song_id_fkey";
						columns: ["song_id"];
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
					matched: number;
					pending: number;
					total: number;
				}[];
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
				| "playlist_profiling";
			theme: "blue" | "green" | "rose" | "lavender";
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
	storage: {
		Tables: {
			buckets: {
				Row: {
					allowed_mime_types: string[] | null;
					avif_autodetection: boolean | null;
					created_at: string | null;
					file_size_limit: number | null;
					id: string;
					name: string;
					owner: string | null;
					owner_id: string | null;
					public: boolean | null;
					type: Database["storage"]["Enums"]["buckettype"];
					updated_at: string | null;
				};
				Insert: {
					allowed_mime_types?: string[] | null;
					avif_autodetection?: boolean | null;
					created_at?: string | null;
					file_size_limit?: number | null;
					id: string;
					name: string;
					owner?: string | null;
					owner_id?: string | null;
					public?: boolean | null;
					type?: Database["storage"]["Enums"]["buckettype"];
					updated_at?: string | null;
				};
				Update: {
					allowed_mime_types?: string[] | null;
					avif_autodetection?: boolean | null;
					created_at?: string | null;
					file_size_limit?: number | null;
					id?: string;
					name?: string;
					owner?: string | null;
					owner_id?: string | null;
					public?: boolean | null;
					type?: Database["storage"]["Enums"]["buckettype"];
					updated_at?: string | null;
				};
				Relationships: [];
			};
			buckets_analytics: {
				Row: {
					created_at: string;
					deleted_at: string | null;
					format: string;
					id: string;
					name: string;
					type: Database["storage"]["Enums"]["buckettype"];
					updated_at: string;
				};
				Insert: {
					created_at?: string;
					deleted_at?: string | null;
					format?: string;
					id?: string;
					name: string;
					type?: Database["storage"]["Enums"]["buckettype"];
					updated_at?: string;
				};
				Update: {
					created_at?: string;
					deleted_at?: string | null;
					format?: string;
					id?: string;
					name?: string;
					type?: Database["storage"]["Enums"]["buckettype"];
					updated_at?: string;
				};
				Relationships: [];
			};
			buckets_vectors: {
				Row: {
					created_at: string;
					id: string;
					type: Database["storage"]["Enums"]["buckettype"];
					updated_at: string;
				};
				Insert: {
					created_at?: string;
					id: string;
					type?: Database["storage"]["Enums"]["buckettype"];
					updated_at?: string;
				};
				Update: {
					created_at?: string;
					id?: string;
					type?: Database["storage"]["Enums"]["buckettype"];
					updated_at?: string;
				};
				Relationships: [];
			};
			iceberg_namespaces: {
				Row: {
					bucket_name: string;
					catalog_id: string;
					created_at: string;
					id: string;
					metadata: Json;
					name: string;
					updated_at: string;
				};
				Insert: {
					bucket_name: string;
					catalog_id: string;
					created_at?: string;
					id?: string;
					metadata?: Json;
					name: string;
					updated_at?: string;
				};
				Update: {
					bucket_name?: string;
					catalog_id?: string;
					created_at?: string;
					id?: string;
					metadata?: Json;
					name?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "iceberg_namespaces_catalog_id_fkey";
						columns: ["catalog_id"];
						referencedRelation: "buckets_analytics";
						referencedColumns: ["id"];
					},
				];
			};
			iceberg_tables: {
				Row: {
					bucket_name: string;
					catalog_id: string;
					created_at: string;
					id: string;
					location: string;
					name: string;
					namespace_id: string;
					remote_table_id: string | null;
					shard_id: string | null;
					shard_key: string | null;
					updated_at: string;
				};
				Insert: {
					bucket_name: string;
					catalog_id: string;
					created_at?: string;
					id?: string;
					location: string;
					name: string;
					namespace_id: string;
					remote_table_id?: string | null;
					shard_id?: string | null;
					shard_key?: string | null;
					updated_at?: string;
				};
				Update: {
					bucket_name?: string;
					catalog_id?: string;
					created_at?: string;
					id?: string;
					location?: string;
					name?: string;
					namespace_id?: string;
					remote_table_id?: string | null;
					shard_id?: string | null;
					shard_key?: string | null;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "iceberg_tables_catalog_id_fkey";
						columns: ["catalog_id"];
						referencedRelation: "buckets_analytics";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "iceberg_tables_namespace_id_fkey";
						columns: ["namespace_id"];
						referencedRelation: "iceberg_namespaces";
						referencedColumns: ["id"];
					},
				];
			};
			migrations: {
				Row: {
					executed_at: string | null;
					hash: string;
					id: number;
					name: string;
				};
				Insert: {
					executed_at?: string | null;
					hash: string;
					id: number;
					name: string;
				};
				Update: {
					executed_at?: string | null;
					hash?: string;
					id?: number;
					name?: string;
				};
				Relationships: [];
			};
			objects: {
				Row: {
					bucket_id: string | null;
					created_at: string | null;
					id: string;
					last_accessed_at: string | null;
					metadata: Json | null;
					name: string | null;
					owner: string | null;
					owner_id: string | null;
					path_tokens: string[] | null;
					updated_at: string | null;
					user_metadata: Json | null;
					version: string | null;
				};
				Insert: {
					bucket_id?: string | null;
					created_at?: string | null;
					id?: string;
					last_accessed_at?: string | null;
					metadata?: Json | null;
					name?: string | null;
					owner?: string | null;
					owner_id?: string | null;
					path_tokens?: string[] | null;
					updated_at?: string | null;
					user_metadata?: Json | null;
					version?: string | null;
				};
				Update: {
					bucket_id?: string | null;
					created_at?: string | null;
					id?: string;
					last_accessed_at?: string | null;
					metadata?: Json | null;
					name?: string | null;
					owner?: string | null;
					owner_id?: string | null;
					path_tokens?: string[] | null;
					updated_at?: string | null;
					user_metadata?: Json | null;
					version?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "objects_bucketId_fkey";
						columns: ["bucket_id"];
						referencedRelation: "buckets";
						referencedColumns: ["id"];
					},
				];
			};
			s3_multipart_uploads: {
				Row: {
					bucket_id: string;
					created_at: string;
					id: string;
					in_progress_size: number;
					key: string;
					owner_id: string | null;
					upload_signature: string;
					user_metadata: Json | null;
					version: string;
				};
				Insert: {
					bucket_id: string;
					created_at?: string;
					id: string;
					in_progress_size?: number;
					key: string;
					owner_id?: string | null;
					upload_signature: string;
					user_metadata?: Json | null;
					version: string;
				};
				Update: {
					bucket_id?: string;
					created_at?: string;
					id?: string;
					in_progress_size?: number;
					key?: string;
					owner_id?: string | null;
					upload_signature?: string;
					user_metadata?: Json | null;
					version?: string;
				};
				Relationships: [
					{
						foreignKeyName: "s3_multipart_uploads_bucket_id_fkey";
						columns: ["bucket_id"];
						referencedRelation: "buckets";
						referencedColumns: ["id"];
					},
				];
			};
			s3_multipart_uploads_parts: {
				Row: {
					bucket_id: string;
					created_at: string;
					etag: string;
					id: string;
					key: string;
					owner_id: string | null;
					part_number: number;
					size: number;
					upload_id: string;
					version: string;
				};
				Insert: {
					bucket_id: string;
					created_at?: string;
					etag: string;
					id?: string;
					key: string;
					owner_id?: string | null;
					part_number: number;
					size?: number;
					upload_id: string;
					version: string;
				};
				Update: {
					bucket_id?: string;
					created_at?: string;
					etag?: string;
					id?: string;
					key?: string;
					owner_id?: string | null;
					part_number?: number;
					size?: number;
					upload_id?: string;
					version?: string;
				};
				Relationships: [
					{
						foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey";
						columns: ["bucket_id"];
						referencedRelation: "buckets";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey";
						columns: ["upload_id"];
						referencedRelation: "s3_multipart_uploads";
						referencedColumns: ["id"];
					},
				];
			};
			vector_indexes: {
				Row: {
					bucket_id: string;
					created_at: string;
					data_type: string;
					dimension: number;
					distance_metric: string;
					id: string;
					metadata_configuration: Json | null;
					name: string;
					updated_at: string;
				};
				Insert: {
					bucket_id: string;
					created_at?: string;
					data_type: string;
					dimension: number;
					distance_metric: string;
					id?: string;
					metadata_configuration?: Json | null;
					name: string;
					updated_at?: string;
				};
				Update: {
					bucket_id?: string;
					created_at?: string;
					data_type?: string;
					dimension?: number;
					distance_metric?: string;
					id?: string;
					metadata_configuration?: Json | null;
					name?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "vector_indexes_bucket_id_fkey";
						columns: ["bucket_id"];
						referencedRelation: "buckets_vectors";
						referencedColumns: ["id"];
					},
				];
			};
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			can_insert_object: {
				Args: { bucketid: string; metadata: Json; name: string; owner: string };
				Returns: undefined;
			};
			extension: { Args: { name: string }; Returns: string };
			filename: { Args: { name: string }; Returns: string };
			foldername: { Args: { name: string }; Returns: string[] };
			get_common_prefix: {
				Args: { p_delimiter: string; p_key: string; p_prefix: string };
				Returns: string;
			};
			get_size_by_bucket: {
				Args: never;
				Returns: {
					bucket_id: string;
					size: number;
				}[];
			};
			list_multipart_uploads_with_delimiter: {
				Args: {
					bucket_id: string;
					delimiter_param: string;
					max_keys?: number;
					next_key_token?: string;
					next_upload_token?: string;
					prefix_param: string;
				};
				Returns: {
					created_at: string;
					id: string;
					key: string;
				}[];
			};
			list_objects_with_delimiter: {
				Args: {
					_bucket_id: string;
					delimiter_param: string;
					max_keys?: number;
					next_token?: string;
					prefix_param: string;
					sort_order?: string;
					start_after?: string;
				};
				Returns: {
					created_at: string;
					id: string;
					last_accessed_at: string;
					metadata: Json;
					name: string;
					updated_at: string;
				}[];
			};
			operation: { Args: never; Returns: string };
			search: {
				Args: {
					bucketname: string;
					levels?: number;
					limits?: number;
					offsets?: number;
					prefix: string;
					search?: string;
					sortcolumn?: string;
					sortorder?: string;
				};
				Returns: {
					created_at: string;
					id: string;
					last_accessed_at: string;
					metadata: Json;
					name: string;
					updated_at: string;
				}[];
			};
			search_by_timestamp: {
				Args: {
					p_bucket_id: string;
					p_level: number;
					p_limit: number;
					p_prefix: string;
					p_sort_column: string;
					p_sort_column_after: string;
					p_sort_order: string;
					p_start_after: string;
				};
				Returns: {
					created_at: string;
					id: string;
					key: string;
					last_accessed_at: string;
					metadata: Json;
					name: string;
					updated_at: string;
				}[];
			};
			search_v2: {
				Args: {
					bucket_name: string;
					levels?: number;
					limits?: number;
					prefix: string;
					sort_column?: string;
					sort_column_after?: string;
					sort_order?: string;
					start_after?: string;
				};
				Returns: {
					created_at: string;
					id: string;
					key: string;
					last_accessed_at: string;
					metadata: Json;
					name: string;
					updated_at: string;
				}[];
			};
		};
		Enums: {
			buckettype: "STANDARD" | "ANALYTICS" | "VECTOR";
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
	pgbouncer: {
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
			],
			theme: ["blue", "green", "rose", "lavender"],
		},
	},
	storage: {
		Enums: {
			buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
		},
	},
} as const;
