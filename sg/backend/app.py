"""
SilverGate — application factory.

Deployment notes that shaped this file (architecture/02-hosting-and-vercel.md):

* **Logging goes to stdout.** The previous version created a `logs/` directory
  and a `RotatingFileHandler`. The serverless filesystem is read-only apart from
  `/tmp`, so that raised during import and failed every request.
* **Nothing depends on process state.** No in-memory registries, no background
  threads, no writable disk. Anything that must survive a request lives in
  Postgres.
* **Configuration is validated before serving.** A missing secret is a startup
  failure, not a silent fallback to a development default.
"""

import logging
import os
import sys

import httpx
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from supabase import ClientOptions, create_client
from werkzeug.middleware.proxy_fix import ProxyFix

load_dotenv(os.environ.get("ENV_FILE", ".env"))

# SilverGate is deployed as a flat directory (Vercel's `api/index.py`, or
# `gunicorn app:create_app()`), not as a package: there is no `__init__.py` in
# `backend/`, so package-relative imports can never resolve and a try/except
# around them would only hide that.
import sessions
from extensions import limiter


def _build_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        # create_app() refuses to start without these; this only guards import.
        return None

    # postgrest-py creates its HTTP client with `http2=True`. On serverless hosting
    # that is a trap: a warm instance holds a pooled HTTP/2 connection, the peer
    # eventually sends GOAWAY, and the next call reuses the doomed connection and
    # dies with `ConnectionTerminated (last_stream_id=…)` — a 500 on any endpoint
    # that touches the database, with nothing wrong with the query itself.
    #
    # The fix belongs here, once, rather than as a retry in every route. HTTP/1.1
    # pooling does not have this failure mode, and `httpx` is already a pinned
    # dependency of the Supabase client, so disabling HTTP/2 costs nothing.
    http_client = httpx.Client(
        http2=False,
        follow_redirects=True,
        # postgrest-py's own default is DEFAULT_POSTGREST_CLIENT_TIMEOUT (120s), so
        # supplying our own client must not quietly shorten every database call.
        timeout=httpx.Timeout(120.0),
    )
    return create_client(url, key, ClientOptions(httpx_client=http_client))


supabase = _build_supabase_client()


def configure_logging() -> None:
    """Send logs to stdout. Vercel (and any container platform) captures them."""
    level_name = os.environ.get("SG_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    root = logging.getLogger()
    root.setLevel(level)

    # Replace any pre-existing handlers so a reload cannot duplicate output.
    for handler in list(root.handlers):
        root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s %(name)s: %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
    )
    root.addHandler(handler)

    # These are chatty without being useful in production.
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object("config.Config")

    # Configure logging first, so that a configuration failure is reported.
    configure_logging()

    # Fail fast, before anything is served.
    from config import Config

    Config.validate()

    sessions.configure(
        touch_interval_minutes=app.config["SESSION_TOUCH_INTERVAL_MINUTES"]
    )
    limiter.init_app(app)

    import auth

    app.before_request(auth.enforce_origin_on_cookie_requests)
    # Keep the session cookie's sliding window alive on every authenticated
    # request, not just on /api/session.
    app.after_request(auth.renew_session_cookie)

    # Trust the platform's proxy headers so client IPs (rate limiting, session
    # audit) are the real ones rather than the load balancer's.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    # Nothing else to wire for the request limits: `from_object(Config)` has already
    # placed MAX_CONTENT_LENGTH and TRUSTED_HOSTS in the config, and Flask and
    # Werkzeug both read those keys natively.

    CORS(
        app,
        resources={
            r"/api/*": {
                "origins": app.config["CORS_ORIGINS"],
                "methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
                "allow_headers": [
                    "Content-Type",
                    "Authorization",
                    "X-Internal-API-Key",
                    "X-Platform-Key",
                    "X-Admin-Code",
                    # The admin surface's second factor. `routes_admin` reads it on
                    # every request, so a browser-based admin panel on another
                    # origin fails its preflight without it and the whole admin API
                    # becomes unreachable from the UI.
                    "X-Admin-TOTP",
                ],
                # `Retry-After` and the rate-limit headers are set by flask-limiter
                # but are invisible to a cross-origin caller unless exposed, which
                # would leave a throttled frontend unable to say when to retry.
                "expose_headers": [
                    "Content-Type",
                    "Retry-After",
                    "X-RateLimit-Limit",
                    "X-RateLimit-Remaining",
                    "X-RateLimit-Reset",
                ],
                "supports_credentials": True,
                "max_age": 600,
            }
        },
    )

    _register_blueprints(app)
    _register_error_handlers(app)
    _register_security_headers(app)

    @app.route("/health")
    def health_check():
        if supabase is None:
            return jsonify({"status": "unhealthy", "error": "database not configured"}), 503
        try:
            supabase.table("users").select("id").limit(1).execute()
            return jsonify({"status": "healthy", "database": "connected"}), 200
        except Exception as exc:
            app.logger.error("Health check failed: %s", exc)
            return jsonify({"status": "unhealthy", "error": "database unavailable"}), 500

    app.logger.info("SilverGate started (env=%s)", app.config["ENV"])
    return app


