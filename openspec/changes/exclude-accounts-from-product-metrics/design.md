# Design: Exclude Accounts from Product Metrics

## Data model

`account.exclude_from_product_metrics boolean not null default false` is the sole classification. The current account value is intentionally evaluated at query time, so enabling it removes the account's whole historical record from product-audience reports and disabling it restores that record. No product data is deleted.

## Read model

Product aggregates filter to `account.exclude_from_product_metrics = false` at the account boundary. Account-owned records join or predicate through that eligible-account set instead of accepting a database-derived ID list through a URL filter.

Operational reads stay unfiltered: account search, detail, review queues, job health, and operator actions must continue to show and act on flagged accounts.

LLM telemetry returns both scopes: the default product-audience ledger filters records attributable to eligible accounts, while `allAccountCostUsd` preserves the real total spend. Records with no account attribution remain in both scopes because they cannot be classified. The UI presents product-audience spend as primary and all-account spend as the comparison.

PostHog uses current person/account identity to exclude identified flagged accounts. Traffic without an associated person remains visible as explicitly labelled observed traffic rather than being silently treated as product-account behavior.

## Control-panel mutation and UI

User Detail displays the current classification. Enabling exclusion requires confirmation that historical product metrics change without deleting data; removing it is immediate. Both mutations pass through `recordAction` and invalidate relevant read caches.

The Users table keeps all accounts visible, adds an exclusion badge, and provides an Included/Excluded filter. This lets operators find and classify accounts without obscuring support work.

## Initial accounts

`fabiogaliano` and `jogabuebonitopontopt` are assigned through the User Detail UI after deployment. The migration never identifies accounts by mutable handles.
