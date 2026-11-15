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

## 2. Deploying to Render.com (Recommended & Free)

Render is a cloud provider that makes deployment easy. We've included a `render.yaml` configuration file for a **1-Click Deploy**.

1.  **Push to GitHub**: Ensure your code is pushed to your repository.
2.  **Create a Blueprint**:
    *   Go to [dashboard.render.com](https://dashboard.render.com/) and create a free account.
    *   Click **New +** -> **Blueprint**.
    *   Connect your GitHub repository.
3.  **Deploy**: 
    *   Render will automatically detect the `render.yaml` file.
    *   Click "Apply". Render will run the `npm run install-all`, build the frontend, and start your Node server automatically.

### Manual Setup (If not using Blueprint)
If you create a standard Web Service instead of a Blueprint:
*   **Build Command**: `npm run install-all && npm run build`
*   **Start Command**: `npm start`
*   **Environment Variables**: `NODE_ENV = production`

## 3. Alternative Free Tiers: Koyeb / Fly.io

The process is similar as we have a unified root `package.json`:
-   **Build Command**: `npm run install-all && npm run build`
-   **Start Command**: `npm start`
-   **Port**: These platforms automatically inject a `PORT` environment variable, which our server listens to.

## Database
The app uses **PostgreSQL** when `DATABASE_URL` is set, and otherwise a local **SQLite** file.

*   **Production**: attach a PostgreSQL database and set `DATABASE_URL` (on Render: create a PostgreSQL instance and uncomment the block in `render.yaml`). Tables and starter data are created on first start.
*   **Without a database**: on most free hosts the filesystem is **ephemeral**, so the SQLite file, including user accounts, is wiped on every restart or redeploy. Fine for a throwaway demo only.
*   Existing SQLite data is not copied to PostgreSQL automatically; a fresh PostgreSQL database starts from the seed data.

## First sign-in
There are no default credentials. The first person to open a new deployment is asked to create the admin account. On a public URL, set `SETUP_TOKEN` to a secret value first: creating that account then requires the code, so a stranger can't claim it before you do.

## Notes for production
*   Serve the app over **HTTPS**; session cookies are marked `Secure` automatically when the request arrives over HTTPS (including behind the host's proxy).
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
*   **Solution**: You must use a host that supports long-running Node.js processes, like **Render**, **Railway**, **Heroku**, or a VPS (DigitalOcean/AWS). The instructions above for Render cover both the frontend and backend in one place.
