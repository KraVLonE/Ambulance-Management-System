import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { measurePath, pointAlong, tripProgress, tripPosition, coverageGrid, boundsOf } from '../lib/geo';
import { SEVERITY, PHASE_LABEL, CAPABILITY_LABEL, availabilityLevel, placeOf } from '../lib/format';

// Chandigarh (approximate centre of the default service area)
const CENTER = [30.7150, 76.7800];
const RETURNING_COLOR = '#6b7280';

const severityColor = (severity) => SEVERITY[severity]?.color || SEVERITY.urgent.color;

// All icons are inline HTML/CSS (see index.css) so the map works without
// hotlinking third-party image hosts.
const hospitalIcon = (count, editable) => L.divIcon({
    className: '',
    html: `<div class="hosp hosp--${availabilityLevel(count)} ${editable ? 'hosp--edit' : ''}"><span class="hosp__cross">✚</span><span class="hosp__count">${count}</span></div>`,
    iconSize: [44, 26],
    iconAnchor: [22, 13],
    popupAnchor: [0, -14],
});

const ambulanceIcon = (color) => L.divIcon({
    className: '',
    html: `<div class="amb" style="--sev:${color}"><img src="/assets/ambulance.png" alt="" /></div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
});

const pickupIcon = (color, variant) => L.divIcon({
    className: '',
    html: `<div class="pickup ${variant}" style="--sev:${color}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
});

const selectionIcon = L.divIcon({
    className: '',
    html: '<div class="pin"></div>',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
});

const MapClickHandler = ({ onClick }) => {
    useMapEvents({
        click(e) {
            onClick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
        },
    });
    return null;
};

// Moves the camera when `focus` changes. `focus.key` makes repeated clicks
// on the same target fly again.
const MapController = ({ focus }) => {
    const map = useMap();
    useEffect(() => {
        if (!focus) return;
        if (focus.bounds) {
            map.flyToBounds(focus.bounds, { padding: [60, 60], maxZoom: 16, duration: 1 });
        } else {
            map.flyTo([focus.lat, focus.lng], focus.zoom || 15, { duration: 1 });
        }
    }, [focus, map]);
    return null;
};

// Frames all hospitals once they load, so the whole service area is visible
// on any screen size (a fixed zoom cuts hospitals off on phones).
const FitToHospitals = ({ hospitals }) => {
    const map = useMap();
    const done = useRef(false);
    useEffect(() => {
        if (done.current) return;
        const points = hospitals.map(h => [h.lat, h.lng]);
        if (points.length === 0) return;
        done.current = true;
        map.fitBounds(points, { padding: [40, 40], maxZoom: 14, animate: false });
    }, [hospitals, map]);
    return null;
};

// Leaflet measures its container once; tell it when the layout changes
// (control-room mode, panel resize) so tiles fill the new space.
const ResizeWatcher = () => {
    const map = useMap();
    useEffect(() => {
        const observer = new ResizeObserver(() => map.invalidateSize());
        observer.observe(map.getContainer());
        return () => observer.disconnect();
    }, [map]);
    return null;
};

/**
 * One dispatch on the map: its route, the pickup pin and a moving ambulance.
 * Position is derived from the server clock every animation frame, so every
 * connected client (and anyone joining mid-trip) sees the same thing.
 * Leaflet objects are moved imperatively to avoid re-rendering React at 60fps.
 */
