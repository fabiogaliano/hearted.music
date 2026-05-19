## ADDED Requirements

### Requirement: Billing-originated control-plane events are stored as durable domain events

The system SHALL persist billing-originated control-plane events in `billing_domain_event` rows instead of relying on an HTTP bridge between repos.

#### Scenario: Mutation and event enqueue succeed atomically
- **WHEN** a billing webhook path applies a billing mutation that should trigger app-side control-plane work
- **THEN** the billing-service SHALL use one SQL orchestration boundary that both commits the billing mutation and inserts the matching `billing_domain_event` row
- **AND** the webhook path SHALL NOT report success if the mutation succeeded but the event row was not inserted

#### Scenario: Domain-event dedupe is scoped to Stripe event and business kind
- **WHEN** the same Stripe event is retried for the same billing business outcome
- **THEN** the database SHALL prevent more than one `billing_domain_event` row for the same `(stripe_event_id, event_kind)` pair
- **AND** the system SHALL NOT require an HTTP idempotency table to prevent duplicate app-side invalidation for that event

#### Scenario: Event envelopes are explicitly versioned
- **WHEN** a `billing_domain_event` row is written
- **THEN** it SHALL store `event_kind`, `schema_version`, and a kind-specific `payload`
- **AND** consumers SHALL treat the database envelope as the canonical shared contract between repos

### Requirement: Billing domain event kinds and payloads are canonical

The system SHALL treat `billing_domain_event` rows as a typed business-event contract, not as free-form JSON blobs.

#### Scenario: Canonical event kinds remain stable
- **WHEN** the system writes or consumes a `billing_domain_event`
- **THEN** `event_kind` SHALL be one of `pack_fulfilled`, `unlimited_activated`, `pack_reversed`, `unlimited_period_reversed`, or `subscription_deactivated`
- **AND** adding a new kind SHALL require an explicit spec and parser update rather than an ad-hoc payload convention

#### Scenario: Envelope fields stay outside payload
- **WHEN** a `billing_domain_event` row is written
- **THEN** `stripe_event_id`, `event_kind`, and `schema_version` SHALL be stored in first-class columns
- **AND** `payload` SHALL contain only kind-specific business data

#### Scenario: Reversal events carry outcome, not inferred mutation instructions
- **WHEN** the system writes `pack_reversed` or `unlimited_period_reversed`
- **THEN** the payload SHALL include `access_removed: boolean`
- **AND** the app consumer SHALL use that outcome to decide whether to emit `BillingChanges.candidateAccessRevoked(...)` instead of replaying the reversal mutation

#### Scenario: Activation and fulfillment events carry provenance needed by app-side control-plane reactions
- **WHEN** the system writes `pack_fulfilled`, `unlimited_activated`, or `subscription_deactivated`
- **THEN** the payload SHALL include the account and provenance fields needed for the current app-side control-plane reaction path
- **AND** producers SHALL NOT omit those fields and expect the app consumer to rediscover them indirectly from Stripe or unrelated tables

### Requirement: Billing domain event consumption is lease-safe and retryable

The app worker SHALL claim, process, and finalize `billing_domain_event` rows through durable status and retry metadata stored on the row.

#### Scenario: Worker claims pending rows without double-processing
- **WHEN** one or more worker processes poll for available billing domain events
- **THEN** each claimable row SHALL be leased to at most one worker at a time
- **AND** another worker SHALL NOT process the same row until the lease expires or the row is finalized

#### Scenario: Successful processing marks the event processed
- **WHEN** the worker upcasts an event payload, dispatches it, and the app-side control-plane change succeeds
- **THEN** the row SHALL transition to `processed`
- **AND** it SHALL record `processed_at`

#### Scenario: Retryable failure is rescheduled from row metadata
- **WHEN** the worker cannot process an event because of a transient app-side failure such as a temporary DB outage or an unsupported future schema version
- **THEN** it SHALL increment `attempt_count`, store `last_error`, and push `available_at` into the future
- **AND** the retry SHALL be driven by the durable row metadata instead of by Stripe webhook redelivery

