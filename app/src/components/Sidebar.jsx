import React, { useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext';
import axios from 'axios';
import clsx from 'clsx';

const Sidebar = ({ onHospitalClick }) => {
    const [hospitals, setHospitals] = useState([]);
    const [loading, setLoading] = useState(true);
    const socket = useSocket();

    const fetchHospitals = async () => {
        try {
            const res = await axios.get('/api/hospitals');
            setHospitals(res.data.data);
            setLoading(false);
        } catch (err) {
            console.error("Failed to fetch hospitals", err);
        }
    };

    useEffect(() => {
        fetchHospitals();
    }, []);

    useEffect(() => {
        if (!socket) return;

        socket.on('ambulance_update', (data) => {
            setHospitals(prev => prev.map(h =>
                h.id === data.hospitalId
                    ? { ...h, ambulancesAvailable: data.ambulancesAvailable }
                    : h
            ));
        });

        return () => {
            socket.off('ambulance_update');
        };
    }, [socket]);

    return (
        <div className="w-full lg:w-96 bg-white shadow-xl h-full overflow-y-auto border-l border-gray-200 flex flex-col z-20">
            <div className="p-6 bg-secondary text-white sticky top-0 z-10 shadow-md">
                <h2 className="text-2xl font-bold">Dashboard</h2>
                <p className="text-blue-100 text-sm">Real-time Ambulance Status</p>
            </div>
            <div className="flex-1 p-4">
                {loading ? (
                    <div className="flex justify-center p-10">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {hospitals.map((hospital) => (
                            <HospitalCard
                                key={hospital.id}
                                hospital={hospital}
                                onClick={() => onHospitalClick(hospital)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

const HospitalCard = ({ hospital, onClick }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(hospital.ambulancesAvailable);
    const [saving, setSaving] = useState(false);

    const handleSave = async (e) => {
        e.stopPropagation();
        setSaving(true);
        try {
            await axios.put(`/api/hospitals/${hospital.id}`, {
                ambulancesAvailable: parseInt(editValue)
            });
            setIsEditing(false);
        } catch (err) {
            alert("Failed to update");
            console.error(err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            onClick={onClick}
            className={clsx(
                "p-4 rounded-lg border transition-all duration-300 relative group",
                hospital.ambulancesAvailable > 0
                    ? "bg-white border-gray-200 hover:shadow-md hover:border-blue-300"
                    : "bg-red-50 border-red-200"
            )}
        >
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="font-semibold text-gray-800">{hospital.name}</h3>
                    <p className="text-xs text-gray-500 mt-1">Node ID: {hospital.id}</p>
                </div>

                {isEditing ? (
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <input
                            type="number"
                            className="w-12 border rounded px-1 py-0.5 text-sm"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            min="0"
                        />
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="bg-green-500 text-white px-2 py-0.5 rounded text-xs"
                        >
                            {saving ? '...' : '✓'}
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsEditing(false); }}
                            className="bg-gray-300 text-gray-700 px-2 py-0.5 rounded text-xs"
                        >
                            ✕
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col items-end gap-1">
                        <div className={clsx(
                            "px-3 py-1 rounded-full text-sm font-bold",
                            hospital.ambulancesAvailable > 5 ? "bg-green-100 text-green-700" :
                                hospital.ambulancesAvailable > 0 ? "bg-yellow-100 text-yellow-700" :
                                    "bg-red-100 text-red-700"
                        )}>
                            {hospital.ambulancesAvailable}
                        </div>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsEditing(true);
                                setEditValue(hospital.ambulancesAvailable);
                            }}
                            className="text-xs text-blue-500 hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            Edit
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Sidebar;
