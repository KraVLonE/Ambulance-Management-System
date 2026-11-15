import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import Modal from './Modal';
import { api } from '../lib/api';
import { distanceM } from '../lib/geo';
import { SEVERITY, SEVERITY_ORDER, CASE_TYPE, CASE_TYPE_ORDER, formatCoords, formatDistance } from '../lib/format';

const SERVICE_RADIUS_M = 40000; // mirrors the server's limit; the server is the authority

const Choice = ({ name, value, selected, onSelect, label, hint, color }) => (
    <label
        className={clsx(
            "cursor-pointer rounded-lg border-2 px-2 py-2 text-center transition-colors focus-within:ring-2 focus-within:ring-offset-1 focus-within:ring-secondary dark:focus-within:ring-offset-slate-900",
            selected ? "bg-gray-50 dark:bg-slate-800" : "border-gray-200 hover:border-gray-300 dark:border-slate-700 dark:hover:border-slate-500",
            selected && !color && "border-secondary"
        )}
        style={selected && color ? { borderColor: color } : undefined}
    >
        <input type="radio" name={name} value={value} checked={selected} onChange={() => onSelect(value)} className="sr-only" />
        <span className="block text-sm font-semibold" style={{ color: selected ? color : undefined }}>{label}</span>
        <span className="block text-[11px] muted">{hint}</span>
    </label>
);

