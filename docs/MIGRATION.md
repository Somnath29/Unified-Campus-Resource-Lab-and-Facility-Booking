# Backend to Next.js 14 App Router Migration

This document tracks the migration of all backend routes, middleware, and background services from Express (`apps/backend`) into Next.js 14 App Router Route Handlers inside `apps/web`.

## Scheduler Note
> **Important:** The in-process `setInterval` auto-release scheduler has been removed in favor of a serverless cron route: `GET /api/cron/auto-release`.
> A scheduler (e.g. Vercel Cron, GitHub Actions, or external cron job) must call this route regularly with `Authorization: Bearer <CRON_SECRET>`; otherwise, unverified reservations exceeding the 15-minute start deadline will never be automatically released back to the available inventory pool.

## Inventory & Migration Status

| Express Method and Path | New Next.js File | Status |
| :--- | :--- | :--- |
| `GET /api/health` | `apps/web/src/app/api/health/route.ts` | migrated |
| `POST /api/auth/login` | `apps/web/src/app/api/auth/login/route.ts` | migrated |
| `POST /api/auth/register` | `apps/web/src/app/api/auth/register/route.ts` | migrated |
| `POST /api/auth/demo-login` | `apps/web/src/app/api/auth/demo-login/route.ts` | migrated |
| `GET /api/auth/me` | `apps/web/src/app/api/auth/me/route.ts` | migrated |
| *(new)* `POST /api/auth/logout` | `apps/web/src/app/api/auth/logout/route.ts` | migrated |
| `GET /api/dashboard/stats` | `apps/web/src/app/api/dashboard/stats/route.ts` | migrated |
| `GET /api/dashboard` | `apps/web/src/app/api/dashboard/route.ts` | migrated |
| `GET /api/resources` | `apps/web/src/app/api/resources/route.ts` | migrated |
| `POST /api/resources/smart-allocation` | `apps/web/src/app/api/resources/smart-allocation/route.ts` | migrated |
| `GET /api/resources/:id` | `apps/web/src/app/api/resources/[id]/route.ts` | migrated |
| `GET /api/timetable` | `apps/web/src/app/api/timetable/route.ts` | migrated |
| `GET /api/bookings` | `apps/web/src/app/api/bookings/route.ts` | migrated |
| `POST /api/bookings` | `apps/web/src/app/api/bookings/route.ts` | migrated |
| `GET /api/bookings/:id` | `apps/web/src/app/api/bookings/[id]/route.ts` | migrated |
| `POST /api/bookings/:id/cancel` | `apps/web/src/app/api/bookings/[id]/cancel/route.ts` | migrated |
| `GET /api/approvals` | `apps/web/src/app/api/approvals/route.ts` | migrated |
| `POST /api/approvals/:id/action` | `apps/web/src/app/api/approvals/[id]/action/route.ts` | migrated |
| `POST /api/checkin/verify` | `apps/web/src/app/api/checkin/verify/route.ts` | migrated |
| `GET /api/analytics/overview` | `apps/web/src/app/api/analytics/overview/route.ts` | migrated |
| `GET /api/analytics` | `apps/web/src/app/api/analytics/route.ts` | migrated |
| `GET /api/admin/users` | `apps/web/src/app/api/admin/users/route.ts` | migrated |
| `PUT /api/admin/users/:id/role` | `apps/web/src/app/api/admin/users/[id]/role/route.ts` | migrated |
| `POST /api/admin/resources` | `apps/web/src/app/api/admin/resources/route.ts` | migrated |
| `PUT /api/admin/resources/:id` | `apps/web/src/app/api/admin/resources/[id]/route.ts` | migrated |
| `DELETE /api/admin/resources/:id` | `apps/web/src/app/api/admin/resources/[id]/route.ts` | migrated |
| `GET /api/admin/policies` | `apps/web/src/app/api/admin/policies/route.ts` | migrated |
| `PUT /api/admin/policies/:id` | `apps/web/src/app/api/admin/policies/[id]/route.ts` | migrated |
| `GET /api/admin/audit-logs` | `apps/web/src/app/api/admin/audit-logs/route.ts` | migrated |
| `GET /api/notifications` | `apps/web/src/app/api/notifications/route.ts` | migrated |
| `PUT /api/notifications/:id/read` | `apps/web/src/app/api/notifications/[id]/read/route.ts` | migrated |
| `PUT /api/notifications/read-all` | `apps/web/src/app/api/notifications/read-all/route.ts` | migrated |
| `POST /api/checkin/auto-release-scan` *(removed)* | Replaced by `GET /api/cron/auto-release` | migrated |
| `middleware/auth.ts` | `apps/web/src/lib/auth.ts` | migrated |
| `services/autoReleaseService.ts` | `apps/web/src/server/services/autoRelease.ts` & `apps/web/src/app/api/cron/auto-release/route.ts` | migrated |
