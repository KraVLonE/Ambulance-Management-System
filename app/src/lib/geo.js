const EARTH_RADIUS_M = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;

// Great-circle distance in metres between two [lat, lng] points.
export function distanceM([lat1, lng1], [lat2, lng2]) {
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// Precomputes cumulative distances so a position can be looked up by
// fraction travelled. This makes the ambulance move at a constant speed
// along the road instead of jumping between unevenly spaced route points.
export function measurePath(path) {
    const cumulative = [0];
    for (let i = 1; i < path.length; i++) {
        cumulative.push(cumulative[i - 1] + distanceM(path[i - 1], path[i]));
    }
    return { path, cumulative, total: cumulative[cumulative.length - 1] || 0 };
}

// Returns { point: [lat, lng], index } at `fraction` (0..1) of the way along the path.
// `index` is the segment the point lies on, useful for splitting the line.
export function pointAlong(measured, fraction) {
    const { path, cumulative, total } = measured;
    if (path.length === 0) return null;
    if (path.length === 1 || total === 0 || fraction <= 0) return { point: path[0], index: 0 };
    if (fraction >= 1) return { point: path[path.length - 1], index: Math.max(0, path.length - 2) };

    const target = fraction * total;
    // Binary search for the segment containing `target`.
    let lo = 0;
    let hi = cumulative.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] <= target) lo = mid;
        else hi = mid;
    }
    const segment = cumulative[hi] - cumulative[lo];
    const t = segment === 0 ? 0 : (target - cumulative[lo]) / segment;
    const [aLat, aLng] = path[lo];
    const [bLat, bLng] = path[hi];
    return { point: [aLat + (bLat - aLat) * t, aLng + (bLng - aLng) * t], index: lo };
}

/**
 * Where a trip is at server time `now`. A trip is a list of timed legs
 * (en_route, on_scene, transporting, returning); see server/engine.js.
 * Returns the current leg, how far through it we are, and real-world seconds
 * left until the ambulance reaches the patient / the hospital.
 */
export function tripProgress(dispatch, now) {
    const legs = dispatch.legs || [];
    if (legs.length === 0) return { phase: dispatch.status, legIndex: -1, leg: null, fraction: 0, toPickupS: null, toHospitalS: null };

    let legIndex = legs.findIndex(leg => now < leg.endAt);
    if (legIndex === -1) legIndex = legs.length - 1;
    const leg = legs[legIndex];
    const fraction = Math.min(1, Math.max(0, (now - leg.startAt) / Math.max(1, leg.endAt - leg.startAt)));
    const left = leg.durationS * (1 - fraction);

    const transport = legs.find(l => l.phase === 'transporting');
    let toPickupS = null;
    let toHospitalS = null;
    if (leg.phase === 'en_route') {
        toPickupS = left;
        toHospitalS = left + (transport?.durationS || 0);
    } else if (leg.phase === 'on_scene') {
        toPickupS = 0;
        toHospitalS = transport?.durationS ?? null;
    } else if (leg.phase === 'transporting') {
        toPickupS = 0;
        toHospitalS = left;
    }
    return { phase: leg.phase, legIndex, leg, fraction, toPickupS, toHospitalS };
}

// Current [lat, lng] of the ambulance on a trip, or null if it has no route yet.
export function tripPosition(dispatch, now) {
    const { leg, fraction } = tripProgress(dispatch, now);
    if (!leg) return null;
    return pointAlong(measurePath(leg.path), fraction)?.point || null;
}

// Rough drive time (seconds) from straight-line distance, matching the
// server's fallback: roads are ~1.4x longer, city traffic averages 35 km/h.
export const estimateSeconds = (metres) => (metres * 1.4) / (35 / 3.6);

/**
 * Coverage grid: for each cell of a grid over `bounds`, the estimated minutes
 * for the nearest free ambulance to get there. `sources` are [lat, lng] points
 * where free ambulances currently are.
 */
export function coverageGrid(bounds, sources, size = 26) {
    const [[south, west], [north, east]] = bounds;
    const latStep = (north - south) / size;
    const lngStep = (east - west) / size;
    const cells = [];
    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            const centre = [south + (row + 0.5) * latStep, west + (col + 0.5) * lngStep];
            let best = Infinity;
            for (const source of sources) best = Math.min(best, distanceM(centre, source));
            cells.push({
                bounds: [[south + row * latStep, west + col * lngStep], [south + (row + 1) * latStep, west + (col + 1) * lngStep]],
                minutes: best === Infinity ? Infinity : estimateSeconds(best) / 60,
            });
        }
    }
    return cells;
}

// Bounding box around a set of { lat, lng } points, padded by `pad` degrees.
export function boundsOf(points, pad = 0) {
    if (points.length === 0) return null;
    const lats = points.map(p => p.lat);
    const lngs = points.map(p => p.lng);
    return [[Math.min(...lats) - pad, Math.min(...lngs) - pad], [Math.max(...lats) + pad, Math.max(...lngs) + pad]];
}
