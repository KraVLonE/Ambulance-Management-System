const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { start, fakeOsrm, sleep, PICKUP, TEST_PASSWORD } = require('./helpers');

// Coordinates of seeded hospitals, as fake-OSRM duration keys.
const AT = { healing: '30.726,76.765', landmark: '30.718,76.758', santokh: '30.713,76.784' };
// Trips that finish in a fraction of a second.
const FAST = { timeScale: 1e9, minTravelMs: 40, maxTravelMs: 40, sceneMs: 30 };

let ctx;
afterEach(async () => { await ctx?.close(); ctx = null; });

describe('authentication', () => {
    test('first run needs setup, which works exactly once', async () => {
        ctx = await start({ setup: false });
        assert.deepEqual((await ctx.api('GET', '/api/auth/status', undefined, null)).body, { user: null, needsSetup: true });

        const first = await ctx.api('POST', '/api/auth/setup', { username: 'boss', password: TEST_PASSWORD }, null);
        assert.equal(first.status, 201);
        assert.equal(first.body.user.role, 'admin');
        assert.match(first.headers.get('set-cookie'), /HttpOnly/);

        const second = await ctx.api('POST', '/api/auth/setup', { username: 'intruder', password: TEST_PASSWORD }, null);
        assert.equal(second.status, 409);
    });

    test('setup can be protected with a setup code', async () => {
        ctx = await start({ setup: false, setupToken: 'let-me-in' });
        const body = { username: 'boss', password: TEST_PASSWORD };
        assert.equal((await ctx.api('POST', '/api/auth/setup', body, null)).status, 403);
        assert.equal((await ctx.api('POST', '/api/auth/setup', { ...body, token: 'let-me-in' }, null)).status, 201);
    });

    test('rejects weak credentials', async () => {
        ctx = await start({ setup: false });
        assert.equal((await ctx.api('POST', '/api/auth/setup', { username: 'boss', password: 'short' }, null)).status, 400);
        assert.equal((await ctx.api('POST', '/api/auth/setup', { username: 'a b', password: TEST_PASSWORD }, null)).status, 400);
    });

    test('everything except auth, health and tracking requires a session', async () => {
        ctx = await start();
        for (const [method, url] of [
            ['GET', '/api/state'], ['GET', '/api/hospitals'], ['GET', '/api/ambulances'], ['GET', '/api/dispatches'],
            ['GET', '/api/dispatches/history'], ['GET', '/api/stats'], ['GET', '/api/analytics'],
            ['GET', '/api/analytics/export.csv'], ['GET', '/api/users'], ['POST', '/api/request'],
            ['GET', '/api/geocode/reverse?lat=1&lng=1'], ['GET', '/api/geocode/search?q=abc'],
        ]) {
            const res = await ctx.api(method, url, method === 'POST' ? PICKUP : undefined, null);
            assert.equal(res.status, 401, `${method} ${url}`);
        }
        assert.equal((await ctx.api('GET', '/api/health', undefined, null)).status, 200);
    });

    test('login, wrong password, logout', async () => {
        ctx = await start();
        assert.equal((await ctx.login('admin', 'wrong-password')).status, 401);
        assert.equal((await ctx.login('nobody')).status, 401);
        const ok = await ctx.login('ADMIN'); // usernames are case-insensitive
        assert.equal(ok.status, 200);
        assert.equal(ok.body.user.username, 'admin');
        assert.equal(ok.body.user.passwordHash, undefined);

        const out = await ctx.api('POST', '/api/auth/logout', {});
        assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    });

    test('a forged or tampered cookie is not accepted', async () => {
        ctx = await start();
        const [name, token] = ctx.cookie('admin').split('=');
        const [payload, signature] = token.split('.');
        const forgedPayload = Buffer.from(JSON.stringify({ uid: 'someone-else', exp: Date.now() + 1e6 })).toString('base64url');
        for (const bad of [`${name}=${forgedPayload}.${signature}`, `${name}=${payload}.AAAA`, `${name}=garbage`]) {
            assert.equal((await ctx.api('GET', '/api/state', undefined, bad)).status, 401);
        }
    });

    test('login attempts are rate limited', async () => {
        ctx = await start({ loginLimit: { windowMs: 60000, max: 3 } });
        // setup used one attempt
        await ctx.login('admin', 'nope-nope-1');
        await ctx.login('admin', 'nope-nope-2');
        assert.equal((await ctx.login('admin', 'nope-nope-3')).status, 429);
    });
});

