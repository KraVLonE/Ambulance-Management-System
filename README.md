# Ambulance Management & Routing System

A modern, full-stack web application for real-time ambulance dispatching and routing. This system allows users to request ambulances from any location on the map, calculates the shortest path using OSRM, and dispatches the nearest available unit with real-time animation.

## Features

*   **Real-time Dispatch**: Request an ambulance from **any point** on the map.
*   **Intelligent Routing**: Uses [OSRM](http://project-osrm.org/) (Open Source Routing Machine) to calculate the actual shortest path based on road networks, not just straight lines.
*   **Multi-Dispatch Architecture**: Supports multiple concurrent ambulance requests with independent animated paths.
*   **Hospital Management**: 
    *   Edit ambulance availability for each hospital directly from the sidebar.
*   **Interactive Map**: Powered by **Leaflet** & **React-Leaflet**.
    *   Click anywhere to pin a pickup location.
    *   Smooth animations for ambulance travel.
    *   Visual indicators for hospitals and active routes.

## Tech Stack

### Frontend
-   **React** (Vite)
-   **Leaflet / React-Leaflet** (Maps)
-   **Tailwind CSS** (Styling)
-   **Socket.io Client** (Real-time updates)

### Backend
-   **Node.js / Express**
-   **SQLite** (Database)
-   **Socket.io** (WebSocket communication)
-   **OSRM Public API** (Routing)

## Installation & Setup

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/KraVLonE/ambulance-management-system.git
    cd ambulance-management-system
    ```

2.  **Install Dependencies**
    
    *Backend*
    ```bash
    cd server
    npm install
    ```

    *Frontend*
    ```bash
    cd ../app
    npm install
    ```

3.  **Start the Application**

    You need to run both the backend and frontend terminals.

    *Terminal 1: Backend*
    ```bash
    cd server
    npm start
    ```
    (Server runs on http://localhost:3000)

    *Terminal 2: Frontend*
    ```bash
    cd app
    npm run dev
    ```
    (App usually runs on http://localhost:5173)

4.  **Open in Browser**
    Visit the URL provided by Vite (e.g., `http://localhost:5173`) to use the application.

## Usage Guide

1.  **Requesting an Ambulance**:
    *   Click **anywhere** on the map.
    *   A modal will appear confirming the location.
    *   Click "Request Ambulance".
    *   An ambulance will be dispatched from the nearest capable hospital.

2.  **Managing Availability**:
    *   In the Sidebar, hover over any hospital card.
    *   Click the **Edit** button.
    *   Update the number of available ambulances
    *   Click the checkmark to save.

3.  **Multiple Requests**:
    *   You can make multiple requests simultaneously.
    *   Watch independent ambulances dispatch to different locations.

## Contributing

Contributions are welcome! Please fork the repository and submit a pull request.

## License

Distributed under the MIT License.
