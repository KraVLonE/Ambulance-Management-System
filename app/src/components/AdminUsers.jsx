import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { ROLE } from '../lib/format';

const emptyForm = { username: '', password: '', role: 'dispatcher', hospitalId: '' };

// Admin page: who can sign in, and what each account may do.
const AdminUsers = ({ currentUser, hospitals, notify }) => {
    const [users, setUsers] = useState(null);
    const [error, setError] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [busy, setBusy] = useState(false);
    const [resetFor, setResetFor] = useState(null); // user id whose password is being reset
    const [newPassword, setNewPassword] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(null);

    const load = useCallback(() => {
        return api.users().then(list => { setUsers(list); setError(null); }).catch(err => setError(errorMessage(err)));
    }, []);
    useEffect(() => { load(); }, [load]);

    const hospitalName = (id) => hospitals.find(h => h.id === id)?.name || 'Unknown hospital';

    const run = async (action, done) => {
        setBusy(true);
        try {
            await action();
            if (done) notify(done, 'success');
            await load();
            return true;
        } catch (err) {
            notify(errorMessage(err), 'error');
            return false;
        } finally {
            setBusy(false);
        }
    };

    const create = async (e) => {
        e.preventDefault();
        const payload = { username: form.username.trim(), password: form.password, role: form.role };
        if (form.role === 'hospital_admin') payload.hospitalId = Number(form.hospitalId);
        if (await run(() => api.createUser(payload), `Account “${payload.username}” created`)) setForm(emptyForm);
    };

    const changeRole = (user, role) => {
        const payload = { role };
        if (role === 'hospital_admin') payload.hospitalId = user.hospitalId ?? hospitals[0]?.id;
        run(() => api.updateUser(user.id, payload));
    };

    const resetPassword = async (e, user) => {
        e.preventDefault();
        if (await run(() => api.updateUser(user.id, { password: newPassword }), `Password for “${user.username}” changed`)) {
            setResetFor(null);
            setNewPassword('');
        }
    };

    return (
        <div className="h-full overflow-y-auto">
            <div className="max-w-4xl mx-auto p-4 sm:p-6">
                <h2 className="text-xl font-bold heading">Users</h2>
                <p className="text-sm muted mt-1">Each person gets their own account. The role decides what they can change.</p>

                <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 mt-4 text-sm">
                    {Object.entries(ROLE).map(([key, meta]) => (
                        <div key={key} className="flex gap-2">
                            <dt className="font-semibold heading whitespace-nowrap">{meta.label}:</dt>
                            <dd className="muted">{meta.hint}</dd>
                        </div>
                    ))}
                </dl>

                <form onSubmit={create} className="card p-4 mt-6">
                    <h3 className="section-title mb-3">Add an account</h3>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <label className="block">
                            <span className="text-xs muted">Username</span>
                            <input className="input mt-0.5" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
                                required minLength={3} maxLength={32} autoComplete="off" autoCapitalize="none" spellCheck={false} />
                        </label>
                        <label className="block">
                            <span className="text-xs muted">Temporary password</span>
                            <input className="input mt-0.5" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                                required minLength={8} autoComplete="new-password" />
                        </label>
                        <label className="block">
                            <span className="text-xs muted">Role</span>
                            <select className="input mt-0.5" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                                {Object.entries(ROLE).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
                            </select>
                        </label>
                        {form.role === 'hospital_admin' && (
                            <label className="block">
                                <span className="text-xs muted">Hospital</span>
                                <select className="input mt-0.5" value={form.hospitalId} onChange={e => setForm({ ...form, hospitalId: e.target.value })} required>
                                    <option value="">Choose…</option>
                                    {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                                </select>
                            </label>
                        )}
                    </div>
                    <button type="submit" className="btn-primary mt-4" disabled={busy}>Add account</button>
                </form>

                <h3 className="section-title mt-8 mb-2">Accounts{users ? ` (${users.length})` : ''}</h3>
                {error ? (
                    <div className="card p-6 text-center">
                        <p className="text-sm muted mb-3">{error}</p>
                        <button type="button" className="btn" onClick={load}>Try again</button>
                    </div>
                ) : users === null ? (
                    <div className="h-24 rounded-lg bg-gray-100 dark:bg-slate-800 animate-pulse" />
                ) : (
                    <ul className="card divide-y divide-gray-200 dark:divide-slate-700">
                        {users.map(user => {
                            const isMe = user.id === currentUser.id;
                            return (
                                <li key={user.id} className="p-3">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                        <div className="min-w-0 flex-1">
                                            <span className="font-semibold heading">{user.username}</span>
                                            {isMe && <span className="ml-2 text-xs muted">(you)</span>}
                                            {user.role === 'hospital_admin' && <span className="block text-xs muted truncate">{hospitalName(user.hospitalId)}</span>}
                                        </div>
                                        <select className="input !w-auto" value={user.role} disabled={busy} onChange={e => changeRole(user, e.target.value)} aria-label={`Role of ${user.username}`}>
                                            {Object.entries(ROLE).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
                                        </select>
                                        {user.role === 'hospital_admin' && (
                                            <select className="input !w-auto max-w-[12rem]" value={user.hospitalId ?? ''} disabled={busy}
                                                onChange={e => run(() => api.updateUser(user.id, { role: 'hospital_admin', hospitalId: Number(e.target.value) }))}
                                                aria-label={`Hospital of ${user.username}`}>
                                                {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                                            </select>
                                        )}
                                        <button type="button" className="text-sm link" onClick={() => { setResetFor(resetFor === user.id ? null : user.id); setNewPassword(''); }}>
                                            Change password
                                        </button>
                                        {!isMe && (confirmDelete === user.id ? (
                                            <button type="button" className="btn !py-1 !border-primary !text-primary" disabled={busy}
                                                onClick={() => run(() => api.deleteUser(user.id), `Account “${user.username}” deleted`).then(() => setConfirmDelete(null))}>
                                                Confirm delete
                                            </button>
                                        ) : (
                                            <button type="button" className="text-sm muted hover:text-primary" onClick={() => setConfirmDelete(user.id)}>Delete</button>
                                        ))}
                                    </div>
                                    {resetFor === user.id && (
                                        <form onSubmit={e => resetPassword(e, user)} className="flex flex-wrap items-end gap-2 mt-3">
                                            <label className="block">
                                                <span className="text-xs muted">New password for {user.username}</span>
                                                <input className="input mt-0.5" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                                                    required minLength={8} autoComplete="new-password" autoFocus />
                                            </label>
                                            <button type="submit" className="btn" disabled={busy}>Save password</button>
                                        </form>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default AdminUsers;