describe('roles', () => {
    test('viewer is read-only', async () => {
        ctx = await start();
        await ctx.addUser('wall', 'viewer');
        assert.equal((await ctx.api('GET', '/api/state', undefined, 'wall')).status, 200);
        assert.equal((await ctx.request({}, 'wall')).status, 403);
        assert.equal((await ctx.api('PUT', '/api/hospitals/16', { ambulancesAvailable: 1 }, 'wall')).status, 403);
        assert.equal((await ctx.api('GET', '/api/users', undefined, 'wall')).status, 403);
    });

    test('dispatcher can dispatch and cancel but not manage fleets, hospitals or users', async () => {
        ctx = await start();
        await ctx.addUser('dee', 'dispatcher');
        const res = await ctx.request({}, 'dee');
        assert.equal(res.status, 201);
        assert.equal(res.body.dispatch.createdBy, 'dee');
        assert.equal((await ctx.api('POST', `/api/dispatches/${res.body.dispatch.id}/cancel`, {}, 'dee')).status, 200);

        assert.equal((await ctx.api('PUT', '/api/hospitals/16', { ambulancesAvailable: 1 }, 'dee')).status, 403);
        assert.equal((await ctx.api('POST', '/api/ambulances', { hospitalId: 16, type: 'BLS' }, 'dee')).status, 403);
        assert.equal((await ctx.api('POST', '/api/hospitals', { name: 'X', lat: 30.7, lng: 76.7 }, 'dee')).status, 403);
        assert.equal((await ctx.api('POST', '/api/users', { username: 'x-user', password: TEST_PASSWORD, role: 'admin' }, 'dee')).status, 403);
    });

    test('hospital admin manages only their own hospital and cannot dispatch', async () => {
        ctx = await start();
        await ctx.addUser('santokh', 'hospital_admin', 16);
        assert.equal((await ctx.api('PUT', '/api/hospitals/16', { ambulancesAvailable: 6 }, 'santokh')).status, 200);
        assert.equal((await ctx.api('PUT', '/api/hospitals/41', { ambulancesAvailable: 6 }, 'santokh')).status, 403);
        assert.equal((await ctx.api('PATCH', '/api/hospitals/16', { bedsAvailable: 3 }, 'santokh')).status, 200);
        assert.equal((await ctx.api('PATCH', '/api/hospitals/16', { name: 'Renamed' }, 'santokh')).status, 403);
        assert.equal((await ctx.api('POST', '/api/ambulances', { hospitalId: 41, type: 'BLS' }, 'santokh')).status, 403);
        assert.equal((await ctx.request({}, 'santokh')).status, 403);

        const other = (await ctx.unitsOf(41))[0];
        assert.equal((await ctx.api('PATCH', `/api/ambulances/${other.id}`, { inService: false }, 'santokh')).status, 403);
        assert.equal((await ctx.api('DELETE', `/api/ambulances/${other.id}`, undefined, 'santokh')).status, 403);
    });

    test('user management rules', async () => {
        ctx = await start();
        const user = await ctx.addUser('dee', 'dispatcher');
        const users = (await ctx.api('GET', '/api/users')).body.data;
        assert.equal(users.length, 2);
        assert.ok(users.every((u) => u.passwordHash === undefined));

        const dup = await ctx.api('POST', '/api/users', { username: 'DEE', password: TEST_PASSWORD, role: 'viewer' });
        assert.equal(dup.status, 409);
        const noHospital = await ctx.api('POST', '/api/users', { username: 'hadmin', password: TEST_PASSWORD, role: 'hospital_admin' });
        assert.equal(noHospital.status, 400);
        assert.equal((await ctx.api('POST', '/api/users', { username: 'x-user', password: TEST_PASSWORD, role: 'god' })).status, 400);

        // Role change takes effect on the user's next request.
        await ctx.api('PATCH', `/api/users/${user.id}`, { role: 'viewer' });
        assert.equal((await ctx.request({}, 'dee')).status, 403);

        // Password reset invalidates the old password.
        await ctx.api('PATCH', `/api/users/${user.id}`, { password: 'a-brand-new-pass' });
        assert.equal((await ctx.login('dee')).status, 401);
        assert.equal((await ctx.login('dee', 'a-brand-new-pass')).status, 200);

        const me = users.find((u) => u.username === 'admin');
        assert.equal((await ctx.api('DELETE', `/api/users/${me.id}`)).status, 409, "can't delete yourself");
        assert.equal((await ctx.api('PATCH', `/api/users/${me.id}`, { role: 'viewer' })).status, 409, 'last admin stays admin');
        assert.equal((await ctx.api('DELETE', `/api/users/${user.id}`)).status, 200);
        assert.equal((await ctx.api('GET', '/api/state', undefined, 'dee')).status, 401, 'deleted user is signed out');
    });
});

