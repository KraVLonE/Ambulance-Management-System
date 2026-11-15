import { useCallback, useRef, useState } from 'react';

const MAX_VISIBLE = 4;
const DURATION_MS = 4500;

// Lightweight toast queue. `notify(message, tone)` where tone is
// 'success' | 'info' | 'warning' | 'error'.
export function useToasts() {
    const [toasts, setToasts] = useState([]);
    const nextId = useRef(1);

    const dismiss = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const notify = useCallback((message, tone = 'info') => {
        const id = nextId.current++;
        setToasts(prev => [...prev, { id, message, tone }].slice(-MAX_VISIBLE));
        // Errors stay a little longer so they can actually be read.
        setTimeout(() => dismiss(id), tone === 'error' ? DURATION_MS * 1.5 : DURATION_MS);
    }, [dismiss]);

    return { toasts, notify, dismiss };
}
