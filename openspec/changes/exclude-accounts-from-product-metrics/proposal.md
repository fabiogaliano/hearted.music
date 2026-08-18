# Proposal: Exclude Accounts from Product Metrics

## Why

Operator, friend, and test accounts are legitimate production accounts but can distort product-adoption, conversion, engagement, and audience-cost metrics. Operators need to classify those accounts from the control panel without losing the ability to support or operate on them.

## What Changes

- Add an account-level `exclude_from_product_metrics` flag, defaulting to false.
- Exclude flagged accounts retroactively from account-derived product aggregates in the control panel.
- Keep operational account detail, search, queues, and mutation tools available for flagged accounts.
- Provide a User Detail control, list badge, and Included/Excluded filter for managing the flag.
- Record every flag change in local control-panel action history.
- Keep actual all-account LLM spend available alongside the filtered product-audience figure.
- Keep PostHog traffic that cannot be attributed to an account as separately labelled observed traffic.

## Non-goals

- Deleting account data or changing entitlement, billing, enrichment, or job execution.
- A generic account-role or tagging system.
- Retroactively rewriting PostHog events.