describe('state and static', () => {
    test('seeded hospitals come with their fleets', async () => {
        ctx = await start();
        const state = await ctx.state();
        assert.equal(state.hospitals.length, 12);
        assert.equal(state.units.length, 42);
        const healing = state.hospitals.find((h) => h.id === 41);
        assert.equal(healing.units, 4);
        assert.equal(healing.ambulancesAvailable, 4);
        assert.deepEqual(healing.capabilities, ['cardiac']);
        assert.ok(state.units.every((u) => u.status === 'available' && ['ALS', 'BLS'].includes(u.type)));
    });

    test('unknown API route returns JSON 404; missing build is explained', async () => {
        ctx = await start();
        const res = await ctx.api('GET', '/api/nope');
        assert.equal(res.status, 404);
        assert.deepEqual(res.body, { error: 'Not found' });
        const page = await ctx.api('GET', '/', undefined, null);
        assert.equal(page.status, 503);
        assert.match(page.text, /not built/i);
    });
});

describe('dispatching', () => {
    test('assigns a unit and builds the full trip', async () => {
        ctx = await start();
        const res = await ctx.request({ severity: 'urgent', note: '  chest pain ', address: 'Sector 17' });
        assert.equal(res.status, 201);
        const d = res.body.dispatch;
        assert.equal(res.body.queued, false);
        assert.equal(d.status, 'en_route');
        assert.equal(d.note, 'chest pain');
        assert.equal(d.hospitalId, 41);
        assert.match(d.callSign, /^A41-/);
        assert.equal(d.destHospitalId, 41, 'nearest hospital with a bed');
        assert.equal(res.body.eta, '10');
        assert.ok(d.trackToken.length >= 10);

        // Base and destination are the same hospital, so there is no drive home.
        assert.deepEqual(d.legs.map((l) => l.phase), ['en_route', 'on_scene', 'transporting']);
        assert.deepEqual(d.legs[0].path[0], [30.726, 76.765]);
        assert.deepEqual(d.legs[0].path.at(-1), [PICKUP.lat, PICKUP.lng]);
        for (let i = 1; i < d.legs.length; i++) assert.equal(d.legs[i].startAt, d.legs[i - 1].endAt);

        const healing = await ctx.hospital(41);
        assert.equal(healing.ambulancesAvailable, 3);
        assert.equal(healing.deployed, 1);
        const unit = (await ctx.state()).units.find((u) => u.id === d.ambulanceId);
        assert.equal(unit.status, 'busy');
    });

    test('picks the fastest unit by road, not the straight-line nearest', async () => {
        ctx = await start({ fetchImpl: fakeOsrm({ [AT.healing]: 900, [AT.landmark]: 300, [AT.santokh]: 700 }) });
        const res = await ctx.request();
        assert.equal(res.body.dispatch.hospitalId, 53);
        assert.equal(res.body.eta, '5');
    });

    test('falls back to a distance-based estimate when OSRM is down', async () => {
        ctx = await start({ fetchImpl: async () => { throw new Error('network down'); } });
        const res = await ctx.request();
        assert.equal(res.status, 201);
        assert.equal(res.body.dispatch.routeSource, 'estimate');
        assert.ok(Number(res.body.eta) >= 1);
    });

    test('critical calls get an advanced life support unit when one is free', async () => {
        ctx = await start();
        const critical = await ctx.request({ severity: 'critical' });
        assert.equal(critical.body.dispatch.unitType, 'ALS');
        const standard = await ctx.request({ severity: 'standard' });
        assert.equal(standard.status, 201);
    });

    test('critical falls back to a basic unit when no advanced unit exists', async () => {
        ctx = await start();
        await ctx.onlyFleet(49, 1); // Harmony has only BLS
        const res = await ctx.request({ severity: 'critical' });
        assert.equal(res.body.dispatch.unitType, 'BLS');
    });

    test('destination matches the case type and needs a free bed', async () => {
        ctx = await start();
        const trauma = await ctx.request({ caseType: 'trauma' });
        const dest = await ctx.hospital(trauma.body.dispatch.destHospitalId);
        assert.ok(dest.capabilities.includes('trauma'));
        assert.equal(dest.id, 16, 'Santokh is the nearest trauma centre');
        // A different base and destination means the unit drives home afterwards.
        assert.equal(trauma.body.dispatch.legs.at(-1).phase, 'returning');

        await ctx.api('PATCH', '/api/hospitals/41', { bedsAvailable: 0 });
        const general = await ctx.request();
        assert.notEqual(general.body.dispatch.destHospitalId, 41, 'full hospital is skipped');
    });

    test('manual override of unit and destination', async () => {
        ctx = await start();
        const unit = (await ctx.unitsOf(96))[0]; // Alchemist, far side of town
        const res = await ctx.request({ ambulanceId: unit.id, destHospitalId: 63 });
        assert.equal(res.status, 201);
        assert.equal(res.body.dispatch.ambulanceId, unit.id);
        assert.equal(res.body.dispatch.destHospitalId, 63);

        const again = await ctx.request({ ambulanceId: unit.id });
        assert.equal(again.status, 409, 'unit is already busy');
        assert.equal((await ctx.request({ ambulanceId: 'nope' })).status, 404);
        assert.equal((await ctx.request({ destHospitalId: 12345 })).status, 404);
    });

    for (const [label, body] of [
        ['missing coords', { lat: undefined, lng: undefined }],
        ['null coords', { lat: null, lng: null }],
        ['non-numeric', { lat: 'abc', lng: 'def' }],
        ['out of range', { lat: 91, lng: 76 }],
        ['bad severity', { severity: 'meh' }],
        ['bad case type', { caseType: 'flu' }],
    ]) {
        test(`400 on ${label}`, async () => {
            ctx = await start();
            assert.equal((await ctx.request(body)).status, 400);
        });
    }

    test('rejects locations outside the service area', async () => {
        ctx = await start();
        const res = await ctx.request({ lat: 0, lng: 0 });
        assert.equal(res.status, 422);
    });

    test('rate limits per client', async () => {
        ctx = await start({ rateLimit: { windowMs: 60000, max: 2 } });
        assert.equal((await ctx.request()).status, 201);
        assert.equal((await ctx.request()).status, 201);
        const res = await ctx.request();
        assert.equal(res.status, 429);
        assert.ok(res.headers.get('retry-after'));
    });
});

