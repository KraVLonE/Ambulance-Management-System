// Distance, road routing (OSRM) and reverse geocoding (Nominatim) helpers.

const EARTH_RADIUS_M = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;

// Great-circle distance in metres.
function haversine(lat1, lng1, lat2, lng2) {
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// Cumulative distances along a [lat, lng] path, for constant-speed interpolation.
function measurePath(path) {
    const cumulative = [0];
    for (let i = 1; i < path.length; i++) {
        cumulative.push(cumulative[i - 1] + haversine(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]));
    }
    return { path, cumulative, total: cumulative[cumulative.length - 1] || 0 };
}

// Point at `fraction` (0..1) of the way along a path.
function pointAlong(path, fraction) {
    if (!path || path.length === 0) return null;
    const { cumulative, total } = measurePath(path);
    if (path.length === 1 || total === 0 || fraction <= 0) return path[0];
    if (fraction >= 1) return path[path.length - 1];
    const target = fraction * total;
    let i = 1;
    while (i < cumulative.length - 1 && cumulative[i] < target) i++;
    const segment = cumulative[i] - cumulative[i - 1];
    const t = segment === 0 ? 0 : (target - cumulative[i - 1]) / segment;
    const [aLat, aLng] = path[i - 1];
    const [bLat, bLng] = path[i];
    return [aLat + (bLat - aLat) * t, aLng + (bLng - aLng) * t];
}

// Rough drive time in seconds when only straight-line distance is known.
const estimateSeconds = (metres) => (metres * ROAD_FACTOR) / FALLBACK_SPEED_MPS;

// Small LRU so repeated lookups don't hit the public APIs and memory stays bounded.
class LruCache {
    constructor(max = 500) {
        this.max = max;
        this.map = new Map();
    }
    get(key) {
        if (!this.map.has(key)) return undefined;
        const value = this.map.get(key);
        this.map.delete(key);
        this.map.set(key, value);
        return value;
    }
    set(key, value) {
        this.map.delete(key);
        this.map.set(key, value);
        if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    }
}

// Used when OSRM is unreachable: roads are longer than the straight line,
// and city traffic averages well below the speed limit.
const ROAD_FACTOR = 1.4;
const FALLBACK_SPEED_MPS = 35 / 3.6;

function estimateRoute(startLat, startLng, endLat, endLng) {
    const distance = haversine(startLat, startLng, endLat, endLng) * ROAD_FACTOR;
    return {
        path: [[startLat, startLng], [endLat, endLng]],
        distance,
        duration: distance / FALLBACK_SPEED_MPS,
        source: 'estimate',
    };
}

function createRouter({ fetchImpl = fetch, osrmUrl, nominatimUrl, timeoutMs = 4000 } = {}) {
    const routeCache = new LruCache(500);
    const geocodeCache = new LruCache(500);

    // ~11 m precision: enough for routing, and lets nearby clicks share a cache entry.
    const round = (n) => n.toFixed(4);

    async function getRoute(startLat, startLng, endLat, endLng) {
        if (!osrmUrl) return estimateRoute(startLat, startLng, endLat, endLng);

        const key = `${round(startLat)},${round(startLng)};${round(endLat)},${round(endLng)}`;
        const cached = routeCache.get(key);
        if (cached) return cached;

        try {
            // OSRM expects {lon},{lat}
            const url = `${osrmUrl}/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
            const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
            if (!response.ok) throw new Error(`OSRM responded ${response.status}`);
            const data = await response.json();
            const route = data.routes && data.routes[0];
            if (data.code !== 'Ok' || !route || !route.geometry?.coordinates?.length) {
                throw new Error(`OSRM returned no route (${data.code})`);
            }
            const result = {
                path: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
                distance: route.distance,
                duration: route.duration,
                source: 'osrm',
            };
            routeCache.set(key, result);
            return result;
        } catch (err) {
            console.error("OSRM error, using straight-line estimate:", err.message);
            return estimateRoute(startLat, startLng, endLat, endLng);
        }
    }

    // Returns a short human-readable address, or null if it can't be resolved.
    async function reverseGeocode(lat, lng) {
        if (!nominatimUrl) return null;

        const key = `${round(lat)},${round(lng)}`;
        const cached = geocodeCache.get(key);
        if (cached !== undefined) return cached;

        try {
            const url = `${nominatimUrl}/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`;
            const response = await fetchImpl(url, {
                signal: AbortSignal.timeout(timeoutMs),
                headers: { 'User-Agent': 'ambulance-management-system', 'Accept-Language': 'en' },
            });
            if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
            const data = await response.json();
            const a = data.address || {};
            const parts = [
                a.road || a.pedestrian || a.amenity || data.name,
                a.neighbourhood || a.suburb || a.city_district,
                a.city || a.town || a.village,
            ].filter(Boolean);
            const address = [...new Set(parts)].join(', ') || data.display_name || null;
            geocodeCache.set(key, address);
            return address;
        } catch (err) {
            console.error("Reverse geocode error:", err.message);
            return null;
        }
    }

    // Free-text place search, biased to the area around `near` ({ lat, lng }).
    async function searchPlaces(query, near) {
        if (!nominatimUrl) return [];
        const key = `q:${query.toLowerCase()}`;
        const cached = geocodeCache.get(key);
        if (cached !== undefined) return cached;

        try {
            const params = new URLSearchParams({ format: 'jsonv2', limit: '6', q: query });
            if (near) {
                const d = 0.6; // about 60 km either side
                params.set('viewbox', `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`);
            }
            const response = await fetchImpl(`${nominatimUrl}/search?${params}`, {
                signal: AbortSignal.timeout(timeoutMs),
                headers: { 'User-Agent': 'ambulance-management-system', 'Accept-Language': 'en' },
            });
            if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
            const data = await response.json();
            const results = (Array.isArray(data) ? data : [])
                .map(item => ({ label: item.display_name, lat: Number(item.lat), lng: Number(item.lon) }))
                .filter(item => item.label && Number.isFinite(item.lat) && Number.isFinite(item.lng));
            geocodeCache.set(key, results);
            return results;
        } catch (err) {
            console.error("Place search error:", err.message);
            return [];
        }
    }

    return { getRoute, reverseGeocode, searchPlaces };
}

module.exports = { haversine, estimateRoute, estimateSeconds, measurePath, pointAlong, createRouter, LruCache };
