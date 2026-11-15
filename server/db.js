// Database layer. Runs on PostgreSQL when a connection URL is given
// (DATABASE_URL), otherwise on a local SQLite file, which keeps development
// and tests zero-setup. Both expose the same tiny promise API:
//   run(sql, params) -> { changes }   get(...) -> row | undefined   all(...) -> rows
// SQL is written once with `?` placeholders and snake_case columns; rows come
// back with camelCase keys on both engines.

const path = require('path');
const crypto = require('crypto');

const DEFAULT_SQLITE_PATH = path.resolve(__dirname, 'ambulance.db');

const camel = (key) => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const camelRow = (row) => {
    if (!row) return row;
    const out = {};
    for (const key of Object.keys(row)) out[camel(key)] = row[key];
    return out;
};

const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS hospitals (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        beds_available INTEGER NOT NULL DEFAULT 20,
        capabilities TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS ambulances (
        id TEXT PRIMARY KEY,
        call_sign TEXT NOT NULL,
        type TEXT NOT NULL,
        hospital_id INTEGER NOT NULL,
        in_service INTEGER NOT NULL DEFAULT 1,
        crew TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS dispatches (
        id TEXT PRIMARY KEY,
        track_token TEXT NOT NULL,
        status TEXT NOT NULL,
        severity TEXT NOT NULL,
        case_type TEXT NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        address TEXT,
        note TEXT,
        ambulance_id TEXT,
        call_sign TEXT,
        hospital_id INTEGER,
        hospital_name TEXT,
        dest_hospital_id INTEGER,
        dest_hospital_name TEXT,
        distance_m DOUBLE PRECISION,
        duration_s DOUBLE PRECISION,
        response_s DOUBLE PRECISION,
        route_source TEXT,
        requested_ambulance_id TEXT,
        requested_dest_id INTEGER,
        created_by TEXT,
        created_at BIGINT NOT NULL,
        assigned_at BIGINT,
        arrived_at BIGINT,
        delivered_at BIGINT,
        completed_at BIGINT
    )`,
    "CREATE INDEX IF NOT EXISTS idx_dispatches_created ON dispatches (created_at)",
    "CREATE INDEX IF NOT EXISTS idx_dispatches_token ON dispatches (track_token)",
    `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        hospital_id INTEGER,
        created_at BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )`,
];

// Starter data for a fresh database: hospitals around Chandigarh with a small
// mixed fleet each. `als` = advanced life support units, `bls` = basic.
const SEED_HOSPITALS = [
    { id: 16, name: "Santokh Hospital", lat: 30.7130, lng: 76.7840, als: 1, bls: 3, beds: 24, capabilities: 'trauma' },
    { id: 25, name: "Max Super Specialty Hospital", lat: 30.7420, lng: 76.7260, als: 2, bls: 3, beds: 60, capabilities: 'trauma,cardiac' },
    { id: 41, name: "Healing Hospital", lat: 30.7260, lng: 76.7650, als: 1, bls: 3, beds: 30, capabilities: 'cardiac' },
    { id: 49, name: "Harmony Hospital", lat: 30.6420, lng: 76.8160, als: 0, bls: 2, beds: 12, capabilities: '' },
    { id: 51, name: "IVY Hospital Mohali", lat: 30.7070, lng: 76.7110, als: 2, bls: 3, beds: 45, capabilities: 'trauma,cardiac' },
    { id: 53, name: "Landmark Hospital", lat: 30.7180, lng: 76.7580, als: 1, bls: 2, beds: 20, capabilities: '' },
    { id: 58, name: "Dhawan Hospital", lat: 30.6970, lng: 76.8450, als: 0, bls: 2, beds: 14, capabilities: '' },
    { id: 59, name: "Command Hospital", lat: 30.6900, lng: 76.8700, als: 1, bls: 3, beds: 40, capabilities: 'trauma' },
    { id: 63, name: "Fortis Hospital Mohali", lat: 30.6940, lng: 76.7380, als: 2, bls: 2, beds: 55, capabilities: 'trauma,cardiac' },
    { id: 67, name: "Eden Critical Care Hospital", lat: 30.7050, lng: 76.7950, als: 1, bls: 1, beds: 16, capabilities: 'cardiac' },
    { id: 74, name: "Park Hospital", lat: 30.6750, lng: 76.7350, als: 0, bls: 2, beds: 18, capabilities: '' },
    { id: 96, name: "Alchemist Hospital Panchkula", lat: 30.6860, lng: 76.8550, als: 2, bls: 3, beds: 50, capabilities: 'trauma,cardiac' },
];

function openSqlite(file) {
    const sqlite3 = require('sqlite3');
    return new Promise((resolve, reject) => {
        const raw = new sqlite3.Database(file, (err) => {
            if (err) return reject(err);
            resolve({
                dialect: 'sqlite',
                run: (sql, params = []) => new Promise((res, rej) => {
                    raw.run(sql, params, function (e) { e ? rej(e) : res({ changes: this.changes }); });
                }),
                get: (sql, params = []) => new Promise((res, rej) => {
                    raw.get(sql, params, (e, row) => (e ? rej(e) : res(camelRow(row))));
                }),
                all: (sql, params = []) => new Promise((res, rej) => {
                    raw.all(sql, params, (e, rows) => (e ? rej(e) : res(rows.map(camelRow))));
                }),
                close: () => new Promise((res, rej) => raw.close((e) => (e ? rej(e) : res()))),
            });
        });
    });
}

async function openPostgres(url, schema) {
    const pg = require('pg');
    // Counts and millisecond timestamps are BIGINT; they fit safely in a JS number.
    pg.types.setTypeParser(20, Number);
    pg.types.setTypeParser(1700, Number);

    if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid schema name');
    if (schema) {
        const client = new pg.Client({ connectionString: url });
        await client.connect();
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
        await client.end();
    }
    const pool = new pg.Pool({
        connectionString: url,
        max: 5,
        ...(schema ? { options: `-c search_path=${schema}` } : {}),
    });
    pool.on('error', (err) => console.error('Postgres pool error:', err.message));

    // `?` -> $1, $2 ... (none of our SQL contains a literal question mark)
    const convert = (sql) => {
        let n = 0;
        return sql.replace(/\?/g, () => `$${++n}`);
    };
    return {
        dialect: 'postgres',
        run: async (sql, params = []) => ({ changes: (await pool.query(convert(sql), params)).rowCount }),
        get: async (sql, params = []) => camelRow((await pool.query(convert(sql), params)).rows[0]),
        all: async (sql, params = []) => (await pool.query(convert(sql), params)).rows.map(camelRow),
        close: async () => {
            await pool.end();
        },
        dropSchema: async () => {
            if (!schema) return;
            const client = new pg.Client({ connectionString: url });
            await client.connect();
            await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
            await client.end();
        },
    };
}

async function insertUnits(db, hospitalId, als, bls, startIndex = 1) {
    let n = startIndex;
    for (const [type, count] of [['ALS', als], ['BLS', bls]]) {
        for (let i = 0; i < count; i++, n++) {
            await db.run(
                "INSERT INTO ambulances (id, call_sign, type, hospital_id, in_service) VALUES (?, ?, ?, ?, 1)",
                [crypto.randomUUID(), `A${hospitalId}-${String(n).padStart(2, '0')}`, type, hospitalId]
            );
        }
    }
}

// Version 1 stored a bare ambulance count per hospital. Keep the old tables
// (renamed) and carry hospitals and their counts over to the new model.
async function migrateSqliteV1(db) {
    const columns = (await db.all("PRAGMA table_info(hospitals)")).map(c => c.name);
    if (!columns.includes('ambulancesAvailable')) return false;

    const old = await db.all("SELECT * FROM hospitals");
    await db.run("ALTER TABLE hospitals RENAME TO hospitals_v1");
    const tables = (await db.all("SELECT name FROM sqlite_master WHERE type = 'table'")).map(t => t.name);
    if (tables.includes('dispatches')) {
        await db.run("DROP INDEX IF EXISTS idx_dispatches_created");
        await db.run("ALTER TABLE dispatches RENAME TO dispatches_v1");
    }
    for (const sql of SCHEMA) await db.run(sql);

    for (const h of old) {
        if (h.lat == null || h.lng == null) continue;
        const seed = SEED_HOSPITALS.find(s => s.id === h.id);
        await db.run(
            "INSERT INTO hospitals (id, name, lat, lng, beds_available, capabilities) VALUES (?, ?, ?, ?, ?, ?)",
            [h.id, h.name, h.lat, h.lng, seed?.beds ?? 20, seed?.capabilities ?? '']
        );
        const total = Math.max(0, Math.min(999, h.ambulancesAvailable || 0));
        const als = Math.round(total / 4); // roughly one advanced unit in four
        await insertUnits(db, h.id, als, total - als);
    }
    console.log(`Migrated ${old.length} hospitals from the previous database format (old tables kept as *_v1).`);
    return true;
}

async function openDatabase({ url, schema, sqlitePath = DEFAULT_SQLITE_PATH } = {}) {
    const db = url ? await openPostgres(url, schema) : await openSqlite(sqlitePath);

    const migrated = db.dialect === 'sqlite' && sqlitePath !== ':memory:'
        ? await migrateSqliteV1(db).catch((err) => {
            // A brand-new file has no hospitals table yet; that is not an error.
            if (/no such table/i.test(err.message)) return false;
            throw err;
        })
        : false;

    if (!migrated) for (const sql of SCHEMA) await db.run(sql);

    const { count } = await db.get("SELECT count(*) AS count FROM hospitals");
    if (count === 0) {
        for (const h of SEED_HOSPITALS) {
            await db.run(
                "INSERT INTO hospitals (id, name, lat, lng, beds_available, capabilities) VALUES (?, ?, ?, ?, ?, ?)",
                [h.id, h.name, h.lat, h.lng, h.beds, h.capabilities]
            );
            await insertUnits(db, h.id, h.als, h.bls);
        }
        console.log(`Database seeded (${db.dialect}).`);
    }

    // Trips in progress when the process stopped can't be resumed (their route
    // and timers lived in memory), so close them out. Queued requests survive.
    const closed = await db.run(
        "UPDATE dispatches SET status = 'completed', completed_at = ? WHERE status NOT IN ('completed', 'cancelled', 'queued')",
        [Date.now()]
    );
    if (closed.changes) console.log(`Closed ${closed.changes} trip(s) interrupted by a restart.`);

    return db;
}

module.exports = { openDatabase, SEED_HOSPITALS, DEFAULT_SQLITE_PATH };