describe('queue', () => {
    test('requests wait when nothing is free and are served most-severe first', async () => {
        ctx = await start();
        await ctx.onlyFleet(41, 0);
        const standard = await ctx.request({ severity: 'standard' });
        assert.equal(standard.status, 201);
        assert.equal(standard.body.queued, true);
        assert.equal(standard.body.dispatch.status, 'queued');
        assert.equal(standard.body.eta, null);
        const critical = await ctx.request({ severity: 'critical' });
        assert.equal(critical.body.queued, true);
        assert.equal((await ctx.api('GET', '/api/stats')).body.queued, 2);

        // One ambulance appears: the critical call gets it even though it came later.
        await ctx.api('PUT', '/api/hospitals/41', { ambulancesAvailable: 1 });
        const live = (await ctx.state()).dispatches;
        assert.equal(live.find((d) => d.id === critical.body.dispatch.id).status, 'en_route');
        assert.equal(live.find((d) => d.id === standard.body.dispatch.id).status, 'queued');
        assert.deepEqual(ctx.eventsFor(critical.body.dispatch.id), ['queued', 'assigned']);
    });

    test('a finishing trip hands its unit to the queue', async () => {
        ctx = await start(FAST);
        await ctx.onlyFleet(41, 1);
        const first = await ctx.request();
        const second = await ctx.request();
        assert.equal(second.body.queued, true);
        await sleep(400);
        const history = (await ctx.api('GET', '/api/dispatches/history')).body.data;
        assert.equal(history.length, 2);
        assert.ok(history.every((d) => d.status === 'completed'));
        assert.equal(history.find((d) => d.id === second.body.dispatch.id).ambulanceId, first.body.dispatch.ambulanceId);
    });

    test('concurrent requests never double-book a unit', async () => {
        ctx = await start();
        await ctx.onlyFleet(41, 2);
        const results = await Promise.all(Array.from({ length: 8 }, () => ctx.request()));
        assert.ok(results.every((r) => r.status === 201));
        const assigned = results.filter((r) => !r.body.queued).map((r) => r.body.dispatch.ambulanceId);
        assert.equal(assigned.length, 2);
        assert.equal(new Set(assigned).size, 2);
        assert.equal(results.filter((r) => r.body.queued).length, 6);
        assert.equal((await ctx.hospital(41)).ambulancesAvailable, 0);
    });
});