#### Scenario: Repeated failure becomes terminal but replayable
- **WHEN** automatic processing reaches the configured max-attempt budget without success
- **THEN** the row SHALL transition to `failed`
- **AND** it SHALL remain available for operator inspection and manual requeue

### Requirement: Billing event consumers upcast payload versions before dispatch

The app SHALL normalize `billing_domain_event` payloads to one current in-memory shape before dispatching them to billing handlers.

#### Scenario: Older row version is upcast successfully
- **WHEN** the worker claims a row whose `schema_version` is older than the current handler shape for its `event_kind`
- **THEN** the consumer SHALL upcast that payload to the current shape before dispatch
- **AND** downstream handler code SHALL receive one normalized current version

#### Scenario: Unknown future version does not become a silent drop
- **WHEN** the worker claims a row whose `schema_version` is newer than it understands
- **THEN** it SHALL record a retryable processing failure on the row
- **AND** it SHALL NOT discard the event as a terminal bad-request equivalent

### Requirement: Stripe webhook acknowledgement depends only on mutation and enqueue durability

Stripe webhook acknowledgement SHALL depend on whether the billing mutation and durable outbox enqueue succeeded, not on whether the app has already consumed the event.

#### Scenario: Pre-enqueue failure returns retryable webhook failure
- **WHEN** a webhook handler cannot complete the billing mutation or cannot durably insert the matching `billing_domain_event`
- **THEN** the billing-service route SHALL return a retryable non-2xx response to Stripe
- **AND** the source event SHALL remain eligible for Stripe redelivery

#### Scenario: Post-enqueue app processing stays internal
- **WHEN** the billing mutation and `billing_domain_event` insert have committed successfully
- **THEN** the billing-service route MAY return 200 to Stripe even if the app has not yet consumed the event
- **AND** subsequent retries SHALL be driven by `billing_domain_event` row state instead of by Stripe webhook delivery

### Requirement: Billing webhook ingress idempotency remains reclaimable until enqueue succeeds

The billing-service SHALL keep Stripe webhook ingress idempotent without making failed source events permanently unretryable.

#### Scenario: Failed webhook delivery can be reclaimed on Stripe retry
- **WHEN** a webhook delivery claimed a `billing_webhook_event` row but failed before the billing mutation and `billing_domain_event` enqueue completed
- **THEN** a later Stripe retry for the same `stripe_event_id` SHALL be able to reclaim that webhook event row
- **AND** the retry SHALL re-run the billing mutation path instead of being dropped as an already-seen duplicate

#### Scenario: Stale processing webhook rows do not wedge source recovery
- **WHEN** a billing-service process crashes after claiming a webhook event and leaves it stuck in `processing`
- **THEN** the ingress idempotency mechanism SHALL allow a later retry to reclaim that stale row after a lease or timeout window
- **AND** the system SHALL NOT require manual row deletion to recover the source event

#### Scenario: Successfully processed webhook deliveries stay terminal no-ops
- **WHEN** Stripe redelivers an event whose billing mutation and outbox enqueue already completed successfully
- **THEN** the ingress idempotency mechanism SHALL treat it as an already-processed duplicate
- **AND** the route SHALL return success without replaying the source mutation path

### Requirement: Operators can inspect and replay failed billing domain events

The system SHALL provide operator tooling for failed `billing_domain_event` rows without requiring manual table edits.

#### Scenario: Operator inspects failed events
- **WHEN** an operator needs to understand why billing-driven control-plane work failed
- **THEN** the system SHALL expose row status, attempt count, last error, payload, and timestamps through documented tooling
- **AND** the operator SHALL NOT need to craft ad-hoc SQL updates to see the failure context

#### Scenario: Operator requeues a failed event
- **WHEN** an operator intentionally requeues a failed `billing_domain_event`
- **THEN** the system SHALL reset it to a claimable pending state with `attempt_count = 0`, cleared lease/error fields, and `available_at = now()` while leaving the original row identity and `created_at` intact
- **AND** the requeued event SHALL be processed through the same worker path as newly created rows
