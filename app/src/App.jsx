import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import LeafletMap from './components/LeafletMap';
import SearchBox from './components/SearchBox';
import HospitalList from './components/HospitalList';
import HospitalForm from './components/HospitalForm';
import DispatchPanel from './components/DispatchPanel';
import RequestModal from './components/RequestModal';
import AnalyticsPage from './components/AnalyticsPage';
import AdminUsers from './components/AdminUsers';
import LoginPage from './components/LoginPage';
import TrackPage from './components/TrackPage';
import SettingsMenu from './components/SettingsMenu';
import ControlRoomTicker from './components/ControlRoomTicker';
import ToastStack from './components/ToastStack';
import { useAuth } from './hooks/useAuth';
import { useDispatchSystem } from './hooks/useDispatchSystem';
import { usePrefs } from './hooks/usePrefs';
import { useToasts } from './hooks/useToasts';
import { api, errorMessage } from './lib/api';
import { playAlert, showNotification } from './lib/alerts';
import { permissions as permissionsFor, placeOf } from './lib/format';

const Stat = ({ label, value, tone, large }) => (
  <div className="text-center px-2 sm:px-3">
    <div className={clsx("font-bold leading-tight tabular-nums", large ? "text-2xl sm:text-3xl" : "text-base sm:text-lg", tone || "heading")}>{value}</div>
    <div className="text-[10px] sm:text-[11px] uppercase tracking-wide muted whitespace-nowrap">{label}</div>
  </div>
);

