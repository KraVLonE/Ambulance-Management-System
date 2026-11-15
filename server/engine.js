// The dispatch engine: owns live state (hospitals, ambulance units, active and
// queued dispatches), decides who goes where, and moves trips through their
// phases on timers. The database is the durable record; this is the authority
// while the process runs.
//
// A trip is a list of timed "legs":
//   en_route      unit's position -> pickup
//   on_scene      waiting at the pickup
//   transporting  pickup -> destination hospital
//   returning     destination hospital -> unit's base (skipped if they are the same)
// Clients animate from the same legs + the server clock, so everyone agrees.
//
// The simulation is sped up: a leg that really takes `durationS` seconds plays
// in durationS / timeScale seconds (clamped to [minTravelMs, maxTravelMs]).

const crypto = require('crypto');
const { haversine, estimateSeconds, pointAlong } = require('./routing');

const SEVERITIES = ['critical', 'urgent', 'standard'];
const CASE_TYPES = ['general', 'trauma', 'cardiac'];
const UNIT_TYPES = ['ALS', 'BLS'];
const CAPABILITIES = ['trauma', 'cardiac'];
const MAX_FLEET = 999;
const CANDIDATE_COUNT = 3;

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const severityRank = (s) => SEVERITIES.indexOf(s);

class EngineError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