describe('re-assignment', () => {
    test('a critical call diverts a unit already heading to a standard call', async () => {
        ctx = await start();
        await ctx.onlyFleet(41, 1);
        const standard = await ctx.request({ severity: 'standard' });
        assert.equal(standard.body.dispatch.status, 'en_route');
        const unitId = standard.body.dispatch.ambulanceId;

        const critical = await ctx.request({ severity: 'critical', lat: 30.735, lng: 76.775 });
        assert.equal(critical.body.dispatch.status, 'en_route');
        assert.equal(critical.body.dispatch.ambulanceId, unitId);
        assert.deepEqual(ctx.eventsFor(critical.body.dispatch.id), ['diverted']);

        const bumped = (await ctx.state()).dispatches.find((d) => d.id === standard.body.dispatch.id);
        assert.equal(bumped.status, 'queued');
        assert.equal(bumped.ambulanceId, null);
        assert.ok(ctx.eventsFor(bumped.id).includes('diverted_away'));
    });

    test('urgent calls are never bumped, and a free unit is preferred when it is about as fast', async () => {
        ctx = await start();
        await ctx.onlyFleet(41, 1);
        const urgent = await ctx.request({ severity: 'urgent' });
        const critical = await ctx.request({ severity: 'critical' });
        assert.equal(critical.body.queued, true);
        assert.equal((await ctx.state()).dispatches.find((d) => d.id === urgent.body.dispatch.id).status, 'en_route');
    });

    test('with a free unit nearby, the standard call is left alone', async () => {
        ctx = await start();
        await ctx.onlyFleet(41, 2);
        const standard = await ctx.request({ severity: 'standard' });
        const critical = await ctx.request({ severity: 'critical' });
        assert.notEqual(critical.body.dispatch.ambulanceId, standard.body.dispatch.ambulanceId);
        assert.equal((await ctx.state()).dispatches.find((d) => d.id === standard.body.dispatch.id).status, 'en_route');
    });

    test('a newly free, much closer unit takes over a call in progress', async () => {
        // The only unit starts far away (Alchemist): a 50 minute drive.
        ctx = await start({ timeScale: 1, fetchImpl: fakeOsrm({ '30.686,76.855': 3000, [AT.healing]: 200 }) });
        await ctx.onlyFleet(96, 1);
        const res = await ctx.request();
        const farUnit = res.body.dispatch.ambulanceId;
        assert.equal(res.body.dispatch.hospitalId, 96);

        // An ambulance comes into service right next to the patient.
        await ctx.api('POST', '/api/ambulances', { hospitalId: 41, type: 'BLS' });
        const d = (await ctx.state()).dispatches.find((x) => x.id === res.body.dispatch.id);
        assert.equal(d.hospitalId, 41);
        assert.notEqual(d.ambulanceId, farUnit);
        assert.equal(d.durationS, 200);
        assert.deepEqual(ctx.eventsFor(d.id), ['created', 'swapped']);
        const far = (await ctx.state()).units.find((u) => u.id === farUnit);
        assert.equal(far.status, 'available', 'the original unit is stood down');
    });

    test('a unit driving home can be sent straight to a new call', async () => {
        ctx = await start({ ...FAST, maxTravelMs: 150, minTravelMs: 150 });
        await ctx.onlyFleet(41, 1);
        // Trauma goes to Santokh, so the Healing unit has a drive home afterwards.
        const first = await ctx.request({ caseType: 'trauma' });
        let returning;
        for (let i = 0; i < 40 && !returning; i++) {
            await sleep(20);
            returning = (await ctx.state()).dispatches.find((d) => d.id === first.body.dispatch.id && d.status === 'returning');
        }
        assert.ok(returning, 'first trip reached its returning leg');
        const unit = (await ctx.state()).units.find((u) => u.id === first.body.dispatch.ambulanceId);
        assert.equal(unit.status, 'returning');

        const second = await ctx.request();
        assert.equal(second.body.dispatch.ambulanceId, unit.id);
        // It sets off from where it is on the road, not from base.
        assert.notDeepEqual(second.body.dispatch.legs[0].path[0], [30.726, 76.765]);
        const history = (await ctx.api('GET', '/api/dispatches/history')).body.data;
        assert.equal(history.find((d) => d.id === first.body.dispatch.id).status, 'completed');
    });
});

