import { useState } from 'react';
import Modal from './Modal';
import { api, errorMessage } from '../lib/api';
import { CAPABILITY_LABEL, formatCoords } from '../lib/format';

/**
 * Create or edit a hospital.
 *   target = { hospital }            edit an existing one
 *   target = { coords: {lat, lng} }  add a new one at that spot
 * `isAdmin` unlocks renaming and deleting; a hospital's own admin can change
 * beds and capabilities only.
 */
const Form = ({ target, isAdmin, notify, onClose }) => {
    const existing = target.hospital;
    const [name, setName] = useState(existing?.name ?? '');
    const [beds, setBeds] = useState(String(existing?.bedsAvailable ?? 20));
    const [capabilities, setCapabilities] = useState(existing?.capabilities ?? []);
    const [busy, setBusy] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [error, setError] = useState(null);

    const toggle = (capability) => setCapabilities(prev =>
        prev.includes(capability) ? prev.filter(c => c !== capability) : [...prev, capability]);

    const run = async (action, done) => {
        setBusy(true);
        setError(null);
        try {
            await action();
            notify(done, 'success');
            onClose();
        } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
        }
    };

    const submit = (e) => {
        e.preventDefault();
        const bedsAvailable = Number(beds);
        if (!Number.isInteger(bedsAvailable) || bedsAvailable < 0 || beds.trim() === '') {
            setError('Beds must be a whole number, 0 or more.');
            return;
        }
        if (existing) {
            const changes = { bedsAvailable, capabilities };
            if (isAdmin) changes.name = name;
            run(() => api.updateHospital(existing.id, changes), `${name} updated`);
        } else {
            run(() => api.createHospital({ name, ...target.coords, bedsAvailable, capabilities }), `${name} added. Add ambulances from the Hospitals tab.`);
        }
    };

    return (
        <form onSubmit={submit}>
            <h3 id="hospital-form-title" className="text-lg font-semibold heading">{existing ? 'Edit hospital' : 'Add a hospital here'}</h3>
            <p className="text-xs muted tabular-nums mt-0.5">
                {formatCoords(existing?.lat ?? target.coords.lat, existing?.lng ?? target.coords.lng)}
                {existing && isAdmin && ' · to move it, use “Edit hospitals” on the map and drag the marker'}
            </p>

            <label className="block mt-4">
                <span className="section-title">Name</span>
                <input className="input mt-1 !py-2" value={name} onChange={e => setName(e.target.value)} maxLength={80} required disabled={!isAdmin} autoFocus={!existing} />
            </label>

            <label className="block mt-4">
                <span className="section-title">Free beds</span>
                <input className="input mt-1 !py-2 !w-28" type="number" min="0" max="9999" value={beds} onChange={e => setBeds(e.target.value)} required />
                <span className="block text-xs muted mt-1">Goes down by one each time a patient is delivered. Patients are sent elsewhere when it reaches zero.</span>
            </label>

            <fieldset className="mt-4">
                <legend className="section-title mb-1">Specialist care</legend>
                <div className="flex gap-4">
                    {Object.entries(CAPABILITY_LABEL).map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input type="checkbox" className="h-4 w-4 accent-secondary" checked={capabilities.includes(key)} onChange={() => toggle(key)} />
                            {label}
                        </label>
                    ))}
                </div>
            </fieldset>

            {error && <p className="mt-4 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}

            <div className="mt-6 flex items-center gap-3">
                {existing && isAdmin && (
                    confirmDelete ? (
                        <button type="button" className="btn !border-primary !text-primary" disabled={busy}
                            onClick={() => run(() => api.deleteHospital(existing.id), `${existing.name} deleted`)}>
                            Yes, delete it and its ambulances
                        </button>
                    ) : (
                        <button type="button" className="text-sm muted hover:text-primary" onClick={() => setConfirmDelete(true)}>Delete…</button>
                    )
                )}
                <span className="flex-1" />
                <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save' : 'Add hospital'}</button>
            </div>
        </form>
    );
};

const HospitalForm = ({ target, isAdmin, notify, onClose }) => (
    <Modal open={!!target} onClose={onClose} labelledBy="hospital-form-title">
        {target && <Form key={target.hospital?.id ?? `${target.coords.lat},${target.coords.lng}`} target={target} isAdmin={isAdmin} notify={notify} onClose={onClose} />}
    </Modal>
);

export default HospitalForm;