async function createEngine({ db, router, emit, config }) {
    const { timeScale, minTravelMs, maxTravelMs, sceneMs, maxServiceKm } = config;

    const hospitals = new Map(); // id -> { id, name, lat, lng, bedsAvailable, capabilities: [] }
    const units = new Map();     // id -> { id, callSign, type, hospitalId, inService, crew, dispatchId }
    const dispatches = new Map(); // id -> live dispatch (queued or in progress)
    const timers = new Map();    // dispatch id -> [timeout]

    // --- Serialising mutations ---
    // Every state change runs through this queue, one at a time. Routing calls
    // are awaited inside it, so two requests can never claim the same unit.
    let tail = Promise.resolve();
    const lock = (fn) => {
        const run = tail.then(fn);
        tail = run.catch(() => {});
        return run;
    };

    // --- Views sent to clients ---
    const unitStatus = (unit) => {
        if (!unit.inService) return 'out_of_service';
        if (!unit.dispatchId) return 'available';
        return dispatches.get(unit.dispatchId)?.status === 'returning' ? 'returning' : 'busy';
    };
    const unitView = (unit) => ({ ...unit, status: unitStatus(unit) });

    const hospitalView = (hospital) => {
        const fleet = [...units.values()].filter(u => u.hospitalId === hospital.id);
        return {
            ...hospital,
            units: fleet.length,
            ambulancesAvailable: fleet.filter(u => unitStatus(u) === 'available').length,
            deployed: fleet.filter(u => u.dispatchId).length,
            outOfService: fleet.filter(u => !u.inService).length,
        };
    };

    const dispatchView = (d) => {
        const { version, transport, waited, ...rest } = d; // eslint-disable-line no-unused-vars
        return rest;
    };

    const emitUnit = (unit) => {
        emit('unit', unitView(unit));
        const hospital = hospitals.get(unit.hospitalId);
        if (hospital) emit('hospital', hospitalView(hospital));
    };
    const emitDispatch = (dispatch, event) => emit('dispatch', { dispatch: dispatchView(dispatch), event, serverNow: Date.now() });

    // --- Persistence ---
    const DISPATCH_COLUMNS = {
        track_token: 'trackToken', status: 'status', severity: 'severity', case_type: 'caseType',
        lat: 'lat', lng: 'lng', address: 'address', note: 'note', ambulance_id: 'ambulanceId',
        call_sign: 'callSign', hospital_id: 'hospitalId', hospital_name: 'hospitalName',
        dest_hospital_id: 'destHospitalId', dest_hospital_name: 'destHospitalName',
        distance_m: 'distanceM', duration_s: 'durationS', response_s: 'responseS',
        route_source: 'routeSource', requested_ambulance_id: 'requestedAmbulanceId',
        requested_dest_id: 'requestedDestId', created_by: 'createdBy', created_at: 'createdAt',
        assigned_at: 'assignedAt', arrived_at: 'arrivedAt', delivered_at: 'deliveredAt', completed_at: 'completedAt',
    };
    const columnNames = Object.keys(DISPATCH_COLUMNS);

    async function saveDispatch(d, isNew = false) {
        const values = columnNames.map(c => d[DISPATCH_COLUMNS[c]] ?? null);
        if (isNew) {
            await db.run(
                `INSERT INTO dispatches (id, ${columnNames.join(', ')}) VALUES (?, ${columnNames.map(() => '?').join(', ')})`,
                [d.id, ...values]
            );
        } else {
            await db.run(`UPDATE dispatches SET ${columnNames.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [...values, d.id]);
        }
    }

    // --- Geometry ---
    const playbackMs = (durationS) => Math.round(clamp((durationS * 1000) / timeScale, minTravelMs, maxTravelMs));

    const currentLeg = (dispatch, now) =>
        dispatch.legs.find(leg => now < leg.endAt) || dispatch.legs[dispatch.legs.length - 1] || null;

    // Where a unit is right now: parked at base, or somewhere along a leg.
    function positionOf(unit, now = Date.now()) {
        const dispatch = unit.dispatchId && dispatches.get(unit.dispatchId);
        const leg = dispatch && currentLeg(dispatch, now);
        if (leg) {
            const fraction = clamp((now - leg.startAt) / Math.max(1, leg.endAt - leg.startAt), 0, 1);
            const point = pointAlong(leg.path, fraction);
            if (point) return { lat: point[0], lng: point[1] };
        }
        const base = hospitals.get(unit.hospitalId);
        return { lat: base.lat, lng: base.lng };
    }

    const distanceTo = (point, target) => haversine(point.lat, point.lng, target.lat, target.lng);

    // --- Choosing a destination hospital ---
    // Nearest hospital that can treat the case and has a bed; relax the
    // requirements step by step rather than fail.
    function chooseDestination(dispatch) {
        const all = [...hospitals.values()];
        if (dispatch.requestedDestId != null && hospitals.has(dispatch.requestedDestId)) {
            return hospitals.get(dispatch.requestedDestId);
        }
        const capable = (h) => dispatch.caseType === 'general' || h.capabilities.includes(dispatch.caseType);
        const tiers = [
            all.filter(h => capable(h) && h.bedsAvailable > 0),
            all.filter(h => h.bedsAvailable > 0),
            all,
        ];
        const pool = tiers.find(t => t.length > 0) || [];
        return pool.sort((a, b) => distanceTo(a, dispatch) - distanceTo(b, dispatch))[0] || null;
    }

    // --- Choosing a unit ---
    // Free = in service and either parked or on its way back to base.
    const isFree = (unit) => unit.inService && ['available', 'returning'].includes(unitStatus(unit));
    const freeUnits = () => [...units.values()].filter(isFree);

    // Critical calls get an advanced life support unit when one is free.
    function eligible(dispatch, pool) {
        if (dispatch.requestedAmbulanceId) return pool.filter(u => u.id === dispatch.requestedAmbulanceId);
        if (dispatch.severity === 'critical') {
            const als = pool.filter(u => u.type === 'ALS');
            if (als.length > 0) return als;
        }
        return pool;
    }

    // Routes from the few nearest starting points and returns them fastest-first.
    // Units parked at the same hospital share a route, so only one per location
    // is considered: a basic unit where that will do, keeping advanced units
    // free for critical calls.
    async function rankUnits(dispatch, pool) {
        const now = Date.now();
        const preferred = (unit) => (dispatch.severity === 'critical' ? unit.type === 'ALS' : unit.type === 'BLS') ? 0 : 1;
        const byLocation = new Map();
        for (const unit of eligible(dispatch, pool)) {
            const from = positionOf(unit, now);
            const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}`;
            const existing = byLocation.get(key);
            if (!existing || preferred(unit) < preferred(existing.unit)) byLocation.set(key, { unit, from });
        }
        const nearest = [...byLocation.values()]
            .map(c => ({ ...c, straight: distanceTo(c.from, dispatch) }))
            .sort((a, b) => a.straight - b.straight)
            .slice(0, CANDIDATE_COUNT);
        const routed = await Promise.all(nearest.map(async c => ({
            ...c,
            route: await router.getRoute(c.from.lat, c.from.lng, dispatch.lat, dispatch.lng),
        })));
        return routed.sort((a, b) => a.route.duration - b.route.duration);
    }

    // --- Timers ---
    function clearTimers(dispatch) {
        (timers.get(dispatch.id) || []).forEach(clearTimeout);
        timers.delete(dispatch.id);
    }

    function scheduleLegs(dispatch) {
        clearTimers(dispatch);
        const version = dispatch.version;
        const list = dispatch.legs.map((leg, index) => {
            const timer = setTimeout(() => {
                lock(() => finishLeg(dispatch, index, version)).catch(console.error);
            }, Math.max(0, leg.endAt - Date.now()));
            timer.unref?.();
            return timer;
        });
        timers.set(dispatch.id, list);
    }

    // --- Lifecycle ---
    // Puts `unit` on `dispatch`, building the whole timed trip.
    async function assign(dispatch, unit, route, event) {
        // A unit driving home is still attached to its previous (delivered) trip.
        if (unit.dispatchId && unit.dispatchId !== dispatch.id) {
            const previous = dispatches.get(unit.dispatchId);
            if (previous) await close(previous, 'completed', { releaseUnit: false });
        }

        let dest = hospitals.get(dispatch.destHospitalId) || chooseDestination(dispatch);
        const base = hospitals.get(unit.hospitalId);
        if (!dest) dest = base;

        if (!dispatch.transport || dispatch.transport.destId !== dest.id) {
            dispatch.transport = { destId: dest.id, route: await router.getRoute(dispatch.lat, dispatch.lng, dest.lat, dest.lng) };
        }
        const homeward = dest.id === base.id ? null : await router.getRoute(dest.lat, dest.lng, base.lat, base.lng);

        const now = Date.now();
        const legs = [];
        let t = now;
        const push = (phase, path, durationS, distanceM, ms) => {
            legs.push({ phase, path, durationS: Math.round(durationS), distanceM: Math.round(distanceM), startAt: t, endAt: t + ms });
            t += ms;
        };
        push('en_route', route.path, route.duration, route.distance, playbackMs(route.duration));
        push('on_scene', [[dispatch.lat, dispatch.lng]], 0, 0, sceneMs);
        const transport = dispatch.transport.route;
        push('transporting', transport.path, transport.duration, transport.distance, playbackMs(transport.duration));
        if (homeward) push('returning', homeward.path, homeward.duration, homeward.distance, playbackMs(homeward.duration));

        Object.assign(dispatch, {
            status: 'en_route',
            ambulanceId: unit.id,
            callSign: unit.callSign,
            unitType: unit.type,
            hospitalId: base.id,
            hospitalName: base.name,
            destHospitalId: dest.id,
            destHospitalName: dest.name,
            distanceM: Math.round(route.distance),
            durationS: Math.round(route.duration),
            routeSource: route.source,
            assignedAt: now,
            arrivedAt: null,
            legs,
            version: (dispatch.version || 0) + 1,
        });
        unit.dispatchId = dispatch.id;

        scheduleLegs(dispatch);
        await saveDispatch(dispatch);
        emitDispatch(dispatch, event);
        emitUnit(unit);
    }

    // Takes a dispatch off its unit and puts it back in the queue.
    function unassign(dispatch) {
        clearTimers(dispatch);
        Object.assign(dispatch, {
            status: 'queued', ambulanceId: null, callSign: null, unitType: null, hospitalId: null, hospitalName: null,
            legs: [], assignedAt: null, waited: true, version: (dispatch.version || 0) + 1,
        });
    }

    // Ends a dispatch for good (completed or cancelled).
    async function close(dispatch, status, { releaseUnit = true } = {}) {
        if (!dispatches.has(dispatch.id)) return null;
        clearTimers(dispatch);
        const unit = dispatch.ambulanceId ? units.get(dispatch.ambulanceId) : null;
        dispatch.status = status;
        dispatch.completedAt = Date.now();
        dispatch.version = (dispatch.version || 0) + 1;
        dispatches.delete(dispatch.id);
        if (unit && unit.dispatchId === dispatch.id && releaseUnit) unit.dispatchId = null;
        await saveDispatch(dispatch);
        emitDispatch(dispatch, status);
        if (unit && releaseUnit) emitUnit(unit);
        return unit;
    }

    // Called by a timer when leg `index` ends.
    async function finishLeg(dispatch, index, version) {
        if (dispatch.version !== version || !dispatches.has(dispatch.id)) return; // superseded
        const finished = dispatch.legs[index];
        const next = dispatch.legs[index + 1];
        const now = Date.now();

        if (finished.phase === 'en_route') {
            dispatch.arrivedAt = now;
            // Time the patient waited, in real-world terms: queueing (scaled back
            // up from playback time) plus the drive.
            // Only genuine waiting counts, not the moment spent computing a route.
            const queuedS = dispatch.waited ? ((dispatch.assignedAt - dispatch.createdAt) / 1000) * timeScale : 0;
            dispatch.responseS = Math.round(queuedS + finished.durationS);
        }

        if (finished.phase === 'transporting') {
            dispatch.deliveredAt = now;
            const dest = hospitals.get(dispatch.destHospitalId);
            if (dest && dest.bedsAvailable > 0) {
                dest.bedsAvailable -= 1;
                await db.run("UPDATE hospitals SET beds_available = ? WHERE id = ?", [dest.bedsAvailable, dest.id]);
                emit('hospital', hospitalView(dest));
            }
        }

        if (!next) {
            const unit = await close(dispatch, 'completed');
            if (unit) await unitFreed(unit);
            return;
        }

        dispatch.status = next.phase;
        await saveDispatch(dispatch);
        emitDispatch(dispatch, next.phase);

        if (next.phase === 'returning') {
            // Patient delivered: the unit can take new work from wherever it is.
            const unit = units.get(dispatch.ambulanceId);
            if (unit) {
                emitUnit(unit);
                await unitFreed(unit);
            }
        }
    }

    // Hands free units to waiting requests, most severe (then oldest) first.
    async function assignQueued() {
        const waiting = [...dispatches.values()]
            .filter(d => d.status === 'queued')
            .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.createdAt - b.createdAt);
        for (const dispatch of waiting) {
            const pool = freeUnits();
            if (pool.length === 0) return;
            const [best] = await rankUnits(dispatch, pool);
            if (best && isFree(best.unit)) await assign(dispatch, best.unit, best.route, 'assigned');
        }
    }

    // A unit just became free. If it can reach someone noticeably sooner than
    // the unit already heading there, send it instead and stand the other down.
    async function considerSwap(unit) {
        if (!isFree(unit)) return;
        const from = positionOf(unit);
        const enRoute = [...dispatches.values()]
            .filter(d => d.status === 'en_route' && !d.requestedAmbulanceId)
            .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.createdAt - b.createdAt);

        for (const dispatch of enRoute) {
            // Never trade an advanced unit on a critical call for a basic one.
            if (dispatch.severity === 'critical' && dispatch.unitType === 'ALS' && unit.type !== 'ALS') continue;
            const leg = dispatch.legs[0];
            const fractionLeft = clamp((leg.endAt - Date.now()) / Math.max(1, leg.endAt - leg.startAt), 0, 1);
            const remainingS = leg.durationS * fractionLeft;
            const guess = estimateSeconds(distanceTo(from, dispatch));
            if (remainingS - guess < 60 || guess > remainingS * 0.6) continue;

            const route = await router.getRoute(from.lat, from.lng, dispatch.lat, dispatch.lng);
            const stillValid = dispatches.has(dispatch.id) && dispatch.status === 'en_route' && isFree(unit);
            if (!stillValid || route.duration > remainingS * 0.75) continue;

            const previous = units.get(dispatch.ambulanceId);
            if (previous) previous.dispatchId = null;
            await assign(dispatch, unit, route, 'swapped');
            if (previous) {
                emitUnit(previous);
                await assignQueued();
            }
            return;
        }
    }

    async function unitFreed(unit) {
        await assignQueued();
        await considerSwap(unit);
    }

    // A new critical call may pull a unit off a standard call if that gets help
    // there clearly sooner than any free unit could (or when none is free).
    async function tryDivert(dispatch, bestFree) {
        const now = Date.now();
        const candidates = [...units.values()]
            .filter(u => u.inService && u.dispatchId)
            .map(u => ({ unit: u, current: dispatches.get(u.dispatchId) }))
            .filter(c => c.current && c.current.status === 'en_route' && c.current.severity === 'standard' && !c.current.requestedAmbulanceId)
            .map(c => ({ ...c, from: positionOf(c.unit, now) }))
            .map(c => ({ ...c, guess: estimateSeconds(distanceTo(c.from, dispatch)) }))
            .sort((a, b) => a.guess - b.guess);
        const nearest = candidates[0];
        if (!nearest) return false;
        if (bestFree && nearest.guess > bestFree.route.duration * 0.7) return false;

        const route = await router.getRoute(nearest.from.lat, nearest.from.lng, dispatch.lat, dispatch.lng);
        if (bestFree && route.duration > bestFree.route.duration * 0.8) return false;
        const victim = nearest.current;
        if (!dispatches.has(victim.id) || victim.status !== 'en_route' || victim.ambulanceId !== nearest.unit.id) return false;

        unassign(victim);
        nearest.unit.dispatchId = null;
        await saveDispatch(victim);
        emitDispatch(victim, 'diverted_away');
        await assign(dispatch, nearest.unit, route, 'diverted');
        await assignQueued(); // find the bumped call another unit straight away
        return true;
    }

    // --- Public operations (each runs under the lock) ---

    const createDispatch = (input, user) => lock(async () => {
        const all = [...hospitals.values()];
        const nearest = all.sort((a, b) => distanceTo(a, input) - distanceTo(b, input))[0];
        if (!nearest || distanceTo(nearest, input) > maxServiceKm * 1000) {
            throw new EngineError(422, "This location is outside the service area.");
        }
        if (input.ambulanceId) {
            const unit = units.get(input.ambulanceId);
            if (!unit) throw new EngineError(404, "That ambulance no longer exists.");
            if (!isFree(unit)) throw new EngineError(409, `${unit.callSign} is not free right now.`);
        }
        if (input.destHospitalId != null && !hospitals.has(input.destHospitalId)) {
            throw new EngineError(404, "That destination hospital no longer exists.");
        }

        const dispatch = {
            id: crypto.randomUUID(),
            trackToken: crypto.randomBytes(12).toString('base64url'),
            status: 'queued',
            severity: input.severity,
            caseType: input.caseType,
            lat: input.lat,
            lng: input.lng,
            address: input.address,
            note: input.note,
            ambulanceId: null, callSign: null, unitType: null, hospitalId: null, hospitalName: null,
            destHospitalId: null, destHospitalName: null,
            distanceM: null, durationS: null, responseS: null, routeSource: null,
            requestedAmbulanceId: input.ambulanceId || null,
            requestedDestId: input.destHospitalId ?? null,
            createdBy: user?.username || null,
            createdAt: Date.now(),
            assignedAt: null, arrivedAt: null, deliveredAt: null, completedAt: null,
            legs: [],
            version: 0,
        };
        const dest = chooseDestination(dispatch);
        dispatch.destHospitalId = dest?.id ?? null;
        dispatch.destHospitalName = dest?.name ?? null;

        dispatches.set(dispatch.id, dispatch);
        await saveDispatch(dispatch, true);

        const [best] = await rankUnits(dispatch, freeUnits());
        const diverted = dispatch.severity === 'critical' && !dispatch.requestedAmbulanceId
            ? await tryDivert(dispatch, best)
            : false;
        if (!diverted) {
            if (best && isFree(best.unit)) await assign(dispatch, best.unit, best.route, 'created');
            else {
                dispatch.waited = true;
                emitDispatch(dispatch, 'queued');
            }
        }
        return dispatchView(dispatch);
    });

    const cancelDispatch = (id) => lock(async () => {
        const dispatch = dispatches.get(id);
        if (!dispatch) throw new EngineError(404, "Dispatch not found or already finished");
        // A trip that has already delivered its patient counts as completed.
        const unit = await close(dispatch, dispatch.status === 'returning' ? 'completed' : 'cancelled');
        if (unit) await unitFreed(unit);
        return { id, status: dispatch.status };
    });

    function nextCallSign(hospitalId) {
        const taken = new Set([...units.values()].map(u => u.callSign));
        for (let n = 1; n <= MAX_FLEET + 1; n++) {
            const sign = `A${hospitalId}-${String(n).padStart(2, '0')}`;
            if (!taken.has(sign)) return sign;
        }
        return `A${hospitalId}-${crypto.randomBytes(2).toString('hex')}`;
    }

    async function insertUnit(hospitalId, type, crew) {
        const unit = { id: crypto.randomUUID(), callSign: nextCallSign(hospitalId), type, hospitalId, inService: true, crew: crew || null, dispatchId: null };
        await db.run(
            "INSERT INTO ambulances (id, call_sign, type, hospital_id, in_service, crew) VALUES (?, ?, ?, ?, 1, ?)",
            [unit.id, unit.callSign, unit.type, unit.hospitalId, unit.crew]
        );
        units.set(unit.id, unit);
        return unit;
    }

    async function deleteUnit(unit) {
        await db.run("DELETE FROM ambulances WHERE id = ?", [unit.id]);
        units.delete(unit.id);
        emit('unit_removed', { id: unit.id });
    }

    const addUnit = ({ hospitalId, type, crew }) => lock(async () => {
        const hospital = hospitals.get(hospitalId);
        if (!hospital) throw new EngineError(404, "Hospital not found");
        if ([...units.values()].filter(u => u.hospitalId === hospitalId).length >= MAX_FLEET) {
            throw new EngineError(400, `A hospital can have at most ${MAX_FLEET} ambulances.`);
        }
        const unit = await insertUnit(hospitalId, type, crew);
        emitUnit(unit);
        await unitFreed(unit);
        return unitView(unit);
    });

    const updateUnit = (id, changes) => lock(async () => {
        const unit = units.get(id);
        if (!unit) throw new EngineError(404, "Ambulance not found");
        if (changes.inService === false && unit.dispatchId) {
            throw new EngineError(409, `${unit.callSign} is on a call. Cancel the dispatch first.`);
        }
        if (changes.type !== undefined) unit.type = changes.type;
        if (changes.crew !== undefined) unit.crew = changes.crew;
        if (changes.inService !== undefined) unit.inService = changes.inService;
        await db.run("UPDATE ambulances SET type = ?, crew = ?, in_service = ? WHERE id = ?", [unit.type, unit.crew, unit.inService ? 1 : 0, id]);
        emitUnit(unit);
        if (isFree(unit)) await unitFreed(unit);
        return unitView(unit);
    });

    const removeUnit = (id) => lock(async () => {
        const unit = units.get(id);
        if (!unit) throw new EngineError(404, "Ambulance not found");
        if (unit.dispatchId) throw new EngineError(409, `${unit.callSign} is on a call and can't be removed yet.`);
        await deleteUnit(unit);
        const hospital = hospitals.get(unit.hospitalId);
        if (hospital) emit('hospital', hospitalView(hospital));
        return { id };
    });

    // Quick "set how many ambulances are at base" control: adds basic units or
    // retires parked ones to reach `count` available.
    const setAvailableCount = (hospitalId, count) => lock(async () => {
        const hospital = hospitals.get(hospitalId);
        if (!hospital) throw new EngineError(404, "Hospital not found");
        const fleet = [...units.values()].filter(u => u.hospitalId === hospitalId);
        const parked = fleet.filter(u => unitStatus(u) === 'available');
        const others = fleet.length - parked.length;
        if (count + others > MAX_FLEET) throw new EngineError(400, `A hospital can have at most ${MAX_FLEET} ambulances.`);

        if (count > parked.length) {
            const added = [];
            for (let i = parked.length; i < count; i++) added.push(await insertUnit(hospitalId, 'BLS', null));
            added.forEach(u => emit('unit', unitView(u)));
            emit('hospital', hospitalView(hospital));
            await assignQueued();
        } else {
            // Retire basic units before advanced ones, newest call signs first.
            const order = [...parked].sort((a, b) => (a.type === b.type ? b.callSign.localeCompare(a.callSign) : a.type === 'BLS' ? -1 : 1));
            for (const unit of order.slice(0, parked.length - count)) await deleteUnit(unit);
            emit('hospital', hospitalView(hospital));
        }
        return hospitalView(hospital);
    });

    const createHospital = (data) => lock(async () => {
        const id = Math.max(0, ...hospitals.keys()) + 1;
        const hospital = { id, name: data.name, lat: data.lat, lng: data.lng, bedsAvailable: data.bedsAvailable ?? 20, capabilities: data.capabilities ?? [] };
        await db.run(
            "INSERT INTO hospitals (id, name, lat, lng, beds_available, capabilities) VALUES (?, ?, ?, ?, ?, ?)",
            [id, hospital.name, hospital.lat, hospital.lng, hospital.bedsAvailable, hospital.capabilities.join(',')]
        );
        hospitals.set(id, hospital);
        emit('hospital', hospitalView(hospital));
        return hospitalView(hospital);
    });

    const updateHospital = (id, changes) => lock(async () => {
        const hospital = hospitals.get(id);
        if (!hospital) throw new EngineError(404, "Hospital not found");
        for (const key of ['name', 'lat', 'lng', 'bedsAvailable', 'capabilities']) {
            if (changes[key] !== undefined) hospital[key] = changes[key];
        }
        await db.run(
            "UPDATE hospitals SET name = ?, lat = ?, lng = ?, beds_available = ?, capabilities = ? WHERE id = ?",
            [hospital.name, hospital.lat, hospital.lng, hospital.bedsAvailable, hospital.capabilities.join(','), id]
        );
        emit('hospital', hospitalView(hospital));
        return hospitalView(hospital);
    });

    const removeHospital = (id) => lock(async () => {
        const hospital = hospitals.get(id);
        if (!hospital) throw new EngineError(404, "Hospital not found");
        const fleet = [...units.values()].filter(u => u.hospitalId === id);
        if (fleet.some(u => u.dispatchId)) throw new EngineError(409, "This hospital has ambulances on a call. Try again when they are back.");
        if ([...dispatches.values()].some(d => d.destHospitalId === id && d.status !== 'returning')) {
            throw new EngineError(409, "A patient is on the way to this hospital. Try again once they have arrived.");
        }
        for (const unit of fleet) await deleteUnit(unit);
        await db.run("DELETE FROM hospitals WHERE id = ?", [id]);
        hospitals.delete(id);
        emit('hospital_removed', { id });
        return { id };
    });

    // --- Boot ---
    for (const row of await db.all("SELECT * FROM hospitals")) {
        hospitals.set(row.id, {
            id: row.id, name: row.name, lat: row.lat, lng: row.lng, bedsAvailable: row.bedsAvailable,
            capabilities: String(row.capabilities || '').split(',').filter(c => CAPABILITIES.includes(c)),
        });
    }
    for (const row of await db.all("SELECT * FROM ambulances")) {
        if (!hospitals.has(row.hospitalId)) continue;
        units.set(row.id, { id: row.id, callSign: row.callSign, type: row.type, hospitalId: row.hospitalId, inService: !!row.inService, crew: row.crew, dispatchId: null });
    }
    for (const row of await db.all("SELECT * FROM dispatches WHERE status = 'queued' ORDER BY created_at")) {
        dispatches.set(row.id, {
            ...row, unitType: null, legs: [], version: 0, waited: true,
            // A unit requested by hand may be gone after a restart; fall back to automatic.
            requestedAmbulanceId: units.has(row.requestedAmbulanceId) ? row.requestedAmbulanceId : null,
        });
    }
    if (dispatches.size > 0) lock(assignQueued).catch(console.error);

    async function shutdown() {
        await tail;
        for (const list of timers.values()) list.forEach(clearTimeout);
        timers.clear();
        // Anything still moving can't be resumed later; record it as finished.
        for (const dispatch of dispatches.values()) {
            if (dispatch.status === 'queued') continue;
            dispatch.status = 'completed';
            dispatch.completedAt = Date.now();
            await saveDispatch(dispatch);
        }
    }

    return {
        // reads
        hospitals: () => [...hospitals.values()].map(hospitalView).sort((a, b) => a.name.localeCompare(b.name)),
        units: () => [...units.values()].map(unitView).sort((a, b) => a.callSign.localeCompare(b.callSign)),
        dispatches: () => [...dispatches.values()].map(dispatchView),
        hospital: (id) => hospitals.get(id),
        unit: (id) => units.get(id),
        findByToken: (token) => {
            const live = [...dispatches.values()].find(d => d.trackToken === token);
            return live ? dispatchView(live) : null;
        },
        counts: () => ({
            active: [...dispatches.values()].filter(d => d.status !== 'queued').length,
            queued: [...dispatches.values()].filter(d => d.status === 'queued').length,
            available: [...units.values()].filter(u => unitStatus(u) === 'available').length,
            deployed: [...units.values()].filter(u => u.dispatchId).length,
        }),
        // writes
        createDispatch, cancelDispatch, addUnit, updateUnit, removeUnit, setAvailableCount,
        createHospital, updateHospital, removeHospital,
        idle: () => tail,
        shutdown,
    };
}

module.exports = { createEngine, EngineError, SEVERITIES, CASE_TYPES, UNIT_TYPES, CAPABILITIES, MAX_FLEET };
