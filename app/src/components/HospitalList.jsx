import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { api, errorMessage } from '../lib/api';
import { availabilityLevel, CAPABILITY_LABEL, UNIT_TYPE, UNIT_STATUS } from '../lib/format';

const MAX_FLEET = 999;

const SORTS = {
    name: { label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
    most: { label: 'Most available', compare: (a, b) => b.ambulancesAvailable - a.ambulancesAvailable },
    least: { label: 'Least available', compare: (a, b) => a.ambulancesAvailable - b.ambulancesAvailable },
};

const LEVEL_STYLE = {
    good: { badge: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300', bar: 'bg-green-500' },
    low: { badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300', bar: 'bg-amber-500' },
    none: { badge: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300', bar: 'bg-red-500' },
};

const STATUS_DOT = {
    available: 'bg-green-500',
    busy: 'bg-primary',
    returning: 'bg-gray-400',
    out_of_service: 'bg-gray-300 dark:bg-slate-600',
};

const HospitalList = ({ hospitals, units, loading, error, onRetry, onHospitalClick, onEditHospital, permissions, notify }) => {
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState('name');

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return hospitals
            .filter(h => !q || h.name.toLowerCase().includes(q))
            .sort(SORTS[sort].compare);
    }, [hospitals, query, sort]);

    const unitsByHospital = useMemo(() => {
        const map = new Map();
        for (const unit of units) {
            if (!map.has(unit.hospitalId)) map.set(unit.hospitalId, []);
            map.get(unit.hospitalId).push(unit);
        }
        for (const list of map.values()) list.sort((a, b) => a.callSign.localeCompare(b.callSign));
        return map;
    }, [units]);

    if (loading && hospitals.length === 0) {
        return (
            <div className="p-4 space-y-3" aria-busy="true" aria-label="Loading hospitals">
                {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="h-[84px] rounded-lg bg-gray-100 dark:bg-slate-800 animate-pulse" />
                ))}
            </div>
        );
    }

    if (error && hospitals.length === 0) {
        return (
            <div className="p-8 text-center">
                <p className="text-sm muted mb-3">{error}</p>
                <button type="button" onClick={onRetry} className="btn">Try again</button>
            </div>
        );
    }

    return (
        <div className="p-4">
            <div className="flex gap-2 mb-3">
                <input
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search hospitals"
                    aria-label="Search hospitals"
                    className="input flex-1 min-w-0"
                />
                <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort hospitals" className="input !w-auto">
                    {Object.entries(SORTS).map(([key, { label }]) => (
                        <option key={key} value={key}>{label}</option>
                    ))}
                </select>
            </div>

            {visible.length === 0 ? (
                <p className="text-sm muted text-center py-8">
                    {hospitals.length === 0 ? 'No hospitals yet. An admin can add one with “Edit hospitals” on the map.' : `No hospitals match “${query}”.`}
                </p>
            ) : (
                <ul className="space-y-3">
                    {visible.map(hospital => (
                        <HospitalCard
                            key={hospital.id}
                            hospital={hospital}
                            units={unitsByHospital.get(hospital.id) || []}
                            canManage={permissions.manageHospital(hospital.id)}
                            onClick={() => onHospitalClick(hospital)}
                            onEdit={() => onEditHospital(hospital)}
                            notify={notify}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
};

const UnitRow = ({ unit, canManage, notify }) => {
    const [busy, setBusy] = useState(false);
    const [crewDraft, setCrewDraft] = useState(null);
    const onCall = unit.status === 'busy' || unit.status === 'returning';

    const run = async (action) => {
        setBusy(true);
        try {
            await action();
        } catch (err) {
            notify(`${unit.callSign}: ${errorMessage(err)}`, 'error');
        } finally {
            setBusy(false);
        }
    };

    const saveCrew = () => {
        const crew = crewDraft.trim();
        setCrewDraft(null);
        if (crew !== (unit.crew || '')) run(() => api.updateUnit(unit.id, { crew }));
    };

    return (
        <li className="flex items-center gap-2 py-1.5 text-sm">
            <span className={clsx("h-2 w-2 rounded-full flex-shrink-0", STATUS_DOT[unit.status])} title={UNIT_STATUS[unit.status]} />
            <span className="font-semibold tabular-nums heading">{unit.callSign}</span>
            {canManage ? (
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => api.updateUnit(unit.id, { type: unit.type === 'ALS' ? 'BLS' : 'ALS' }))}
                    title={`${UNIT_TYPE[unit.type].full}. Click to switch.`}
                    className={clsx("text-[11px] font-bold px-1.5 py-0.5 rounded border", unit.type === 'ALS' ? 'border-primary text-primary' : 'border-gray-300 muted dark:border-slate-600')}
                >
                    {unit.type}
                </button>
            ) : (
                <span className={clsx("text-[11px] font-bold px-1.5 py-0.5 rounded border", unit.type === 'ALS' ? 'border-primary text-primary' : 'border-gray-300 muted dark:border-slate-600')} title={UNIT_TYPE[unit.type].full}>
                    {unit.type}
                </span>
            )}

            {crewDraft !== null ? (
                <input
                    className="input !py-0.5 !px-1.5 flex-1 min-w-0"
                    autoFocus
                    maxLength={80}
                    value={crewDraft}
                    placeholder="Crew names"
                    aria-label={`Crew of ${unit.callSign}`}
                    onChange={e => setCrewDraft(e.target.value)}
                    onBlur={saveCrew}
                    onKeyDown={e => { if (e.key === 'Enter') saveCrew(); if (e.key === 'Escape') setCrewDraft(null); }}
                />
            ) : (
                <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => setCrewDraft(unit.crew || '')}
                    className="flex-1 min-w-0 text-left truncate muted text-xs disabled:cursor-default"
                    title={canManage ? 'Click to edit the crew' : undefined}
                >
                    {unit.crew || (canManage ? 'Add crew…' : UNIT_STATUS[unit.status])}
                </button>
            )}

            {canManage && (
                <>
                    <button
                        type="button"
                        disabled={busy || onCall}
                        onClick={() => run(() => api.updateUnit(unit.id, { inService: unit.status === 'out_of_service' }))}
                        className="text-xs link disabled:opacity-40 disabled:no-underline whitespace-nowrap"
                        title={onCall ? 'On a call right now' : undefined}
                    >
                        {unit.status === 'out_of_service' ? 'Return to service' : onCall ? UNIT_STATUS[unit.status] : 'Take off duty'}
                    </button>
                    <button
                        type="button"
                        disabled={busy || onCall}
                        onClick={() => run(() => api.deleteUnit(unit.id))}
                        className="muted hover:text-primary disabled:opacity-30 px-1"
                        aria-label={`Remove ${unit.callSign}`}
                        title="Remove this ambulance"
                    >
                        ×
                    </button>
                </>
            )}
        </li>
    );
};

const HospitalCard = ({ hospital, units, canManage, onClick, onEdit, notify }) => {
    const [draft, setDraft] = useState(null); // string while typing an exact value, else null
    const [saving, setSaving] = useState(false);
    const [open, setOpen] = useState(false);

    const available = hospital.ambulancesAvailable;
    const style = LEVEL_STYLE[availabilityLevel(available)];
    const inService = hospital.units - hospital.outOfService;

    const run = async (action) => {
        setSaving(true);
        try {
            // New state arrives via the socket broadcast, same as for every other client.
            await action();
        } catch (err) {
            notify(`${hospital.name}: ${errorMessage(err)}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const setCount = (value) => {
        if (!Number.isInteger(value) || value < 0 || value > MAX_FLEET) {
            notify(`Enter a whole number between 0 and ${MAX_FLEET}.`, 'error');
            return;
        }
        setDraft(null);
        if (value !== available) run(() => api.setAmbulances(hospital.id, value));
    };

    const stepButton = "h-7 w-7 rounded-md border border-gray-300 dark:border-slate-600 font-bold leading-none hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-40";
    const badge = clsx("min-w-[2.5rem] px-2 py-1 rounded-full text-sm font-bold tabular-nums text-center", style.badge, saving && "opacity-60");

    return (
        <li className={clsx("card p-3 transition-colors", available === 0 && "!bg-red-50 !border-red-200 dark:!bg-red-950/40 dark:!border-red-900")}>
            <div className="flex justify-between items-start gap-3">
                <button type="button" onClick={onClick} className="text-left min-w-0 group" title="Show on map">
                    <span className="block font-semibold heading group-hover:text-secondary dark:group-hover:text-sky-400 truncate">{hospital.name}</span>
                    <span className="block text-xs muted mt-0.5">
                        {available === 0 ? 'No ambulance at base' : `${available} at base`}
                        {hospital.deployed > 0 && ` · ${hospital.deployed} on call`}
                        {hospital.outOfService > 0 && ` · ${hospital.outOfService} off duty`}
                    </span>
                    <span className="block text-xs muted">
                        {hospital.bedsAvailable === 0 ? <span className="text-primary font-semibold">No beds free</span> : `${hospital.bedsAvailable} beds free`}
                        {hospital.capabilities.map(c => ` · ${CAPABILITY_LABEL[c]}`)}
                    </span>
                </button>

                {canManage ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                        <button type="button" className={stepButton} disabled={saving || available <= 0} onClick={() => setCount(available - 1)} aria-label={`Remove an ambulance from ${hospital.name}`}>−</button>
                        {draft === null ? (
                            <button type="button" onClick={() => setDraft(String(available))} className={badge}
                                title="Click to type an exact number" aria-label={`${available} ambulances at base at ${hospital.name}. Click to edit.`}>
                                {available}
                            </button>
                        ) : (
                            <input
                                type="number" min="0" max={MAX_FLEET} autoFocus value={draft}
                                onChange={e => setDraft(e.target.value)}
                                onBlur={() => setDraft(null)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') setCount(draft.trim() === '' ? NaN : Number(draft));
                                    if (e.key === 'Escape') setDraft(null);
                                }}
                                aria-label={`Ambulances at base at ${hospital.name}`}
                                className="input !w-14 !px-1 !py-0.5 text-center"
                            />
                        )}
                        <button type="button" className={stepButton} disabled={saving || hospital.units >= MAX_FLEET} onClick={() => setCount(available + 1)} aria-label={`Add an ambulance to ${hospital.name}`}>+</button>
                    </div>
                ) : (
                    <span className={clsx(badge, "flex-shrink-0")} title="Ambulances at base">{available}</span>
                )}
            </div>

            {/* Share of this hospital's working fleet that is at base right now */}
            <div className="mt-2.5 h-1.5 rounded-full bg-gray-200 dark:bg-slate-700 overflow-hidden" aria-hidden="true">
                <div className={clsx("h-full rounded-full transition-all duration-500", style.bar)} style={{ width: inService === 0 ? '0%' : `${(available / inService) * 100}%` }} />
            </div>

            <div className="mt-2 flex items-center gap-3 text-xs">
                <button type="button" onClick={() => setOpen(o => !o)} className="link font-semibold" aria-expanded={open}>
                    {open ? 'Hide' : 'Show'} {hospital.units} ambulance{hospital.units === 1 ? '' : 's'}
                </button>
                {canManage && <button type="button" onClick={onEdit} className="link">Edit details</button>}
            </div>

            {open && (
                <div className="mt-2 border-t hairline pt-1">
                    {units.length === 0 ? (
                        <p className="text-xs muted py-2">No ambulances are based here.</p>
                    ) : (
                        <ul className="divide-y divide-gray-100 dark:divide-slate-800">
                            {units.map(unit => <UnitRow key={unit.id} unit={unit} canManage={canManage} notify={notify} />)}
                        </ul>
                    )}
                    {canManage && (
                        <div className="flex gap-2 mt-2">
                            {Object.keys(UNIT_TYPE).map(type => (
                                <button key={type} type="button" className="btn !py-1 !text-xs" disabled={saving}
                                    onClick={() => run(() => api.addUnit({ hospitalId: hospital.id, type }))} title={`Add a ${UNIT_TYPE[type].full.toLowerCase()} unit`}>
                                    + {type} unit
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </li>
    );
};

export default HospitalList;
