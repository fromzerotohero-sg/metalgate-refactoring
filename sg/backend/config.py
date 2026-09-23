"""
SilverGate configuration.

Every value that differs between environments comes from the environment.
Values that are required for the service to be *safe* have no insecure
fallback: in production the application refuses to start without them.

Reference: architecture/02-hosting-and-vercel.md, architecture/04-authentication.md

Every attribute on `Config` is present once `Config.validate()` has run, so the
application reads them by index (`current_app.config["PLANS"]`) rather than with
`.get`. A missing key is a programming error and should raise where it happens,
not silently become `None` in the middle of a request. `.get` is reserved for
dictionary payloads whose keys really are optional.
"""

import json
import logging
import os
import secrets

from dotenv import load_dotenv

load_dotenv(os.environ.get("ENV_FILE", ".env"))

logger = logging.getLogger(__name__)


def _bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        raise RuntimeError(f"{name} must be an integer, got {raw!r}") from None


def _json_dict(name: str) -> dict:
    raw = os.environ.get(name)
    if not raw or not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{name} is not valid JSON: {exc}") from None
    if not isinstance(parsed, dict):
        raise RuntimeError(f"{name} must be a JSON object")
    return parsed


# Plans, cheapest first. Prices are in EUR cents. Keep this ordered list in
# sync with the `PLAN_ORDER` derivation below.
_DEFAULT_PLANS = {
    "lite": {"name": "Lite", "credits": 150, "price_cents": 799},
    "pro": {"name": "Pro", "credits": 300, "price_cents": 1499},
    "ultra": {"name": "Ultra", "credits": 750, "price_cents": 2999},
}

_PREFERRED_PLAN_ORDER = list(_DEFAULT_PLANS)  # declaration order is the plan order


def _build_plans() -> dict:
    """
    Merge the shipped plan defaults with the environment.

    `SG_PLANS` may override any field, or add a plan. A Stripe price ID may be
    supplied either as `stripe_price_id` inside `SG_PLANS` or as the standalone
    `STRIPE_PRICE_<PLAN_ID>` variable, which is the easier one to manage in a
    hosting dashboard.
    """
    plans = {plan_id: dict(spec) for plan_id, spec in _DEFAULT_PLANS.items()}

    for plan_id, override in _json_dict("SG_PLANS").items():
        if not isinstance(override, dict):
            raise RuntimeError(f"SG_PLANS.{plan_id} must be a JSON object")
        plans.setdefault(plan_id, {}).update(override)

    # A single normalisation pass over the merged result, so a plan added through
    # SG_PLANS gets exactly the same treatment as a shipped one — including the
    # STRIPE_PRICE_* environment fallback.
    for plan_id, spec in plans.items():
        spec.setdefault(
            "stripe_price_id", os.environ.get(f"STRIPE_PRICE_{plan_id.upper()}", "")
        )
        spec.setdefault("name", plan_id.title())
        spec.setdefault("currency", "EUR")
        spec["id"] = plan_id

    return plans


def _plan_order(plans: dict) -> list:
    """Cheapest-first ordering: known plans in their declared order, then extras."""
    known = [plan_id for plan_id in _PREFERRED_PLAN_ORDER if plan_id in plans]
    extra = sorted(
        (plan_id for plan_id in plans if plan_id not in _PREFERRED_PLAN_ORDER),
        key=lambda plan_id: plans[plan_id].get("price_cents", 0),
    )
    return known + extra


# Origins used before SG_CORS_ORIGINS is configured. These mirror the set that
# the previous deployment served, plus local development.
_DEFAULT_CORS_ORIGINS = [
    "https://fromzerotohero.io",
    "https://efootball.fromzerotohero.io",
    "https://tornei.fromzerotohero.io",
    "http://localhost",
    "http://localhost:3000",
    "http://localhost:3001",
]

