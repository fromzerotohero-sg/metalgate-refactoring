"""
Vercel / WSGI entry point.

Vercel's Python runtime looks for a WSGI callable named ``app`` in this file and
serves it as a serverless function. The Flask application itself lives in
``backend/``, so that directory is put on ``sys.path`` before importing it —
this keeps ``backend/`` runnable on its own with gunicorn or ``python app.py``
without turning everything into a package.

``vercel.json`` routes the whole path space here; the application decides what
to do with each route.
"""

import os
import sys

_BACKEND_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"
)

if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from app import create_app  # noqa: E402  (the path must be set first)

app = create_app()
