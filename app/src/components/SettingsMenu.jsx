import { useEffect, useRef, useState } from 'react';
import { ROLE } from '../lib/format';
import { notificationPermission, requestNotificationPermission, playAlert } from '../lib/alerts';

const THEMES = [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];

const Toggle = ({ checked, onChange, label, hint }) => (
    <label className="flex items-start gap-3 cursor-pointer py-1.5">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-secondary" />
        <span>
            <span className="block text-sm heading">{label}</span>
            {hint && <span className="block text-xs muted">{hint}</span>}
        </span>
    </label>
);

// Account + preferences popover in the header.
const SettingsMenu = ({ user, prefs, setPref, onLogout, notify }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const toggleNotifications = async (wanted) => {
        if (!wanted) return setPref('notifications', false);
        const permission = await requestNotificationPermission();
        if (permission === 'granted') {
            setPref('notifications', true);
        } else {
            setPref('notifications', false);
            notify(
                permission === 'unsupported'
                    ? "This browser doesn't support notifications."
                    : 'Notifications are blocked for this site. Allow them in your browser settings to turn this on.',
                'warning'
            );
        }
    };

    const toggleSound = (wanted) => {
        setPref('sound', wanted);
        if (wanted) playAlert(); // lets the user hear what they just enabled
    };

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-haspopup="true"
                aria-expanded={open}
                className="h-9 w-9 rounded-full bg-secondary text-white font-bold uppercase flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-secondary"
                title={`${user.username} · settings`}
            >
                {user.username.slice(0, 1)}
            </button>
            {open && (
                <div className="absolute right-0 mt-2 w-72 card shadow-xl p-4 z-[1600]">
                    <div className="font-semibold heading truncate">{user.username}</div>
                    <div className="text-xs muted">{ROLE[user.role]?.label}</div>

                    <div className="section-title mt-4 mb-1.5">Theme</div>
                    <div className="flex rounded-md border border-gray-300 dark:border-slate-600 overflow-hidden" role="group" aria-label="Theme">
                        {THEMES.map(([value, label]) => (
                            <button
                                key={value} type="button" onClick={() => setPref('theme', value)} aria-pressed={prefs.theme === value}
                                className={`flex-1 py-1.5 text-sm font-medium ${prefs.theme === value ? 'bg-secondary text-white' : 'hover:bg-gray-50 dark:hover:bg-slate-800'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className="section-title mt-4 mb-0.5">Critical call alerts</div>
                    <Toggle checked={prefs.sound} onChange={toggleSound} label="Play a sound" />
                    <Toggle
                        checked={prefs.notifications && notificationPermission() === 'granted'}
                        onChange={toggleNotifications}
                        label="Browser notification"
                        hint="Shown when this tab is in the background"
                    />

                    <button type="button" className="btn w-full mt-4" onClick={onLogout}>Sign out</button>
                </div>
            )}
        </div>
    );
};

export default SettingsMenu;