describe('trip lifecycle', () => {
    test('runs through every phase, uses a bed, and frees the unit', async () => {
        ctx = await start(FAST);
        const before = await ctx.hospital(16);
        const res = await ctx.request({ caseType: 'trauma' });
        const { id, ambulanceId } = res.body.dispatch;
        await sleep(450);

        assert.deepEqual(ctx.eventsFor(id), ['created', 'on_scene', 'transporting', 'returning', 'completed']);
        assert.equal((await ctx.hospital(16)).bedsAvailable, before.bedsAvailable - 1);
        assert.equal((await ctx.state()).units.find((u) => u.id === ambulanceId).status, 'available');
        assert.equal((await ctx.state()).dispatches.length, 0);

        const [row] = (await ctx.api('GET', '/api/dispatches/history')).body.data;
        assert.equal(row.status, 'completed');
        assert.equal(row.responseS, 600);
        assert.ok(row.arrivedAt >= row.assignedAt && row.deliveredAt >= row.arrivedAt && row.completedAt >= row.deliveredAt);
    });

    test('cancel frees the unit immediately, once', async () => {
        ctx = await start();
        const res = await ctx.request();
        const { id, ambulanceId } = res.body.dispatch;
        assert.equal((await ctx.api('POST', `/api/dispatches/${id}/cancel`, {})).status, 200);
        assert.equal((await ctx.state()).units.find((u) => u.id === ambulanceId).status, 'available');
        assert.equal((await ctx.api('POST', `/api/dispatches/${id}/cancel`, {})).status, 404);
        const [row] = (await ctx.api('GET', '/api/dispatches/history')).body.data;
        assert.equal(row.status, 'cancelled');
    });

    test('a queued request can be cancelled', async () => {
        ctx = await start();
        await ctx.onlyFleet(41, 0);
        const res = await ctx.request();
        assert.equal((await ctx.api('POST', `/api/dispatches/${res.body.dispatch.id}/cancel`, {})).status, 200);
        assert.equal((await ctx.state()).dispatches.length, 0);
    });
});

describe('fleet management', () => {
    test('quick count adds basic units and retires parked ones', async () => {
        ctx = await start();
        const up = await ctx.api('PUT', '/api/hospitals/41', { ambulancesAvailable: 6 });
        assert.equal(up.body.data.ambulancesAvailable, 6);
        const units = await ctx.unitsOf(41);
        assert.equal(units.length, 6);
        assert.equal(new Set(units.map((u) => u.callSign)).size, 6, 'call signs are unique');

        await ctx.api('PUT', '/api/hospitals/41', { ambulancesAvailable: 1 });
        const left = await ctx.unitsOf(41);
        assert.equal(left.length, 1);
        assert.equal(left[0].type, 'ALS', 'basic units are retired first');
    });

    for (const bad of [-1, 1.5, '5', null, 1000]) {
        test(`rejects count ${JSON.stringify(bad)}`, async () => {
            ctx = await start();
            assert.equal((await ctx.api('PUT', '/api/hospitals/41', { ambulancesAvailable: bad })).status, 400);
            assert.equal((await ctx.hospital(41)).ambulancesAvailable, 4);
        });
    }

    test('busy units are untouched by the quick count and cannot be removed', async () => {
        ctx = await start();
        const res = await ctx.request();
        const busy = res.body.dispatch.ambulanceId;
        await ctx.api('PUT', '/api/hospitals/41', { ambulancesAvailable: 0 });
        const left = await ctx.unitsOf(41);
        assert.deepEqual(left.map((u) => u.id), [busy]);
        assert.equal((await ctx.api('DELETE', `/api/ambulances/${busy}`)).status, 409);
        assert.equal((await ctx.api('PATCH', `/api/ambulances/${busy}`, { inService: false })).status, 409);
    });

    test('add, edit, take out of service and remove a unit', async () => {
        ctx = await start();
        const added = await ctx.api('POST', '/api/ambulances', { hospitalId: 49, type: 'ALS', crew: ' Asha & Ravi ' });
        assert.equal(added.status, 201);
        assert.equal(added.body.data.crew, 'Asha & Ravi');
        const id = added.body.data.id;

        const off = await ctx.api('PATCH', `/api/ambulances/${id}`, { inService: false, type: 'BLS' });
        assert.equal(off.body.data.status, 'out_of_service');
        assert.equal(off.body.data.type, 'BLS');
        const harmony = await ctx.hospital(49);
        assert.equal(harmony.units, 3);
        assert.equal(harmony.ambulancesAvailable, 2);
        assert.equal(harmony.outOfService, 1);

        // An out-of-service unit is never dispatched.
        await ctx.onlyFleet(49, 0);
        assert.equal((await ctx.request()).body.queued, true);

        assert.equal((await ctx.api('POST', '/api/ambulances', { hospitalId: 49, type: 'XXL' })).status, 400);
        assert.equal((await ctx.api('POST', '/api/ambulances', { hospitalId: 9999, type: 'BLS' })).status, 404);
        assert.equal((await ctx.api('DELETE', `/api/ambulances/${id}`)).status, 200);
        assert.equal((await ctx.api('DELETE', `/api/ambulances/${id}`)).status, 404);
    });
});

