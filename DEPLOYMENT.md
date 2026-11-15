# Deployment Guide

This project is configured for a **Monolithic Deployment**. This means the Node.js backend serves the React frontend as static files. This simplifies hosting as you only need to deploy **one service**.

## 1. Local Production Test

Before deploying, test the production build locally:

1.  **Build the Frontend**:
    ```bash
    cd app
    npm run build
    ```
    This creates a `dist` folder in `app/`.

2.  **Start the Backend**:
    ```bash
    cd ../server
    npm start
    ```

3.  **Visit**: `http://localhost:3000`
    You should see the full application working. The backend is now serving the frontend.

## 2. Production (Docker)

Production runs on an Oracle Cloud server behind a shared Traefik reverse proxy, at **https://ambulance-management.kravlone.xyz**. `docker-compose.yml` starts two containers:

*   `app`: built from the `Dockerfile` (builds the React app, then runs the Node server on port 3000). Traefik labels route the domain to it and get a Let's Encrypt certificate.
*   `db`: PostgreSQL 17, with data in the `pgdata` volume. It is not reachable from outside the server.

First deploy on the server (Traefik is already running and the external `traefik-public` network exists):
```bash
git clone https://github.com/KraVLonE/Ambulance-Management-System.git ambulance && cd ambulance
printf "POSTGRES_PASSWORD=%s\n" "$(openssl rand -hex 24)" > .env && chmod 600 .env
docker compose up -d --build
```
Update: `git pull && docker compose up -d --build`.

Optional values in `.env`: `SETUP_TOKEN`, `SESSION_SECRET` (see below).

## Database
The app uses **PostgreSQL** when `DATABASE_URL` is set, and otherwise a local **SQLite** file.

*   **Production**: `docker-compose.yml` sets `DATABASE_URL` to the bundled Postgres container. Tables and starter data are created on first start.
*   **Local development**: without `DATABASE_URL`, a SQLite file (`server/ambulance.db`, git-ignored) is created automatically.
*   Existing SQLite data is not copied to PostgreSQL automatically; a fresh PostgreSQL database starts from the seed data.

## First sign-in
There are no default credentials. The first person to open a new deployment is asked to create the admin account. On a public URL, set `SETUP_TOKEN` to a secret value first: creating that account then requires the code, so a stranger can't claim it before you do.

## Notes for production
*   Serve the app over **HTTPS**; session cookies are marked `Secure` automatically when the request arrives over HTTPS (including behind the Traefik proxy).
*   The app is designed to run as a **single instance**: live trips and their timers are held in memory. Running several instances behind a load balancer is not supported.
*   The public tracking page (`/track/...`) is reachable without an account by anyone who has the link. It shows only that one trip, without notes or staff names.
*   Cross-origin requests are blocked by default. If the frontend is hosted separately, set `CORS_ORIGIN` to its URL.
*   Routing and address lookup use the free public OSRM and Nominatim servers, which are rate limited and meant for light use. For real traffic, host your own and set `OSRM_URL` / `NOMINATIM_URL`.

## FAQ

### Q: Can I deploy this to GitHub Pages or Vercel?
**No, not the entire app.**
*   **GitHub Pages** and **Vercel** are designed for *static* or *frontend-only* sites.
*   This application has a **Node.js Backend** that needs to run continuously for:
    *   Socket.io real-time updates.
    *   The dispatch engine and database access.
    *   OSRM Proxying.
*   **Solution**: You must use a host that supports long-running Node.js processes, such as a VPS. The Docker setup above runs the frontend and backend as one service.
