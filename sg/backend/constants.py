"""
The shared vocabulary of the domain.

These strings cross module boundaries and are written to the database, so a typo
is not a crash — it is a silently wrong row. That has already happened once here:
a filter on `type == "purchase"` kept working after one-off purchases were
retired, and every subscriber read as having bought zero credits.

Keeping the vocabulary in one module makes such a mistake either impossible (the
name does not exist) or a one-line fix.
"""

# ── Credit ledger ───────────────────────────────────────────────────────────

# Transaction was completed. The only status the application writes.
TX_STATUS_COMPLETED = "completed"

# Retired one-off credit packs, still present in historical rows.
TX_PURCHASE = "purchase"
# A monthly subscription's allowance for one billing period. Written once per
# paid Stripe invoice — the only transaction type that represents new revenue.
TX_SUBSCRIPTION_GRANT = "subscription_grant"
# Free credits: referral bonus, signup bonus, admin grant.
TX_BONUS = "bonus"
# Credits spent.
TX_DEDUCTION = "deduction"
# Reserved for consumption recorded by a platform rather than by a deduction.
TX_USAGE = "usage"

# Every type that adds credits. Used by admin reporting so a new grant type
# cannot be forgotten in one place and counted in another.
CREDIT_IN_TYPES = frozenset({TX_PURCHASE, TX_SUBSCRIPTION_GRANT, TX_BONUS})
# Grant types that represent money actually paid. `bonus` is free, so it inflates
# a "credits bought" figure and must not be counted as revenue.
REVENUE_TX_TYPES = frozenset({TX_PURCHASE, TX_SUBSCRIPTION_GRANT})
# Every type that removes credits.
CREDIT_OUT_TYPES = frozenset({TX_DEDUCTION, TX_USAGE})

# ── Tokens ──────────────────────────────────────────────────────────────────

# The `type` claim that distinguishes the two JWTs signed with the same secret.
TOKEN_TYPE_ACCESS = "access"
TOKEN_TYPE_STREAMER = "streamer"

# Single-purpose tokens.
TOKEN_TYPE_EMAIL_VERIFICATION = "email_verification"
TOKEN_TYPE_PASSWORD_RESET = "password_reset"

# ── Revocation and lifecycle reasons ────────────────────────────────────────
# Recorded on `sessions.revoked_reason`, and on the credit revocation performed
# when a subscription ends, so one event has one name.

REVOKE_LOGOUT = "logout"
REVOKE_LOGOUT_ALL = "logout_all"
REVOKE_PASSWORD_CHANGE = "password_change"
REVOKE_PASSWORD_RESET = "password_reset"
REVOKE_ACCOUNT_DELETED = "account_deleted"
REVOKE_SUBSCRIPTION_DELETED = "subscription_deleted"
REVOKE_IDLE_TIMEOUT = "idle_timeout"

# ── Subscriptions ───────────────────────────────────────────────────────────

# Subscription statuses Stripe sends. Anything else is stored but flagged.
SUBSCRIPTION_STATUSES = frozenset({
    "active",
    "trialing",
    "past_due",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "unpaid",
    "paused",
})

# Statuses that mean "this plan is currently providing credits". `past_due` is
# included deliberately: Stripe retries a failed payment for days, and cutting a
# paying user off during that window is worse than a brief overrun.
PLAN_BEARING_STATUSES = frozenset({"active", "trialing", "past_due"})

# ── Login events ────────────────────────────────────────────────────────────

LOGIN_FAILED_INVALID_CREDENTIALS = "invalid_credentials"
LOGIN_FAILED_EMAIL_NOT_VERIFIED = "email_not_verified"
