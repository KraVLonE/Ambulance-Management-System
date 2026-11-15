// Authentication: scrypt password hashes and a signed, httpOnly session cookie.
// No external auth dependencies; everything is Node's built-in crypto.

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const COOKIE = 'ams_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What each role may do:
 *   admin          everything, including users and hospitals
 *   dispatcher     create / cancel dispatches, choose units manually
 *   hospital_admin manage the fleet and beds of their own hospital
 *   viewer         read-only (wall display)
 */
const ROLES = ['admin', 'dispatcher', 'hospital_admin', 'viewer'];

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(password, salt, 32);
    return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
    const [scheme, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
    return crypto.timingSafeEqual(expected, actual);
}

function validateCredentials(username, password) {
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
        return "Username must be 3-32 characters: letters, numbers, dot, dash or underscore.";
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
        return "Password must be at least 8 characters.";
    }
    return null;
}

const sign = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

function createToken(userId, secret, now = Date.now()) {
    const payload = Buffer.from(JSON.stringify({ uid: userId, exp: now + SESSION_MS })).toString('base64url');
    return `${payload}.${sign(payload, secret)}`;
}

// Returns the user id, or null if the token is missing, forged or expired.
function readToken(token, secret, now = Date.now()) {
    if (typeof token !== 'string') return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = sign(payload, secret);
    if (signature.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try {
        const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
        return typeof exp === 'number' && exp > now ? uid : null;
    } catch {
        return null;
    }
}

function parseCookies(header) {
    const cookies = {};
    for (const part of String(header || '').split(';')) {
        const index = part.indexOf('=');
        if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    }
    return cookies;
}

function setSessionCookie(res, token, secure) {
    const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(SESSION_MS / 1000)}`];
    if (secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

const publicUser = (user) => user && ({
    id: user.id,
    username: user.username,
    role: user.role,
    hospitalId: user.hospitalId ?? null,
});

// The signing secret is generated once and kept in the database so sessions
// survive restarts. SESSION_SECRET overrides it (needed if several instances
// ever share one database).
async function loadSecret(db) {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    const row = await db.get("SELECT value FROM settings WHERE key = ?", ['session_secret']);
    if (row) return row.value;
    const secret = crypto.randomBytes(32).toString('base64url');
    await db.run("INSERT INTO settings (key, value) VALUES (?, ?)", ['session_secret', secret]);
    return secret;
}

async function userFromCookieHeader(db, secret, cookieHeader) {
    const uid = readToken(parseCookies(cookieHeader)[COOKIE], secret);
    if (!uid) return null;
    return (await db.get("SELECT id, username, role, hospital_id FROM users WHERE id = ?", [uid])) || null;
}

module.exports = {
    ROLES, COOKIE, hashPassword, verifyPassword, validateCredentials, createToken, readToken,
    parseCookies, setSessionCookie, clearSessionCookie, publicUser, loadSecret, userFromCookieHeader,
};
