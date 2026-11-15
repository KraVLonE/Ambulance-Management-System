// Audible and browser notifications for critical calls. Both are opt-in and
// degrade silently where the browser doesn't allow them.

let audioContext = null;

// Two short rising tones. Synthesised, so there is no audio file to load.
export function playAlert() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audioContext = audioContext || new Ctx();
        if (audioContext.state === 'suspended') audioContext.resume();
        const start = audioContext.currentTime;
        [[880, 0], [1175, 0.18]].forEach(([frequency, offset]) => {
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, start + offset);
            gain.gain.exponentialRampToValueAtTime(0.25, start + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.16);
            oscillator.connect(gain).connect(audioContext.destination);
            oscillator.start(start + offset);
            oscillator.stop(start + offset + 0.18);
        });
    } catch {
        // Autoplay policy or no audio device: nothing useful to do.
    }
}

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export const notificationPermission = () => (notificationsSupported() ? Notification.permission : 'unsupported');

export async function requestNotificationPermission() {
    if (!notificationsSupported()) return 'unsupported';
    try {
        return await Notification.requestPermission();
    } catch {
        return 'denied';
    }
}

// Shown only while the dashboard is in the background; in the foreground the
// toast and sound already cover it.
export function showNotification(title, body) {
    if (!notificationsSupported() || Notification.permission !== 'granted' || !document.hidden) return;
    try {
        const notification = new Notification(title, { body, icon: '/assets/ambulance.png', tag: 'critical-call' });
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    } catch {
        // Some browsers only allow notifications from a service worker.
    }
}
