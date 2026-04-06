CREATE TABLE billing_admin_task (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL,
  charge_id       TEXT NOT NULL,
  description     TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'resolved')),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_admin_task_status ON billing_admin_task(status);