describe('hospital management', () => {
    test('create, edit, move and delete', async () => {
        ctx = await start();
        const created = await ctx.api('POST', '/api/hospitals', { name: ' City Care ', lat: 30.75, lng: 76.79, bedsAvailable: 5, capabilities: ['trauma'] });
        assert.equal(created.status, 201);
        const id = created.body.data.id;
        assert.equal(created.body.data.name, 'City Care');
        assert.equal(created.body.data.units, 0);

        const moved = await ctx.api('PATCH', `/api/hospitals/${id}`, { lat: 30.76, lng: 76.8, capabilities: ['trauma', 'cardiac'] });
        assert.equal(moved.body.data.lat, 30.76);
        assert.deepEqual(moved.body.data.capabilities, ['trauma', 'cardiac']);

        await ctx.api('POST', '/api/ambulances', { hospitalId: id, type: 'BLS' });
        await ctx.addUser('citycare', 'hospital_admin', id);
        assert.equal((await ctx.api('DELETE', `/api/hospitals/${id}`)).status, 200);
        const state = await ctx.state();
        assert.equal(state.hospitals.length, 12);
        assert.equal(state.units.filter((u) => u.hospitalId === id).length, 0);
        // Its admin loses the role rather than keeping rights over nothing.
        assert.equal((await ctx.api('GET', '/api/users')).body.data.find((u) => u.username === 'citycare').role, 'viewer');
    });

    test('validation', async () => {
        ctx = await start();
        assert.equal((await ctx.api('POST', '/api/hospitals', { name: '', lat: 30.7, lng: 76.7 })).status, 400);
        assert.equal((await ctx.api('POST', '/api/hospitals', { name: 'X', lat: 'a', lng: 76.7 })).status, 400);
        assert.equal((await ctx.api('PATCH', '/api/hospitals/41', { bedsAvailable: -1 })).status, 400);
        assert.equal((await ctx.api('PATCH', '/api/hospitals/41', { capabilities: ['magic'] })).status, 400);
        assert.equal((await ctx.api('PATCH', '/api/hospitals/9999', { bedsAvailable: 1 })).status, 404);
    });

    test('a hospital with a unit on a call cannot be deleted', async () => {
        ctx = await start();
        await ctx.request();
        assert.equal((await ctx.api('DELETE', '/api/hospitals/41')).status, 409);
    });
});

