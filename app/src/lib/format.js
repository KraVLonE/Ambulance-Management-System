export const SEVERITY = {
    critical: { label: 'Critical', hint: 'Life-threatening', color: '#e63946', chip: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900' },
    urgent: { label: 'Urgent', hint: 'Needs care soon', color: '#f59e0b', chip: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900' },
    standard: { label: 'Standard', hint: 'Stable patient', color: '#457b9d', chip: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900' },
};
export const SEVERITY_ORDER = ['critical', 'urgent', 'standard'];

export const CASE_TYPE = {
    general: { label: 'General', hint: 'Any hospital' },
    trauma: { label: 'Trauma', hint: 'Needs a trauma centre' },
    cardiac: { label: 'Cardiac', hint: 'Needs cardiac care' },
};
export const CASE_TYPE_ORDER = ['general', 'trauma', 'cardiac'];

export const CAPABILITY_LABEL = { trauma: 'Trauma', cardiac: 'Cardiac' };

export const UNIT_TYPE = {
    ALS: { label: 'ALS', full: 'Advanced life support' },
    BLS: { label: 'BLS', full: 'Basic life support' },
};

export const UNIT_STATUS = {
    available: 'At base',
    busy: 'On a call',
    returning: 'Heading back',
    out_of_service: 'Out of service',
};

export const PHASE_LABEL = {
    queued: 'Waiting for an ambulance',
    en_route: 'En route',
    on_scene: 'On scene',
    transporting: 'Taking patient to hospital',
    returning: 'Returning to base',
    completed: 'Completed',
    cancelled: 'Cancelled',
};

export const ROLE = {
    admin: { label: 'Admin', hint: 'Everything, including users and hospitals' },
    dispatcher: { label: 'Dispatcher', hint: 'Create and cancel dispatches' },
    hospital_admin: { label: 'Hospital admin', hint: 'Manage one hospital’s fleet and beds' },
    viewer: { label: 'Viewer', hint: 'Read-only' },
};

// What a signed-in user may do. The server enforces the same rules.
export function permissions(user) {
    const role = user?.role;
    return {
        dispatch: role === 'admin' || role === 'dispatcher',
        admin: role === 'admin',
        manageHospital: (hospitalId) => role === 'admin' || (role === 'hospital_admin' && user.hospitalId === hospitalId),
    };
}

export function formatDistance(metres) {
    if (metres == null) return '';
    return metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`;
}

// "under a minute", "1 min", "12 min"
export function formatMinutes(seconds) {
    if (seconds < 45) return 'under a minute';
    return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function formatCoords(lat, lng) {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

export function formatClock(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Traffic-light level for a hospital's availability.
export function availabilityLevel(count) {
    if (count <= 0) return 'none';
    return count <= 2 ? 'low' : 'good';
}

export const placeOf = (dispatch) => dispatch.address || formatCoords(dispatch.lat, dispatch.lng);