const RequestForm = ({ location, hospitals, units, loading, onClose, onConfirm }) => {
    const [severity, setSeverity] = useState('urgent');
    const [caseType, setCaseType] = useState('general');
    const [note, setNote] = useState('');
    const [address, setAddress] = useState(location.label ?? undefined); // undefined = looking up, null = unknown
    const [manual, setManual] = useState(false);
    const [ambulanceId, setAmbulanceId] = useState('');
    const [destHospitalId, setDestHospitalId] = useState('');
    const confirmRef = useRef(null);

    useEffect(() => {
        if (location.label) return; // came from search: already has a name
        const controller = new AbortController();
        api.reverseGeocode(location.lat, location.lng, controller.signal)
            .then(result => setAddress(result))
            .catch(() => { if (!controller.signal.aborted) setAddress(null); });
        return () => controller.abort();
    }, [location]);

    useEffect(() => { confirmRef.current?.focus(); }, []);

    const here = useMemo(() => [location.lat, location.lng], [location]);
    const hospitalById = useMemo(() => new Map(hospitals.map(h => [h.id, h])), [hospitals]);

    // Free units, nearest first, for the preview line and the manual picker.
    // The server makes the real choice using road travel time.
    const freeUnits = useMemo(() => units
        .filter(u => u.status === 'available' || u.status === 'returning')
        .map(u => ({ ...u, base: hospitalById.get(u.hospitalId) }))
        .filter(u => u.base)
        .map(u => ({ ...u, away: distanceM(here, [u.base.lat, u.base.lng]) }))
        // Same distance (same hospital): list basic units first, as the server
        // keeps advanced units back for critical calls.
        .sort((a, b) => a.away - b.away || a.type.localeCompare(b.type) * -1 || a.callSign.localeCompare(b.callSign)), [units, hospitalById, here]);

    const nearestHospital = useMemo(() => hospitals
        .map(h => ({ ...h, away: distanceM(here, [h.lat, h.lng]) }))
        .sort((a, b) => a.away - b.away)[0], [hospitals, here]);

    const outOfArea = nearestHospital && nearestHospital.away > SERVICE_RADIUS_M;
    const noneFree = freeUnits.length === 0;
    const nearestFree = freeUnits[0];
    const alsFree = freeUnits.find(u => u.type === 'ALS');

    const submit = (e) => {
        e.preventDefault();
        if (outOfArea || loading) return;
        onConfirm({
            severity,
            caseType,
            note: note.trim(),
            address: address || undefined,
            ambulanceId: manual && ambulanceId ? ambulanceId : undefined,
            destHospitalId: manual && destHospitalId ? Number(destHospitalId) : undefined,
        });
    };

    let preview;
    if (outOfArea) preview = `This spot is ${formatDistance(nearestHospital.away)} from the nearest hospital, outside the service area.`;
    else if (noneFree) preview = 'Every ambulance is busy. The request will be queued and served as soon as one is free, most serious first.';
    else if (severity === 'critical' && alsFree) preview = <>An advanced life support unit will be sent. Closest: <strong>{alsFree.callSign}</strong> at {alsFree.base.name}, about {formatDistance(alsFree.away)} away.</>;
    else preview = <>Closest free unit: <strong>{nearestFree.callSign}</strong> at {nearestFree.base.name}, about {formatDistance(nearestFree.away)} away. The fastest by road will be sent.</>;

    return (
        <form onSubmit={submit}>
            <div className="flex items-start gap-3">
                <div className="flex-shrink-0 flex items-center justify-center h-11 w-11 rounded-full bg-red-100 dark:bg-red-950">
                    <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 21s-7-5.686-7-11a7 7 0 1114 0c0 5.314-7 11-7 11z" />
                        <circle cx="12" cy="10" r="2.5" strokeWidth="2" />
                    </svg>
                </div>
                <div className="min-w-0">
                    <h3 id="request-title" className="text-lg font-semibold heading">Send an ambulance here?</h3>
                    <p className="text-sm mt-0.5 break-words">
                        {address === undefined ? <span className="muted">Looking up address…</span> : address || 'Selected map location'}
                    </p>
                    <p className="text-xs muted tabular-nums">{formatCoords(location.lat, location.lng)}</p>
                </div>
            </div>

            <fieldset className="mt-5">
                <legend className="section-title mb-2">How serious is it?</legend>
                <div className="grid grid-cols-3 gap-2">
                    {SEVERITY_ORDER.map(key => (
                        <Choice key={key} name="severity" value={key} selected={severity === key} onSelect={setSeverity}
                            label={SEVERITY[key].label} hint={SEVERITY[key].hint} color={SEVERITY[key].color} />
                    ))}
                </div>
            </fieldset>

            <fieldset className="mt-4">
                <legend className="section-title mb-2">What kind of case?</legend>
                <div className="grid grid-cols-3 gap-2">
                    {CASE_TYPE_ORDER.map(key => (
                        <Choice key={key} name="caseType" value={key} selected={caseType === key} onSelect={setCaseType}
                            label={CASE_TYPE[key].label} hint={CASE_TYPE[key].hint} />
                    ))}
                </div>
            </fieldset>

            <label className="block mt-4">
                <span className="section-title">Note for the crew <span className="font-normal normal-case">(optional)</span></span>
                <input
                    type="text"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    maxLength={200}
                    placeholder="e.g. chest pain, 2nd floor, gate code 4411"
                    className="input mt-1 !py-2"
                />
            </label>

            <div className="mt-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={manual} onChange={e => setManual(e.target.checked)} className="h-4 w-4 accent-secondary" />
                    Choose the ambulance or hospital myself
                </label>
                {manual && (
                    <div className="grid sm:grid-cols-2 gap-3 mt-2">
                        <label className="block">
                            <span className="text-xs muted">Ambulance</span>
                            <select value={ambulanceId} onChange={e => setAmbulanceId(e.target.value)} className="input mt-0.5">
                                <option value="">Automatic (fastest)</option>
                                {freeUnits.map(u => (
                                    <option key={u.id} value={u.id}>
                                        {u.callSign} · {u.type} · {formatDistance(u.away)}{u.status === 'returning' ? ' · heading back' : ''}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="block">
                            <span className="text-xs muted">Take patient to</span>
                            <select value={destHospitalId} onChange={e => setDestHospitalId(e.target.value)} className="input mt-0.5">
                                <option value="">Automatic (nearest suitable)</option>
                                {[...hospitals].sort((a, b) => a.name.localeCompare(b.name)).map(h => (
                                    <option key={h.id} value={h.id}>{h.name} · {h.bedsAvailable} beds</option>
                                ))}
                            </select>
                        </label>
                    </div>
                )}
            </div>

            <p className={clsx(
                "mt-4 text-sm rounded-md px-3 py-2",
                outOfArea ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"
                    : noneFree ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                        : "bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-300"
            )}>
                {preview}
            </p>

            <div className="mt-5 flex gap-3">
                <button type="button" className="btn flex-1 !py-2" onClick={onClose} disabled={loading}>Cancel</button>
                <button ref={confirmRef} type="submit" className="btn-primary flex-1 !py-2" disabled={loading || outOfArea}>
                    {loading ? 'Dispatching…' : noneFree ? 'Add to queue' : 'Dispatch ambulance'}
                </button>
            </div>
        </form>
    );
};

const RequestModal = ({ location, hospitals, units, loading, onClose, onConfirm }) => (
    <Modal open={!!location} onClose={onClose} labelledBy="request-title" locked={loading}>
        {location && (
            // Keyed by location so a new pin starts with a fresh form
            <RequestForm
                key={`${location.lat},${location.lng}`}
                location={location}
                hospitals={hospitals}
                units={units}
                loading={loading}
                onClose={onClose}
                onConfirm={onConfirm}
            />
        )}
    </Modal>
);

export default RequestModal;
