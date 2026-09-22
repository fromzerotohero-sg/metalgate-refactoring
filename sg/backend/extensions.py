from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# Storage is configured from Config.RATELIMIT_STORAGE_URI when the app is
# created. The default (memory://) is per-instance and therefore not meaningful
# on serverless hosting — see architecture/02-hosting-and-vercel.md §3.
limiter = Limiter(key_func=get_remote_address)
