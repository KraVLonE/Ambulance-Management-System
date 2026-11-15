const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const auth = require('../auth');
const { openDatabase } = require('../db');
const { haversine, pointAlong, LruCache } = require('../routing');
const { start, PG_URL } = require('./helpers');

describe('auth helpers', () => {
    test('password hashes verify and are salted', async () => {
        const a = await auth.hashPassword('correct horse');
        const b = await auth.hashPassword('correct horse');
        assert.notEqual(a, b);
        assert.equal(await auth.verifyPassword('correct horse', a), true);
        assert.equal(await auth.verifyPassword('wrong horse', a), false);
        assert.equal(await auth.verifyPassword('anything', 'not-a-hash'), false);
    });

    test('tokens expire and reject a different secret', () => {
        const token = auth.createToken('user-1', 'secret', 1000);
        assert.equal(auth.readToken(token, 'secret', 2000), 'user-1');
        assert.equal(auth.readToken(token, 'other-secret', 2000), null);
        assert.equal(auth.readToken(token, 'secret', 1000 + 8 * 24 * 60 * 60 * 1000), null);
        assert.equal(auth.readToken(undefined, 'secret'), null);
        assert.equal(auth.readToken('a.b.c', 'secret'), null);
    });

    test('cookie parsing', () => {
        assert.deepEqual(auth.parseCookies('a=1; ams_session=x.y; b=%20c'), { a: '1', ams_session: 'x.y', b: ' c' });
        assert.deepEqual(auth.parseCookies(undefined), {});
    });
});

describe('routing helpers', () => {
    test('haversine matches a known distance', () => {
        const km = haversine(30.7333, 76.7794, 28.6139, 77.2090) / 1000; // Chandigarh -> Delhi
        assert.ok(km > 225 && km < 245, `got ${km}`);
    });

    test('pointAlong interpolates by distance', () => {
        const line = [[0, 0], [0, 1], [0, 2]];
        assert.deepEqual(pointAlong(line, 0), [0, 0]);
        assert.deepEqual(pointAlong(line, 1), [0, 2]);
        const [, lng] = pointAlong(line, 0.75);
        assert.ok(Math.abs(lng - 1.5) < 1e-9);
        assert.deepEqual(pointAlong([[5, 5]], 0.5), [5, 5]);
        assert.equal(pointAlong([], 0.5), null);
    });

    test('LRU cache evicts the least recently used entry', () => {
        const cache = new LruCache(2);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.get('a');
        cache.set('c', 3);
        assert.equal(cache.get('b'), undefined);
        assert.equal(cache.get('a'), 1);
    });
});

// These exercise SQLite files on disk, so they don't apply to the Postgres run.
describe('persistence', { skip: !!PG_URL }, () => {
    const tempDb = () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambulance-test-'));
        return { dir, file: path.join(dir, 'test.db'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
    };

    test('queued requests, users and sessions survive a restart; trips in progress are closed', async () => {
        const tmp = tempDb();
        try {
            let ctx = await start({ sqlitePath: tmp.file });
            const moving = await ctx.request();
            await ctx.onlyFleet(41, 0); // the busy unit stays; nothing else is free
            const waiting = await ctx.request({ severity: 'critical' });
            assert.equal(waiting.body.queued, true);
            const cookie = ctx.cookie('admin');
            await ctx.close();

            ctx = await start({ sqlitePath: tmp.file, setup: false });
            const state = await ctx.api('GET', '/api/state', undefined, cookie);
            assert.equal(state.status, 200, 'the old session cookie still works');
            // The interrupted trip is closed and its unit is free again, so the
            // queued critical call is picked up straight away.
            await ctx.engine.idle();
            const live = (await ctx.api('GET', '/api/state', undefined, cookie)).body.dispatches;
            assert.equal(live.length, 1);
            assert.equal(live[0].id, waiting.body.dispatch.id);
            assert.equal(live[0].status, 'en_route');
            const history = (await ctx.api('GET', '/api/dispatches/history', undefined, cookie)).body.data;
            assert.equal(history.find((d) => d.id === moving.body.dispatch.id).status, 'completed');
            await ctx.close();
        } finally {
            tmp.cleanup();
        }
    });

    test('a version 1 database is migrated without losing hospitals or counts', async () => {
        const tmp = tempDb();
        try {
            const sqlite3 = require('sqlite3');
            await new Promise((resolve, reject) => {
                const old = new sqlite3.Database(tmp.file);
                old.exec(`
                    CREATE TABLE hospitals (id INTEGER PRIMARY KEY, name TEXT, ambulancesAvailable INTEGER, isHospital INTEGER, lat REAL, lng REAL);
                    INSERT INTO hospitals VALUES (16, 'Santokh Renamed', 8, 1, 30.713, 76.784);
                    INSERT INTO hospitals VALUES (200, 'My Own Clinic', 3, 1, 30.70, 76.80);
                    INSERT INTO hospitals VALUES (201, 'No Coordinates', 3, 1, NULL, NULL);
                    CREATE TABLE dispatches (id TEXT PRIMARY KEY, hospitalId INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, status TEXT NOT NULL, createdAt INTEGER NOT NULL);
                    CREATE INDEX idx_dispatches_created ON dispatches (createdAt);
                    INSERT INTO dispatches VALUES ('d1', 16, 30.7, 76.7, 'completed', 1);
                `, (err) => old.close(() => (err ? reject(err) : resolve())));
            });

            const db = await openDatabase({ sqlitePath: tmp.file });
            const hospitals = await db.all('SELECT * FROM hospitals ORDER BY id');
            assert.deepEqual(hospitals.map((h) => h.name), ['Santokh Renamed', 'My Own Clinic']);
            assert.equal(hospitals[0].capabilities, 'trauma', 'known hospitals get their capabilities');
            const counts = await db.all('SELECT hospital_id, count(*) AS n FROM ambulances GROUP BY hospital_id ORDER BY hospital_id');
            assert.deepEqual(counts.map((c) => [c.hospitalId, c.n]), [[16, 8], [200, 3]]);
            assert.equal((await db.get('SELECT count(*) AS n FROM hospitals_v1')).n, 3, 'old data is kept');
            assert.equal((await db.get('SELECT count(*) AS n FROM dispatches_v1')).n, 1);
            await db.close();

            // Opening again must not migrate or seed twice.
            const again = await openDatabase({ sqlitePath: tmp.file });
            assert.equal((await again.get('SELECT count(*) AS n FROM ambulances')).n, 11);
            await again.close();
        } finally {
            tmp.cleanup();
        }
    });
});
