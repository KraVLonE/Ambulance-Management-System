import { useCallback, useEffect, useState } from 'react';

const KEY = 'ams-prefs';
const DEFAULTS = { theme: 'system', sound: true, notifications: false };

function load() {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
        return DEFAULTS;
    }
}

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

// Per-browser preferences: colour theme and critical-call alerts.
export function usePrefs() {
    const [prefs, setPrefs] = useState(load);
    const [osDark, setOsDark] = useState(systemDark);

    useEffect(() => {
        const query = window.matchMedia?.('(prefers-color-scheme: dark)');
        if (!query) return;
        const onChange = (e) => setOsDark(e.matches);
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, []);

    const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && osDark);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', dark);
    }, [dark]);

    const setPref = useCallback((key, value) => {
        setPrefs(prev => {
            const next = { ...prev, [key]: value };
            try {
                localStorage.setItem(KEY, JSON.stringify(next));
            } catch {
                // Private mode or storage disabled: the choice lasts for this visit only.
            }
            return next;
        });
    }, []);

    return { prefs, dark, setPref };
}
