const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require("socket.io");
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { openDatabase } = require('./db');
const { createRouter } = require('./routing');
const auth = require('./auth');
const { createEngine, EngineError, SEVERITIES, CASE_TYPES, UNIT_TYPES, CAPABILITIES, MAX_FLEET } = require('./engine');

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const cleanText = (value, maxLength) =>
    typeof value === 'string' ? value.trim().slice(0, maxLength) || null : null;
const isInt = (value, min, max) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

// Wraps async route handlers so rejections reach the error middleware.
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function parseCoords(source) {
    if (!source) return null;
    const lat = Number(source.lat);
    const lng = Number(source.lng);
    const present = (v) => v !== null && v !== undefined && v !== '';
    const valid = present(source.lat) && present(source.lng) &&
        Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    return valid ? { lat, lng } : null;
}

// Spreadsheet-safe CSV cell: quoted, and never starting a formula.
function csvCell(value) {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text) && typeof value !== 'number') text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Builds the HTTP + Socket.io server. Everything external (database, routing
 * APIs, timing) is injectable so the app can be tested offline.
 */
async function createApp(options = {}) {
    const {
        databaseUrl = process.env.DATABASE_URL || undefined, // Postgres; SQLite file when unset
        databaseSchema,
        sqlitePath = process.env.DB_PATH || undefined,
        fetchImpl,
        osrmUrl = process.env.OSRM_URL ?? 'https://router.project-osrm.org',
        nominatimUrl = process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org',
        timeScale = Number(process.env.TIME_SCALE) || 30,
        minTravelMs = 6000,
        maxTravelMs = 40000,
        sceneMs = 4000,
        maxServiceKm = 40,
        rateLimit = { windowMs: 60000, max: 30 },
        loginLimit = { windowMs: 5 * 60000, max: 10 },
        setupToken = process.env.SETUP_TOKEN || null,
        corsOrigin = process.env.CORS_ORIGIN, // unset = same-origin only
        frontendPath = path.join(__dirname, '../app/dist'),
    } = options;

    const db = await openDatabase({ url: databaseUrl, schema: databaseSchema, sqlitePath });
    const router = createRouter({ fetchImpl, osrmUrl, nominatimUrl });
    const secret = await auth.loadSecret(db);

    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, corsOrigin ? { cors: { origin: corsOrigin, credentials: true } } : {});

    // Live updates go only to signed-in dashboards.
    const ROOM = 'staff';
    const engine = await createEngine({
        db,
        router,
        emit: (event, payload) => {
            options.onEvent?.(event, payload);
            io.to(ROOM).emit(event, payload);
        },
        config: { timeScale, minTravelMs, maxTravelMs, sceneMs, maxServiceKm },
    });

    io.use((socket, next) => {
        auth.userFromCookieHeader(db, secret, socket.handshake.headers.cookie)
            .then((user) => {
                if (!user) return next(new Error('unauthorized'));
                socket.data.user = user;
                next();
            })
            .catch(next);
    });
    io.on('connection', (socket) => socket.join(ROOM));

    app.set('trust proxy', 1); // correct client IPs and https detection behind a proxy
    if (corsOrigin) app.use(cors({ origin: corsOrigin, credentials: true }));
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org"],
                styleSrc: ["'self'", "'unsafe-inline'"], // Leaflet positions elements with inline styles
                connectSrc: ["'self'", "ws:", "wss:"],
                upgradeInsecureRequests: null, // would break plain-http localhost
            },
        },
        crossOriginResourcePolicy: false,
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, // OpenStreetMap requires a Referer header
    }));
    app.use(compression());
    app.use(express.json({ limit: '10kb' }));

    // --- Rate limiting (per IP, sliding window) ---
    function limiter(config) {
        const hits = new Map();
        return (req, res, next) => {
            if (!config) return next();
            const now = Date.now();
            const recent = (hits.get(req.ip) || []).filter(t => now - t < config.windowMs);
            if (recent.length >= config.max) {
                res.set('Retry-After', String(Math.ceil(config.windowMs / 1000)));
                return res.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
            }
            recent.push(now);
            hits.set(req.ip, recent);
            if (hits.size > 5000) hits.clear(); // crude bound; fine at this scale
            next();
        };
    }
    const limitRequests = limiter(rateLimit);
    const limitLogins = limiter(loginLimit);
    const limitPublic = limiter(rateLimit && { windowMs: 60000, max: 120 });

    // --- Auth middleware ---
    app.use('/api', wrap(async (req, res, next) => {
        req.user = await auth.userFromCookieHeader(db, secret, req.headers.cookie);
        next();
    }));

    const requireAuth = (req, res, next) =>
        req.user ? next() : res.status(401).json({ error: "Please sign in." });

    const requireRole = (...roles) => (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: "Please sign in." });
        if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Your account isn't allowed to do that." });
        next();
    };

    // Admins manage any hospital; a hospital admin only their own.
    const canManageHospital = (user, hospitalId) =>
        user.role === 'admin' || (user.role === 'hospital_admin' && user.hospitalId === hospitalId);
    const forbidden = (res) => res.status(403).json({ error: "Your account isn't allowed to do that." });

    const userCount = async () => (await db.get("SELECT count(*) AS count FROM users")).count;

    // --- Auth ---

    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', database: db.dialect, ...engine.counts(), uptime: process.uptime() });
    });

    app.get('/api/auth/status', wrap(async (req, res) => {
        res.json({ user: auth.publicUser(req.user), needsSetup: (await userCount()) === 0 });
    }));

    // First run only: create the initial admin account.
    app.post('/api/auth/setup', limitLogins, wrap(async (req, res) => {
        if ((await userCount()) > 0) return res.status(409).json({ error: "Setup has already been completed. Please sign in." });
        const { username, password, token } = req.body || {};
        if (setupToken && token !== setupToken) return res.status(403).json({ error: "The setup code is not correct." });
        const problem = auth.validateCredentials(username, password);
        if (problem) return res.status(400).json({ error: problem });

        const user = { id: crypto.randomUUID(), username, role: 'admin', hospitalId: null };
        await db.run(
            "INSERT INTO users (id, username, password_hash, role, hospital_id, created_at) VALUES (?, ?, ?, 'admin', NULL, ?)",
            [user.id, username, await auth.hashPassword(password), Date.now()]
        );
        auth.setSessionCookie(res, auth.createToken(user.id, secret), req.secure);
        res.status(201).json({ user: auth.publicUser(user) });
    }));

    app.post('/api/auth/login', limitLogins, wrap(async (req, res) => {
        const { username, password } = req.body || {};
        const row = typeof username === 'string'
            ? await db.get("SELECT * FROM users WHERE lower(username) = lower(?)", [username])
            : null;
        const ok = row && typeof password === 'string' && await auth.verifyPassword(password, row.passwordHash);
        if (!ok) return res.status(401).json({ error: "Wrong username or password." });
        auth.setSessionCookie(res, auth.createToken(row.id, secret), req.secure);
        res.json({ user: auth.publicUser(row) });
    }));

    app.post('/api/auth/logout', (req, res) => {
        auth.clearSessionCookie(res);
        res.json({ success: true });
    });

    // --- Users (admin) ---

    app.get('/api/users', requireRole('admin'), wrap(async (req, res) => {
        const rows = await db.all("SELECT id, username, role, hospital_id, created_at FROM users ORDER BY username");
        res.json({ data: rows });
    }));

    function validateRole(role, hospitalId) {
        if (!auth.ROLES.includes(role)) return `Role must be one of: ${auth.ROLES.join(', ')}`;
        if (role === 'hospital_admin' && !engine.hospital(hospitalId)) return "A hospital admin needs to be linked to a hospital.";
        return null;
    }

    app.post('/api/users', requireRole('admin'), wrap(async (req, res) => {
        const { username, password, role } = req.body || {};
        const hospitalId = role === 'hospital_admin' ? req.body.hospitalId : null;
        const problem = auth.validateCredentials(username, password) || validateRole(role, hospitalId);
        if (problem) return res.status(400).json({ error: problem });
        if (await db.get("SELECT id FROM users WHERE lower(username) = lower(?)", [username])) {
            return res.status(409).json({ error: "That username is already taken." });
        }
        const user = { id: crypto.randomUUID(), username, role, hospitalId };
        await db.run(
            "INSERT INTO users (id, username, password_hash, role, hospital_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            [user.id, username, await auth.hashPassword(password), role, hospitalId, Date.now()]
        );
        res.status(201).json({ data: user });
    }));

    const adminCount = async () => (await db.get("SELECT count(*) AS count FROM users WHERE role = 'admin'")).count;

    app.patch('/api/users/:id', requireRole('admin'), wrap(async (req, res) => {
        const target = await db.get("SELECT * FROM users WHERE id = ?", [req.params.id]);
        if (!target) return res.status(404).json({ error: "User not found" });
        const body = req.body || {};

        const role = body.role ?? target.role;
        const hospitalId = role === 'hospital_admin' ? (body.hospitalId ?? target.hospitalId) : null;
        const problem = validateRole(role, hospitalId);
        if (problem) return res.status(400).json({ error: problem });
        if (target.role === 'admin' && role !== 'admin' && (await adminCount()) <= 1) {
            return res.status(409).json({ error: "This is the only admin account. Make someone else an admin first." });
        }

        let passwordHash = target.passwordHash;
        if (body.password !== undefined) {
            const weak = auth.validateCredentials(target.username, body.password);
            if (weak) return res.status(400).json({ error: weak });
            passwordHash = await auth.hashPassword(body.password);
        }
        await db.run("UPDATE users SET role = ?, hospital_id = ?, password_hash = ? WHERE id = ?", [role, hospitalId, passwordHash, target.id]);
        res.json({ data: { id: target.id, username: target.username, role, hospitalId } });
    }));

    app.delete('/api/users/:id', requireRole('admin'), wrap(async (req, res) => {
        if (req.params.id === req.user.id) return res.status(409).json({ error: "You can't delete the account you're signed in with." });
        const target = await db.get("SELECT * FROM users WHERE id = ?", [req.params.id]);
        if (!target) return res.status(404).json({ error: "User not found" });
        if (target.role === 'admin' && (await adminCount()) <= 1) {
            return res.status(409).json({ error: "This is the only admin account." });
        }
        await db.run("DELETE FROM users WHERE id = ?", [target.id]);
        res.json({ success: true });
    }));

    // --- Live state ---

    app.get('/api/state', requireAuth, (req, res) => {
        res.json({
            hospitals: engine.hospitals(),
            units: engine.units(),
            dispatches: engine.dispatches(),
            serverNow: Date.now(),
            config: { timeScale, maxServiceKm },
        });
    });

    app.get('/api/hospitals', requireAuth, (req, res) => {
        res.json({ data: engine.hospitals() });
    });

    // --- Hospitals ---

    function parseHospital(body, { partial }) {
        const out = {};
        if (!partial || body.name !== undefined) {
            out.name = cleanText(body.name, 80);
            if (!out.name) return { error: "Hospital name is required." };
        }
        if (!partial || body.lat !== undefined || body.lng !== undefined) {
            const coords = parseCoords(body);
            if (!coords) return { error: "Valid lat and lng are required." };
            Object.assign(out, coords);
        }
        if (body.bedsAvailable !== undefined) {
            if (!isInt(body.bedsAvailable, 0, 9999)) return { error: "Beds must be a whole number between 0 and 9999." };
            out.bedsAvailable = body.bedsAvailable;
        }
        if (body.capabilities !== undefined) {
            if (!Array.isArray(body.capabilities) || body.capabilities.some(c => !CAPABILITIES.includes(c))) {
                return { error: `Capabilities must be chosen from: ${CAPABILITIES.join(', ')}` };
            }
            out.capabilities = [...new Set(body.capabilities)];
        }
        return { value: out };
    }

    app.post('/api/hospitals', requireRole('admin'), wrap(async (req, res) => {
        const parsed = parseHospital(req.body || {}, { partial: false });
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        res.status(201).json({ data: await engine.createHospital(parsed.value) });
    }));

    app.patch('/api/hospitals/:id', requireAuth, wrap(async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid hospital id" });
        if (!canManageHospital(req.user, id)) return forbidden(res);
        const parsed = parseHospital(req.body || {}, { partial: true });
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        // Renaming and moving a hospital is an admin decision; its own admin
        // looks after beds and capabilities.
        if (req.user.role !== 'admin' && ['name', 'lat', 'lng'].some(k => parsed.value[k] !== undefined)) return forbidden(res);
        res.json({ data: await engine.updateHospital(id, parsed.value) });
    }));

    app.delete('/api/hospitals/:id', requireRole('admin'), wrap(async (req, res) => {
        const id = Number(req.params.id);
        await engine.removeHospital(id);
        await db.run("UPDATE users SET role = 'viewer', hospital_id = NULL WHERE hospital_id = ?", [id]);
        res.json({ success: true });
    }));

    // Quick fleet size control: set how many ambulances are parked at base.
    app.put('/api/hospitals/:id', requireAuth, wrap(async (req, res) => {
        const id = Number(req.params.id);
        const count = req.body?.ambulancesAvailable;
        if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid hospital id" });
        if (!canManageHospital(req.user, id)) return forbidden(res);
        if (!isInt(count, 0, MAX_FLEET)) {
            return res.status(400).json({ error: `ambulancesAvailable must be a whole number between 0 and ${MAX_FLEET}` });
        }
        res.json({ message: "Hospital updated", data: await engine.setAvailableCount(id, count) });
    }));

    // --- Ambulance units ---

    app.get('/api/ambulances', requireAuth, (req, res) => {
        res.json({ data: engine.units() });
    });

    app.post('/api/ambulances', requireAuth, wrap(async (req, res) => {
        const body = req.body || {};
        if (!Number.isInteger(body.hospitalId)) return res.status(400).json({ error: "hospitalId is required" });
        if (!canManageHospital(req.user, body.hospitalId)) return forbidden(res);
        if (!UNIT_TYPES.includes(body.type)) return res.status(400).json({ error: `type must be one of: ${UNIT_TYPES.join(', ')}` });
        const unit = await engine.addUnit({ hospitalId: body.hospitalId, type: body.type, crew: cleanText(body.crew, 80) });
        res.status(201).json({ data: unit });
    }));

    app.patch('/api/ambulances/:id', requireAuth, wrap(async (req, res) => {
        const unit = engine.unit(req.params.id);
        if (!unit) return res.status(404).json({ error: "Ambulance not found" });
        if (!canManageHospital(req.user, unit.hospitalId)) return forbidden(res);
        const body = req.body || {};
        const changes = {};
        if (body.type !== undefined) {
            if (!UNIT_TYPES.includes(body.type)) return res.status(400).json({ error: `type must be one of: ${UNIT_TYPES.join(', ')}` });
            changes.type = body.type;
        }
        if (body.crew !== undefined) changes.crew = cleanText(body.crew, 80);
        if (body.inService !== undefined) {
            if (typeof body.inService !== 'boolean') return res.status(400).json({ error: "inService must be true or false" });
            changes.inService = body.inService;
        }
        res.json({ data: await engine.updateUnit(unit.id, changes) });
    }));

    app.delete('/api/ambulances/:id', requireAuth, wrap(async (req, res) => {
        const unit = engine.unit(req.params.id);
        if (!unit) return res.status(404).json({ error: "Ambulance not found" });
        if (!canManageHospital(req.user, unit.hospitalId)) return forbidden(res);
        await engine.removeUnit(unit.id);
        res.json({ success: true });
    }));

    // --- Geocoding ---

    app.get('/api/geocode/reverse', requireAuth, limitRequests, wrap(async (req, res) => {
        const coords = parseCoords(req.query);
        if (!coords) return res.status(400).json({ error: "Valid lat and lng are required" });
        res.json({ address: await router.reverseGeocode(coords.lat, coords.lng) });
    }));

    app.get('/api/geocode/search', requireAuth, limitRequests, wrap(async (req, res) => {
        const query = cleanText(req.query.q, 120);
        if (!query || query.length < 3) return res.status(400).json({ error: "Type at least 3 characters to search." });
        const all = engine.hospitals();
        const near = all.length
            ? { lat: all.reduce((s, h) => s + h.lat, 0) / all.length, lng: all.reduce((s, h) => s + h.lng, 0) / all.length }
            : null;
        res.json({ data: await router.searchPlaces(query, near) });
    }));

    // --- Dispatches ---

    app.post('/api/request', requireRole('admin', 'dispatcher'), limitRequests, wrap(async (req, res) => {
        const body = req.body || {};
        const target = parseCoords(body);
        if (!target) return res.status(400).json({ error: "Valid lat and lng are required" });

        const severity = body.severity === undefined ? 'urgent' : body.severity;
        if (!SEVERITIES.includes(severity)) return res.status(400).json({ error: `severity must be one of: ${SEVERITIES.join(', ')}` });
        const caseType = body.caseType === undefined ? 'general' : body.caseType;
        if (!CASE_TYPES.includes(caseType)) return res.status(400).json({ error: `caseType must be one of: ${CASE_TYPES.join(', ')}` });
        if (body.ambulanceId != null && typeof body.ambulanceId !== 'string') return res.status(400).json({ error: "Invalid ambulanceId" });
        if (body.destHospitalId != null && !Number.isInteger(body.destHospitalId)) return res.status(400).json({ error: "Invalid destHospitalId" });

        const dispatch = await engine.createDispatch({
            ...target,
            severity,
            caseType,
            address: cleanText(body.address, 200),
            note: cleanText(body.note, 200),
            ambulanceId: body.ambulanceId || null,
            destHospitalId: body.destHospitalId ?? null,
        }, req.user);

        res.status(201).json({
            success: true,
            queued: dispatch.status === 'queued',
            dispatch,
            serverNow: Date.now(),
            eta: dispatch.durationS == null ? null : String(Math.max(1, Math.round(dispatch.durationS / 60))),
        });
    }));

    app.get('/api/dispatches', requireAuth, (req, res) => {
        res.json({ active: engine.dispatches(), serverNow: Date.now() });
    });

    app.get('/api/dispatches/history', requireAuth, wrap(async (req, res) => {
        const limit = clamp(parseInt(req.query.limit, 10) || 20, 1, 100);
        const rows = await db.all(
            "SELECT * FROM dispatches WHERE status IN ('completed', 'cancelled') ORDER BY created_at DESC LIMIT ?",
            [limit]
        );
        res.json({ data: rows });
    }));

    app.post('/api/dispatches/:id/cancel', requireRole('admin', 'dispatcher'), wrap(async (req, res) => {
        res.json({ success: true, data: await engine.cancelDispatch(req.params.id) });
    }));

    // --- Stats & analytics ---

    const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
    const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

    app.get('/api/stats', requireAuth, wrap(async (req, res) => {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const rows = await db.all("SELECT status, duration_s, response_s FROM dispatches WHERE created_at >= ?", [startOfDay.getTime()]);
        const responses = rows.filter(r => r.responseS != null).map(r => r.responseS);
        const etas = rows.filter(r => r.status !== 'cancelled' && r.durationS != null).map(r => r.durationS);
        const counts = engine.counts();
        res.json({
            today: {
                total: rows.length,
                completed: rows.filter(r => r.status === 'completed').length,
                cancelled: rows.filter(r => r.status === 'cancelled').length,
                avgEtaMinutes: round1(average(etas) == null ? null : average(etas) / 60),
                avgResponseMinutes: round1(average(responses) == null ? null : average(responses) / 60),
            },
            active: counts.active,
            queued: counts.queued,
            fleet: { available: counts.available, deployed: counts.deployed },
        });
    }));

    const analyticsRows = (days) => db.all(
        "SELECT * FROM dispatches WHERE created_at >= ? ORDER BY created_at DESC LIMIT 5000",
        [Date.now() - days * 24 * 60 * 60 * 1000]
    );

    app.get('/api/analytics', requireAuth, wrap(async (req, res) => {
        const days = clamp(parseInt(req.query.days, 10) || 7, 1, 90);
        // Minutes to add to UTC to get the viewer's local time, so "calls by
        // hour" matches the clock on their wall, not the server's.
        const tzOffset = clamp(parseInt(req.query.tzOffset, 10) || 0, -840, 840);
        const rows = await analyticsRows(days);
        const localHour = (ms) => new Date(ms + tzOffset * 60000).getUTCHours();
        const localDate = (ms) => new Date(ms + tzOffset * 60000).toISOString().slice(0, 10);

        const group = (keyOf) => {
            const map = new Map();
            for (const row of rows) {
                const key = keyOf(row);
                if (key == null) continue;
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(row);
            }
            return map;
        };
        const summarise = (list) => {
            const responses = list.filter(r => r.responseS != null).map(r => r.responseS);
            return { count: list.length, avgResponseMinutes: round1(average(responses) == null ? null : average(responses) / 60) };
        };

        const hours = group(r => localHour(r.createdAt));
        const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, ...summarise(hours.get(hour) || []) }));

        const daysMap = group(r => localDate(r.createdAt));
        const byDay = [...daysMap.entries()].map(([date, list]) => ({ date, ...summarise(list) })).sort((a, b) => a.date.localeCompare(b.date));

        const byHospital = [...group(r => r.hospitalName).entries()]
            .map(([hospitalName, list]) => ({ hospitalName, ...summarise(list) }))
            .sort((a, b) => b.count - a.count);

        const bySeverity = SEVERITIES.map(severity => ({ severity, ...summarise(rows.filter(r => r.severity === severity)) }));

        const responses = rows.filter(r => r.responseS != null).map(r => r.responseS).sort((a, b) => a - b);
        const percentile = (p) => (responses.length ? responses[Math.min(responses.length - 1, Math.floor(p * responses.length))] : null);

        res.json({
            days,
            totals: {
                total: rows.length,
                completed: rows.filter(r => r.status === 'completed').length,
                cancelled: rows.filter(r => r.status === 'cancelled').length,
                avgResponseMinutes: round1(average(responses) == null ? null : average(responses) / 60),
                p90ResponseMinutes: round1(percentile(0.9) == null ? null : percentile(0.9) / 60),
            },
            byHour,
            byDay,
            byHospital,
            bySeverity,
            points: rows.slice(0, 2000).map(r => ({ lat: r.lat, lng: r.lng, severity: r.severity, responseS: r.responseS })),
        });
    }));

    app.get('/api/analytics/export.csv', requireAuth, wrap(async (req, res) => {
        const days = clamp(parseInt(req.query.days, 10) || 7, 1, 90);
        const rows = await analyticsRows(days);
        const iso = (ms) => (ms ? new Date(ms).toISOString() : '');
        const columns = [
            ['created_at', r => iso(r.createdAt)], ['status', r => r.status], ['severity', r => r.severity],
            ['case_type', r => r.caseType], ['address', r => r.address], ['lat', r => r.lat], ['lng', r => r.lng],
            ['ambulance', r => r.callSign], ['base_hospital', r => r.hospitalName], ['destination_hospital', r => r.destHospitalName],
            ['distance_km', r => (r.distanceM == null ? '' : (r.distanceM / 1000).toFixed(2))],
            ['drive_minutes', r => (r.durationS == null ? '' : (r.durationS / 60).toFixed(1))],
            ['response_minutes', r => (r.responseS == null ? '' : (r.responseS / 60).toFixed(1))],
            ['arrived_at', r => iso(r.arrivedAt)], ['delivered_at', r => iso(r.deliveredAt)], ['completed_at', r => iso(r.completedAt)],
            ['requested_by', r => r.createdBy], ['note', r => r.note],
        ];
        const lines = [columns.map(c => c[0]).join(',')];
        for (const row of rows) lines.push(columns.map(c => csvCell(c[1](row))).join(','));
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="dispatches-last-${days}-days.csv"`);
        res.send(lines.join('\r\n') + '\r\n');
    }));

    // --- Public tracking (no sign-in; the unguessable token is the key) ---
    // Deliberately exposes only what the caller needs: no notes, no staff names.

    app.get('/api/track/:token', limitPublic, wrap(async (req, res) => {
        const token = req.params.token;
        if (!/^[A-Za-z0-9_-]{10,40}$/.test(token)) return res.status(404).json({ error: "Tracking link not found" });
        const live = engine.findByToken(token);
        const record = live || await db.get("SELECT * FROM dispatches WHERE track_token = ?", [token]);
        if (!record) return res.status(404).json({ error: "Tracking link not found" });

        let queuePosition = null;
        if (record.status === 'queued') {
            const rank = (d) => SEVERITIES.indexOf(d.severity);
            const waiting = engine.dispatches().filter(d => d.status === 'queued')
                .sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
            queuePosition = waiting.findIndex(d => d.id === record.id) + 1 || null;
        }
        res.json({
            status: record.status,
            lat: record.lat,
            lng: record.lng,
            address: record.address,
            callSign: record.callSign,
            unitType: record.unitType || null,
            destHospitalName: record.destHospitalName,
            durationS: record.durationS,
            createdAt: record.createdAt,
            legs: live ? live.legs : [],
            queuePosition,
            serverNow: Date.now(),
        });
    }));

    // Unknown API routes should fail loudly, not return the SPA's index.html.
    app.use('/api', (req, res) => {
        res.status(404).json({ error: "Not found" });
    });

    // --- Serve Frontend (Production) ---
    const indexFile = path.join(frontendPath, 'index.html');
    app.use(express.static(frontendPath));
    app.get('*', (req, res) => {
        if (!fs.existsSync(indexFile)) {
            return res.status(503).type('text').send("Frontend not built. Run `npm run build` (or use `npm run dev` in app/).");
        }
        res.sendFile(indexFile);
    });

    app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
        if (err instanceof EngineError) return res.status(err.status).json({ error: err.message });
        if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
            return res.status(400).json({ error: "Invalid request body" });
        }
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    });

    async function close() {
        await engine.shutdown();
        await new Promise((resolve) => io.close(resolve));
        if (server.listening) await new Promise((resolve) => server.close(resolve));
        await db.close();
    }

    return { app, server, io, db, engine, close };
}

module.exports = { createApp };
