-- Stripe delivers webhooks at-least-once; without this constraint a
-- re-delivered chargeback/reversal event mints a duplicate operator task.
-- One event maps to one charge and one task, so the event id is the
-- natural idempotency key. The writer (billing-service) must insert with
-- ON CONFLICT (stripe_event_id) DO NOTHING.
ALTER TABLE billing_admin_task
  ADD CONSTRAINT billing_admin_task_stripe_event_id_key UNIQUE (stripe_event_id);
