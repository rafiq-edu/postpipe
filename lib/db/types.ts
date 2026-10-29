export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          last4: string
          mode: string
          name: string
          org_id: string
          revoked_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          last4: string
          mode: string
          name: string
          org_id: string
          revoked_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          last4?: string
          mode?: string
          name?: string
          org_id?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          event_id: string
          received_at: string
          type: string
        }
        Insert: {
          event_id: string
          received_at?: string
          type: string
        }
        Update: {
          event_id?: string
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      bluesky_oauth_sessions: {
        Row: {
          key_version: number
          session_enc: string
          sub: string
          updated_at: string
        }
        Insert: {
          key_version: number
          session_enc: string
          sub: string
          updated_at?: string
        }
        Update: {
          key_version?: number
          session_enc?: string
          sub?: string
          updated_at?: string
        }
        Relationships: []
      }
      bluesky_oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          key: string
          state_enc: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          key: string
          state_enc: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          key?: string
          state_enc?: string
        }
        Relationships: []
      }
      connect_sessions: {
        Row: {
          created_at: string
          expires_at: string
          external_id: string
          failed_attempts: number
          id: string
          mode: string
          org_id: string
          pkce_verifier_enc: string | null
          platform: string
          platform_data: Json
          redirect_url: string | null
          state: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          external_id: string
          failed_attempts?: number
          id?: string
          mode: string
          org_id: string
          pkce_verifier_enc?: string | null
          platform: string
          platform_data?: Json
          redirect_url?: string | null
          state: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          external_id?: string
          failed_attempts?: number
          id?: string
          mode?: string
          org_id?: string
          pkce_verifier_enc?: string | null
          platform?: string
          platform_data?: Json
          redirect_url?: string | null
          state?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connect_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          expires_at: string
          key: string
          org_id: string
          request_hash: string
          response: Json | null
        }
        Insert: {
          expires_at: string
          key: string
          org_id: string
          request_hash: string
          response?: Json | null
        }
        Update: {
          expires_at?: string
          key?: string
          org_id?: string
          request_hash?: string
          response?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      media: {
        Row: {
          bytes: number
          created_at: string
          duration_ms: number | null
          height: number | null
          id: string
          last_used_at: string | null
          mime: string
          mode: string
          org_id: string
          status: Database["public"]["Enums"]["media_status"]
          storage_path: string
          width: number | null
        }
        Insert: {
          bytes: number
          created_at?: string
          duration_ms?: number | null
          height?: number | null
          id?: string
          last_used_at?: string | null
          mime: string
          mode: string
          org_id: string
          status?: Database["public"]["Enums"]["media_status"]
          storage_path: string
          width?: number | null
        }
        Update: {
          bytes?: number
          created_at?: string
          duration_ms?: number | null
          height?: number | null
          id?: string
          last_used_at?: string | null
          mime?: string
          mode?: string
          org_id?: string
          status?: Database["public"]["Enums"]["media_status"]
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          org_id: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          org_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_deletion_requests: {
        Row: {
          confirmation_code: string
          created_at: string
          platform_user_id: string
          status: string
        }
        Insert: {
          confirmation_code: string
          created_at?: string
          platform_user_id: string
          status: string
        }
        Update: {
          confirmation_code?: string
          created_at?: string
          platform_user_id?: string
          status?: string
        }
        Relationships: []
      }
      oauth_locks: {
        Row: {
          expires_at: string
          name: string
          owner: string
        }
        Insert: {
          expires_at: string
          name: string
          owner?: string
        }
        Update: {
          expires_at?: string
          name?: string
          owner?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          billing_customer_id: string | null
          branding: Json
          created_at: string
          id: string
          name: string
          plan: string
          plan_ends_at: string | null
          polar_subscription_id: string | null
        }
        Insert: {
          billing_customer_id?: string | null
          branding?: Json
          created_at?: string
          id?: string
          name: string
          plan?: string
          plan_ends_at?: string | null
          polar_subscription_id?: string | null
        }
        Update: {
          billing_customer_id?: string | null
          branding?: Json
          created_at?: string
          id?: string
          name?: string
          plan?: string
          plan_ends_at?: string | null
          polar_subscription_id?: string | null
        }
        Relationships: []
      }
      platform_approvals: {
        Row: {
          note: string | null
          platform: string
          status: Database["public"]["Enums"]["platform_approval_status"]
          updated_at: string
        }
        Insert: {
          note?: string | null
          platform: string
          status?: Database["public"]["Enums"]["platform_approval_status"]
          updated_at?: string
        }
        Update: {
          note?: string | null
          platform?: string
          status?: Database["public"]["Enums"]["platform_approval_status"]
          updated_at?: string
        }
        Relationships: []
      }
      platform_apps: {
        Row: {
          client_id: string
          client_secret_enc: string
          created_at: string
          extra: string | null
          id: string
          key_version: number
          org_id: string
          platform: string
          updated_at: string
        }
        Insert: {
          client_id: string
          client_secret_enc: string
          created_at?: string
          extra?: string | null
          id?: string
          key_version?: number
          org_id: string
          platform: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_secret_enc?: string
          created_at?: string
          extra?: string | null
          id?: string
          key_version?: number
          org_id?: string
          platform?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_apps_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_quotas: {
        Row: {
          count: number
          day: string
          scope: string
        }
        Insert: {
          count?: number
          day: string
          scope: string
        }
        Update: {
          count?: number
          day?: string
          scope?: string
        }
        Relationships: []
      }
      publish_runs: {
        Row: {
          detail: Json | null
          finished_at: string | null
          id: string
          org_id: string
          started_at: string
          status: Database["public"]["Enums"]["publish_run_status"]
          step: string
          target_id: string
        }
        Insert: {
          detail?: Json | null
          finished_at?: string | null
          id?: string
          org_id: string
          started_at?: string
          status: Database["public"]["Enums"]["publish_run_status"]
          step: string
          target_id: string
        }
        Update: {
          detail?: Json | null
          finished_at?: string | null
          id?: string
          org_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["publish_run_status"]
          step?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publish_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_runs_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "social_post_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          api_key_id: string
          count: number
          minute: string
        }
        Insert: {
          api_key_id: string
          count?: number
          minute: string
        }
        Update: {
          api_key_id?: string
          count?: number
          minute?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limits_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_limits_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys_public"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_jobs: {
        Row: {
          last_run_at: string | null
          name: string
        }
        Insert: {
          last_run_at?: string | null
          name: string
        }
        Update: {
          last_run_at?: string | null
          name?: string
        }
        Relationships: []
      }
      social_accounts: {
        Row: {
          access_token_enc: string | null
          avatar_url: string | null
          created_at: string
          deleted_at: string | null
          display_name: string | null
          expiring_notified_at: string | null
          external_id: string
          id: string
          key_version: number
          mode: string
          org_id: string
          platform: string
          platform_data: Json
          platform_user_id: string
          refresh_expires_at: string | null
          refresh_lock_at: string | null
          refresh_token_enc: string | null
          scopes: string[]
          status: Database["public"]["Enums"]["social_account_status"]
          token_expires_at: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          access_token_enc?: string | null
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          expiring_notified_at?: string | null
          external_id: string
          id?: string
          key_version?: number
          mode: string
          org_id: string
          platform: string
          platform_data?: Json
          platform_user_id: string
          refresh_expires_at?: string | null
          refresh_lock_at?: string | null
          refresh_token_enc?: string | null
          scopes?: string[]
          status?: Database["public"]["Enums"]["social_account_status"]
          token_expires_at?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          access_token_enc?: string | null
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          expiring_notified_at?: string | null
          external_id?: string
          id?: string
          key_version?: number
          mode?: string
          org_id?: string
          platform?: string
          platform_data?: Json
          platform_user_id?: string
          refresh_expires_at?: string | null
          refresh_lock_at?: string | null
          refresh_token_enc?: string | null
          scopes?: string[]
          status?: Database["public"]["Enums"]["social_account_status"]
          token_expires_at?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_targets: {
        Row: {
          attempts: number
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          locked_at: string | null
          mode: string
          next_attempt_at: string | null
          org_id: string
          platform: string
          platform_post_id: string | null
          platform_post_url: string | null
          platform_publish_id: string | null
          post_id: string
          publish_state: Json | null
          published_at: string | null
          raw_error: Json | null
          social_account_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["social_post_target_status"]
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          locked_at?: string | null
          mode: string
          next_attempt_at?: string | null
          org_id: string
          platform: string
          platform_post_id?: string | null
          platform_post_url?: string | null
          platform_publish_id?: string | null
          post_id: string
          publish_state?: Json | null
          published_at?: string | null
          raw_error?: Json | null
          social_account_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["social_post_target_status"]
        }
        Update: {
          attempts?: number
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          locked_at?: string | null
          mode?: string
          next_attempt_at?: string | null
          org_id?: string
          platform?: string
          platform_post_id?: string | null
          platform_post_url?: string | null
          platform_publish_id?: string | null
          post_id?: string
          publish_state?: Json | null
          published_at?: string | null
          raw_error?: Json | null
          social_account_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["social_post_target_status"]
        }
        Relationships: [
          {
            foreignKeyName: "social_post_targets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_targets_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_targets_social_account_id_fkey"
            columns: ["social_account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_targets_social_account_id_fkey"
            columns: ["social_account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts_public"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          account_configurations: Json
          caption: string | null
          created_at: string
          external_id: string | null
          id: string
          idempotency_key: string | null
          media: Json
          media_ids: string[]
          mode: string
          org_id: string
          platform_configurations: Json
          scheduled_at: string | null
          social_account_ids: string[]
          status: Database["public"]["Enums"]["social_post_status"]
          updated_at: string
        }
        Insert: {
          account_configurations?: Json
          caption?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          idempotency_key?: string | null
          media?: Json
          media_ids?: string[]
          mode: string
          org_id: string
          platform_configurations?: Json
          scheduled_at?: string | null
          social_account_ids?: string[]
          status?: Database["public"]["Enums"]["social_post_status"]
          updated_at?: string
        }
        Update: {
          account_configurations?: Json
          caption?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          idempotency_key?: string | null
          media?: Json
          media_ids?: string[]
          mode?: string
          org_id?: string
          platform_configurations?: Json
          scheduled_at?: string | null
          social_account_ids?: string[]
          status?: Database["public"]["Enums"]["social_post_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          id: string
          kind: string
          mode: string
          occurred_at: string
          org_id: string
          quantity: number
          target_id: string | null
        }
        Insert: {
          id?: string
          kind: string
          mode: string
          occurred_at?: string
          org_id: string
          quantity?: number
          target_id?: string | null
        }
        Update: {
          id?: string
          kind?: string
          mode?: string
          occurred_at?: string
          org_id?: string
          quantity?: number
          target_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "social_post_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempt: number
          created_at: string
          delivered_at: string | null
          endpoint_id: string
          event: string
          id: string
          mode: string
          next_attempt_at: string | null
          org_id: string
          payload: Json
          response_code: number | null
          status: Database["public"]["Enums"]["webhook_delivery_status"]
        }
        Insert: {
          attempt?: number
          created_at?: string
          delivered_at?: string | null
          endpoint_id: string
          event: string
          id?: string
          mode: string
          next_attempt_at?: string | null
          org_id: string
          payload: Json
          response_code?: number | null
          status?: Database["public"]["Enums"]["webhook_delivery_status"]
        }
        Update: {
          attempt?: number
          created_at?: string
          delivered_at?: string | null
          endpoint_id?: string
          event?: string
          id?: string
          mode?: string
          next_attempt_at?: string | null
          org_id?: string
          payload?: Json
          response_code?: number | null
          status?: Database["public"]["Enums"]["webhook_delivery_status"]
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_deliveries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          created_at: string
          enabled: boolean
          events: string[]
          id: string
          mode: string
          org_id: string
          secret_enc: string
          url: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          events?: string[]
          id?: string
          mode: string
          org_id: string
          secret_enc: string
          url: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          events?: string[]
          id?: string
          mode?: string
          org_id?: string
          secret_enc?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      api_keys_public: {
        Row: {
          created_at: string | null
          id: string | null
          key_prefix: string | null
          last_used_at: string | null
          last4: string | null
          mode: string | null
          name: string | null
          org_id: string | null
          revoked_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          key_prefix?: string | null
          last_used_at?: string | null
          last4?: string | null
          mode?: string | null
          name?: string | null
          org_id?: string | null
          revoked_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          key_prefix?: string | null
          last_used_at?: string | null
          last4?: string | null
          mode?: string | null
          name?: string | null
          org_id?: string | null
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_apps_public: {
        Row: {
          client_id: string | null
          created_at: string | null
          extra: string | null
          id: string | null
          org_id: string | null
          platform: string | null
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          extra?: string | null
          id?: string | null
          org_id?: string | null
          platform?: string | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          extra?: string | null
          id?: string | null
          org_id?: string | null
          platform?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_apps_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      social_accounts_public: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          deleted_at: string | null
          display_name: string | null
          expiring_notified_at: string | null
          external_id: string | null
          id: string | null
          key_version: number | null
          mode: string | null
          org_id: string | null
          platform: string | null
          platform_data: Json | null
          platform_user_id: string | null
          refresh_expires_at: string | null
          scopes: string[] | null
          status: Database["public"]["Enums"]["social_account_status"] | null
          token_expires_at: string | null
          updated_at: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          deleted_at?: string | null
          display_name?: string | null
          expiring_notified_at?: string | null
          external_id?: string | null
          id?: string | null
          key_version?: number | null
          mode?: string | null
          org_id?: string | null
          platform?: string | null
          platform_data?: Json | null
          platform_user_id?: string | null
          refresh_expires_at?: string | null
          scopes?: string[] | null
          status?: Database["public"]["Enums"]["social_account_status"] | null
          token_expires_at?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          deleted_at?: string | null
          display_name?: string | null
          expiring_notified_at?: string | null
          external_id?: string | null
          id?: string | null
          key_version?: number | null
          mode?: string | null
          org_id?: string | null
          platform?: string | null
          platform_data?: Json | null
          platform_user_id?: string | null
          refresh_expires_at?: string | null
          scopes?: string[] | null
          status?: Database["public"]["Enums"]["social_account_status"] | null
          token_expires_at?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      claim_daily_job: {
        Args: { p_name: string; p_now: string }
        Returns: boolean
      }
      claim_due_targets: {
        Args: { p_limit: number; p_now: string }
        Returns: {
          attempts: number
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          locked_at: string | null
          mode: string
          next_attempt_at: string | null
          org_id: string
          platform: string
          platform_post_id: string | null
          platform_post_url: string | null
          platform_publish_id: string | null
          post_id: string
          publish_state: Json | null
          published_at: string | null
          raw_error: Json | null
          social_account_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["social_post_target_status"]
        }[]
        SetofOptions: {
          from: "*"
          to: "social_post_targets"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_token_refresh: {
        Args: { p_account_id: string; p_now: string }
        Returns: boolean
      }
      claim_webhook_deliveries: {
        Args: { p_limit: number; p_now?: string }
        Returns: {
          attempt: number
          created_at: string
          delivered_at: string | null
          endpoint_id: string
          event: string
          id: string
          mode: string
          next_attempt_at: string | null
          org_id: string
          payload: Json
          response_code: number | null
          status: Database["public"]["Enums"]["webhook_delivery_status"]
        }[]
        SetofOptions: {
          from: "*"
          to: "webhook_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      consume_quota: {
        Args: { p_cap: number; p_day: string; p_scope: string }
        Returns: boolean
      }
      increment_rate_limit: {
        Args: { p_api_key_id: string; p_minute: string }
        Returns: number
      }
      member_org_ids: { Args: never; Returns: string[] }
      record_connect_failure: {
        Args: { p_session_id: string }
        Returns: number
      }
      rollup_post_status: { Args: { p_post_id: string }; Returns: undefined }
    }
    Enums: {
      media_status: "uploaded" | "validated" | "failed"
      member_role: "owner" | "member"
      platform_approval_status:
        | "not_started"
        | "in_progress"
        | "approved"
        | "rejected"
        | "not_needed"
      publish_run_status: "running" | "success" | "error"
      social_account_status:
        | "connected"
        | "expired"
        | "revoked"
        | "disconnected"
      social_post_status:
        | "draft"
        | "scheduled"
        | "processing"
        | "completed"
        | "partial"
        | "failed"
        | "cancelled"
      social_post_target_status:
        | "pending"
        | "running"
        | "success"
        | "error"
        | "cancelled"
      webhook_delivery_status: "pending" | "delivered" | "dead"
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
  public: {
    Enums: {
      media_status: ["uploaded", "validated", "failed"],
      member_role: ["owner", "member"],
      platform_approval_status: [
        "not_started",
        "in_progress",
        "approved",
        "rejected",
        "not_needed",
      ],
      publish_run_status: ["running", "success", "error"],
      social_account_status: [
        "connected",
        "expired",
        "revoked",
        "disconnected",
      ],
      social_post_status: [
        "draft",
        "scheduled",
        "processing",
        "completed",
        "partial",
        "failed",
        "cancelled",
      ],
      social_post_target_status: [
        "pending",
        "running",
        "success",
        "error",
        "cancelled",
      ],
      webhook_delivery_status: ["pending", "delivered", "dead"],
    },
  },
} as const

