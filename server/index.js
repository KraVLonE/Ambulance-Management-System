const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { db, initializeDatabase } = require('./database');
const { nodeCoords } = require('./pathfinding');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for now
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(helmet({
    contentSecurityPolicy: false, // Disabled for React/Vite development and inline scripts if any
    crossOriginResourcePolicy: false,
    referrerPolicy: {
        policy: 'strict-origin-when-cross-origin', // OpenStreetMap requires a Referer header
    },
}));
app.use(compression());
app.use(express.json());

// Initialize DB
initializeDatabase();

// Keep frontend static files logic AFTER API routes so API takes precedence
// But for now, let's put it here to ensure it's loaded.
// Actually, in Express, routes are checked in order. 
// We want API routes to match first (which they will if defined above catch-all).

// --- API Endpoints ---

// Get all hospitals
app.get('/api/hospitals', (req, res) => {
    db.all("SELECT * FROM hospitals", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({
            data: rows
        });
    });
});

// In-memory cache for routes: key="startLat,startLng;endLat,endLng" -> value=route
const routeCache = new Map();

// Helper to get route from OSRM
async function getOSRMRoute(startLat, startLng, endLat, endLng) {
    const key = `${startLat},${startLng};${endLat},${endLng}`;
    if (routeCache.has(key)) {
        console.log("Cache hit for route");
        return routeCache.get(key);
    }

    try {
        // OSRM expects {lon},{lat}
        const url = `http://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
            return null;
        }

        const route = data.routes[0];
        routeCache.set(key, route); // Cache result
        return route;
    } catch (err) {
        console.error("OSRM Error:", err);
        return null;
    }
}

// Request Ambulance
app.post('/api/request', async (req, res) => {
    const { locationId, lat, lng } = req.body;

    let targetNode = null;

    if (lat && lng) {
        targetNode = { lat: parseFloat(lat), lng: parseFloat(lng) };
    } else if (locationId) {
        targetNode = nodeCoords[locationId];
    }

    if (!targetNode) {
        return res.status(400).json({ error: "Valid locationId OR lat/lng is required" });
    }

    db.all("SELECT * FROM hospitals WHERE ambulancesAvailable > 0", [], async (err, hospitals) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (hospitals.length === 0) {
            return res.status(404).json({ error: "No ambulances available nearby." });
        }

        let nearestHospital = null;
        let bestRoute = null;
        let minDuration = Infinity;

        const bestCandidate = hospitals.map(h => {
            if (!h.lat || !h.lng) return { ...h, dist: Infinity };
            const dLat = h.lat - targetNode.lat;
            const dLng = h.lng - targetNode.lng;
            const dist = Math.sqrt(dLat * dLat + dLng * dLng);
            return { ...h, dist };
        })
            .sort((a, b) => a.dist - b.dist)[0]; // Just take the #1 closest

        if (bestCandidate && bestCandidate.dist !== Infinity) {
            const route = await getOSRMRoute(bestCandidate.lat, bestCandidate.lng, targetNode.lat, targetNode.lng);
            if (route) {
                nearestHospital = bestCandidate;
                bestRoute = route;
                minDuration = route.duration;
            }
        }

        if (!nearestHospital || !bestRoute) {
            if (bestCandidate) {
                nearestHospital = bestCandidate;
                bestRoute = {
                    geometry: {
                        coordinates: [
                            [bestCandidate.lng, bestCandidate.lat],
                            [targetNode.lng, targetNode.lat]
                        ]
                    },
                    duration: 0
                };
            } else {
                return res.status(404).json({ error: "Could not find a path to any hospital." });
            }
        }

        // 2. Update DB (decrement ambulance)
        db.run("UPDATE hospitals SET ambulancesAvailable = ambulancesAvailable - 1 WHERE id = ?", [nearestHospital.id], function (err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            // 3. Broadcast update
            io.emit('ambulance_update', {
                hospitalId: nearestHospital.id,
                ambulancesAvailable: nearestHospital.ambulancesAvailable - 1
            });

            // 4. Return response
            const pathCoordinates = bestRoute.geometry.coordinates.map(coord => [coord[1], coord[0]]);

            res.json({
                success: true,
                hospital: nearestHospital,
                path: { shortestPath: pathCoordinates },
                eta: (minDuration / 60).toFixed(0)
            });

            setTimeout(() => {
                db.run("UPDATE hospitals SET ambulancesAvailable = ambulancesAvailable + 1 WHERE id = ?", [nearestHospital.id], (err) => {
                    if (!err) {
                        db.get("SELECT * FROM hospitals WHERE id = ?", [nearestHospital.id], (err, row) => {
                            if (row) {
                                io.emit('ambulance_update', {
                                    hospitalId: row.id,
                                    ambulancesAvailable: row.ambulancesAvailable
                                });
                            }
                        });
                    }
                });
            }, 30000);
        });
    });
});

// Update Hospital (e.g. Ambulance Count)
app.put('/api/hospitals/:id', (req, res) => {
    const { id } = req.params;
    const { ambulancesAvailable } = req.body;

    if (ambulancesAvailable === undefined) {
        return res.status(400).json({ error: "ambulancesAvailable is required" });
    }

    db.run(
        "UPDATE hospitals SET ambulancesAvailable = ? WHERE id = ?",
        [ambulancesAvailable, id],
        function (err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: "Hospital not found" });
            }

            // Broadcast update
            io.emit('ambulance_update', {
                hospitalId: parseInt(id),
                ambulancesAvailable: parseInt(ambulancesAvailable)
            });

            res.json({
                message: "Hospital updated",
                data: { id: parseInt(id), ambulancesAvailable: parseInt(ambulancesAvailable) }
            });
        }
    );
});

// --- Serve Frontend (Production) ---
const frontendPath = path.join(__dirname, '../app/dist');
app.use(express.static(frontendPath));

app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// --- Socket.io ---
io.on('connection', (socket) => {
    console.log('a user connected');
    socket.on('disconnect', () => {
        console.log('user disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
