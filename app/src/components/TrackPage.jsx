import { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { DispatchLayer } from './LeafletMap';
import { api } from '../lib/api';
import { tripProgress } from '../lib/geo';
import { formatMinutes, formatCoords } from '../lib/format';

const POLL_MS = 3000;

const hospitalDot = L.divIcon({
    className: '',
    html: '<div class="hosp hosp--good" style="width:26px"><span class="hosp__cross">✚</span></div>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
});

// Keeps the pickup, the route and the destination in view.
const FitTrip = ({ trip }) => {
    const map = useMap();
    const fitted = useRef(null);
    useEffect(() => {
        const key = `${trip.status}:${trip.legs.length}:${trip.legs[0]?.startAt || 0}`;
        if (fitted.current === key) return;
        fitted.current = key;
        const points = [[trip.lat, trip.lng], ...trip.legs.filter(l => l.phase !== 'returning').flatMap(l => l.path)];
        if (points.length > 1) map.fitBounds(points, { padding: [50, 50], maxZoom: 16 });
        else map.setView(points[0], 15);
    }, [map, trip]);
    return null;
};

function summary(trip, progress) {
    switch (trip.status) {
        case 'queued':
            return {
                title: 'Your request has been received',
                detail: trip.queuePosition > 1
                    ? `All ambulances are busy right now. You are number ${trip.queuePosition} in the queue; the most serious cases go first.`
                    : 'All ambulances are busy right now. You are next: one will be sent the moment it is free.',
            };
        case 'en_route':
            return { title: `Ambulance arriving in ${formatMinutes(progress.toPickupS)}`, detail: `${trip.callSign} is on its way to you.` };
        case 'on_scene':
            return { title: 'The ambulance has arrived', detail: `${trip.callSign} is at your location.` };
        case 'transporting':
            return { title: `On the way to ${trip.destHospitalName}`, detail: `Arriving in ${formatMinutes(progress.toHospitalS)}.` };
        case 'returning':
        case 'completed':
            return { title: `Arrived at ${trip.destHospitalName || 'the hospital'}`, detail: 'This trip is finished.' };
        case 'cancelled':
            return { title: 'This request was cancelled', detail: 'If you still need help, please call again.' };
        default:
            return { title: 'Tracking your ambulance', detail: '' };
    }
}

// Public page a caller opens from a shared link. No sign-in; it shows only
// this one trip.
const TrackPage = ({ token }) => {
    const [trip, setTrip] = useState(null);
    const [failure, setFailure] = useState(null); // 'notfound' | 'offline'
    const [now, setNow] = useState(0);
    const clockOffset = useRef(0);
    const serverNow = useCallback(() => Date.now() + clockOffset.current, []);

    useEffect(() => {
        let stopped = false;
        let timer;
        const poll = () => {
            api.track(token)
                .then(data => {
                    if (stopped) return;
                    clockOffset.current = data.serverNow - Date.now();
                    setTrip(data);
                    setFailure(null);
                    // Nothing more will change once the trip has ended.
                    if (!['completed', 'cancelled'].includes(data.status)) timer = setTimeout(poll, POLL_MS);
                })
                .catch(err => {
                    if (stopped) return;
                    if (err.response?.status === 404) return setFailure('notfound');
                    setFailure('offline');
                    timer = setTimeout(poll, POLL_MS * 2);
                });
        };
        poll();
        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, [token]);

    // Tick so the countdown moves between polls.
    useEffect(() => {
        const interval = setInterval(() => setNow(serverNow()), 500);
        return () => clearInterval(interval);
    }, [serverNow]);

    if (failure === 'notfound') {
        return (
            <div className="min-h-dvh flex items-center justify-center p-6 text-center">
                <div>
                    <h1 className="text-xl font-bold heading">Tracking link not found</h1>
                    <p className="muted mt-2">Check that you opened the complete link you were sent.</p>
                </div>
            </div>
        );
    }
    if (!trip) {
        return <div className="min-h-dvh flex items-center justify-center muted">{failure === 'offline' ? 'Cannot reach the server. Retrying…' : 'Loading…'}</div>;
    }

    const progress = tripProgress(trip, now || trip.serverNow);
    const { title, detail } = summary(trip, progress);
    const live = ['en_route', 'on_scene', 'transporting'].includes(trip.status);
    const lastStop = trip.legs.find(l => l.phase === 'transporting')?.path.at(-1);
    // The public view follows the patient, not the ambulance's drive home.
    const shown = { ...trip, id: token, legs: trip.legs.filter(l => l.phase !== 'returning'), status: trip.status === 'returning' ? 'completed' : trip.status };

    return (
        <div className="h-dvh flex flex-col">
            <header className="surface shadow-sm px-4 py-3 z-10">
                <div className="flex items-center gap-3">
                    <img src="/assets/ambulance.png" alt="" className="h-9 w-9 flex-shrink-0" />
                    <div className="min-w-0">
                        <h1 className="text-lg font-bold heading leading-tight" aria-live="polite">{title}</h1>
                        <p className="text-sm muted">{detail}</p>
                    </div>
                </div>
                <p className="text-xs muted mt-2 truncate">
                    Pickup: {trip.address || formatCoords(trip.lat, trip.lng)}
                    {failure === 'offline' && ' · connection lost, retrying…'}
                </p>
            </header>
            <div className="flex-1 min-h-0">
                <MapContainer center={[trip.lat, trip.lng]} zoom={14} className="h-full w-full">
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <FitTrip trip={trip} />
                    {(live || trip.status === 'queued') && <DispatchLayer key={`${shown.legs[0]?.startAt || 'queued'}`} dispatch={shown} serverNow={serverNow} />}
                    {lastStop && <Marker position={lastStop} icon={hospitalDot} interactive={false} />}
                </MapContainer>
            </div>
        </div>
    );
};

export default TrackPage;
