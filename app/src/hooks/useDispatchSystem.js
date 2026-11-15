import { useCallback, useEffect, useRef, useState } from 'react';
import { api, socket, errorMessage } from '../lib/api';
import { placeOf } from '../lib/format';

const upsert = (list, item) =>
    list.some(x => x.id === item.id) ? list.map(x => (x.id === item.id ? item : x)) : [...list, item];
const without = (list, id) => list.filter(x => x.id !== id);

// What to tell the user for each thing the server reports about a dispatch.
function describe(event, d) {
    const unit = d.callSign || 'Ambulance';
    const eta = d.durationS == null ? '' : ` · ETA ${Math.max(1, Math.round(d.durationS / 60))} min`;
    switch (event) {
        case 'created': return [`${unit} dispatched from ${d.hospitalName}${eta}`, 'success'];
        case 'queued': return [`No ambulance is free. Request at ${placeOf(d)} is queued.`, 'warning'];
        case 'assigned': return [`${unit} assigned to the waiting request at ${placeOf(d)}${eta}`, 'success'];
        case 'diverted': return [`${unit} diverted to the critical call at ${placeOf(d)}${eta}`, 'warning'];
        case 'diverted_away': return [`Request at ${placeOf(d)} is waiting again: its ambulance went to a critical call.`, 'warning'];
        case 'swapped': return [`Closer unit ${unit} took over the call at ${placeOf(d)}${eta}`, 'info'];
        case 'on_scene': return [`${unit} arrived at ${placeOf(d)}`, 'info'];
        case 'returning': return [`Patient delivered to ${d.destHospitalName}`, 'info'];
        case 'cancelled': return [`Dispatch to ${placeOf(d)} cancelled`, 'warning'];
        default: return null;
    }
}

/**
 * Single source of truth for server state: hospitals, ambulance units, live
 * dispatches, history and stats. Loads over HTTP, stays current via Socket.io,
 * and reloads everything after a reconnect so nothing is missed.
 *
 * `enabled`: only run while signed in.
 * `notify(message, tone)`: called for events worth telling the user about.
 * `onCritical(dispatch)`: called when a critical call comes in.
 */
export function useDispatchSystem({ enabled, notify, onCritical }) {
    const [hospitals, setHospitals] = useState([]);
    const [units, setUnits] = useState([]);
    const [dispatches, setDispatches] = useState([]);
    const [history, setHistory] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [connected, setConnected] = useState(false);

    // Server clock minus local clock, so animations stay in sync across
    // devices whose clocks disagree.
    const clockOffset = useRef(0);
    const serverNow = useCallback(() => Date.now() + clockOffset.current, []);
    const syncClock = (serverTime) => {
        if (typeof serverTime === 'number') clockOffset.current = serverTime - Date.now();
    };

    const callbacks = useRef({ notify, onCritical });
    useEffect(() => { callbacks.current = { notify, onCritical }; }, [notify, onCritical]);

    // The person who made a request hears about it twice (HTTP response and
    // socket broadcast); announce each change only once.
    const announced = useRef(new Set());

    const applyDispatch = useCallback((dispatch, event, serverTime) => {
        syncClock(serverTime);
        const finished = dispatch.status === 'completed' || dispatch.status === 'cancelled';
        setDispatches(prev => (finished ? without(prev, dispatch.id) : upsert(prev, dispatch)));

        const key = `${dispatch.id}:${event}:${dispatch.assignedAt || 0}`;
        if (!event || announced.current.has(key)) return;
        announced.current.add(key);
        const message = describe(event, dispatch);
        if (message) callbacks.current.notify?.(...message);
        if (dispatch.severity === 'critical' && ['created', 'queued', 'diverted'].includes(event)) {
            callbacks.current.onCritical?.(dispatch);
        }
    }, []);

    const loadSecondary = useCallback(() => {
        api.history().then(setHistory).catch(() => {});
        api.stats().then(setStats).catch(() => {});
    }, []);

    const loadCore = useCallback(() => {
        return api.state()
            .then((state) => {
                syncClock(state.serverNow);
                setHospitals(state.hospitals);
                setUnits(state.units);
                setDispatches(state.dispatches);
                setError(null);
            })
            .catch(err => setError(errorMessage(err)))
            .finally(() => setLoading(false));
    }, []);

    const reload = useCallback(() => {
        setLoading(true);
        loadCore();
        loadSecondary();
    }, [loadCore, loadSecondary]);

    useEffect(() => {
        if (!enabled) return;
        loadCore();
        loadSecondary();

        let hasConnected = false;
        const onConnect = () => {
            setConnected(true);
            // Events were missed while offline: resync instead of trusting stale state.
            if (hasConnected) {
                loadCore();
                loadSecondary();
            }
            hasConnected = true;
        };
        const onDisconnect = () => setConnected(false);
        const onHospital = (hospital) => setHospitals(prev => upsert(prev, hospital));
        const onHospitalRemoved = ({ id }) => setHospitals(prev => without(prev, id));
        const onUnit = (unit) => setUnits(prev => upsert(prev, unit));
        const onUnitRemoved = ({ id }) => setUnits(prev => without(prev, id));
        const onDispatch = ({ dispatch, event, serverNow: serverTime }) => {
            applyDispatch(dispatch, event, serverTime);
            if (['created', 'queued', 'completed', 'cancelled', 'on_scene'].includes(event)) loadSecondary();
        };

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('hospital', onHospital);
        socket.on('hospital_removed', onHospitalRemoved);
        socket.on('unit', onUnit);
        socket.on('unit_removed', onUnitRemoved);
        socket.on('dispatch', onDispatch);
        socket.connect();

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('hospital', onHospital);
            socket.off('hospital_removed', onHospitalRemoved);
            socket.off('unit', onUnit);
            socket.off('unit_removed', onUnitRemoved);
            socket.off('dispatch', onDispatch);
            socket.disconnect();
            setConnected(false);
        };
    }, [enabled, applyDispatch, loadCore, loadSecondary]);

    return { hospitals, units, dispatches, history, stats, loading, error, connected, serverNow, applyDispatch, reload };
}
