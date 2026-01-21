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
					created_at: string;
					display_name: string | null;
					email: string | null;
					id: string;
					spotify_id: string;
					updated_at: string;
				};
				Insert: {
					created_at?: string;
					display_name?: string | null;
					email?: string | null;
					id?: string;
					spotify_id: string;
					updated_at?: string;
				};
				Update: {
					created_at?: string;
					display_name?: string | null;
					email?: string | null;
					id?: string;
					spotify_id?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			auth_token: {
				Row: {
					access_token: string;
					account_id: string;
					created_at: string;
					id: string;
					refresh_token: string;
					token_expires_at: string;
					updated_at: string;
				};
				Insert: {
					access_token: string;
					account_id: string;
					created_at?: string;
					id?: string;
					refresh_token: string;
					token_expires_at: string;
					updated_at?: string;
				};
				Update: {
					access_token?: string;
					account_id?: string;
					created_at?: string;
					id?: string;
					refresh_token?: string;
					token_expires_at?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "auth_token_account_id_fkey";
						columns: ["account_id"];
						isOneToOne: true;
						referencedRelation: "account";
						referencedColumns: ["id"];
					},
				];
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
						isOneToOne: false;
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
					status: string | null;
					unliked_at: string | null;
					updated_at: string;
				};
				Insert: {
					account_id: string;
					created_at?: string;
					id?: string;
					liked_at: string;
					song_id: string;
					status?: string | null;
					unliked_at?: string | null;
					updated_at?: string;
				};
				Update: {
					account_id?: string;
					created_at?: string;
					id?: string;
					liked_at?: string;
					song_id?: string;
					status?: string | null;
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
			playlist: {
				Row: {
					account_id: string;
					created_at: string;
					description: string | null;
					id: string;
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
			song: {
				Row: {
					album_id: string | null;
					album_name: string | null;
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
			user_preferences: {
				Row: {
					account_id: string;
					created_at: string;
					id: string;
					onboarding_completed_at: string | null;
					onboarding_step: string;
					theme: Database["public"]["Enums"]["theme"];
					updated_at: string;
				};
				Insert: {
					account_id: string;
					created_at?: string;
					id?: string;
					onboarding_completed_at?: string | null;
					onboarding_step?: string;
					theme?: Database["public"]["Enums"]["theme"];
					updated_at?: string;
				};
				Update: {
					account_id?: string;
					created_at?: string;
					id?: string;
					onboarding_completed_at?: string | null;
					onboarding_step?: string;
					theme?: Database["public"]["Enums"]["theme"];
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
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			[_ in never]: never;
		};
		Enums: {
			item_type: "song" | "playlist";
			job_status: "pending" | "running" | "completed" | "failed";
			job_type:
				| "sync_liked_songs"
				| "sync_playlists"
				| "song_analysis"
				| "playlist_analysis"
				| "matching";
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
			],
			theme: ["blue", "green", "rose", "lavender"],
		},
	},
} as const;