export const DispatchLayer = ({ dispatch, serverNow }) => {
    const legs = dispatch.legs;
    const measured = useMemo(() => (legs || []).map(leg => measurePath(leg.path)), [legs]);
    const markerRef = useRef(null);
    const remainingRef = useRef(null);
    const color = severityColor(dispatch.severity);
    const hasTrip = measured.length > 0;
    const [start] = useState(() => (hasTrip ? legs[0].path[0] : [dispatch.lat, dispatch.lng]));

    const patientWaiting = ['queued', 'en_route', 'on_scene'].includes(dispatch.status);
    const pinIcon = useMemo(() => pickupIcon(
        color,
        dispatch.status === 'queued' ? 'pickup--waiting pickup--pulse' : patientWaiting ? 'pickup--pulse' : ''
    ), [color, dispatch.status, patientWaiting]);
    const ambIcon = useMemo(
        () => ambulanceIcon(dispatch.status === 'returning' ? RETURNING_COLOR : color),
        [color, dispatch.status]
    );

    useEffect(() => {
        if (!hasTrip) return;
        let frame;
        let lastSegment = -1;
        let lastLeg = -1;
        let lastLng = null;

        const tick = () => {
            const { legIndex, leg, fraction } = tripProgress(dispatch, serverNow());
            const located = pointAlong(measured[legIndex], fraction);
            const marker = markerRef.current;
            if (located && marker) {
                marker.setLatLng(located.point);

                // The artwork faces east; mirror it when driving west.
                const lng = located.point[1];
                if (lastLng !== null && Math.abs(lng - lastLng) > 1e-7) {
                    marker.getElement()?.classList.toggle('amb-flip', lng < lastLng);
                }
                lastLng = lng;

                // Solid line = road still to drive on this leg. Only rebuilt
                // when the ambulance crosses into a new segment.
                const line = remainingRef.current;
                if (line && (located.index !== lastSegment || legIndex !== lastLeg)) {
                    line.setLatLngs(leg.path.length > 1 ? [located.point, ...leg.path.slice(located.index + 1)] : []);
                    line.setStyle({ color: leg.phase === 'returning' ? RETURNING_COLOR : color });
                    lastSegment = located.index;
                    lastLeg = legIndex;
                }
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [dispatch, measured, serverNow, color, hasTrip]);

    return (
        <>
            {hasTrip && legs.map((leg, index) => (
                leg.path.length > 1 && (
                    <Polyline
                        key={`${leg.phase}-${leg.startAt}-${index}`}
                        positions={leg.path}
                        pathOptions={{ color: leg.phase === 'returning' ? RETURNING_COLOR : color, weight: 4, opacity: 0.25, dashArray: '6 8' }}
                        interactive={false}
                    />
                )
            ))}
            {hasTrip && <Polyline ref={remainingRef} positions={[]} pathOptions={{ color, weight: 5, opacity: 0.9 }} interactive={false} />}

            {dispatch.status !== 'returning' && (
                <Marker position={[dispatch.lat, dispatch.lng]} icon={pinIcon}>
                    <Tooltip direction="top" offset={[0, -8]}>
                        <strong>{[SEVERITY[dispatch.severity]?.label, PHASE_LABEL[dispatch.status]].filter(Boolean).join(' · ')}</strong>
                        <br />
                        {placeOf(dispatch)}
                    </Tooltip>
                </Marker>
            )}

            {hasTrip && (
                <Marker ref={markerRef} position={start} icon={ambIcon} zIndexOffset={1000}>
                    <Tooltip direction="top" offset={[0, -16]}>
                        <strong>{dispatch.callSign}</strong>{dispatch.unitType ? ` (${dispatch.unitType})` : ''} · {PHASE_LABEL[dispatch.status]}
                        {dispatch.destHospitalName && dispatch.status !== 'returning' && <><br />To {dispatch.destHospitalName}</>}
                    </Tooltip>
                </Marker>
            )}
        </>
    );
};

const HospitalMarker = ({ hospital, registerRef, editable, onMove }) => {
    const icon = useMemo(() => hospitalIcon(hospital.ambulancesAvailable, editable), [hospital.ambulancesAvailable, editable]);
    const position = useMemo(() => [hospital.lat, hospital.lng], [hospital.lat, hospital.lng]);
    const handlers = useMemo(() => ({
        dragend(e) {
            const { lat, lng } = e.target.getLatLng();
            onMove?.(hospital, { lat, lng }, () => e.target.setLatLng(position));
        },
    }), [hospital, onMove, position]);

    return (
        <Marker
            position={position}
            icon={icon}
            draggable={editable}
            eventHandlers={handlers}
            ref={el => registerRef(hospital.id, el)}
        >
            <Popup>
                <div className="min-w-[170px]">
                    <h3 className="font-bold text-primary text-sm">{hospital.name}</h3>
                    <p className="text-sm !my-1">
                        Ambulances at base: <strong>{hospital.ambulancesAvailable}</strong> of {hospital.units}
                        {hospital.deployed > 0 && <><br />On a call: <strong>{hospital.deployed}</strong></>}
                        <br />Beds free: <strong>{hospital.bedsAvailable}</strong>
                    </p>
                    {hospital.capabilities.length > 0 && (
                        <p className="text-xs !my-0 opacity-70">{hospital.capabilities.map(c => CAPABILITY_LABEL[c]).join(' · ')} centre</p>
                    )}
                    {editable && <p className="text-xs !mt-1 !mb-0 opacity-70">Drag the marker to correct its position.</p>}
                </div>
            </Popup>
        </Marker>
    );
};

// Minutes-to-nearest-free-ambulance bands, shared by the overlay and its legend.
const COVERAGE_BANDS = [
    { max: 4, color: '#15803d', label: '< 4 min' },
    { max: 8, color: '#84cc16', label: '4-8' },
    { max: 12, color: '#f59e0b', label: '8-12' },
    { max: 20, color: '#ea580c', label: '12-20' },
    { max: Infinity, color: '#b91c1c', label: '20+' },
];

// Shades the service area by how long the nearest free ambulance would take.
const CoverageLayer = ({ bounds, sources }) => {
    const map = useMap();
    useEffect(() => {
        if (!bounds) return;
        const renderer = L.canvas({ padding: 0.3 });
        const group = L.layerGroup();
        for (const cell of coverageGrid(bounds, sources)) {
            const band = COVERAGE_BANDS.find(b => cell.minutes < b.max) || COVERAGE_BANDS[COVERAGE_BANDS.length - 1];
            L.rectangle(cell.bounds, { renderer, stroke: false, fillColor: band.color, fillOpacity: 0.36, interactive: false }).addTo(group);
        }
        group.addTo(map);
        return () => { group.remove(); };
    }, [map, bounds, sources]);
    return null;
};

const MapButton = ({ active, onClick, children, title }) => (
    <button
        type="button"
        onClick={onClick}
        title={title}
        aria-pressed={active}
        className={`map-chip px-3 py-1.5 ${active ? '!bg-secondary !text-white !border-secondary' : 'hover:bg-white dark:hover:bg-slate-700'}`}
    >
        {children}
    </button>
);

const LeafletMap = ({
    hospitals, units, dispatches, serverNow, focus, selectedLocation,
    onMapClick, onLocate, locating, canDispatch, canEditHospitals, editMode, onToggleEdit, onHospitalMove,
    hint, children,
}) => {
    const markerRefs = useRef({});
    const registerRef = (id, el) => { markerRefs.current[id] = el; };
    const [coverage, setCoverage] = useState(false);
    const [coverageTick, setCoverageTick] = useState(0);

    // Open the hospital's popup once the camera has been told to move there.
    useEffect(() => {
        if (focus?.hospitalId) markerRefs.current[focus.hospitalId]?.openPopup();
    }, [focus]);

    // Units heading home keep moving, so refresh the overlay every few seconds.
    useEffect(() => {
        if (!coverage) return;
        const interval = setInterval(() => setCoverageTick(t => t + 1), 4000);
        return () => clearInterval(interval);
    }, [coverage]);

    const coverageBounds = useMemo(() => boundsOf(hospitals, 0.05), [hospitals]);

    // Where free ambulances are right now: parked at base, or on the way back.
    const coverageSources = useMemo(() => {
        if (!coverage) return [];
        void coverageTick;
        const byId = new Map(hospitals.map(h => [h.id, h]));
        const now = serverNow();
        const sources = [];
        for (const unit of units) {
            if (unit.status === 'available') {
                const base = byId.get(unit.hospitalId);
                if (base) sources.push([base.lat, base.lng]);
            } else if (unit.status === 'returning') {
                const trip = dispatches.find(d => d.id === unit.dispatchId);
                const point = trip && tripPosition(trip, now);
                if (point) sources.push(point);
            }
        }
        return sources;
    }, [coverage, coverageTick, hospitals, units, dispatches, serverNow]);

    return (
        <div className="relative h-full w-full">
            <MapContainer center={CENTER} zoom={12} className="h-full w-full">
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <FitToHospitals hospitals={hospitals} />
                <ResizeWatcher />
                <MapController focus={focus} />
                <MapClickHandler onClick={onMapClick} />

                {coverage && <CoverageLayer bounds={coverageBounds} sources={coverageSources} />}

                {hospitals.map(hospital => (
                    <HospitalMarker
                        key={hospital.id}
                        hospital={hospital}
                        registerRef={registerRef}
                        editable={!!editMode}
                        onMove={onHospitalMove}
                    />
                ))}

                {dispatches.map(dispatch => (
                    <DispatchLayer key={dispatch.id} dispatch={dispatch} serverNow={serverNow} />
                ))}

                {selectedLocation && (
                    <Marker position={[selectedLocation.lat, selectedLocation.lng]} icon={selectionIcon} interactive={false} />
                )}
            </MapContainer>

            {/* Top row: search (passed in), then hint or edit banner */}
            <div className="absolute top-3 left-14 right-3 z-[1000] flex flex-wrap items-start gap-2 pointer-events-none">
                <div className="pointer-events-auto flex-1 min-w-[180px] max-w-sm">{children}</div>
                <div className="pointer-events-auto flex gap-2 ml-auto">
                    <MapButton active={coverage} onClick={() => setCoverage(c => !c)} title="Shade the map by how many minutes away the nearest free ambulance is">
                        Coverage
                    </MapButton>
                    {canEditHospitals && (
                        <MapButton active={editMode} onClick={onToggleEdit} title="Drag hospitals to fix their position, or click the map to add one">
                            {editMode ? 'Done editing' : 'Edit hospitals'}
                        </MapButton>
                    )}
                </div>
            </div>

            {(editMode || hint) && (
                <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[999] pointer-events-none map-chip px-3 py-1.5 whitespace-nowrap max-w-[92%] truncate">
                    {editMode ? 'Drag a hospital to move it · click the map to add one' : hint}
                </div>
            )}

            {coverage && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] map-chip !rounded-lg px-3 py-2 !text-xs max-w-[92%]">
                    <div className="mb-1">Nearest free ambulance</div>
                    <div className="flex items-center gap-2 font-normal">
                        {COVERAGE_BANDS.map(band => (
                            <span key={band.label} className="flex items-center gap-1 whitespace-nowrap">
                                <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: band.color, opacity: 0.7 }} />
                                {band.label}
                            </span>
                        ))}
                    </div>
                    {coverageSources.length === 0 && <div className="mt-1 text-primary">No ambulance is free right now.</div>}
                </div>
            )}

            {canDispatch && !editMode && (
                <button
                    type="button"
                    onClick={onLocate}
                    disabled={locating}
                    className="absolute bottom-6 right-3 z-[1000] map-chip hover:bg-white dark:hover:bg-slate-700 pl-3 pr-4 py-2 shadow-lg flex items-center gap-2 disabled:opacity-60"
                >
                    <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <circle cx="12" cy="12" r="3" />
                        <path strokeLinecap="round" d="M12 2v3m0 14v3M2 12h3m14 0h3" />
                    </svg>
                    {locating ? 'Locating…' : 'Use my location'}
                </button>
            )}
        </div>
    );
};

export default LeafletMap;
