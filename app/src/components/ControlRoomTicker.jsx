import { useEffect, useState } from 'react';
import { tripProgress } from '../lib/geo';
import { SEVERITY, SEVERITY_ORDER, PHASE_LABEL, formatMinutes, placeOf } from '../lib/format';

const MAX_ROWS = 7;

function status(dispatch, progress) {
    if (dispatch.status === 'queued') return 'WAITING';
    if (progress.phase === 'en_route') return formatMinutes(progress.toPickupS);
    if (progress.phase === 'transporting') return `→ hospital ${formatMinutes(progress.toHospitalS)}`;
    return PHASE_LABEL[progress.phase];
}

// Large-type list of live calls for the wall display, laid over the map.
const ControlRoomTicker = ({ dispatches, serverNow }) => {
    const [now, setNow] = useState(0);
    useEffect(() => {
        const update = () => setNow(serverNow());
        const first = setTimeout(update, 0);
        const interval = setInterval(update, 500);
        return () => {
            clearTimeout(first);
            clearInterval(interval);
        };
    }, [serverNow]);

    const rows = dispatches
        .filter(d => d.status !== 'returning')
        .sort((a, b) =>
            (a.status === 'queued' ? 0 : 1) - (b.status === 'queued' ? 0 : 1) ||
            SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
            a.createdAt - b.createdAt);

    return (
        <div className="absolute top-16 right-3 z-[1000] w-[26rem] max-w-[calc(100%-1.5rem)] pointer-events-none">
            {rows.length === 0 ? (
                <div className="map-chip !rounded-xl px-5 py-4 !text-lg text-center">No active calls</div>
            ) : (
                <ul className="space-y-2">
                    {rows.slice(0, MAX_ROWS).map(dispatch => {
                        const progress = tripProgress(dispatch, now || dispatch.createdAt);
                        const color = SEVERITY[dispatch.severity]?.color;
                        return (
                            <li key={dispatch.id} className="map-chip !rounded-xl px-4 py-2.5 flex items-center gap-3" style={{ borderLeft: `6px solid ${color}` }}>
                                <div className="min-w-0 flex-1">
                                    <div className="text-base font-bold truncate">{placeOf(dispatch)}</div>
                                    <div className="text-xs font-normal opacity-70 truncate">
                                        {SEVERITY[dispatch.severity]?.label}
                                        {dispatch.callSign ? ` · ${dispatch.callSign} from ${dispatch.hospitalName}` : ' · no ambulance free'}
                                    </div>
                                </div>
                                <div className={`text-lg font-bold tabular-nums whitespace-nowrap ${dispatch.status === 'queued' ? 'text-primary animate-pulse' : ''}`}>
                                    {status(dispatch, progress)}
                                </div>
                            </li>
                        );
                    })}
                    {rows.length > MAX_ROWS && <li className="map-chip !rounded-xl px-4 py-1.5 text-center">+{rows.length - MAX_ROWS} more</li>}
                </ul>
            )}
        </div>
    );
};

export default ControlRoomTicker;