describe('analytics, export and tracking', () => {
    test('analytics summarise finished and cancelled calls', async () => {
        ctx = await start(FAST);
        await ctx.request({ severity: 'critical' });
        const second = await ctx.request({ severity: 'standard' });
        await ctx.api('POST', `/api/dispatches/${second.body.dispatch.id}/cancel`, {});
        await sleep(350);

        const a = (await ctx.api('GET', '/api/analytics?days=7')).body;
        assert.equal(a.totals.total, 2);
        assert.equal(a.totals.completed, 1);
        assert.equal(a.totals.cancelled, 1);
        assert.equal(a.totals.avgResponseMinutes, 10);
        assert.equal(a.byHour.length, 24);
        assert.equal(a.byHour.reduce((s, h) => s + h.count, 0), 2);
        assert.equal(a.bySeverity.find((s) => s.severity === 'critical').count, 1);
        assert.equal(a.points.length, 2);
        assert.equal(a.byDay.length, 1);

        const stats = (await ctx.api('GET', '/api/stats')).body;
        assert.equal(stats.today.total, 2);
        assert.equal(stats.today.avgResponseMinutes, 10);
    });

    test('CSV export is well-formed and neutralises spreadsheet formulas', async () => {
        ctx = await start();
        await ctx.request({ note: '=HYPERLINK("http://evil")', address: 'Plot 4, "Green" Lane' });
        const res = await ctx.api('GET', '/api/analytics/export.csv');
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type'), /text\/csv/);
        assert.match(res.headers.get('content-disposition'), /attachment/);
        const [header, row] = res.text.trim().split('\r\n');
        assert.ok(header.startsWith('created_at,status,severity'));
        assert.ok(row.includes(`"'=HYPERLINK(""http://evil"")"`), row);
        assert.ok(row.includes('"Plot 4, ""Green"" Lane"'));
    });

    test('tracking link works without signing in and hides staff details', async () => {
        ctx = await start();
        const res = await ctx.request({ note: 'private note', address: 'Sector 17' });
        const token = res.body.dispatch.trackToken;
        const track = await ctx.api('GET', `/api/track/${token}`, undefined, null);
        assert.equal(track.status, 200);
        assert.equal(track.body.status, 'en_route');
        assert.equal(track.body.address, 'Sector 17');
        assert.equal(track.body.legs.length, 3);
        assert.ok(track.body.serverNow);
        assert.ok(!JSON.stringify(track.body).includes('private note'));
        assert.equal(track.body.createdBy, undefined);

        // Still resolves (without live route) once the trip is over.
        await ctx.api('POST', `/api/dispatches/${res.body.dispatch.id}/cancel`, {});
        const after = await ctx.api('GET', `/api/track/${token}`, undefined, null);
        assert.equal(after.body.status, 'cancelled');
        assert.deepEqual(after.body.legs, []);

        assert.equal((await ctx.api('GET', '/api/track/not-a-real-token', undefined, null)).status, 404);
        assert.equal((await ctx.api('GET', '/api/track/x', undefined, null)).status, 404);
    });

    test('tracking shows the place in the queue', async () => {
        ctx = await start();
        await ctx.onlyFleet(41, 0);
        await ctx.request({ severity: 'critical' });
        const second = await ctx.request({ severity: 'standard' });
        const track = await ctx.api('GET', `/api/track/${second.body.dispatch.trackToken}`, undefined, null);
        assert.equal(track.body.status, 'queued');
        assert.equal(track.body.queuePosition, 2);
    });
});

describe('geocoding', () => {
    const nominatim = (calls) => async (url) => {
        calls.push(url);
        if (url.includes('/search')) {
            return { ok: true, json: async () => [{ display_name: 'Sector 17, Chandigarh', lat: '30.74', lon: '76.78' }, { display_name: 'bad', lat: 'x', lon: 'y' }] };
        }
        return { ok: true, json: async () => ({ address: { road: 'Jan Marg', suburb: 'Sector 17', city: 'Chandigarh' } }) };
    };

    test('reverse lookup formats an address and caches it', async () => {
        const calls = [];
        ctx = await start({ nominatimUrl: 'http://nominatim.test', fetchImpl: nominatim(calls) });
        const url = `/api/geocode/reverse?lat=${PICKUP.lat}&lng=${PICKUP.lng}`;
        assert.equal((await ctx.api('GET', url)).body.address, 'Jan Marg, Sector 17, Chandigarh');
        await ctx.api('GET', url);
        assert.equal(calls.length, 1);
    });

    test('place search returns usable results, biased to the service area', async () => {
        const calls = [];
        ctx = await start({ nominatimUrl: 'http://nominatim.test', fetchImpl: nominatim(calls) });
        const res = await ctx.api('GET', '/api/geocode/search?q=sector%2017');
        assert.deepEqual(res.body.data, [{ label: 'Sector 17, Chandigarh', lat: 30.74, lng: 76.78 }]);
        assert.match(calls[0], /viewbox=/);
        assert.equal((await ctx.api('GET', '/api/geocode/search?q=ab')).status, 400);
    });

    test('geocoder outages degrade quietly', async () => {
        ctx = await start({ nominatimUrl: 'http://nominatim.test', fetchImpl: async () => { throw new Error('down'); } });
        assert.equal((await ctx.api('GET', `/api/geocode/reverse?lat=${PICKUP.lat}&lng=${PICKUP.lng}`)).body.address, null);
        assert.deepEqual((await ctx.api('GET', '/api/geocode/search?q=sector')).body.data, []);
    });
});
