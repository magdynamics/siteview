# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SiteView is a construction management app for Build Chain (a ~50-employee construction company with 4 sites). It is three separate npm packages sharing one Firebase project (`siteview-buildchain`):

- `backend/` — Node.js/Express API (entry: `src/server.js`, default port 5000, all routes under `/api/*`)
- `web/` — React 18 dashboard (Create React App, Material UI, Recharts) for office roles
- `mobile/` — React Native app (Expo SDK 49) for field employees, iOS + Android
- `firebase/` — Firestore and Storage security rules

There is no test suite or linter configured in any package.

## Commands

Each package has its own `node_modules`; run `npm install` inside `backend/`, `web/`, and `mobile/` separately.

```bash
# Backend (from backend/)
npm run dev        # nodemon, port 5000 (or PORT in .env)
npm start          # production

# Web (from web/)
npm start          # CRA dev server
npm run build      # production build; deploy: firebase deploy --only hosting

# Mobile (from mobile/)
npm start          # expo start (scan QR with Expo Go)
npm run ios / npm run android

# Firebase rules + indexes (firebase.json at repo root points at firebase/)
firebase deploy --only firestore,storage
```

## Configuration

- `backend/.env` (copy from `.env.example`): `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_STORAGE_BUCKET`, `GOOGLE_MAPS_API_KEY`, `PORT`, `FRONTEND_URL` (CORS origin). Service account key lives at `backend/serviceAccountKey.json` (never commit).
- Provisioning status: Firestore (database, rules, indexes) and Auth are live on `siteview-buildchain`; client configs are real. **File storage runs on the local driver during the trial**: `STORAGE_DRIVER=local` in `backend/.env` writes uploads to `backend/uploads/` (gitignored) served at `PUBLIC_BASE_URL/files/*`; all upload endpoints go through `services/fileStorage.js`. To move to the cloud later: link a billing account (Blaze), click Storage "Get Started" (bucket will be `siteview-buildchain.firebasestorage.app`), deploy storage rules, and set `STORAGE_DRIVER=firebase`. `REQUIRE_TASK_PHOTOS` env gates before/after photo enforcement on task completion (off until mobile per-task photo capture is wired).
- Firebase client configs are hardcoded in `web/src/services/firebase.js` and `mobile/src/services/firebase.js`.
- The backend API URL is set in `web/.env` (`REACT_APP_API_URL`) and hardcoded in `mobile/src/services/api.js`.

## Architecture

### Auth and roles

Firebase Authentication (email/password) on the clients. Clients send the Firebase ID token; `backend/src/middleware/auth.js` verifies it and loads the user's `role` from the Firestore `users` collection. Five roles gate everything:

| Role | Access |
|------|--------|
| `employee` | Mobile app only |
| `supervisor` | Web: live status, timesheet approval, manual punch, equipment/inventory/maintenance/health views |
| `accountant` | Web: timesheets, invoices, exports, documents |
| `manager` | Web: all-sites overview, weekly reports |
| `admin` | Everything + manage employees and sites |
| `viewer` | Reserved: external read-only (municipality/lender) — no endpoints grant it yet; will receive compliance-dashboard access |

Technical-guideline role mapping (SiteView_Technical_Guideline.md): Owner/Investor→admin, GC/PM→manager, Site Manager→supervisor, Foreman/Worker→employee, Accountant→accountant, Municipality/Lender→viewer.

The web app mirrors this: `web/src/pages/` is organized into `admin/`, `manager/`, `supervisor/`, `accountant/` folders, with routing/role guards driven by `web/src/context/AuthContext.js`.

### Backend

`backend/src/routes/` has one module per domain, all registered in `src/server.js`. Domains: time tracking (`punches` — includes immutable corrections via `POST /:id/correct` + `supersededBy` chain, `timesheets`), workforce (`auth`, `employees`, `sites`), equipment management (`equipment`, `machineHours`, `maintenance`, `maintenanceSchedule`, `repairTickets`, `technicians`, `inspections`, `healthDashboard`, `fleetReports` — utilization/downtime/compliance/idle-assets/cost-per-hour under `/api/fleet-reports`), money (`budget`, `accounting` — cash forecast + `GET /export` weekly xlsx, `subcontractors` + invoices, `vendors`, `payments` — ledger with proof uploads; linking an invoice auto-marks it paid), field ops (`tasks`, `materials`, `plans`, `changeOrders`, `safety` — incident report/close, `weather` — daily Open-Meteo capture per site, `voice` — dispatch/query), plus `inventory`, `documents` (supports `relatedType`/`relatedId` linking), `photos`, `notifications`, `reports`, `dashboards`, `alerts`.

`backend/src/services/`: `firebase.js` (Admin SDK — Firestore + Storage), `pdf.js` (pdfkit) and `excel.js` (exceljs) for invoice/timesheet exports, `maintenanceRecords.js` (shared maintenance-record writer used by manual creation, schedule completion, and ticket completion), `inventoryStock.js` (stock decrement + transaction log shared by inventory and maintenance-supplies endpoints), `nlp.js` (Claude-powered voice parsing via `@anthropic-ai/sdk`, active only when `ANTHROPIC_API_KEY` is set — voice.js falls back to its rule-based parsers otherwise), `fileStorage.js` (local/firebase upload driver).

Note: `/api/health` is registered twice in `server.js` — the healthDashboard router and a plain status endpoint; the router wins for matching paths.

### Mobile

Employee-only app: punch in/out (GPS via expo-location), my-tasks with before/during/after photo evidence, safety incident reporting, equipment/machine hours, inspections, document scanning (with vendor linking). i18n via i18next with English and Spanish in `mobile/src/i18n/` — user-facing strings belong in both `en.js` and `es.js`, not inline. Offline-first: `services/offlineQueue.js` queues punches/machine-hours/task-status mutations in AsyncStorage on network failure and replays them (interceptors in `services/api.js`); queued responses resolve `{status: 202, data: {queued: true}}`.

### Domain rules

- Employees have `paymentType` of `hourly`, `daily`, or `contract`, each with its own rate field (`hourlyRate` / `dailyRate` / `contractAmount`) — this drives timesheet and invoice calculations.
- Users are stored in the Firestore `users` collection keyed by Firebase Auth `uid`, with `role` and `isActive` fields.
- A `sites` document is one construction project and carries project-level fields (`budgetTotal`, `currentPhase`, `stakeholders[]`, `changeOrderThreshold`, owner/GC/dates) per the technical guideline — there is no separate `projects` collection.
- Punches snapshot the employee's pay rate at punch-in (`rateSnapshot`, `paymentTypeSnapshot`); punch-out validates an open punch-in exists and flags shifts over 12 hours (`flagged`).
