# Superadmin Frontend Plan

## Goal
Build a superadmin frontend that gives a client-facing view of analytics and full operational controls across:

- Student app backend: `C:\Users\sande\backend\docquest`
- SaaS website/backend: `C:\Users\sande\pdf-brach`

The frontend should let an admin track usage, monitor system health, and perform high-privilege control actions from one place.

## Scope Update: Absolute Control
The client wants a high-level control panel, not just dashboards. That means the system should support broad administrative authority, including:

- sending system emails
- sending push notifications
- blocking or pausing subscriptions
- forcing plan changes
- managing users
- viewing and intervening in payments
- controlling content visibility
- managing tests, competitions, and drafts
- auditing admin activity

This should be treated as an internal control plane with strict safeguards, not a normal frontend page.

## Current Context

### Available backend surfaces already found
- `docquest` exposes routes for:
  - auth
  - tests
  - plans
  - subscriptions
  - user dashboard
  - metadata
  - health
  - student analytics
  - admin notifications
  - admin competitions
  - student payments / me / notifications / feedback / help
- `pdf-brach` exposes routes for:
  - auth
  - tests
  - plans
  - subscriptions
  - user dashboard
  - notifications
  - drafts / automode drafts
  - pdf

### Constraint
- The current `DocForge` workspace is effectively empty except for `.git`.
- A new frontend can be built here as a standalone admin console, rather than modifying the two existing repos immediately.

## Recommended Architecture

### Option A: Standalone admin console in `DocForge` (recommended)
Create a new small project in this repo with:

- a lightweight backend proxy layer
- a frontend dashboard UI

Reason:
- keeps changes isolated
- avoids breaking the production student app and SaaS app
- lets one UI aggregate data from both backends
- easier to iterate before deciding whether to merge into an existing repo

### High-level structure
- `server/`
  - API proxy endpoints
  - auth header/token handling
  - backend aggregation endpoints
- `web/`
  - superadmin dashboard UI
  - analytics widgets
  - admin action forms

## Proposed Features

### 1. Executive dashboard
Single-page summary for client visibility:

- total students
- active users
- test attempts
- subscription counts
- revenue snapshot
- notification activity
- competition activity
- API/service health

### 2. Analytics views
Pull and combine data from both systems:

- student app engagement trends
- daily / weekly activity
- streak and retention indicators
- topic performance summaries
- payment/subscription trends
- SaaS usage indicators from `pdf-brach`
- recent operational events

### 3. Admin controls
Initial control actions that appear feasible from existing endpoints:

- create/list/cancel admin notifications (`docquest`)
- create/list/update/cancel competitions (`docquest`)
- review plans/tests/subscriptions
- inspect health endpoints

Required expanded controls for the client:

- send emails to users or segments
- send push notifications to all users or selected users
- pause, resume, upgrade, downgrade, or cancel subscriptions
- block users, unblock users, force logout, reset access
- inspect payments, flag payment issues, trigger refunds where supported
- manage plans, pricing visibility, and feature flags
- create, edit, pause, cancel, or archive competitions
- inspect and manage test content lifecycle
- manage SaaS-side drafts, PDF generation usage, and account access
- access support tools for intervention and troubleshooting

Important:
Some of these actions do not appear to have existing endpoints yet, so backend work will be required.

## Integration Plan

### Phase 1: Discovery and contract mapping
Before building the UI, confirm the exact response shapes for:

- `docquest` admin notification endpoints
- `docquest` admin competition endpoints
- `docquest` analytics endpoints
- `docquest` health endpoint
- `pdf-brach` dashboard / notifications / subscription endpoints
- any existing mail, billing, admin, or user-management endpoints

Deliverable:
- a documented endpoint map with request/response examples
- a gap report showing which required admin controls are missing

### Phase 2: Aggregation backend
Build a local backend in this repo that:

- stores base URLs in env config
- forwards auth tokens safely
- calls both backend systems
- normalizes responses into one dashboard-friendly shape
- handles partial failures cleanly
- centralizes authorization for dangerous actions
- logs all privileged actions

Suggested aggregate endpoints:

- `GET /api/overview`
- `GET /api/analytics`
- `GET /api/activity`
- `GET /api/health`
- `GET /api/notifications`
- `POST /api/notifications`
- `POST /api/notifications/:id/cancel`
- `GET /api/competitions`
- `POST /api/competitions`
- `PATCH /api/competitions/:id`
- `POST /api/competitions/:id/cancel`

Suggested high-privilege control endpoints:

