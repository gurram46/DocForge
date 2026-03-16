# DocForge Superadmin

Standalone superadmin frontend and proxy server for:

- `C:\Users\sande\backend\docquest`
- `C:\Users\sande\pdf-brach`

## What this is

This project is a separate control-plane UI. It does not replace either backend and it does not bypass their normal JWT flows.

The browser talks only to this local server. This server then calls the two backends using dedicated admin credentials.
For executive KPIs, it can also read directly from Postgres through `DATABASE_URL`.

Mobile-app override:
- competition + notification routes can be pointed to a separate backend using `MOBILEAPP_BASE_URL`.

Per-backend auth mode (env-only, no code redeploy needed):
- `*_ADMIN_AUTH_MODE=shared_token` uses `X-Admin-Token`
- `*_ADMIN_AUTH_MODE=internal_admin_jwt` uses generated JWT from `*_INTERNAL_ADMIN_JWT_SECRET`
- `*_ADMIN_AUTH_MODE=static_internal_jwt` uses fixed `*_INTERNAL_ADMIN_JWT`
- `*_ADMIN_AUTH_MODE=legacy_access_jwt` uses legacy app-style access JWT (mobile compatibility)
- `*_ADMIN_AUTH_MODE=auto` tries secure modes first, then fallbacks

## Quick start

1. Copy `.env.example` to `.env`
2. Set the login credentials plus the backend URLs and either internal admin JWT secrets, fixed JWTs, or admin tokens
3. Optionally set `DATABASE_URL` for direct read-only KPI queries
4. Run `npm start`
5. Open `http://localhost:2000`

## Login

The app now starts with a login screen.

- `OWNER_LOGIN_EMAIL` / `OWNER_LOGIN_PASSWORD`: full control plane access
- `VIEWER_LOGIN_EMAIL` / `VIEWER_LOGIN_PASSWORD`: read-only investor/stakeholder access

`viewer` can see:
- overview
- health
- activity
- audit visibility

`owner` can also use:
- email
- notifications
- user controls
- subscription controls
- competition actions

## Current v1 features

- overview fetch from both backends
- direct DB-backed KPI snapshot when `DATABASE_URL` is configured
- health fetch from both backends
- activity panels
- email send form
- notification create form
- competition create form
- user block/unblock controls
- subscription pause/resume/cancel controls

## Expected backend contract

This app expects both backends to expose `/admin/*` endpoints protected by a dedicated internal admin credential such as:

- `Authorization: Bearer <internal-admin-jwt>`
- or `X-Admin-Token`

Preferred setup:

- set `DOCQUEST_INTERNAL_ADMIN_JWT_SECRET`
- set `PDFBRACH_INTERNAL_ADMIN_JWT_SECRET`
- the app will generate short-lived signed HS256 internal admin JWTs automatically

Fallbacks:

- provide fixed `*_INTERNAL_ADMIN_JWT`
- or provide `*_ADMIN_TOKEN`

Temporary unblock mode (current):

- set the same shared value in backend `INTERNAL_ADMIN_TOKEN`
- set the same value in this app as `DOCQUEST_ADMIN_TOKEN` and `PDFBRACH_ADMIN_TOKEN`
- leave `*_INTERNAL_ADMIN_JWT_SECRET` empty until backend JWT separation is introduced

## Notes

- If an endpoint is not implemented yet, the UI will show the error instead of crashing.
- Admin tokens are kept server-side in `.env`.
- Login credentials must be explicitly set in `.env`; they should not be hardcoded in source.
- Current login is an in-memory session gate for local/internal use. Sessions reset when the server restarts.
- Before production use, move the login layer to persistent auth and tighten backend role enforcement further.
- TypeScript source lives in `src/server.ts` and `src/client/app.ts`.
