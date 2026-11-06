# AP Automation backend

## Local configuration

The backend reads `Backend/.env`. Configure `DB_PASSWORD` and, when using AI
extraction, `GROQ_API_KEY`. Django development mode defaults to `DEBUG=True`;
without `DJANGO_SECRET_KEY` it generates an ephemeral development key. Set
`DJANGO_DEBUG=False` outside development. Production startup then requires
`DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `DB_PASSWORD`, and an appropriate
`DEFAULT_FROM_EMAIL`. Set `DB_NAME`, `DB_USER`, `DB_HOST`, and `DB_PORT` when
the database differs from the local defaults.

Set `CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS` to the actual frontend
origins. Production enables secure cookies, HTTPS redirection, and HSTS by
default. If TLS terminates at a trusted reverse proxy, set
`DJANGO_TRUST_PROXY_SSL_HEADER=True` only when that proxy overwrites
`X-Forwarded-Proto`.

The frontend accepts `VITE_API_BASE_URL`; development defaults to
`http://127.0.0.1:8000/api`, while production defaults to same-origin `/api`.

## Authentication and notifications

- `POST /api/auth/register/` accepts `full_name`, `email`, `password`, and
  `confirm_password`. Passwords are validated and hashed by Django.
- `POST /api/auth/token/` authenticates by email and returns a DRF token.
- `POST /api/auth/logout/` revokes the current token.
- The frontend stores the token for refresh persistence and clears it on logout
  or an expired-token response.
- Configure `EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`,
  `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, `EMAIL_USE_SSL`, and
  `DEFAULT_FROM_EMAIL` for real outbound notifications. Development uses
  Django's console email backend.
- `python manage.py notify_pending_approvals` sends reminders after
  `AP_APPROVAL_REMINDER_HOURS` (default 24) and escalates after
  `AP_APPROVAL_ESCALATION_HOURS` (default 72). Notifications go to active users
  with email addresses; Django groups and approval-rule labels do not restrict
  application access or notification recipients. Schedule this command with
  the deployment's task scheduler.

## Integration status

- PDF text extraction and image OCR are local integrations using pypdf,
  Poppler, and Tesseract. Groq extraction is attempted only when
  `GROQ_API_KEY` is configured; no external extraction request is implied by
  local OCR verification.
- Inbound email ingestion and a mailbox adapter are not implemented.
- Payment records track request approval/rejection and settlement history.
  Payment processing in the tracking workflow is simulated for testing; no
  bank transfer is initiated. Completing a simulated payment creates a
  `SIM-PAY-*` reference and records the settlement date.
- Reports and CSV exports are available, but no ERP/accounting provider
  connector or delivery/retry queue is implemented.
