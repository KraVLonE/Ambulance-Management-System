import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { tripProgress } from '../lib/geo';
import { SEVERITY, SEVERITY_ORDER, CASE_TYPE, PHASE_LABEL, formatDistance, formatMinutes, formatClock, placeOf } from '../lib/format';

// Re-renders a few times a second so countdowns and progress bars move.
function useServerClock(serverNow, active) {
    const [now, setNow] = useState(0);
    useEffect(() => {
        if (!active) return;
        const update = () => setNow(serverNow());
        const first = setTimeout(update, 0);
        const interval = setInterval(update, 250);
        return () => {
            clearTimeout(first);
            clearInterval(interval);
        };
    }, [serverNow, active]);
    return now;
}

export const SeverityChip = ({ severity }) => {
    const meta = SEVERITY[severity] || SEVERITY.urgent;
    return (
        <span className={clsx("text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border", meta.chip)}>
            {meta.label}
        </span>
    );
};

const bySeverityThenAge = (a, b) =>
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.createdAt - b.createdAt;

function headline(dispatch, progress) {
    switch (progress.phase) {
        case 'en_route': return `Arrives in ${formatMinutes(progress.toPickupS)}`;
        case 'on_scene': return 'On scene with patient';
        case 'transporting': return `At ${dispatch.destHospitalName} in ${formatMinutes(progress.toHospitalS)}`;
        case 'returning': return 'Free, heading back to base';
        default: return PHASE_LABEL[dispatch.status];
    }
}

const TripCard = ({ dispatch, now, position, canDispatch, onFocus, onCancel, onShare }) => {
    const [cancelling, setCancelling] = useState(false);
    const queued = dispatch.status === 'queued';
    const progress = tripProgress(dispatch, now || dispatch.assignedAt || dispatch.createdAt);
    const color = SEVERITY[dispatch.severity]?.color || SEVERITY.urgent.color;
    const returning = progress.phase === 'returning';

    const cancel = async () => {
        setCancelling(true);
        try {
            await onCancel(dispatch);
        } finally {
            setCancelling(false);
        }
    };

    return (
        <li className="card overflow-hidden" style={{ borderLeft: `4px solid ${returning ? '#9ca3af' : color}` }}>
            <button type="button" onClick={() => onFocus(dispatch)} className="w-full text-left p-3 pb-2 hover:bg-gray-50 dark:hover:bg-slate-800" title="Show on map">
                <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                        <SeverityChip severity={dispatch.severity} />
                        {dispatch.caseType !== 'general' && <span className="text-[11px] font-semibold muted uppercase">{CASE_TYPE[dispatch.caseType]?.label}</span>}
                    </span>
                    <span className="text-xs muted">{queued ? `Waiting · #${position}` : PHASE_LABEL[progress.phase]}</span>
                </div>
                <p className="mt-1.5 font-semibold heading tabular-nums">
                    {queued ? 'Waiting for a free ambulance' : headline(dispatch, progress)}
                </p>
                <p className="text-sm truncate">{placeOf(dispatch)}</p>
                <p className="text-xs muted mt-0.5 truncate">
                    {queued
                        ? `Requested ${formatClock(dispatch.createdAt)}${dispatch.destHospitalName ? ` · will go to ${dispatch.destHospitalName}` : ''}`
                        : <>{dispatch.callSign} ({dispatch.unitType}) from {dispatch.hospitalName} · {formatDistance(dispatch.distanceM)}{dispatch.routeSource === 'estimate' && ' · estimated route'}</>}
                </p>
                {!queued && !returning && dispatch.destHospitalName && progress.phase !== 'transporting' && (
                    <p className="text-xs muted truncate">Then to {dispatch.destHospitalName}</p>
                )}
                {dispatch.note && <p className="text-xs muted italic mt-1 truncate">“{dispatch.note}”</p>}
            </button>
            <div className="px-3 pb-3 flex items-center gap-3">
                <div
                    className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-slate-700 overflow-hidden"
                    role="progressbar" aria-valuemin={0} aria-valuemax={100}
                    aria-valuenow={queued ? 0 : Math.round(progress.fraction * 100)}
                    aria-label={PHASE_LABEL[progress.phase] || 'Waiting'}
                >
                    <div
                        className={clsx("h-full rounded-full", (queued || progress.phase === 'on_scene') && "animate-pulse")}
                        style={{ width: queued ? '100%' : `${progress.fraction * 100}%`, backgroundColor: returning ? '#9ca3af' : color, opacity: queued ? 0.35 : 1 }}
                    />
                </div>
                {!returning && (
                    <button type="button" onClick={() => onShare(dispatch)} className="text-xs font-semibold link" title="Copy a public link the caller can use to follow this ambulance">
                        Share
                    </button>
                )}
                {canDispatch && (
                    <button type="button" onClick={cancel} disabled={cancelling} className="text-xs font-semibold muted hover:text-primary disabled:opacity-50">
                        {cancelling ? '…' : returning ? 'Recall now' : 'Cancel'}
                    </button>
                )}
            </div>
        </li>
    );
};

