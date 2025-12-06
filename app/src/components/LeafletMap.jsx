import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import axios from 'axios';

// Fix for default marker icon in React-Leaflet
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

// Custom Icons
const ambulanceIcon = L.icon({
    iconUrl: '/assets/ambulance.png',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
});

const hospitalIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/33/33777.png', // Simple Red Cross
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    className: 'hospital-marker'
});

const locationIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/447/447031.png', // Pin/Target icon
    iconSize: [30, 30],
    iconAnchor: [15, 30],
});

// Chandigarh Coordinates (Approximate Center)
const CENTER = [30.7333, 76.7794];


// Map Click Handler Component
const MapClickHandler = ({ onClick }) => {
    useMapEvents({
        click(e) {
            if (onClick) onClick(e.latlng);
        },
    });
    return null;
};

// Component to handle map interactions like flying to a location
const MapController = ({ focusedLocation }) => {
    const map = useMap();

    useEffect(() => {
        if (focusedLocation) {
            map.flyTo(focusedLocation, 15, {
                duration: 1.5
            });
        }
    }, [focusedLocation, map]);

    return null;
};

// Ambulance Marker Component that handles its own animation
const AmbulanceMarker = ({ path, onComplete }) => {
    const [pos, setPos] = useState(path && path.length > 0 ? path[0] : null);

    useEffect(() => {
        if (!path || path.length === 0) return;

        let isMounted = true;

        const animate = async () => {
            // Start
            if (isMounted) setPos(path[0]);

            const totalDuration = 2000; // 2 seconds total per dispatch
            const stepDuration = totalDuration / path.length;

            for (let i = 0; i < path.length; i++) {
                if (!isMounted) return;
                setPos(path[i]);
                await new Promise(r => setTimeout(r, Math.max(20, stepDuration)));
            }

            // Wait a bit at destination then complete
            await new Promise(r => setTimeout(r, 1000));
            if (isMounted && onComplete) onComplete();
        };

        animate();

        return () => { isMounted = false; };
    }, [path]);

    if (!pos) return null;

    return <Marker position={pos} icon={ambulanceIcon} zIndexOffset={1000} />;
};



const LeafletMap = ({ activeDispatches, focusedHospital, onMapClick }) => {
    const [hospitals, setHospitals] = useState([]);
    const markerRefs = useRef({});

    // Fetch hospitals for markers and update node locations
    useEffect(() => {
        const fetchHospitals = async () => {
            try {
                const res = await axios.get('/api/hospitals');
                const hospitalData = res.data.data;
                setHospitals(hospitalData);
            } catch (err) {
                console.error("Failed to fetch hospitals for map", err);
            }
        };
        fetchHospitals();
    }, []);

    // Handle opening popup when focusedHospital changes
    useEffect(() => {
        if (focusedHospital && markerRefs.current[focusedHospital.id]) {
            const marker = markerRefs.current[focusedHospital.id];
            marker.openPopup();
        }
    }, [focusedHospital]);

    return (
        <MapContainer center={CENTER} zoom={12} style={{ height: '100%', width: '100%', borderRadius: '0.75rem' }}>
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapController focusedHospital={focusedHospital} />
            <MapClickHandler onClick={onMapClick} />

            {/* Render Nodes (Memoized) */}

            {/* Render Hospitals */}
            {hospitals.map(hospital => (
                hospital.lat && hospital.lng ? (
                    <Marker
                        key={hospital.id}
                        position={[hospital.lat, hospital.lng]}
                        icon={hospitalIcon}
                        ref={el => markerRefs.current[hospital.id] = el}
                    >
                        <Popup>
                            <div className="min-w-[150px]">
                                <h3 className="font-bold text-red-600">{hospital.name}</h3>
                                <p className="text-sm my-1">Ambulances: <strong>{hospital.ambulancesAvailable}</strong></p>
                                <p className="text-xs text-gray-500">Node ID: {hospital.id}</p>
                            </div>
                        </Popup>
                    </Marker>
                ) : null
            ))}

            {/* Render Concurrent Dispatches */}
            {activeDispatches && activeDispatches.map(dispatch => (
                <React.Fragment key={dispatch.id}>
                    {/* Path Line */}
                    {dispatch.path && dispatch.path.length > 1 && (
                        <Polyline
                            positions={dispatch.path}
                            pathOptions={{ color: '#e63946', weight: 4, dashArray: '10, 10', opacity: 0.8 }}
                        />
                    )}
                    {/* Animated Ambulance */}
                    <AmbulanceMarker
                        path={dispatch.path}
                        onComplete={() => dispatch.onComplete && dispatch.onComplete(dispatch.id)}
                    />
                </React.Fragment>
            ))}
        </MapContainer>
    );
};

export default LeafletMap;
