const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'ambulance.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database ' + dbPath + ': ' + err.message);
    } else {
        console.log('Connected to the SQLite database.');
    }
});

function initializeDatabase() {
    db.serialize(() => {
        // Create Hospitals Table
        db.run(`CREATE TABLE IF NOT EXISTS hospitals (
            id INTEGER PRIMARY KEY,
            name TEXT,
            ambulancesAvailable INTEGER,
            isHospital INTEGER,
            lat REAL,
            lng REAL
        )`);

        // Check if data exists, if not seed it
        db.get("SELECT count(*) as count FROM hospitals", (err, row) => {
            if (err) {
                return console.error(err.message);
            }
            if (row.count === 0) {
                console.log("Seeding database...");
                seedDatabase();
            } else {
                db.get("SELECT lat FROM hospitals WHERE id = 16", (err, row) => {
                    if (!row || !row.lat) {
                        console.log("Updating database with coordinates...");
                        updateDatabaseCoords();
                    }
                });
            }
        });
    });
}

const hospitalsData = [
    { id: 16, name: "Santokh Hospital", ambulancesAvailable: 24, lat: 30.7130, lng: 76.7840 }, // Sec 38
    { id: 25, name: "Max Super Specialty Hospital", ambulancesAvailable: 25, lat: 30.7420, lng: 76.7260 }, // Mohali Phase 6
    { id: 41, name: "Healing Hospital", ambulancesAvailable: 23, lat: 30.7260, lng: 76.7650 }, // Sec 34
    { id: 49, name: "Harmony Hospital", ambulancesAvailable: 12, lat: 30.6420, lng: 76.8160 }, // Zirakpur (approx)
    { id: 51, name: "IVY Hospital Mohali", ambulancesAvailable: 25, lat: 30.7070, lng: 76.7110 }, // Sec 71 Mohali
    { id: 53, name: "Landmark Hospital", ambulancesAvailable: 14, lat: 30.7180, lng: 76.7580 }, // Sec 33
    { id: 58, name: "Dhawan Hospital", ambulancesAvailable: 11, lat: 30.6970, lng: 76.8450 }, // Panchkula Sec 7
    { id: 59, name: "Command Hospital", ambulancesAvailable: 16, lat: 30.6900, lng: 76.8700 }, // Chandimandir
    { id: 63, name: "Fortis Hospital Mohali", ambulancesAvailable: 17, lat: 30.6940, lng: 76.7380 }, // Sec 62 Mohali
    { id: 67, name: "Eden Critical Care Hospital", ambulancesAvailable: 10, lat: 30.7050, lng: 76.7950 }, // Ind Area
    { id: 74, name: "Park Hospital", ambulancesAvailable: 12, lat: 30.6750, lng: 76.7350 }, // Mohali Sec 69 (approx)
    { id: 96, name: "Alchemist Hospital Panchkula", ambulancesAvailable: 25, lat: 30.6860, lng: 76.8550 } // Sec 21 Panchkula
];

function seedDatabase() {
    const stmt = db.prepare("INSERT INTO hospitals (id, name, ambulancesAvailable, isHospital, lat, lng) VALUES (?, ?, ?, 1, ?, ?)");
    hospitalsData.forEach(hospital => {
        stmt.run(hospital.id, hospital.name, hospital.ambulancesAvailable, hospital.lat, hospital.lng);
    });
    stmt.finalize();
    console.log("Database seeded.");
}

function updateDatabaseCoords() {
    db.run("ALTER TABLE hospitals ADD COLUMN lat REAL", (err) => {
        db.run("ALTER TABLE hospitals ADD COLUMN lng REAL", (err) => {
            const stmt = db.prepare("UPDATE hospitals SET lat = ?, lng = ? WHERE id = ?");
            hospitalsData.forEach(hospital => {
                stmt.run(hospital.lat, hospital.lng, hospital.id);
            });
            stmt.finalize();
            console.log("Database coordinates updated.");
        });
    });
}

module.exports = {
    db,
    initializeDatabase
};