const HistoryRow = ({ dispatch }) => (
    <li className="flex items-start gap-3 py-2 border-b hairline last:border-0">
        <span className="mt-1.5 h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: SEVERITY[dispatch.severity]?.color || '#9ca3af' }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
            <p className="text-sm heading truncate">{placeOf(dispatch)}</p>
            <p className="text-xs muted truncate">
                {formatClock(dispatch.createdAt)}
                {dispatch.callSign && ` · ${dispatch.callSign}`}
                {dispatch.responseS != null && ` · reached in ${formatMinutes(dispatch.responseS)}`}
                {dispatch.destHospitalName && dispatch.status === 'completed' && ` · ${dispatch.destHospitalName}`}
            </p>
        </div>
        <span className={clsx("text-xs font-medium flex-shrink-0", dispatch.status === 'cancelled' ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400')}>
            {PHASE_LABEL[dispatch.status]}
        </span>
    </li>
);

const DispatchPanel = ({ dispatches, history, serverNow, canDispatch, onFocus, onCancel, onShare }) => {
    const now = useServerClock(serverNow, dispatches.length > 0);

    const queued = dispatches.filter(d => d.status === 'queued').sort(bySeverityThenAge);
    const active = dispatches.filter(d => !['queued', 'returning'].includes(d.status)).sort(bySeverityThenAge);
    const returning = dispatches.filter(d => d.status === 'returning').sort((a, b) => a.createdAt - b.createdAt);
    const card = (dispatch, index) => (
        <TripCard key={dispatch.id} dispatch={dispatch} now={now} position={index + 1}
            canDispatch={canDispatch} onFocus={onFocus} onCancel={onCancel} onShare={onShare} />
    );

    return (
        <div className="p-4">
            {queued.length > 0 && (
                <>
                    <h3 className="section-title mb-2 !text-amber-700 dark:!text-amber-400">Waiting for an ambulance ({queued.length})</h3>
                    <ul className="space-y-3 mb-6">{queued.map(card)}</ul>
                </>
            )}

            <h3 className="section-title mb-2">Active ({active.length})</h3>
            {active.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-600 p-6 text-center">
                    <p className="text-sm font-medium heading">All quiet</p>
                    <p className="text-xs muted mt-1">
                        {canDispatch ? 'Click the map or search an address to send an ambulance.' : 'Live trips show up here.'}
                    </p>
                </div>
            ) : (
                <ul className="space-y-3">{active.map(card)}</ul>
            )}

            {returning.length > 0 && (
                <>
                    <h3 className="section-title mt-6 mb-2">Heading back ({returning.length})</h3>
                    <ul className="space-y-3">{returning.map(card)}</ul>
                </>
            )}

            <h3 className="section-title mt-6 mb-1">Recent</h3>
            {history.length === 0 ? (
                <p className="text-sm muted py-2">Finished dispatches will be listed here.</p>
            ) : (
                <ul>{history.map(dispatch => <HistoryRow key={dispatch.id} dispatch={dispatch} />)}</ul>
            )}

            <p className="text-[11px] muted mt-4">
                Trips are played back faster than real time. Times shown are real road estimates.
            </p>
        </div>
    );
};

export default DispatchPanel;
