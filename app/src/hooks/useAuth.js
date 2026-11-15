import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, setUnauthorizedHandler } from '../lib/api';

/**
 * Session state. `status` is:
 *   'loading'  checking with the server
 *   'setup'    no accounts exist yet; the first admin must be created
 *   'signedOut' / 'signedIn'
 *   'error'    the server could not be reached
 */
export function useAuth() {
    const [state, setState] = useState({ status: 'loading', user: null, error: null });

    const check = useCallback(() => {
        return api.authStatus()
            .then(({ user, needsSetup }) => {
                setState({ status: user ? 'signedIn' : needsSetup ? 'setup' : 'signedOut', user, error: null });
            })
            .catch(err => setState({ status: 'error', user: null, error: errorMessage(err) }));
    }, []);

    useEffect(() => {
        check();
        // Any API call that comes back 401 means the session ended.
        setUnauthorizedHandler(() => setState(prev => (prev.status === 'signedIn' ? { status: 'signedOut', user: null, error: null } : prev)));
        return () => setUnauthorizedHandler(null);
    }, [check]);

    const signedIn = (user) => setState({ status: 'signedIn', user, error: null });

    const login = useCallback((username, password) => api.login(username, password).then(signedIn), []);
    const setup = useCallback((payload) => api.setup(payload).then(signedIn), []);
    const logout = useCallback(() => {
        return api.logout().catch(() => {}).then(() => setState({ status: 'signedOut', user: null, error: null }));
    }, []);

    return { ...state, login, setup, logout, retry: check };
}