def _register_blueprints(app: Flask) -> None:
    from routes import bp as api_bp

    app.register_blueprint(api_bp, url_prefix="/api")

    from routes_sso import sso_bp

    app.register_blueprint(sso_bp, url_prefix="/api")

    from routes_google import google_bp

    app.register_blueprint(google_bp, url_prefix="/api")

    from routes_streamer import bp as streamer_bp

    app.register_blueprint(streamer_bp, url_prefix="/api")

    from routes_admin import admin_bp

    app.register_blueprint(admin_bp)


def _register_security_headers(app: Flask) -> None:
    """
    Response headers that are cheap to send and expensive to omit.

    Set on every response rather than per route: a header that has to be
    remembered per endpoint is a header that will be missing from the one
    endpoint that needed it.
    """

    @app.after_request
    def _apply(response):
        # Stop a browser from second-guessing a Content-Type we chose. An API that
        # returns JSON is a classic target for content sniffing.
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        # A session token or a verification link must never travel in a Referer.
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        # Nothing in this service is meant to be framed.
        response.headers.setdefault("X-Frame-Options", "DENY")

        # Authenticated JSON must not sit in a browser cache or an intermediary's.
        # `/api/*` is all of it, including the unauthenticated endpoints — they are
        # cheap, and one rule is safer than two.
        if request.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")

        # Host-scoped: this covers v2.fromzerotohero.io and its subdomains. This
        # frontend and the other platforms need their own HSTS header, which is the
        # frontend deployment's job.
        if app.config["IS_PRODUCTION"]:
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=63072000; includeSubDomains"
            )

        return response


def _register_error_handlers(app: Flask) -> None:
    @app.errorhandler(404)
    def not_found(_error):
        return jsonify({"error": "Endpoint not found"}), 404

    @app.errorhandler(429)
    def rate_limited(error):
        """
        JSON for rate-limit rejections.

        flask-limiter's default 429 carries a plain-text body, which is awkward
        for a JSON API and easy to mishandle on the client — a browser fetch that
        assumes JSON would throw on `.json()` instead of reading the status.
        """
        payload = {"error": "Too many requests. Please try again shortly."}
        limit = getattr(error, "description", None)
        if limit:
            payload["limit"] = limit
        return jsonify(payload), 429

    @app.errorhandler(413)
    def payload_too_large(_error):
        """JSON for an oversized body, so a client sees a reason, not an HTML page."""
        limit_mb = app.config["MAX_CONTENT_LENGTH"] / (1024 * 1024)
        return jsonify({"error": f"Request body too large (limit {limit_mb:.0f} MB)"}), 413

    @app.errorhandler(500)
    def internal_error(error):
        app.logger.error("Unhandled error: %s", error)
        return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":  # local development only
    application = create_app()
    application.run(
        host=os.environ.get("SG_HOST", "127.0.0.1"),
        port=int(os.environ.get("SG_PORT", "4001")),
        debug=False,
    )
