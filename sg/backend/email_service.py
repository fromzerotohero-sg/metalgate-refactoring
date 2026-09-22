from __future__ import annotations

import base64
import html
import logging
import re
import time
import uuid

import requests
import resend
from flask import current_app

logger = logging.getLogger(__name__)

# Resend's batch endpoint. See send_campaign_batch for why this is called
# directly rather than through the SDK.
RESEND_BATCH_URL = "https://api.resend.com/emails/batch"

# Resend's documented maximum recipients per batch call.
MAX_BATCH_SIZE = 100

# Resend caps an idempotency key at 256 characters.
MAX_IDEMPOTENCY_KEY_LENGTH = 256


class EmailService:
    def __init__(self):
        self.api_key = current_app.config["RES_API_KEY"]
        self.from_email = current_app.config["EMAIL_FROM"]
        self.from_name = current_app.config["EMAIL_FROM_NAME"]
        resend.api_key = self.api_key

    def _replace_data_images_with_cid(self, html_body):
        """Convert data:image URLs into CID attachments for broad email-client support."""
        if not html_body:
            return html_body, []

        pattern = re.compile(
            r'src=["\'](data:image/(?P<subtype>[a-zA-Z0-9.+-]+);base64,(?P<data>[^"\']+))["\']',
            re.IGNORECASE,
        )

        attachments = []
        cid_map = {}

        def replacer(match):
            full_data_url = match.group(1)
            subtype = (match.group("subtype") or "png").lower()
            base64_data = match.group("data") or ""

            if full_data_url in cid_map:
                cid = cid_map[full_data_url]
                return f'src="cid:{cid}"'

            try:
                image_bytes = base64.b64decode(base64_data, validate=True)
                if not image_bytes:
                    return match.group(0)

                cid = f"img-{uuid.uuid4().hex}"

                cid_map[full_data_url] = cid
                attachments.append(
                    {
                        "filename": f"{cid}.{subtype}",
                        "content": base64.b64encode(image_bytes).decode("ascii"),
                        "disposition": "inline",
                        "content_id": cid,
                    }
                )
                return f'src="cid:{cid}"'
            except Exception:
                logger.warning("Failed to convert inline data image to CID attachment")
                return match.group(0)

        updated_html = pattern.sub(replacer, html_body)
        return updated_html, attachments

    def send_email(self, to_email, subject, html_body, text_body=None):
        """Send email using Resend"""
        try:
            logger.info("Attempting to send email to %s", to_email)
            logger.info("Resend from: %s <%s>", self.from_name, self.from_email)
            logger.info("Resend API key available: %s", bool(self.api_key))

            processed_html, inline_attachments = self._replace_data_images_with_cid(
                html_body
            )

            params: resend.Emails.SendParams = {
                "from": f"{self.from_name} <{self.from_email}>",
                "to": [to_email],
                "subject": subject,
                "html": processed_html,
            }

            if text_body:
                params["text"] = text_body

            if inline_attachments:
                params["attachments"] = inline_attachments

            response = resend.Emails.send(params)
            logger.info("Email sent successfully to %s: %s", to_email, response)
            return True

        except Exception as e:
            logger.error("Failed to send email to %s: %s", to_email, e)
            logger.error("Resend API key available: %s", bool(self.api_key))
            logger.error("From Email: %s", self.from_email)
            raise

    def send_campaign_batch(self, emails, *, idempotency_key=None, max_attempts=4):
        """
        Send up to 100 emails in a single Resend API call.

        Sending one HTTP request per recipient is what made a large campaign
        impossible: 3,000 sequential calls cannot finish inside a function or
        gunicorn timeout no matter which email provider is behind it. Batching
        turns 3,000 calls into 30.

        This posts to the batch endpoint directly rather than using
        ``resend.Batch`` because the endpoint's ``Idempotency-Key`` header is what
        makes a retried chunk safe, and its exposure in the SDK varies by version
        — while ``resend`` is unpinned in requirements.txt.

        **The batch endpoint does not support attachments.** Campaign images must
        therefore be hosted URLs; the caller rejects inline ``data:`` images
        before reaching here. The single-send path above still supports them,
        which is why the verification and welcome templates keep their embedded
        images.

        Retries on 429 and 5xx with backoff, reusing the same idempotency key so a
        retry after a timeout cannot double-send. Returns the Resend email ids in
        the same order as `emails`.
        """
        if not emails:
            return []
        if len(emails) > MAX_BATCH_SIZE:
            raise ValueError(
                f"Resend accepts at most {MAX_BATCH_SIZE} emails per batch, got {len(emails)}"
            )

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if idempotency_key:
            headers["Idempotency-Key"] = str(idempotency_key)[:MAX_IDEMPOTENCY_KEY_LENGTH]

        last_error = None

        for attempt in range(1, max_attempts + 1):
            try:
                response = requests.post(
                    RESEND_BATCH_URL, headers=headers, json=emails, timeout=30
                )
            except requests.RequestException as exc:
                # A timeout may still have been delivered; the idempotency key is
                # what makes retrying it safe.
                last_error = exc
                logger.warning(
                    "Batch send attempt %s/%s failed: %s", attempt, max_attempts, exc
                )
            else:
                if response.status_code in (200, 201):
                    try:
                        payload = response.json()
                    except ValueError:
                        raise RuntimeError(
                            "Resend returned a non-JSON batch response: "
                            f"{response.text[:300]}"
                        ) from None
                    return [item.get("id") for item in (payload.get("data") or [])]

                detail = f"{response.status_code} {response.text[:300]}"

                if response.status_code == 429 or response.status_code >= 500:
                    # Worth retrying: rate limit or a transient fault on their side.
                    last_error = RuntimeError(f"Resend returned {detail}")
                    logger.warning(
                        "Batch send attempt %s/%s rejected: %s",
                        attempt,
                        max_attempts,
                        detail,
                    )
                else:
                    # 4xx is our payload being wrong; retrying would only repeat it.
                    raise RuntimeError(f"Resend rejected the batch: {detail}")

            if attempt < max_attempts:
                # Exponential backoff: Resend rate-limits per second.
                time.sleep(min(0.5 * (2 ** attempt), 8))

        raise RuntimeError(
            f"Batch send failed after {max_attempts} attempts: {last_error}"
        )

    def send_verification_email(self, user_email, username, verification_link):
        """Send email verification with a secure link."""
        # `username` is user-supplied, so it is escaped before it reaches an HTML
        # body: without this, a username containing markup is rendered as markup
        # in the recipient's mail client.
        safe_username = html.escape(username or "utente")
        try:
            logger.info("Starting email verification process for %s", user_email)
            logger.info("Verification link prepared for email delivery")

            subject = "Conferma il tuo account SilverGate"

            html_body = f"""
            <!DOCTYPE html>
            <html lang="it">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Conferma il tuo account</title>
            </head>
            <body style="margin:0;padding:0;background-color:#08080f;font-family:'Segoe UI',Arial,sans-serif;color:#e8e8f0;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#08080f;padding:48px 16px 56px;">
                    <tr>
                        <td align="center">
                            <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">

                                <!-- LOGO -->
                                <tr>
                                    <td align="center" style="padding:0 0 36px 0;">
                                        <span style="font-size:13px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#4a4a6a;">FROM ZERO TO HERO</span>
                                    </td>
                                </tr>

                                <!-- CARD -->
                                <tr>
                                    <td style="background:#0e0e1a;border:1px solid #1c1c2e;border-radius:16px;overflow:hidden;">

                                        <!-- Accent top bar -->
                                        <div style="height:3px;background:linear-gradient(90deg,#BD9FED 0%,#60B0CA 100%);"></div>

                                        <!-- Body -->
                                        <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                            <tr>
                                                <td style="padding:44px 44px 0 44px;">

                                                    <h1 style="margin:0 0 8px 0;font-size:28px;font-weight:800;color:#ffffff;line-height:1.25;letter-spacing:-0.3px;">Conferma il tuo account</h1>
                                                    <p style="margin:0 0 28px 0;font-size:15px;color:#6666aa;">Un solo click per iniziare.</p>

                                                    <p style="margin:0 0 18px 0;font-size:16px;line-height:1.75;color:#c8c8e0;">Ciao <strong style="color:#ffffff;">{safe_username}</strong>,</p>

                                                    <p style="margin:0 0 32px 0;font-size:15px;line-height:1.85;color:#a0a0c0;">Grazie per esserti registrato su <strong style="color:#e8e8f0;">SilverGate</strong>. Premi il pulsante qui sotto per verificare il tuo indirizzo email e attivare il profilo.</p>

                                                    <!-- CTA -->
                                                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                                                        <tr>
                                                            <td align="center">
                                                                <a href="{verification_link}" style="display:inline-block;background:linear-gradient(90deg,#BD9FED 0%,#7ec8e3 100%);color:#06060f;font-size:15px;font-weight:800;text-decoration:none;padding:15px 44px;border-radius:10px;letter-spacing:0.4px;">Verifica email &rarr;</a>
                                                            </td>
                                                        </tr>
                                                    </table>

                                                    <!-- GOLDEN BANNER -->
                                                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                                                        <tr>
                                                            <td style="background:linear-gradient(135deg,#3a2800 0%,#5c3d00 50%,#3a2800 100%);border:1px solid #c8860a;border-radius:12px;padding:18px 22px;">
                                                                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                                                    <tr>
                                                                        <td width="36" valign="middle" style="padding-right:14px;font-size:26px;line-height:1;">&#127873;</td>
                                                                        <td valign="middle">
                                                                            <p style="margin:0 0 3px 0;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#f0a830;">Benvenuto</p>
                                                                            <p style="margin:0;font-size:16px;font-weight:800;color:#ffe08a;">Goditi i tuoi 10 HP gratis!</p>
                                                                        </td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                    </table>

                                                    <!-- Expiry note -->
                                                    <p style="margin:0 0 24px 0;font-size:13px;line-height:1.7;color:#55556a;">Il link scade tra <strong style="color:#7a7a9a;">24 ore</strong>. Se non hai creato tu questo account, ignora questa email.</p>

                                                    <!-- Fallback link -->
                                                    <p style="margin:0 0 8px 0;font-size:13px;color:#55556a;">Se il bottone non funziona, copia questo link:</p>
                                                    <div style="background:#0a0a14;border-left:3px solid #2e2e50;border-radius:6px;padding:12px 16px;margin:0 0 40px 0;">
                                                        <a href="{verification_link}" style="color:#7ab8d4;word-break:break-all;text-decoration:none;font-size:12px;line-height:1.7;">{verification_link}</a>
                                                    </div>

                                                </td>
                                            </tr>

                                            <!-- Footer inside card -->
                                            <tr>
                                                <td style="padding:20px 44px 28px 44px;border-top:1px solid #161625;">
                                                    <p style="margin:0;font-size:13px;font-weight:600;color:#c8c8e0;">A presto,<br><span style="color:#BD9FED;">Team SilverGate</span></p>
                                                </td>
                                            </tr>

                                        </table>
                                    </td>
                                </tr>

                                <!-- Bottom legal -->
                                <tr>
                                    <td style="padding:28px 0 0 0;text-align:center;">
                                        <p style="margin:0 0 4px 0;font-size:11px;color:#2e2e48;">© 2025 SilverGate — Tutti i diritti riservati</p>
                                        <p style="margin:0;font-size:11px;color:#2e2e48;">Non rispondere a questa email.</p>
                                    </td>
                                </tr>

                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
            """

            text_body = f"""
Conferma il tuo account SilverGate

Ciao {username or 'utente'},

abbiamo ricevuto la tua registrazione su SilverGate.
Per attivare il profilo e completare l'accesso, conferma il tuo indirizzo email aprendo questo link:

{verification_link}

Il link di verifica resta valido per 24 ore.
Se non hai creato tu questo account, puoi ignorare tranquillamente questa email.

A presto,
Team SilverGate

© 2025 SilverGate — Tutti i diritti riservati
Non rispondere a questa email.
            """

            logger.info("Email content prepared, attempting to send to %s", user_email)
            result = self.send_email(user_email, subject, html_body, text_body)
            logger.info("Email send result: %s", result)
            return result

        except Exception as e:
            logger.error("Failed to send verification email to %s: %s", user_email, e)
            logger.error("Exception details: %s", e)
            raise

    def send_password_reset_code(self, user_email, code):
        """Send password reset code"""
        try:
            subject = "Reset your SilverGate password"

            html_body = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Reset your password</title>
                <style>
                    body {{
                        font-family: Arial, sans-serif;
                        line-height: 1.6;
                        color: #333;
                        max-width: 600px;
                        margin: 0 auto;
                        padding: 20px;
                    }}
                    .header {{
                        text-align: center;
                        padding: 20px 0;
                        border-bottom: 2px solid #00d4ff;
                    }}
                    .logo {{
                        font-size: 24px;
                        font-weight: bold;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        -webkit-background-clip: text;
                        -webkit-text-fill-color: transparent;
                    }}
                    .content {{
                        padding: 30px 0;
                    }}
                    .code-box {{
                        background: #f8f9fa;
                        border: 2px solid #00d4ff;
                        border-radius: 8px;
                        padding: 20px;
                        text-align: center;
                        margin: 20px 0;
                    }}
                    .code {{
                        font-size: 32px;
                        font-weight: bold;
                        letter-spacing: 8px;
                        color: #00d4ff;
                        font-family: monospace;
                    }}
                    .footer {{
                        text-align: center;
                        padding: 20px 0;
                        border-top: 1px solid #eee;
                        font-size: 12px;
                        color: #666;
                    }}
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="logo">SilverGate</div>
                </div>

                <div class="content">
                    <h2>Password Reset Request</h2>
                    <p>We received a request to reset the password for your account.</p>

                    <p>Use the following code to verify your identity:</p>

                    <div class="code-box">
                        <p>Your reset code is:</p>
                        <div class="code">{code}</div>
                    </div>

                    <p><strong>Important:</strong> This code will expire in 15 minutes.</p>

                    <p>If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
                </div>

                <div class="footer">
                    <p>This is an automated message from SilverGate. Please do not reply to this email.</p>
                    <p>© 2024 SilverGate. All rights reserved.</p>
                </div>
            </body>
            </html>
            """

            text_body = f"""
            Password Reset Request

            We received a request to reset your SilverGate password.

            Your reset code is: {code}

            This code will expire in 15 minutes.

            If you didn't request this, you can ignore this email.

            © 2024 SilverGate
            """

            return self.send_email(user_email, subject, html_body, text_body)

        except Exception as e:
            logger.error("Failed to send password reset email to %s: %s", user_email, e)
            raise


# ── Campaign bodies ─────────────────────────────────────────────────────────
# Building a campaign email is 170 lines of HTML that belongs beside the other
# templates, not inside a Flask route module.

def sanitize_image_src(value) -> str:
    """
    Accept only an absolute http(s) URL or a small inline `data:image/` value.

    Anything else is dropped rather than echoed into the template, so a campaign
    cannot be turned into an XSS or an arbitrary-URL injection vector.
    """
    raw = str(value or "").strip()
    if not raw:
        return ""
    if raw.startswith("https://") or raw.startswith("http://"):
        return raw
    if raw.startswith("data:image/") and ";base64," in raw and len(raw) <= 2_000_000:
        return raw
    return ""


def build_campaign_bodies(payload: dict, username: str | None) -> tuple:
    """Render one campaign email for one recipient: ``(html, text)``."""
    heading = html.escape(str(payload.get("heading", "")).strip() or "Comunicazione")
    intro = html.escape(str(payload.get("intro_text", "")).strip()).replace("\n", "<br>")
    body = html.escape(str(payload.get("body_text", "")).strip()).replace("\n", "<br>")
    cta_text = html.escape(str(payload.get("cta_text", "")).strip())
    cta_url = str(payload.get("cta_url", "")).strip()
    banner_image = sanitize_image_src(payload.get("banner_image"))
    logo_image = sanitize_image_src(payload.get("logo_image"))
    footer_note = html.escape(str(payload.get("footer_note", "")).strip()).replace(
        "\n", "<br>"
    )
    safe_username = html.escape(username or "utente")

    cta_html = ""
    cta_text_line = ""
    if cta_text and cta_url:
        safe_url = html.escape(cta_url, quote=True)
        cta_html = f"""
            <div style="text-align: center; margin: 36px 0 32px 0;">
                <a href="{safe_url}" style="
                    display: inline-block;
                    background: linear-gradient(90deg, #BD9FED 0%, #60B0CA 100%);
                    color: #080611;
                    font-size: 16px;
                    font-weight: 800;
                    text-decoration: none;
                    padding: 14px 36px;
                    border-radius: 8px;
                    letter-spacing: 0.5px;
                ">{cta_text}</a>
            </div>
        """
        cta_text_line = f"\n\n{cta_text}: {cta_url}"

    logo_block = ""
    if logo_image:
        safe_logo = html.escape(logo_image, quote=True)
        logo_block = f"""
        <div style="margin-bottom: 12px;">
          <img src="{safe_logo}" alt="SilverGate" style="max-height: 56px; width: auto; display: inline-block;">
        </div>
        """

    banner_block = ""
    if banner_image:
        safe_banner = html.escape(banner_image, quote=True)
        banner_block = f"""
        <tr>
          <td style="padding: 20px 40px 0 40px;">
            <img src="{safe_banner}" alt="Banner" style="display:block;width:100%;height:auto;border-radius:12px;">
          </td>
        </tr>
        """

    html_body = f"""
    <!DOCTYPE html>
    <html lang="it">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>{heading}</title>
      </head>
      <body style="
        margin: 0;
        padding: 0;
        background-color: #080611;
        font-family: 'Segoe UI', Arial, sans-serif;
        color: #e8e8f0;
      ">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #080611; padding: 40px 16px;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">
                <tr>
                  <td align="center" style="padding: 36px 40px 28px 40px; border-bottom: 1px solid #1e1e2e;">
                    {logo_block}
                    <span style="
                      font-size: 28px;
                      font-weight: 900;
                      letter-spacing: 0.6px;
                      color: #F4EEFF;
                      text-shadow: 0 0 18px rgba(189,159,237,0.18);
                    ">SilverGate</span>
                  </td>
                </tr>
                {banner_block}
                <tr>
                  <td style="padding: 40px 40px 0 40px;">
                    <h1 style="
                      margin: 0 0 24px 0;
                      font-size: 34px;
                      font-weight: 800;
                      color: #ffffff;
                      line-height: 1.2;
                      letter-spacing: -0.5px;
                    ">{heading}</h1>
                    <p style="
                      margin: 0 0 20px 0;
                      font-size: 16px;
                      line-height: 1.75;
                      color: #cfc7e6;
                    ">Ciao <strong style="color: #ffffff;">{safe_username}</strong>,</p>
                    <p style="
                      margin: 0 0 20px 0;
                      font-size: 16px;
                      line-height: 1.8;
                      color: #d7d0ea;
                    ">{intro}</p>
                    <p style="
                      margin: 0 0 20px 0;
                      font-size: 16px;
                      line-height: 1.8;
                      color: #d7d0ea;
                    ">{body}</p>

                    <div style="
                      background: linear-gradient(180deg, rgba(216,180,254,0.14) 0%, rgba(125,211,252,0.10) 100%);
                      border: 1px solid rgba(216,180,254,0.32);
                      box-shadow: 0 10px 30px rgba(0,0,0,0.18);
                      border-radius: 14px;
                      padding: 22px 24px;
                      margin: 30px 0;
                    ">
                      <p style="
                        margin: 0 0 10px 0;
                        font-size: 14px;
                        font-weight: 800;
                        text-transform: uppercase;
                        letter-spacing: 1px;
                        color: #F3E8FF;
                      ">Messaggio dal team</p>
                      <p style="
                        margin: 0;
                        font-size: 15px;
                        line-height: 1.8;
                        color: #e6def7;
                      ">{footer_note}</p>
                    </div>

                    {cta_html}
                  </td>
                </tr>
                <tr>
                  <td style="
                    padding: 24px 40px 36px 40px;
                    border-top: 1px solid #1e1e2e;
                    text-align: center;
                  ">
                    <p style="margin: 0 0 6px 0; font-size: 12px; color: #4a4a6a;">
                      © 2025 SilverGate — Tutti i diritti riservati
                    </p>
                    <p style="margin: 0; font-size: 12px; color: #4a4a6a;">
                      Non rispondere a questa email.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
    """

    text_body = (
        f"{heading}\n\n"
        f"Ciao {username or 'utente'},\n\n"
        f"{str(payload.get('intro_text', '')).strip()}\n\n"
        f"{str(payload.get('body_text', '')).strip()}\n\n"
        f"{str(payload.get('footer_note', '')).strip()}\n\n"
        "© 2025 SilverGate — Tutti i diritti riservati\n"
        "Non rispondere a questa email."
        f"{cta_text_line}"
    )

    return html_body, text_body
