CREATE TABLE api_token (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    name TEXT DEFAULT 'extension',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_api_token_account_id ON api_token(account_id);
CREATE INDEX idx_api_token_token_hash ON api_token(token_hash);

ALTER TABLE api_token ENABLE ROW LEVEL SECURITY;
