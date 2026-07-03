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
- Provisioning status: Firestore (database, rules, indexes) is deployed to `siteview-buildchain`. **Firebase Storage is not yet set up** — needs console "Get Started" + Blaze plan; photo/document uploads fail until then, and the bucket will be `siteview-buildchain.firebasestorage.app` (not `.appspot.com`). Auth (Email/Password), the service account key, and client app configs are also still pending per `SETUP_GUIDE.md`.
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

The web app mirrors this: `web/src/pages/` is organized into `admin/`, `manager/`, `supervisor/`, `accountant/` folders, with routing/role guards driven by `web/src/context/AuthContext.js`.

### Backend

`backend/src/routes/` has one module per domain, all registered in `src/server.js`. Domains: time tracking (`punches`, `timesheets`), workforce (`auth`, `employees`, `sites`), equipment management (`equipment`, `machineHours`, `maintenance`, `maintenanceSchedule`, `repairTickets`, `technicians`, `inspections`, `healthDashboard`, `fleetReports` — utilization/downtime/compliance/idle-assets/cost-per-hour under `/api/fleet-reports`), plus `inventory`, `documents`, `photos`, `notifications`, `reports`.

`backend/src/services/`: `firebase.js` (Admin SDK — Firestore + Storage), `pdf.js` (pdfkit) and `excel.js` (exceljs) for invoice/timesheet exports, `maintenanceRecords.js` (shared maintenance-record writer used by manual creation, schedule completion, and ticket completion), `inventoryStock.js` (stock decrement + transaction log shared by inventory and maintenance-supplies endpoints).

Note: `/api/health` is registered twice in `server.js` — the healthDashboard router and a plain status endpoint; the router wins for matching paths.

### Mobile

Employee-only app: punch in/out (GPS via expo-location), task photos, equipment/machine hours, inspections, document scanning. i18n via i18next with English and Spanish in `mobile/src/i18n/` — user-facing strings belong in both `en.js` and `es.js`, not inline.

### Domain rules

- Employees have `paymentType` of `hourly`, `daily`, or `contract`, each with its own rate field (`hourlyRate` / `dailyRate` / `contractAmount`) — this drives timesheet and invoice calculations.
- Users are stored in the Firestore `users` collection keyed by Firebase Auth `uid`, with `role` and `isActive` fields.
