CREATE UNIQUE INDEX oauth_account_user_id_provider_id_key
  ON oauth_account (user_id, provider_id);
