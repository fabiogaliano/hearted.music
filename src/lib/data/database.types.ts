export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          spotify_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          spotify_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          spotify_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      auth_token: {
        Row: {
          access_token: string
          account_id: string
          created_at: string
          id: string
          refresh_token: string
          token_expires_at: string
          updated_at: string
        }
        Insert: {
          access_token: string
          account_id: string
          created_at?: string
          id?: string
          refresh_token: string
          token_expires_at: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          account_id?: string
          created_at?: string
          id?: string
          refresh_token?: string
          token_expires_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_token_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
        ]
      }
      job: {
        Row: {
          account_id: string
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          progress: Json | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          type: Database["public"]["Enums"]["job_type"]
          updated_at: string
        }
        Insert: {
          account_id: string
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          progress?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          type: Database["public"]["Enums"]["job_type"]
          updated_at?: string
        }
        Update: {
          account_id?: string
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          progress?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          type?: Database["public"]["Enums"]["job_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
        ]
      }
      liked_song: {
        Row: {
          account_id: string
          created_at: string
          id: string
          liked_at: string
          song_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          liked_at: string
          song_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          liked_at?: string
          song_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "liked_song_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "liked_song_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "song"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist: {
        Row: {
          account_id: string
          created_at: string
          description: string | null
          id: string
          is_public: boolean | null
          name: string
          snapshot_id: string | null
          spotify_id: string
          track_count: number | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean | null
          name: string
          snapshot_id?: string | null
          spotify_id: string
          track_count?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean | null
          name?: string
          snapshot_id?: string | null
          spotify_id?: string
          track_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_song: {
        Row: {
          added_at: string | null
          created_at: string
          id: string
          playlist_id: string
          position: number
          song_id: string
          updated_at: string
        }
        Insert: {
          added_at?: string | null
          created_at?: string
          id?: string
          playlist_id: string
          position?: number
          song_id: string
          updated_at?: string
        }
        Update: {
          added_at?: string | null
          created_at?: string
          id?: string
          playlist_id?: string
          position?: number
          song_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_song_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlist"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_song_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "song"
            referencedColumns: ["id"]
          },
        ]
      }
      song: {
        Row: {
          album_id: string | null
          album_name: string | null
          artists: Json
          created_at: string
          duration_ms: number | null
          id: string
          name: string
          popularity: number | null
          preview_url: string | null
          spotify_id: string
          updated_at: string
        }
        Insert: {
          album_id?: string | null
          album_name?: string | null
          artists?: Json
          created_at?: string
          duration_ms?: number | null
          id?: string
          name: string
          popularity?: number | null
          preview_url?: string | null
          spotify_id: string
          updated_at?: string
        }
        Update: {
          album_id?: string | null
          album_name?: string | null
          artists?: Json
          created_at?: string
          duration_ms?: number | null
          id?: string
          name?: string
          popularity?: number | null
          preview_url?: string | null
          spotify_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      job_status: "pending" | "running" | "completed" | "failed"
      job_type: "sync_liked_songs" | "sync_playlists"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      job_status: ["pending", "running", "completed", "failed"],
      job_type: ["sync_liked_songs", "sync_playlists"],
    },
  },
} as const

