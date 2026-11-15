# Ambulance Management & Routing System

A full-stack, real-time ambulance dispatch system. Dispatchers send individual ambulances to any point on the map; the server picks the fastest suitable unit by road, takes the patient to the nearest hospital that can treat them, and keeps every connected screen in sync.

## Features

**Dispatching**
*   **Request from anywhere**: click the map, search an address, or use your location. Choose severity (Critical / Urgent / Standard) and case type (General / Trauma / Cardiac), and add a note for the crew.
*   **Individual ambulances**: every unit has a call sign, a type (ALS = advanced life support, BLS = basic), a crew and a status. Critical calls get an ALS unit when one is free.
*   **Fastest by road**: the server routes the nearest candidates with [OSRM](http://project-osrm.org/) and sends the quickest. If OSRM is unreachable it falls back to a distance-based estimate.
*   **Full trip**: base → patient → on scene → nearest suitable hospital (right speciality, free bed) → back to base. A unit driving home can be sent straight to a new call.
*   **Queue**: when no ambulance is free the request waits and is served the moment one frees up, most serious first.
*   **Smart re-assignment**: a critical call can pull a unit off a standard call; a unit that frees up much closer takes over a call already in progress.
*   **Manual override**: a dispatcher can pick the ambulance and the destination hospital by hand.
*   **Public tracking link**: share a link the caller can open, without an account, to watch their ambulance and ETA.

**Managing**
*   **Sign-in and roles**: admin, dispatcher, hospital admin (own hospital only) and read-only viewer.
*   **Hospitals**: add, edit and delete hospitals; drag markers on the map to fix their position; set free beds and specialities.
*   **Fleets**: add or remove units, switch ALS/BLS, name the crew, take a unit off duty.

**Seeing what is going on**
*   **Live for everyone**: all changes are broadcast over Socket.io, including to screens that join mid-trip or reconnect.
*   **Coverage view**: shades the map by how many minutes away the nearest free ambulance is.
*   **Analytics**: response times and call volume by hour, busiest hospitals, a heat grid of where calls come from, and CSV export.
*   **Control room mode**: full-screen map with a large call list for a wall display.
*   **Dark mode**, plus an optional sound and browser notification for critical calls.

> Trips are played back about 30× faster than real time so a demo doesn't take ten minutes. Times shown are real road estimates.

## Tech Stack

*   **Frontend**: React (Vite), Leaflet / React-Leaflet, Tailwind CSS, Socket.io client
*   **Backend**: Node.js / Express, Socket.io
*   **Database**: PostgreSQL in production, SQLite for local development (no setup needed)
*   **External services**: OSRM (routing) and Nominatim (address lookup and search)

## Getting Started

```bash
git clone https://github.com/KraVLonE/ambulance-management-system.git
cd ambulance-management-system
npm run install-all
```

Run the backend and frontend in two terminals:

```bash
cd server && npm start        # http://localhost:3000
cd app && npm run dev         # http://localhost:5173
```

If port 3000 is taken: `PORT=3100 npm start` and `BACKEND_URL=http://localhost:3100 npm run dev`.

Open the frontend URL. **On first run you are asked to create the admin account**; there are no default credentials. Add other users from the **Users** page.

Without `DATABASE_URL` the server uses a SQLite file (`server/ambulance.db`) and seeds twelve hospitals around Chandigarh with small fleets. A database from an earlier version is upgraded automatically; the old tables are kept as `hospitals_v1` / `dispatches_v1`.

## Roles

| Role | Can do |
| --- | --- |
| Admin | Everything: users, hospitals, fleets, dispatching |
| Dispatcher | Create and cancel dispatches, choose units by hand |
| Hospital admin | Manage the ambulances, beds and specialities of their own hospital |
| Viewer | Read-only (for example a wall display) |

## Tests

```bash
npm test                 # server API tests + frontend tests (both run offline)
npm run lint             # frontend lint
```

To run the server suite against PostgreSQL instead of SQLite (each test uses its own throwaway schema):

```bash
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/dbname npm test --prefix server
```

## Configuration

All optional, set as environment variables on the server:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | unset | PostgreSQL connection string. When unset, SQLite is used |
| `DB_PATH` | `server/ambulance.db` | SQLite file location (only without `DATABASE_URL`) |
| `SETUP_TOKEN` | unset | If set, creating the first admin account requires this code |
| `SESSION_SECRET` | generated, stored in the database | Signing key for session cookies |
| `TIME_SCALE` | `30` | How much faster than real time trips are played back |
| `OSRM_URL` | public OSRM server | Routing server; empty string = always use estimates |
| `NOMINATIM_URL` | public Nominatim server | Geocoding; empty string = no address lookup or search |
| `CORS_ORIGIN` | unset (same-origin only) | Allow a frontend hosted on another origin |

## API

All routes except `auth`, `health` and `track` need a signed-in session (httpOnly cookie).

| Method | Path | Who | Description |
| --- | --- | --- | --- |
| GET | `/api/auth/status` | anyone | Current user, and whether first-run setup is needed |
| POST | `/api/auth/setup` · `/login` · `/logout` | anyone | Create first admin · sign in · sign out |
| GET/POST/PATCH/DELETE | `/api/users[/:id]` | admin | Manage accounts |
| GET | `/api/state` | signed in | Hospitals, units and live dispatches in one call |
| POST | `/api/request` | dispatcher | `{ lat, lng, severity?, caseType?, note?, address?, ambulanceId?, destHospitalId? }` |
| POST | `/api/dispatches/:id/cancel` | dispatcher | Cancel / recall |
| GET | `/api/dispatches/history` | signed in | Recently finished dispatches |
| POST/PATCH/DELETE | `/api/hospitals[/:id]` | admin (PATCH: also own hospital admin) | Manage hospitals |
| PUT | `/api/hospitals/:id` | hospital manager | Set how many ambulances are at base |
| POST/PATCH/DELETE | `/api/ambulances[/:id]` | hospital manager | Manage units |
| GET | `/api/stats` · `/api/analytics` · `/api/analytics/export.csv` | signed in | Numbers and export |
| GET | `/api/geocode/reverse` · `/api/geocode/search` | signed in | Address lookup and search |
| GET | `/api/track/:token` | anyone with the link | Public view of one trip |

Socket.io events (signed-in clients only): `hospital`, `hospital_removed`, `unit`, `unit_removed`, `dispatch`.

## Project Layout

```
server/
  app.js       HTTP routes, auth and role checks
  engine.js    Dispatch engine: units, queue, trip legs, re-assignment
  db.js        PostgreSQL / SQLite layer, schema, seed data, migration
  auth.js      Password hashing and session cookies
  routing.js   OSRM routing, Nominatim geocoding, geometry helpers
app/src/
  App.jsx      Shell: sign-in gate, live view, analytics, users, tracking
  components/  Map, panels, forms and pages
  hooks/       Auth, live state, preferences, toasts
  lib/         API client, geometry, formatting, alerts
```

## Contributing

Contributions are welcome! Please fork the repository and submit a pull request.

## License

Distributed under the MIT License.
