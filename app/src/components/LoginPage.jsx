import { useState } from 'react';
import { errorMessage } from '../lib/api';

// Sign-in screen. On a brand-new install (`mode === 'setup'`) it becomes the
// form that creates the first admin account instead.
const LoginPage = ({ mode, onLogin, onSetup }) => {
    const setup = mode === 'setup';
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const submit = async (e) => {
        e.preventDefault();
        if (setup && password !== confirm) {
            setError('The two passwords do not match.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            if (setup) await onSetup({ username: username.trim(), password, token: token || undefined });
            else await onLogin(username.trim(), password);
        } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
        }
    };

    return (
        <div className="min-h-dvh flex items-center justify-center p-4">
            <form onSubmit={submit} className="card shadow-xl w-full max-w-sm p-6">
                <div className="flex items-center gap-3">
                    <img src="/assets/ambulance.png" alt="" className="h-10 w-10" />
                    <div>
                        <h1 className="text-xl font-bold text-primary leading-tight">Ambulance Manager</h1>
                        <p className="text-sm muted">{setup ? 'Create the first admin account' : 'Sign in to continue'}</p>
                    </div>
                </div>

                {setup && (
                    <p className="mt-4 text-sm rounded-md px-3 py-2 bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-200">
                        This is a new installation. The account you create now can add other users and manage everything.
                    </p>
                )}

                <label className="block mt-5">
                    <span className="section-title">Username</span>
                    <input className="input mt-1 !py-2" value={username} onChange={e => setUsername(e.target.value)}
                        autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus />
                </label>
                <label className="block mt-4">
                    <span className="section-title">Password</span>
                    <input className="input mt-1 !py-2" type="password" value={password} onChange={e => setPassword(e.target.value)}
                        autoComplete={setup ? 'new-password' : 'current-password'} required minLength={setup ? 8 : undefined} />
                    {setup && <span className="block text-xs muted mt-1">At least 8 characters.</span>}
                </label>
                {setup && (
                    <>
                        <label className="block mt-4">
                            <span className="section-title">Repeat password</span>
                            <input className="input mt-1 !py-2" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required />
                        </label>
                        <label className="block mt-4">
                            <span className="section-title">Setup code <span className="font-normal normal-case">(only if your server requires one)</span></span>
                            <input className="input mt-1 !py-2" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" />
                        </label>
                    </>
                )}

                {error && <p className="mt-4 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}

                <button type="submit" className="btn-primary w-full mt-6 !py-2" disabled={busy}>
                    {busy ? 'Please wait…' : setup ? 'Create account' : 'Sign in'}
                </button>
            </form>
        </div>
    );
};

export default LoginPage;
