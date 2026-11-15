import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { api, errorMessage } from '../lib/api';
import { SEVERITY } from '../lib/format';

const RANGES = [{ days: 1, label: 'Today + yesterday' }, { days: 7, label: '7 days' }, { days: 30, label: '30 days' }, { days: 90, label: '90 days' }];

// Chart colours by role, light and dark (see .viz-root in this file's <style>).
// One blue hue throughout: every chart here shows a single measure.
const HEAT_RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#104281'];

const hourLabel = (hour) => `${String(hour).padStart(2, '0')}:00`;

const StatTile = ({ label, value, sub }) => (
    <div className="card p-3 sm:p-4">
        <div className="text-xs muted">{label}</div>
        <div className="text-2xl font-bold heading tabular-nums mt-1">{value}</div>
        {sub && <div className="text-xs muted mt-0.5">{sub}</div>}
    </div>
);

/**
 * Column chart for one measure across the 24 hours of the day.
 * Thin columns from a single baseline, hairline grid, hover/focus tooltip.
 */
const HourChart = ({ data, valueOf, format, unit, emptyText }) => {
    const [hover, setHover] = useState(null);
    const values = data.map(valueOf);
    const max = Math.max(0, ...values.filter(v => v != null));

    const W = 720, H = 220, left = 34, right = 8, top = 12, bottom = 26;
    const plotW = W - left - right;
    const plotH = H - top - bottom;
    const band = plotW / 24;
    const barW = Math.min(18, band - 4);

    // A round number just above the largest value, so gridlines land on clean ticks.
    const niceMax = useMemo(() => {
        if (max <= 0) return 1;
        const magnitude = 10 ** Math.floor(Math.log10(max));
        return [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(m => m >= max) || max;
    }, [max]);
    const ticks = [0, 0.5, 1].map(f => f * niceMax);
    const y = (v) => top + plotH - (v / niceMax) * plotH;

    if (max <= 0) return <p className="text-sm muted py-10 text-center">{emptyText}</p>;

    const active = hover != null ? data[hover] : null;
    return (
        <div className="relative">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${unit} by hour of day`}>
                {ticks.map(t => (
                    <g key={t}>
                        <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} style={{ stroke: t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)' }} strokeWidth="1" />
                        <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" style={{ fill: 'var(--viz-muted)' }}>{format(t)}</text>
                    </g>
                ))}
                {data.map((d, i) => {
                    const v = values[i];
                    const x = left + i * band + (band - barW) / 2;
                    const h = v == null ? 0 : Math.max(v > 0 ? 2 : 0, (v / niceMax) * plotH);
                    const r = Math.min(4, h);
                    return (
                        <g key={d.hour}>
                            {h > 0 && (
                                // Rounded at the data end, square on the baseline.
                                <path
                                    d={`M${x},${top + plotH} v${-(h - r)} q0,${-r} ${r},${-r} h${barW - 2 * r} q${r},0 ${r},${r} v${h - r} z`}
                                    style={{ fill: 'var(--viz-series)', opacity: hover == null || hover === i ? 1 : 0.45 }}
                                />
                            )}
                            {/* Full-height hit area: easier to hover than a short bar */}
                            <rect
                                x={left + i * band} y={top} width={band} height={plotH} fill="transparent" tabIndex={0}
                                aria-label={`${hourLabel(d.hour)}: ${v == null ? 'no data' : `${format(v)} ${unit}`}`}
                                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                                onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                            />
                            {i % 3 === 0 && (
                                <text x={left + i * band + band / 2} y={H - 8} textAnchor="middle" fontSize="11" style={{ fill: 'var(--viz-muted)' }}>{hourLabel(d.hour)}</text>
                            )}
                        </g>
                    );
                })}
            </svg>
            {active && (
                <div
                    className="absolute -translate-x-1/2 pointer-events-none card shadow-lg px-2.5 py-1.5 text-xs whitespace-nowrap z-10"
                    style={{ left: `${((left + hover * band + band / 2) / W) * 100}%`, top: 0 }}
                >
                    <div className="muted">{hourLabel(active.hour)} – {hourLabel((active.hour + 1) % 24)}</div>
                    <div className="font-semibold heading">{values[hover] == null ? 'No data' : `${format(values[hover])} ${unit}`}</div>
                </div>
            )}
        </div>
    );
};

// Ranked horizontal bars, one row per hospital, largest first.
const RankedBars = ({ rows }) => {
    const max = Math.max(1, ...rows.map(r => r.count));
    return (
        <table className="w-full text-sm">
            <thead>
                <tr className="text-xs muted text-left">
                    <th className="font-normal pb-2">Hospital (ambulance base)</th>
                    <th className="font-normal pb-2 w-[38%]">Calls</th>
                    <th className="font-normal pb-2 text-right whitespace-nowrap">Avg response</th>
                </tr>
            </thead>
            <tbody>
                {rows.map(row => (
                    <tr key={row.hospitalName} className="border-t hairline">
                        <td className="py-2 pr-3 heading truncate max-w-[12rem]">{row.hospitalName}</td>
                        <td className="py-2">
                            <div className="flex items-center gap-2">
                                <div className="h-3 rounded-r" style={{ width: `${(row.count / max) * 100}%`, minWidth: 2, backgroundColor: 'var(--viz-series)' }} />
                                <span className="tabular-nums heading">{row.count}</span>
                            </div>
                        </td>
                        <td className="py-2 text-right tabular-nums muted">{row.avgResponseMinutes == null ? '–' : `${row.avgResponseMinutes} min`}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
};

// Bins call locations into a grid and shades each cell by how many calls it had.
const HeatLayer = ({ points }) => {
    const map = useMap();
    useEffect(() => {
        if (points.length === 0) return;
        const lats = points.map(p => p.lat);
        const lngs = points.map(p => p.lng);
        const south = Math.min(...lats), north = Math.max(...lats);
        const west = Math.min(...lngs), east = Math.max(...lngs);
        // ~600 m cells; a single point still gets one visible cell.
        const step = 0.006;
        const cells = new Map();
        for (const p of points) {
            const row = Math.floor((p.lat - south) / step);
            const col = Math.floor((p.lng - west) / step);
            const key = `${row}:${col}`;
            cells.set(key, { row, col, count: (cells.get(key)?.count || 0) + 1 });
        }
        const max = Math.max(...[...cells.values()].map(c => c.count));
        const group = L.layerGroup();
        for (const { row, col, count } of cells.values()) {
            const shade = HEAT_RAMP[Math.min(HEAT_RAMP.length - 1, Math.floor(((count - 1) / Math.max(1, max - 1)) * (HEAT_RAMP.length - 1)))];
            L.rectangle(
                [[south + row * step, west + col * step], [south + (row + 1) * step, west + (col + 1) * step]],
                { stroke: true, color: '#ffffff', weight: 1, fillColor: max === 1 ? HEAT_RAMP[3] : shade, fillOpacity: 0.8 }
            ).bindTooltip(`${count} call${count === 1 ? '' : 's'}`).addTo(group);
        }
        group.addTo(map);
        map.fitBounds([[south - step, west - step], [north + step, east + step]], { maxZoom: 14 });
        return () => { group.remove(); };
    }, [map, points]);
    return null;
};

const AnalyticsPage = ({ notify }) => {
    const [days, setDays] = useState(7);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const requestId = useRef(0);

    useEffect(() => {
        const id = ++requestId.current;
        api.analytics(days)
            .then(result => { if (id === requestId.current) { setData(result); setError(null); } })
            .catch(err => { if (id === requestId.current) setError(errorMessage(err)); });
    }, [days]);

    const stale = data && data.days !== days;
    const maxHeat = useMemo(() => {
        if (!data) return 0;
        const cells = new Map();
        for (const p of data.points) {
            const key = `${Math.floor(p.lat / 0.006)}:${Math.floor(p.lng / 0.006)}`;
            cells.set(key, (cells.get(key) || 0) + 1);
        }
        return Math.max(0, ...cells.values());
    }, [data]);

    return (
        <div className="viz-root h-full overflow-y-auto">
            <div className="max-w-6xl mx-auto p-4 sm:p-6">
                {/* Filters in one row above everything they affect */}
                <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-xl font-bold heading mr-auto">Analytics</h2>
                    <div className="flex rounded-md border border-gray-300 dark:border-slate-600 overflow-hidden" role="group" aria-label="Time range">
                        {RANGES.map(range => (
                            <button
                                key={range.days} type="button" onClick={() => setDays(range.days)} aria-pressed={days === range.days}
                                className={`px-3 py-1.5 text-sm font-medium ${days === range.days ? 'bg-secondary text-white' : 'surface hover:bg-gray-50 dark:hover:bg-slate-800'}`}
                            >
                                {range.label}
                            </button>
                        ))}
                    </div>
                    <a href={api.exportUrl(days)} className="btn" download onClick={() => notify('Preparing the CSV download…', 'info')}>
                        Export CSV
                    </a>
                </div>

                {error && !data ? (
                    <div className="card p-8 text-center mt-6">
                        <p className="text-sm muted">{error}</p>
                    </div>
                ) : !data ? (
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-6" aria-busy="true">
                        {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-20 rounded-lg bg-gray-100 dark:bg-slate-800 animate-pulse" />)}
                    </div>
                ) : (
                    <div className={stale ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-6">
                            <StatTile label="Calls" value={data.totals.total} />
                            <StatTile label="Completed" value={data.totals.completed} />
                            <StatTile label="Cancelled" value={data.totals.cancelled}
                                sub={data.totals.total ? `${Math.round((data.totals.cancelled / data.totals.total) * 100)}% of calls` : undefined} />
                            <StatTile label="Average response" value={data.totals.avgResponseMinutes == null ? '–' : `${data.totals.avgResponseMinutes} min`} sub="request to arrival" />
                            <StatTile label="9 in 10 reached within" value={data.totals.p90ResponseMinutes == null ? '–' : `${data.totals.p90ResponseMinutes} min`} />
                        </div>

                        {data.totals.total === 0 ? (
                            <div className="card p-10 text-center mt-6">
                                <p className="font-medium heading">No calls in this period</p>
                                <p className="text-sm muted mt-1">Dispatch an ambulance from the Live view and the numbers will appear here.</p>
                            </div>
                        ) : (
                            <>
                                <div className="grid lg:grid-cols-2 gap-4 mt-4">
                                    <section className="card p-4">
                                        <h3 className="font-semibold heading">Calls by hour of day</h3>
                                        <p className="text-xs muted mb-2">When requests come in, in your local time</p>
                                        <HourChart data={data.byHour} valueOf={d => d.count} format={v => (Number.isInteger(v) ? String(v) : v.toFixed(1))} unit="calls" emptyText="No calls yet." />
                                    </section>
                                    <section className="card p-4">
                                        <h3 className="font-semibold heading">Average response time by hour</h3>
                                        <p className="text-xs muted mb-2">Minutes from request to arrival, including time spent queued</p>
                                        <HourChart data={data.byHour} valueOf={d => d.avgResponseMinutes} format={v => (Number.isInteger(v) ? String(v) : v.toFixed(1))} unit="min" emptyText="No ambulance has reached a patient yet in this period." />
                                    </section>
                                </div>

                                <div className="grid lg:grid-cols-2 gap-4 mt-4">
                                    <section className="card p-4">
                                        <h3 className="font-semibold heading mb-3">Busiest hospitals</h3>
                                        {data.byHospital.length === 0
                                            ? <p className="text-sm muted">No ambulance has been assigned yet in this period.</p>
                                            : <RankedBars rows={data.byHospital} />}

                                        <h3 className="font-semibold heading mt-6 mb-2">By severity</h3>
                                        <table className="w-full text-sm">
                                            <tbody>
                                                {data.bySeverity.map(row => (
                                                    <tr key={row.severity} className="border-t hairline">
                                                        <td className="py-2">
                                                            <span className="inline-block h-2.5 w-2.5 rounded-full mr-2" style={{ backgroundColor: SEVERITY[row.severity].color }} aria-hidden="true" />
                                                            {SEVERITY[row.severity].label}
                                                        </td>
                                                        <td className="py-2 text-right tabular-nums heading">{row.count} call{row.count === 1 ? '' : 's'}</td>
                                                        <td className="py-2 text-right tabular-nums muted w-32">{row.avgResponseMinutes == null ? '–' : `${row.avgResponseMinutes} min avg`}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </section>

                                    <section className="card p-4 flex flex-col">
                                        <h3 className="font-semibold heading">Where calls come from</h3>
                                        <p className="text-xs muted mb-2">Each square is about 600 m across; darker means more calls</p>
                                        <div className="flex-1 min-h-[320px] rounded-md overflow-hidden border hairline">
                                            <MapContainer center={[30.715, 76.78]} zoom={12} className="h-full w-full" scrollWheelZoom={false}>
                                                <TileLayer
                                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                                />
                                                <HeatLayer points={data.points} />
                                            </MapContainer>
                                        </div>
                                        {maxHeat > 1 && (
                                            <div className="flex items-center gap-2 mt-2 text-xs muted">
                                                <span>1 call</span>
                                                <span className="flex">
                                                    {HEAT_RAMP.map(color => <span key={color} className="h-3 w-6" style={{ backgroundColor: color }} />)}
                                                </span>
                                                <span>{maxHeat} calls</span>
                                            </div>
                                        )}
                                    </section>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AnalyticsPage;
