"""
Development utility: generate the secrets SilverGate requires.

    python security_enhancements.py

Not imported by the application. It exists so that production secrets are
generated properly instead of being typed by hand — the previous version of this
file emitted `INTERNAL_AES_KEY` and `FLASK_SECRET_KEY`, neither of which the
application reads, while omitting `ADMIN_CODE`, which it does.
"""

import secrets

# name -> entropy in bytes (token_urlsafe produces ~4/3 of this in characters)
SECRET_LENGTHS = {
    "SECRET_KEY": 48,        # Flask request signing
    "JWT_SECRET": 48,        # access tokens, verification tokens, streamer tokens
    "INTERNAL_API_KEY": 48,  # server-to-server credit endpoints
    "ADMIN_CODE": 32,        # admin dashboard gate
}


def generate_secure_keys() -> dict:
    """Return a fresh value for every secret the application requires."""
    return {
        name: secrets.token_urlsafe(length) for name, length in SECRET_LENGTHS.items()
    }


if __name__ == "__main__":
    for key_name, key_value in generate_secure_keys().items():
        print(f"{key_name}={key_value}")