# Platform entries carried over from the previous deployment's .env.production, so
# that origins and service attribution keep working during the migration.
#
# These are PLACEHOLDERS. Replace them with SG_PLATFORMS once the rebuilt
# frontends settle on their callback paths — in particular, `redirect_uris` are
# matched exactly during the cross-domain code exchange and the current values
# are a convention, not a fact.
_DEFAULT_PLATFORMS = {
    "efootball": {
        "name": "eFootball Coaching",
        "origins": ["https://efootball.fromzerotohero.io"],
        "redirect_uris": ["https://efootball.fromzerotohero.io/auth/callback"],
        "api_key": "",
    },
    "tornei": {
        "name": "Arena Tornei",
        "origins": ["https://tornei.fromzerotohero.io"],
        "redirect_uris": ["https://tornei.fromzerotohero.io/auth/callback"],
        "api_key": "",
    },
    "fzth": {
        "name": "From Zero to Hero",
        "origins": ["https://fromzerotohero.io"],
        "redirect_uris": ["https://fromzerotohero.io/auth/callback"],
        "api_key": "",
    },
}


class Config:
    # ── Environment ─────────────────────────────────────────────────────────
    ENV = (os.environ.get("SG_ENV") or os.environ.get("FLASK_ENV") or "development").lower()
    IS_PRODUCTION = ENV == "production"

    # ── Core secrets ────────────────────────────────────────────────────────
    # In production these must be present; in development a random value is
    # generated so that the app still boots (see Config.validate).
    SECRET_KEY = os.environ.get("SECRET_KEY")
    JWT_SECRET = os.environ.get("JWT_SECRET")
    INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY")

    # ── Data store ──────────────────────────────────────────────────────────
    SUPABASE_URL = os.environ.get("SUPABASE_URL")
    SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

    # ── The session cookie ──────────────────────────────────────────────────
    # This cookie is the user's only credential and the only mechanism that
    # keeps them signed in across every platform. See architecture/04.
    SESSION_COOKIE_NAME = os.environ.get("SG_SESSION_COOKIE_NAME", "sg_session")
    SESSION_COOKIE_PATH = "/"
    # Must be a *custom* domain such as ".fromzerotohero.io" so that every
    # platform subdomain receives the cookie. A shared domain like
    # ".vercel.app" cannot be used: it is on the Public Suffix List and
    # browsers reject cookies scoped to it.
    SESSION_COOKIE_DOMAIN = os.environ.get("SG_SESSION_COOKIE_DOMAIN") or None
    # Whether the cookie MUST be scoped to a shared parent domain. True by default
    # because cross-platform single sign-on is the whole point of SilverGate, and a
    # host-only cookie breaks it without any visible error. Set to false only for a
    # deployment where every platform uses the code-exchange path.
    REQUIRE_SHARED_COOKIE = _bool("SG_REQUIRE_SHARED_COOKIE", True)
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SECURE = _bool("SG_SESSION_COOKIE_SECURE", IS_PRODUCTION)
    # "Lax" is correct when SilverGate and its platforms share a registrable
    # domain. A cross-site frontend would need "None" (and Secure).
    SESSION_COOKIE_SAMESITE = os.environ.get("SG_SESSION_COOKIE_SAMESITE", "Lax")
    # 400 days is the longest cookie lifetime Chrome will honour. The cookie is
    # re-issued on activity, so this is a sliding window, not a hard cap.
    SESSION_TTL_DAYS = _int("SG_SESSION_TTL_DAYS", 400)
    # Re-issue the cookie once it is older than this. Does NOT rotate the token.
    SESSION_RENEW_AFTER_HOURS = _int("SG_SESSION_RENEW_AFTER_HOURS", 24)
    # 0 means "never expires" — the intended default. Set >0 to add an idle cap.
    SESSION_IDLE_TIMEOUT_DAYS = _int("SG_SESSION_IDLE_TIMEOUT_DAYS", 0) or None
    # Debounce last_seen_at writes so a busy client does not write on every request.
    SESSION_TOUCH_INTERVAL_MINUTES = _int("SG_SESSION_TOUCH_INTERVAL_MINUTES", 5)

    # ── Short-lived access tokens (handed to platforms, not to browsers) ────
    ACCESS_TOKEN_TTL_MINUTES = _int("SG_ACCESS_TOKEN_TTL_MINUTES", 10)
    ACCESS_TOKEN_ISSUER = os.environ.get("SG_ACCESS_TOKEN_ISSUER", "silvergate")
    # One-time code lifetime for the cross-domain SSO exchange (architecture/04 §6).
    SSO_CODE_TTL_SECONDS = _int("SG_SSO_CODE_TTL_SECONDS", 60)

    # Streamer (partner) tokens. Streamers are not `users` rows, so they cannot
    # use the revocable session store; this lifetime is the only control.
    STREAMER_TOKEN_TTL_DAYS = _int("SG_STREAMER_TOKEN_TTL_DAYS", 400)

    # ── Policy ──────────────────────────────────────────────────────────────
    # Enforced consistently on registration, password change and password reset.
    MIN_PASSWORD_LENGTH = _int("SG_MIN_PASSWORD_LENGTH", 8)
    # An upper bound exists only so a client cannot make the hasher do unbounded
    # work by posting a multi-megabyte "password". Generous on purpose: it must
    # never reject a legitimate passphrase.
    MAX_PASSWORD_LENGTH = _int("SG_MAX_PASSWORD_LENGTH", 256)

    # Referral rewards are temporary credits, not plan credits: the plan bucket
    # is owned by Stripe and a bonus must not inflate the allowance. A year is
    # long enough to read as permanent while still lapsing eventually.
    REFERRAL_BONUS_CREDITS = _int("SG_REFERRAL_BONUS_CREDITS", 50)
    REFERRAL_BONUS_TTL_DAYS = _int("SG_REFERRAL_BONUS_TTL_DAYS", 365)

    # Signup bonus, granted as a temporary credit at registration.
    SIGNUP_BONUS_CREDITS = _int("SG_SIGNUP_BONUS_CREDITS", 10)
    # Default lifetime for a temporary credit grant when the granting call does
    # not name one. An explicit `expires_at`/`expires_in_days` always wins.
    TEMP_GRANT_TTL_DAYS = _int("SG_TEMP_GRANT_TTL_DAYS", 7)

    # ── Public URLs ───────────────────────────────────────────────────
    # The frontend is served from the apex and the API from `v2.`, both under the
    # same registrable domain. The browser only ever talks to the frontend, which
    # proxies /api/* to this service, so the session cookie stays first-party and
    # the flow is same-site (`SameSite=Lax` is enough) with no redirect handshake.
    #
    # The apex is the frontend's home and `v2.` the API's, both permanent. The
    # frontend answered on `silver.` during the cutover, so a deployed SG_APP_URL
    # may still name it until the hostname is switched over; the value below is
    # only the fallback used when that variable is unset.
    APP_URL = (os.environ.get("SG_APP_URL") or "https://fromzerotohero.io").rstrip("/")
    LOGIN_URL = os.environ.get("SG_LOGIN_URL") or f"{APP_URL}/login"
    # Where a user is sent when we have no better destination: after verifying from a
    # link that carried no `redirect`, and when returning from the Stripe portal.
    # `/account` is the workspace page; `/dashboard` is kept as an alias on the
    # frontend, so either value works. Override with SG_DASHBOARD_URL.
    DASHBOARD_URL = os.environ.get("SG_DASHBOARD_URL") or f"{APP_URL}/account"
    # Public base URL of this API, used to build verification links that point
    # straight at the backend (see SG_EMAIL_VERIFY_VIA_API below).
    API_PUBLIC_URL = (
        os.environ.get("SG_API_PUBLIC_URL") or "https://v2.fromzerotohero.io"
    ).rstrip("/")
    # When true, verification emails link straight to the API, which promotes
    # the user *and* creates their session in one navigation (architecture/04 §4).
    EMAIL_VERIFY_VIA_API = _bool("SG_EMAIL_VERIFY_VIA_API", False)

    # ── Google sign-in (OpenID Connect) ────────────────────────────────────
    # Optional integration. With no client ID the /api/auth/google/* endpoints
    # send the browser back with `?oauth=unavailable` rather than failing, so the
    # frontend can simply not offer the button.
    #
    # The secret is used only for the server-to-server code exchange and must
    # never reach a browser or a frontend environment variable.
    GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
    GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
    # Must match an authorized redirect URI on the OAuth client EXACTLY: Google
    # rejects a mismatch before the request reaches this service, so the failure
    # reads as a Google-side error rather than a configuration mistake. Derived
    # from API_PUBLIC_URL, which is correct whenever the API is reached at its
    # public address.
    GOOGLE_REDIRECT_URI = (
        os.environ.get("SG_GOOGLE_REDIRECT_URI")
        or f"{API_PUBLIC_URL}/api/auth/google/callback"
    )

    # Where Stripe returns the payer. Absolute and configuration-driven, so a
    # subscription always lands on SilverGate's own account page — including when a
    # platform started the checkout. The account page reads `?subscription=` to show
    # its banner.
    CHECKOUT_SUCCESS_URL = (
        os.environ.get("SG_CHECKOUT_SUCCESS_URL")
        or f"{DASHBOARD_URL}?subscription=success"
    )
    CHECKOUT_CANCEL_URL = (
        os.environ.get("SG_CHECKOUT_CANCEL_URL")
        or f"{DASHBOARD_URL}?subscription=cancel"
    )

    # ── CORS ────────────────────────────────────────────────────────────────
    CORS_ORIGINS = (
        [o.strip() for o in os.environ.get("SG_CORS_ORIGINS", "").split(",") if o.strip()]
        or _DEFAULT_CORS_ORIGINS
    )

    # ── Rate limiting ───────────────────────────────────────────────────────
    # An in-memory store is per-instance and therefore enforces nothing on
    # serverless: each instance keeps its own counters, so the real limit is
    # "N per instance per window". Production refuses to start with it unless the
    # operator opts in explicitly (see validate) — silently pretending to rate
    # limit is worse than not rate limiting, because it is relied upon.
    RATELIMIT_STORAGE_URI = os.environ.get("SG_RATELIMIT_STORAGE_URI", "memory://")
    # Set true only when there genuinely is no shared store available and the
    # deployment accepts that limits are per-instance.
    ALLOW_IN_MEMORY_RATELIMIT = _bool("SG_ALLOW_IN_MEMORY_RATELIMIT", False)
    RATELIMIT_HEADERS_ENABLED = True
    RATELIMIT_ENABLED = _bool("SG_RATELIMIT_ENABLED", True)
    RATELIMIT_STRATEGY = "fixed-window"

    # ── Platform registry ───────────────────────────────────────────────────
    # client_id -> {name, origins[], redirect_uris[], api_key}
    PLATFORMS = {**_DEFAULT_PLATFORMS, **_json_dict("SG_PLATFORMS")}

    # ── Admin ───────────────────────────────────────────────────────────────
    # Read from the environment; there is no source-code default.
    ADMIN_CODE = os.environ.get("ADMIN_CODE")
    # A second factor for the admin surface, which can read every user and move
    # credits. Generate one with `python totp.py`. When set, every admin request
    # must also carry a valid `X-Admin-TOTP` code.
    ADMIN_TOTP_SECRET = os.environ.get("SG_ADMIN_TOTP_SECRET")
    # Comma-separated CIDRs or addresses. When set, admin requests from anywhere
    # else are refused before their credential is even looked at. Opt-in, because
    # a dynamic operator IP would otherwise lock the operator out — but it is the
    # single most effective control on this surface, so set it if the operator's
    # address is stable.
    ADMIN_IP_ALLOWLIST = [
        entry.strip()
        for entry in os.environ.get("SG_ADMIN_IP_ALLOWLIST", "").split(",")
        if entry.strip()
    ]

    # ── Request limits ──────────────────────────────────────────────────────
    # Reject an oversized body before it is read into memory. The largest
    # legitimate payload is a campaign preview carrying an inline base64 image,
    # which `_sanitize_image_src` caps at 2 MB of characters — so 4 MB is a
    # generous ceiling that still bounds a hostile request.
    MAX_CONTENT_LENGTH = _int("SG_MAX_CONTENT_LENGTH", 4 * 1024 * 1024)
    # Hosts this API will answer for. Unset by default: SilverGate builds no URL
    # from the request's Host header, so a Host attack has nothing to poison, and
    # a fixed list would reject Vercel's preview deployments. Set it to the API
    # hostname to add the check anyway.
    TRUSTED_HOSTS = [
        entry.strip()
        for entry in os.environ.get("SG_TRUSTED_HOSTS", "").split(",")
        if entry.strip()
    ] or None

    # ── Stripe ──────────────────────────────────────────────────────────────
    STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY")
    STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET")

    # ── Plans ───────────────────────────────────────────────────────────────
    # Monthly subscriptions, cheapest first. `credits` is the allowance for a
    # single billing period.
    #
    # Leftover credits do NOT roll over: every paid invoice resets the allowance
    # to `credits`. See billing.py.
    #
    # Stripe price IDs are created in the Stripe dashboard, so they come from the
    # environment (STRIPE_PRICE_LITE / _PRO / _ULTRA). A plan with no price ID is
    # still listed, but checkout returns 503 for it rather than charging the wrong
    # amount.
    # Upgrade grants the full allowance for the new period, not the difference.
    # A paid invoice always resets, so a plan change mid-period simply starts the
    # new allowance early — documented rather than prorated.
    PLANS = _build_plans()
    PLAN_ORDER = _plan_order(PLANS)
    # The upgrade call to action appears once usage reaches this percentage of
    # the plan allowance — "within 10% of the limit" by default.
    UPGRADE_CTA_THRESHOLD_PERCENT = _int("SG_UPGRADE_CTA_THRESHOLD_PERCENT", 90)
    # Where the call to action sends the user.
    STORE_URL = (os.environ.get("SG_STORE_URL") or f"{APP_URL}/pricing").rstrip("/")

    # ── Email ───────────────────────────────────────────────────────────────
    RES_API_KEY = os.environ.get("RES_API_KEY")
    EMAIL_FROM = os.environ.get("EMAIL_FROM", "info@fromzerotohero.io")
    EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "SilverGate")
    EMAIL_VERIFICATION_URL = os.environ.get("EMAIL_VERIFICATION_URL") or f"{APP_URL}/verify-email"

    # ── OpenAI ──────────────────────────────────────────────────────────────
    # The key is used only by the admin proxy endpoints that read live usage from
    # OpenAI's organization API. SilverGate does not call the completions API
    # itself — AI usage is *logged* by the platforms into `ai_usage_logs`.
    OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

    @classmethod
    def validate(cls) -> None:
        """
        Fail fast rather than silently running with insecure or missing settings.

        The previous deployment fell back to literal "dev-secret-key" values in
        production. That is worse than crashing, so secrets are required here.
        """
        missing = []
        if not cls.SUPABASE_URL:
            missing.append("SUPABASE_URL")
        if not cls.SUPABASE_KEY:
            missing.append("SUPABASE_KEY")

        if cls.IS_PRODUCTION:
            for name in ("SECRET_KEY", "JWT_SECRET", "INTERNAL_API_KEY", "ADMIN_CODE"):
                if not getattr(cls, name):
                    missing.append(name)
            if cls.RATELIMIT_STORAGE_URI == "memory://" and not cls.ALLOW_IN_MEMORY_RATELIMIT:
                raise RuntimeError(
                    "SG_RATELIMIT_STORAGE_URI is 'memory://' in production. Rate limits "
                    "would be enforced per instance, so on serverless hosting they "
                    "effectively do not exist — every brute-forceable endpoint (login, "
                    "the admin code, password reset) would be unprotected. Configure a "
                    "shared store (e.g. redis://), or set "
                    "SG_ALLOW_IN_MEMORY_RATELIMIT=true to accept per-instance limits."
                )
            if not cls.SESSION_COOKIE_SECURE:
                raise RuntimeError(
                    "SG_SESSION_COOKIE_SECURE must be true in production: the session "
                    "cookie is the user's only credential."
                )
            if not cls.SESSION_COOKIE_DOMAIN:
                if cls.REQUIRE_SHARED_COOKIE:
                    raise RuntimeError(
                        "SG_SESSION_COOKIE_DOMAIN is unset, so the session cookie would be "
                        "host-only: platforms on sibling subdomains would NOT share the "
                        "user's session, silently breaking cross-platform single sign-on. "
                        "Set it (e.g. .yourbrand.com), or set SG_REQUIRE_SHARED_COOKIE=false "
                        "if every platform uses the code-exchange path instead."
                    )
                logger.warning(
                    "SG_SESSION_COOKIE_DOMAIN is unset and SG_REQUIRE_SHARED_COOKIE is "
                    "false: the session is host-only by explicit choice."
                )
        else:
            # Development: generate throwaway secrets so the app still boots.
            for name in ("SECRET_KEY", "JWT_SECRET", "INTERNAL_API_KEY"):
                if not getattr(cls, name):
                    setattr(cls, name, secrets.token_urlsafe(48))
                    logger.warning("%s was not set; generated an ephemeral dev value.", name)
            if not cls.ADMIN_CODE:
                cls.ADMIN_CODE = "dev-admin-code"
                logger.warning("ADMIN_CODE was not set; using the development default.")

        if cls.MAX_PASSWORD_LENGTH < cls.MIN_PASSWORD_LENGTH:
            raise RuntimeError(
                "SG_MAX_PASSWORD_LENGTH must be >= SG_MIN_PASSWORD_LENGTH "
                f"({cls.MAX_PASSWORD_LENGTH} < {cls.MIN_PASSWORD_LENGTH})."
            )

        # The admin surface can read every user and move credits. In production we
        # insist that it is configured deliberately rather than inherited from a
        # development default.
        if cls.IS_PRODUCTION:
            if not cls.ADMIN_TOTP_SECRET:
                logger.warning(
                    "SG_ADMIN_TOTP_SECRET is unset: the admin API runs single-factor "
                    "(shared code only). Set it to require an authenticator code too."
                )
            if not cls.ADMIN_IP_ALLOWLIST:
                logger.warning(
                    "SG_ADMIN_IP_ALLOWLIST is unset: the admin API is reachable from "
                    "any address. Strongly recommended when the operator's IP is stable."
                )
            # Compared as *sets*. A length comparison stood here, and a real allowlist
            # that happened to have the same number of entries as the defaults tripped
            # it — logging a misconfiguration error for a correctly configured
            # deployment, which is worse than no check at all: it trains you to ignore
            # the line that would announce the genuine problem.
            if set(cls.CORS_ORIGINS) == set(_DEFAULT_CORS_ORIGINS):
                # The defaults include http://localhost, which is not a production
                # frontend. CORS with credentials against an unset allowlist is a
                # silent misconfiguration, not a working default.
                logger.error(
                    "SG_CORS_ORIGINS is unset, so the development defaults are in "
                    "use (including http://localhost). Set it to the real frontend "
                    "origins."
                )

        if missing:
            raise RuntimeError(
                "Missing required configuration: "
                + ", ".join(sorted(missing))
                + ". The application refuses to start without them. See .env.example."
            )

        for client_id, platform in cls.PLATFORMS.items():
            if not isinstance(platform, dict):
                raise RuntimeError(f"Platform '{client_id}' must be a JSON object")
            for field in ("origins", "redirect_uris"):
                value = platform.get(field)
                if value is not None and not isinstance(value, list):
                    raise RuntimeError(f"Platform '{client_id}'.{field} must be a list")

        if not cls.PLANS:
            raise RuntimeError("No plans are configured.")

        for plan_id, spec in cls.PLANS.items():
            for field in ("name", "credits", "price_cents"):
                if spec.get(field) in (None, ""):
                    raise RuntimeError(f"Plan '{plan_id}' is missing '{field}'.")
            if int(spec["credits"]) <= 0:
                raise RuntimeError(f"Plan '{plan_id}'.credits must be positive.")

        unconfigured = [
            plan_id
            for plan_id, spec in cls.PLANS.items()
            if not spec.get("stripe_price_id")
        ]
        if unconfigured:
            expected = ", ".join(f"STRIPE_PRICE_{plan_id.upper()}" for plan_id in unconfigured)
            message = (
                "No Stripe price ID configured for plan(s): %s. Checkout will return "
                "503 for them; set %s." % (", ".join(unconfigured), expected)
            )
            if cls.IS_PRODUCTION:
                logger.error(message)
            else:
                logger.warning(message)

        if not cls.STRIPE_SECRET_KEY:
            logger.warning(
                "STRIPE_SECRET_KEY is unset: subscriptions cannot be created or managed."
            )

        # Half-configured Google sign-in is worth shouting about: the button will
        # be offered and every attempt will fail, because the code exchange cannot
        # complete without the secret.
        if bool(cls.GOOGLE_CLIENT_ID) != bool(cls.GOOGLE_CLIENT_SECRET):
            message = (
                "Only one of GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET is set, so "
                "Google sign-in cannot complete. Set both, or neither."
            )
            if cls.IS_PRODUCTION:
                logger.error(message)
            else:
                logger.warning(message)