function Dashboard({ user, onLogout, prefsState }) {
  const { prefs, setPref } = prefsState;
  const { toasts, notify, dismiss } = useToasts();
  const can = useMemo(() => permissionsFor(user), [user]);

  const onCritical = useCallback((dispatch) => {
    if (prefs.sound) playAlert();
    if (prefs.notifications) showNotification('Critical call', placeOf(dispatch));
  }, [prefs.sound, prefs.notifications]);

  const system = useDispatchSystem({ enabled: true, notify, onCritical });
  const { hospitals, units, dispatches, history, stats, loading, error, connected, serverNow, applyDispatch, reload } = system;

  const [view, setView] = useState('live'); // 'live' | 'analytics' | 'users'
  const [tab, setTab] = useState('hospitals');
  const [selectedLocation, setSelectedLocation] = useState(null); // { lat, lng, label? } awaiting confirmation
  const [requesting, setRequesting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [focus, setFocus] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [hospitalTarget, setHospitalTarget] = useState(null); // what HospitalForm is editing
  const [controlRoom, setControlRoom] = useState(false);

  // A fresh `key` each time so focusing the same target twice still moves the map.
  const focusOn = useCallback((target) => setFocus({ ...target, key: Date.now() }), []);

  const fleet = useMemo(() => ({
    available: units.filter(u => u.status === 'available').length,
    onCall: units.filter(u => u.status === 'busy').length,
    queued: dispatches.filter(d => d.status === 'queued').length,
  }), [units, dispatches]);

  const closeRequest = useCallback(() => setSelectedLocation(null), []);

  const handleMapClick = (location) => {
    if (editMode) setHospitalTarget({ coords: location });
    else if (can.dispatch) setSelectedLocation(location);
  };

  const handleConfirmRequest = async (details) => {
    if (!selectedLocation) return;
    setRequesting(true);
    try {
      const res = await api.request({ lat: selectedLocation.lat, lng: selectedLocation.lng, ...details });
      // The socket normally announces it; say it ourselves only when offline.
      applyDispatch(res.dispatch, connected ? null : res.queued ? 'queued' : 'created', res.serverNow);
      setSelectedLocation(null);
      setTab('dispatches');
      const route = res.dispatch.legs?.[0]?.path;
      if (route?.length > 1) focusOn({ bounds: route });
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setRequesting(false);
    }
  };

  const handleCancel = async (dispatch) => {
    try {
      await api.cancel(dispatch.id);
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const handleShare = async (dispatch) => {
    const link = `${window.location.origin}/track/${dispatch.trackToken}`;
    try {
      await navigator.clipboard.writeText(link);
      notify('Tracking link copied. Anyone with it can follow this ambulance.', 'success');
    } catch {
      // Clipboard is unavailable on plain http or when permission is denied.
      notify(`Tracking link: ${link}`, 'info');
    }
  };

  const handleHospitalMove = useCallback(async (hospital, coords, revert) => {
    try {
      await api.updateHospital(hospital.id, coords);
      notify(`${hospital.name} moved`, 'success');
    } catch (err) {
      revert();
      notify(errorMessage(err), 'error');
    }
  }, [notify]);

  const handleLocate = () => {
    if (!navigator.geolocation) {
      notify("Your browser doesn't support location lookup.", 'error');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        const here = { lat: coords.latitude, lng: coords.longitude };
        focusOn({ ...here, zoom: 15 });
        setSelectedLocation(here);
      },
      (geoError) => {
        setLocating(false);
        notify(
          geoError.code === geoError.PERMISSION_DENIED
            ? 'Location permission was denied. Click the map to pick a spot instead.'
            : "Couldn't determine your location. Click the map to pick a spot instead.",
          'warning'
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const focusDispatch = (d) => {
    const leg = d.legs?.find(l => l.phase === d.status) || d.legs?.[0];
    if (leg?.path.length > 1) focusOn({ bounds: leg.path });
    else focusOn({ lat: d.lat, lng: d.lng, zoom: 15 });
  };

  // Control room: full-screen map with a large call list, for a wall display.
  const enterControlRoom = () => {
    setView('live');
    setEditMode(false);
    setControlRoom(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const exitControlRoom = useCallback(() => {
    setControlRoom(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);
  useEffect(() => {
    if (!controlRoom) return;
    // Leaving full screen (Esc) also leaves control-room mode.
    const onChange = () => { if (!document.fullscreenElement) setControlRoom(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [controlRoom]);

  const navButton = (key, label) => (
    <button
      type="button"
      onClick={() => setView(key)}
      aria-current={view === key ? 'page' : undefined}
      className={clsx(
        "px-2.5 py-1 rounded-md text-sm font-semibold",
        view === key ? "bg-primary/10 text-primary" : "muted hover:text-gray-900 dark:hover:text-white"
      )}
    >
      {label}
    </button>
  );

  const tabButton = (key, label) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      className={clsx(
        "flex-1 py-2.5 text-sm font-semibold border-b-2 transition-colors",
        tab === key ? "border-primary text-primary" : "border-transparent muted hover:text-gray-900 dark:hover:text-white"
      )}
    >
      {label}
    </button>
  );

  const waiting = dispatches.length - dispatches.filter(d => d.status === 'returning').length;
  const hint = can.dispatch && dispatches.length === 0 && !selectedLocation
    ? 'Click the map or search an address to request an ambulance'
    : null;

  return (
    <div className="flex flex-col h-dvh overflow-hidden">
      <header className="surface shadow-sm z-30 px-3 sm:px-4 py-2 flex items-center gap-2 sm:gap-4 border-b hairline">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <img src="/assets/ambulance.png" alt="" className="h-8 w-8 flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-base sm:text-xl font-bold text-primary leading-tight truncate">Ambulance Manager</h1>
            <div className="flex items-center gap-1.5 text-[11px] muted" title={connected ? 'Receiving live updates' : 'Live updates paused. Reconnecting automatically.'}>
              <span className={clsx("h-2 w-2 rounded-full", connected ? "bg-green-500" : "bg-amber-500 animate-pulse")} />
              {connected ? 'Live' : 'Reconnecting…'}
            </div>
          </div>
        </div>

        {!controlRoom && (
          <nav className="hidden sm:flex items-center gap-1" aria-label="Sections">
            {navButton('live', 'Live')}
            {navButton('analytics', 'Analytics')}
            {can.admin && navButton('users', 'Users')}
          </nav>
        )}

        <div className="flex items-center divide-x divide-gray-200 dark:divide-slate-700 ml-auto">
          <Stat large={controlRoom} label="At base" value={loading && units.length === 0 ? '–' : fleet.available} tone={fleet.available === 0 && units.length > 0 ? 'text-primary' : 'text-green-700 dark:text-green-400'} />
          <Stat large={controlRoom} label="On call" value={fleet.onCall} tone={fleet.onCall > 0 ? 'text-primary' : undefined} />
          {(fleet.queued > 0 || controlRoom) && <Stat large={controlRoom} label="Waiting" value={fleet.queued} tone={fleet.queued > 0 ? 'text-amber-600 dark:text-amber-400' : undefined} />}
          <div className={controlRoom ? '' : 'hidden md:block'}><Stat large={controlRoom} label="Today" value={stats?.today.total ?? '–'} /></div>
          <div className={controlRoom ? '' : 'hidden lg:block'}>
            <Stat large={controlRoom} label="Avg response" value={stats?.today.avgResponseMinutes != null ? `${stats.today.avgResponseMinutes}m` : '–'} />
          </div>
        </div>

        {controlRoom ? (
          <button type="button" className="btn" onClick={exitControlRoom}>Exit</button>
        ) : (
          <>
            <button type="button" className="btn hidden md:inline-flex" onClick={enterControlRoom} title="Full-screen map and call list for a wall display">
              Control room
            </button>
            <SettingsMenu user={user} prefs={prefs} setPref={setPref} onLogout={onLogout} notify={notify} />
          </>
        )}
      </header>

      {/* Section switcher for phones */}
      {!controlRoom && (
        <nav className="sm:hidden surface border-b hairline flex justify-around py-1" aria-label="Sections">
          {navButton('live', 'Live')}
          {navButton('analytics', 'Analytics')}
          {can.admin && navButton('users', 'Users')}
        </nav>
      )}

      {/* The live view stays mounted while other sections are open, so the map keeps its position. */}
      <div className={clsx("flex-1 min-h-0 flex-col lg:flex-row", view === 'live' ? 'flex' : 'hidden')}>
        <main className={clsx("min-w-0 lg:flex-1 lg:h-auto", controlRoom ? "flex-1" : "h-[52%] lg:p-4")}>
          <div className={clsx("w-full h-full overflow-hidden", !controlRoom && "lg:shadow-xl lg:rounded-xl lg:border-4 lg:border-white dark:lg:border-slate-800")}>
            <LeafletMap
              hospitals={hospitals}
              units={units}
              dispatches={dispatches}
              serverNow={serverNow}
              focus={focus}
              selectedLocation={selectedLocation}
              onMapClick={handleMapClick}
              onLocate={handleLocate}
              locating={locating}
              canDispatch={can.dispatch && !controlRoom}
              canEditHospitals={can.admin && !controlRoom}
              editMode={editMode}
              onToggleEdit={() => setEditMode(m => !m)}
              onHospitalMove={handleHospitalMove}
              hint={hint}
            >
              {can.dispatch && !controlRoom && !editMode && (
                <SearchBox onSelect={(place) => { focusOn({ lat: place.lat, lng: place.lng, zoom: 16 }); setSelectedLocation(place); }} />
              )}
            </LeafletMap>
            {controlRoom && <ControlRoomTicker dispatches={dispatches} serverNow={serverNow} />}
          </div>
        </main>

        {!controlRoom && (
          <aside className="flex-1 lg:flex-none min-h-0 w-full lg:w-[26rem] surface shadow-xl border-t lg:border-t-0 lg:border-l hairline flex flex-col z-20">
            <div className="flex border-b hairline" role="tablist">
              {tabButton('hospitals', `Hospitals (${hospitals.length})`)}
              {tabButton('dispatches', (
                <span className="inline-flex items-center gap-1.5">
                  Dispatches
                  {waiting > 0 && (
                    <span className={clsx("text-white text-[11px] rounded-full px-1.5 py-px tabular-nums", fleet.queued > 0 ? "bg-amber-600" : "bg-primary")}>{waiting}</span>
                  )}
                </span>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto" role="tabpanel">
              {tab === 'hospitals' ? (
                <HospitalList
                  hospitals={hospitals}
                  units={units}
                  loading={loading}
                  error={error}
                  onRetry={reload}
                  onHospitalClick={(h) => focusOn({ lat: h.lat, lng: h.lng, hospitalId: h.id })}
                  onEditHospital={(hospital) => setHospitalTarget({ hospital })}
                  permissions={can}
                  notify={notify}
                />
              ) : (
                <DispatchPanel
                  dispatches={dispatches}
                  history={history}
                  serverNow={serverNow}
                  canDispatch={can.dispatch}
                  onFocus={focusDispatch}
                  onCancel={handleCancel}
                  onShare={handleShare}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {view === 'analytics' && <div className="flex-1 min-h-0"><AnalyticsPage notify={notify} /></div>}
      {view === 'users' && can.admin && <div className="flex-1 min-h-0"><AdminUsers currentUser={user} hospitals={hospitals} notify={notify} /></div>}

      <RequestModal
        location={selectedLocation}
        hospitals={hospitals}
        units={units}
        loading={requesting}
        onClose={closeRequest}
        onConfirm={handleConfirmRequest}
      />
      <HospitalForm target={hospitalTarget} isAdmin={can.admin} notify={notify} onClose={() => setHospitalTarget(null)} />
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function App() {
  const prefsState = usePrefs(); // also applies the light/dark theme
  const auth = useAuth();
  const trackToken = useMemo(() => window.location.pathname.match(/^\/track\/([^/]+)/)?.[1] || null, []);

  // The caller's tracking page is public: no session involved.
  if (trackToken) return <TrackPage token={decodeURIComponent(trackToken)} />;

  if (auth.status === 'loading') {
    return <div className="min-h-dvh flex items-center justify-center muted">Loading…</div>;
  }
  if (auth.status === 'error') {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6 text-center">
        <div>
          <p className="muted mb-3">{auth.error}</p>
          <button type="button" className="btn" onClick={auth.retry}>Try again</button>
        </div>
      </div>
    );
  }
  if (auth.status !== 'signedIn') {
    return <LoginPage mode={auth.status === 'setup' ? 'setup' : 'login'} onLogin={auth.login} onSetup={auth.setup} />;
  }
  // Keyed by user so signing in as someone else starts from a clean slate.
  return <Dashboard key={auth.user.id} user={auth.user} onLogout={auth.logout} prefsState={prefsState} />;
}

export default App;