- `POST /api/admin/email/send`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id/block`
- `PATCH /api/admin/users/:id/unblock`
- `POST /api/admin/users/:id/force-logout`
- `GET /api/admin/subscriptions`
- `PATCH /api/admin/subscriptions/:id/pause`
- `PATCH /api/admin/subscriptions/:id/resume`
- `PATCH /api/admin/subscriptions/:id/cancel`
- `PATCH /api/admin/subscriptions/:id/plan`
- `GET /api/admin/payments`
- `POST /api/admin/payments/:id/refund`
- `GET /api/admin/audit-log`

Note:
These are control-plane endpoints for the new admin layer. Some may proxy to existing routes; others will require new backend implementation in `docquest`, `pdf-brach`, or both.

### Phase 3: Frontend dashboard
Build a frontend with:

- top KPI cards
- trend charts
- recent activity tables
- notifications management panel
- competitions management panel
- system health section
- backend status indicators
- user management panel
- subscriptions control panel
- email/send center
- payment intervention panel
- audit log viewer

Preferred UX:
- one clear superadmin homepage
- fast scan for metrics
- clear action forms with validation
- visible error states for backend outages

### Phase 4: Hardening
- authentication for superadmin access
- strict role checks
- audit logging for admin actions
- confirmation flows for destructive actions
- optional two-person approval for critical financial actions
- loading/error/empty states
- pagination and filters
- input validation
- rate limiting on admin actions
- action reason capture for sensitive operations
- immutable admin event history

## Control Domains

### 1. User control
- search users
- view account state
- block/unblock users
- disable access temporarily
- force password reset / re-verification flows
- force logout across devices

### 2. Subscription control
- view all subscriptions
- filter by status, plan, renewal risk
- pause subscriptions
- resume subscriptions
- cancel subscriptions
- override plan assignments
- comp access / grant manual access

### 3. Communication control
- send email broadcasts
- send targeted emails
- send push notifications
- schedule messages
- cancel scheduled campaigns
- track delivery status where providers support it

### 4. Billing control
- inspect payments
- see failed payment patterns
- mark exceptions
- trigger refunds if payment providers support admin refunds
- reconcile subscription state against provider state

### 5. Content and operations control
- manage competitions
- manage notifications
- manage test publication status
- inspect draft pipelines
- monitor PDF generation usage and failures
- monitor background jobs and webhook failures

### 6. Governance
- audit trail for every admin action
- admin session tracking
- role-based permissions inside superadmin
- optional read-only vs operator vs owner roles

## Data Model for the Dashboard

### Core overview payload
The aggregate API should normalize to something like:

- `studentMetrics`
  - totalUsers
  - activeUsers
  - testsTaken
  - avgScore
  - subscriptionsActive
  - revenue
- `saasMetrics`
  - totalCustomers
  - activeDrafts
  - generatedPdfs
  - planDistribution
- `operations`
  - notificationsActive
  - competitionsActive
  - failedJobs
  - serviceHealth

### Activity feed
Unified recent events:

- new subscriptions
- notifications sent
- competitions created
- failed requests
- unusual traffic spikes

## Risks / Unknowns

### 1. Missing endpoints
Not all desired metrics may have direct endpoints today.
Possible fix:
- add new read-only summary endpoints in the existing backends

### 2. Auth differences
The two systems may use different auth schemes/cookies/tokens.
Possible fix:
- centralize auth in the new proxy layer

### 3. CORS / network separation
Direct browser calls to both backends may be blocked or brittle.
Possible fix:
- browser talks only to the local admin backend

### 4. Incomplete analytics
Some client-facing KPIs may require SQL aggregation not yet exposed.
Possible fix:
- add dedicated backend analytics endpoints after reviewing DB schema

### 5. Dangerous actions without safeguards
Absolute control creates real operational risk.
Possible fix:
- require explicit permission levels
- add confirmations and audit logs
- split especially risky actions behind stronger authorization

### 6. Provider limitations
Mail, payment, and subscription systems may depend on third-party APIs.
Possible fix:
- map exact provider integrations first
- expose only what underlying providers safely support

## Build Order

1. Confirm which repo should host the final UI long term.
2. Enumerate exact API contracts from both backends.
3. Create the standalone admin console scaffold in `DocForge`.
4. Implement proxy/aggregation endpoints.
5. Implement the dashboard UI.
6. Wire up notification and competition controls.
7. Add user, subscription, email, and payment controls.
8. Add authentication and audit protections.
9. Test against live/staging backend URLs.

## Minimal First Deliverable
If we want the fastest usable version first, build:

- overview page
- health section
- notifications list/create/cancel
- competitions list/create/cancel
- basic analytics cards from `docquest`
- user search and block/unblock
- subscription list and pause/cancel controls
- basic email send tool

This gives immediate operational value before deeper analytics work.

## Recommended Rule
Do not ship "absolute control" as one unrestricted admin role.

Instead, split capabilities into at least:

1. Viewer: can only see analytics and audit logs.
2. Operator: can manage notifications, competitions, and limited user actions.
3. Owner: can perform subscription overrides, billing actions, and critical controls.

## Decision Needed Before Coding
Choose one:

1. Build a standalone admin console in `DocForge` first.
2. Put the UI directly inside `pdf-brach`.
3. Put the UI directly inside `backend\docquest` as server-rendered/admin pages.

Recommendation:
Choose option 1 first, then migrate later if needed.
