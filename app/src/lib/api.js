import axios from 'axios';
import io from 'socket.io-client';

const http = axios.create({ baseURL: '/api', timeout: 15000 });

// One shared connection for the whole app. In production it is same-origin;
// in dev Vite proxies /socket.io to the backend. The session cookie
// authenticates it, so it is only connected while signed in.
export const socket = io({ autoConnect: false });

// Lets the app react when the session has expired (any 401 outside sign-in).
let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
http.interceptors.response.use(
    (response) => response,
    (error) => {
        const url = error.config?.url || '';
        if (error.response?.status === 401 && !url.startsWith('/auth/')) onUnauthorized?.();
        return Promise.reject(error);
    }
);

// Turns any failure into a message that is safe to show to the user.
export function errorMessage(err) {
    if (err.response?.data?.error) return err.response.data.error;
    if (err.code === 'ECONNABORTED') return 'The server took too long to respond.';
    if (!err.response) return 'Cannot reach the server. Check your connection.';
    return 'Something went wrong. Please try again.';
}

const data = (r) => r.data.data;
const body = (r) => r.data;

export const api = {
    // auth
    authStatus: () => http.get('/auth/status').then(body),
    setup: (payload) => http.post('/auth/setup', payload).then(r => r.data.user),
    login: (username, password) => http.post('/auth/login', { username, password }).then(r => r.data.user),
    logout: () => http.post('/auth/logout').then(body),

    // users (admin)
    users: () => http.get('/users').then(data),
    createUser: (payload) => http.post('/users', payload).then(data),
    updateUser: (id, payload) => http.patch(`/users/${id}`, payload).then(data),
    deleteUser: (id) => http.delete(`/users/${id}`).then(body),

    // live state
    state: () => http.get('/state').then(body),
    history: (limit = 20) => http.get('/dispatches/history', { params: { limit } }).then(data),
    stats: () => http.get('/stats').then(body),

    // dispatching
    request: (payload) => http.post('/request', payload).then(body),
    cancel: (id) => http.post(`/dispatches/${id}/cancel`).then(body),

    // hospitals & units
    createHospital: (payload) => http.post('/hospitals', payload).then(data),
    updateHospital: (id, payload) => http.patch(`/hospitals/${id}`, payload).then(data),
    deleteHospital: (id) => http.delete(`/hospitals/${id}`).then(body),
    setAmbulances: (id, ambulancesAvailable) => http.put(`/hospitals/${id}`, { ambulancesAvailable }).then(data),
    addUnit: (payload) => http.post('/ambulances', payload).then(data),
    updateUnit: (id, payload) => http.patch(`/ambulances/${id}`, payload).then(data),
    deleteUnit: (id) => http.delete(`/ambulances/${id}`).then(body),

    // geocoding
    reverseGeocode: (lat, lng, signal) =>
        http.get('/geocode/reverse', { params: { lat, lng }, signal }).then(r => r.data.address),
    searchPlaces: (q, signal) => http.get('/geocode/search', { params: { q }, signal }).then(data),

    // analytics
    analytics: (days) =>
        http.get('/analytics', { params: { days, tzOffset: -new Date().getTimezoneOffset() } }).then(body),
    exportUrl: (days) => `/api/analytics/export.csv?days=${days}`,

    // public tracking
    track: (token) => http.get(`/track/${encodeURIComponent(token)}`).then(body),
};
