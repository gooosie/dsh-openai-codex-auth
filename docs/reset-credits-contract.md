# Reset-credit contract

Verified against the official openai/codex source on 2026-09-30:

- [Backend requests](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)
- [Response types](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/types.rs)
- [Contract fixtures](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets_tests.rs)

This is a private ChatGPT backend contract, not a stable public Platform API.

## Read

GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits

OAuth Bearer and chatgpt-account-id headers match the existing usage request.
The response has available_count and credits. Each credit has id, reset_type,
status, granted_at, nullable expires_at and optional title/description.
Only available codex_rate_limits cards are displayed, sorted by expiry.
Expired cards are excluded; missing or invalid expiry is explicitly unknown.
Browser snapshots expose count, expiry timestamps and the opaque card ID needed
to select a card, never profile/user IDs, raw descriptions or credentials.
A details failure does not fail usage.

## Consume

POST https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume

Content-Type: application/json

Body: {"redeem_request_id":"<UUID v4>","credit_id":"<selected card ID>"}

Every row selects its own credit_id. The list is sorted by earliest expiry, but
no card is chosen automatically. A fresh preflight confirms the selected ID is
still available; if absent, no POST is sent and no substitute is chosen.
Known response codes: reset, already_redeemed, no_credit, nothing_to_reset.
The upstream also returns windows_reset; the UI refreshes actual usage instead
of assuming every model's limits were reset.

Only a confirmed UI action can dispatch through the plugin. There is no model
tool, startup action, or polling path for redemption. The Typed Remote request
requires confirmed:true, a UUID and creditId, validated on both sides.

The browser saves the pending UUID and selected card in sessionStorage before dispatch, retains
it for uncertain responses, and never retries automatically. The host coalesces
concurrent calls, caches completed attempts for its lifetime, and blocks new
keys while an attempt is uncertain. A key cannot be reused for a different card.
A retry uses the same backend UUID and card ID, including
after the final available card may already have been consumed.
Do not start another reset in another window to work around an uncertain result.
Do not change accounts while resolving an uncertain operation.

## Validation boundary

All consume tests use injected mock transports. No real consume endpoint or
real reset credit has been used to validate this feature. Unit tests cover
request contract, sanitization, confirmation/cancellation, double-clicks,
account changes during preflight, and idempotent uncertain retries. The isolated
DSH Web UI uses fake usage/card snapshots and a stubbed Remote controller.
Real redemption and actual account eligibility remain unverified.
