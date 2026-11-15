const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createApp } = require('../app');

// Set TEST_DATABASE_URL to run the whole suite against PostgreSQL (each test
// gets its own throwaway schema). Without it, tests use in-memory SQLite.
const PG_URL = process.env.TEST_DATABASE_URL || null;

// Sector 17, Chandigarh: well inside the service area.
// Nearest hospitals by straight line: Healing (41), Landmark (53), Santokh (16).
const PICKUP = { lat: 30.7400, lng: 76.7800 };
const TEST_PASSWORD = 'test-password-1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fake OSRM: drive time is looked up by the start point ("lat,lng") so tests
// control which unit is "fastest". Unknown starts take 600 s.
function fakeOsrm(durations = {}, calls = []) {
    return async (url) => {
        calls.push(url);
        const [, coords] = url.match(/driving\/([^?]+)/);
        const [start, end] = coords.split(';').map((p) => p.split(',').map(Number));
        const duration = durations[`${start[1]},${start[0]}`] ?? 600;
        return {
            ok: true,
            json: async () => ({
                code: 'Ok',
                routes: [{ duration, distance: duration * 10, geometry: { coordinates: [start, end] } }],
            }),
        };
    };
}

async function start(options = {}) {
    const events = [];
    const schema = PG_URL && !options.sqlitePath ? `t_${crypto.randomBytes(6).toString('hex')}` : undefined;
    const ctx = await createApp({
        ...(schema ? { databaseUrl: PG_URL, databaseSchema: schema } : { databaseUrl: undefined, sqlitePath: ':memory:' }),
        osrmUrl: 'http://osrm.test',
        nominatimUrl: '',
        fetchImpl: fakeOsrm(),
        rateLimit: null,
        loginLimit: null,
        frontendPath: path.join(os.tmpdir(), 'no-such-frontend'),
        onEvent: (name, payload) => events.push({ name, payload }),
        ...options,
    });
    ctx.events = events;
    await new Promise((resolve) => ctx.server.listen(0, resolve));
    const base = `http://127.0.0.1:${ctx.server.address().port}`;
    const cookies = {}; // username -> cookie header

    // `as` picks whose session to use; null sends no cookie.
    ctx.api = async (method, url, body, as = 'admin') => {
        const headers = {};
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (as && cookies[as]) headers.Cookie = cookies[as];
        if (as && as.includes('=')) headers.Cookie = as; // raw cookie, for forgery tests
        const res = await fetch(base + url, {
            method,
            headers,
            body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        return { status: res.status, body: json, text, headers: res.headers };
    };

    const remember = (username, res) => {
        const set = res.headers.get('set-cookie');
        if (set) cookies[username] = set.split(';')[0];
    };

    if (options.setup !== false) {
        const res = await ctx.api('POST', '/api/auth/setup', { username: 'admin', password: TEST_PASSWORD }, null);
        remember('admin', res);
    }

    // Creates a user with the given role and signs them in.
    ctx.addUser = async (username, role, hospitalId) => {
        const created = await ctx.api('POST', '/api/users', { username, password: TEST_PASSWORD, role, hospitalId });
        if (created.status !== 201) throw new Error(`addUser failed: ${created.text}`);
        const login = await ctx.api('POST', '/api/auth/login', { username, password: TEST_PASSWORD }, null);
        remember(username, login);
        return created.body.data;
    };
    ctx.login = async (username, password = TEST_PASSWORD) => {
        const res = await ctx.api('POST', '/api/auth/login', { username, password }, null);
        remember(username, res);
        return res;
    };
    ctx.cookie = (username) => cookies[username];

    ctx.state = async () => (await ctx.api('GET', '/api/state')).body;
    ctx.hospital = async (id) => (await ctx.state()).hospitals.find((h) => h.id === id);
    ctx.unitsOf = async (hospitalId) => (await ctx.state()).units.filter((u) => u.hospitalId === hospitalId);
    ctx.request = (body = {}, as = 'admin') => ctx.api('POST', '/api/request', { ...PICKUP, ...body }, as);

    // Leaves exactly `count` ambulances in the whole system, all at `hospitalId`.
    ctx.onlyFleet = async (hospitalId, count) => {
        for (const h of ctx.engine.hospitals()) {
            await ctx.engine.setAvailableCount(h.id, h.id === hospitalId ? count : 0);
        }
    };
    ctx.eventsFor = (id) => events.filter((e) => e.name === 'dispatch' && e.payload.dispatch.id === id).map((e) => e.payload.event);

    const close = ctx.close;
    ctx.close = async () => {
        await close();
        if (schema) {
            const pg = require('pg');
            const client = new pg.Client({ connectionString: PG_URL });
            await client.connect();
            await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
            await client.end();
        }
    };
    return ctx;
}

module.exports = { start, fakeOsrm, sleep, PICKUP, TEST_PASSWORD, PG_URL };
