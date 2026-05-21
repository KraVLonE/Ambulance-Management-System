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

## Note on Database
This app uses **SQLite** (`ambulance.db`). On most serverless platforms (Render free tier, Heroku), the filesystem is **ephemeral**. This means if the web service restarts/redeploys, **the database will reset**.
*   **For Demo**: This is fine.

## FAQ

### Q: Can I deploy this to GitHub Pages or Vercel?
**No, not the entire app.**
*   **GitHub Pages** and **Vercel** are designed for *static* or *frontend-only* sites.
*   This application has a **Node.js Backend** that needs to run continuously for:
    *   Socket.io real-time updates.
    *   SQLite database.
    *   OSRM Proxying.
*   **Solution**: You must use a host that supports long-running Node.js processes, like **Render**, **Railway**, **Heroku**, or a VPS (DigitalOcean/AWS). The instructions above for Render cover both the frontend and backend in one place.
