const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new sqlite3.Database('./scp_foundation.db');

// Initialize database with versioning
db.serialize(() => {
    // Users table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            clearance_level INTEGER DEFAULT 1,
            department TEXT,
            rank TEXT,
            is_admin BOOLEAN DEFAULT 0,
            is_super_admin BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME,
            version INTEGER DEFAULT 1,
            is_deleted BOOLEAN DEFAULT 0
        )
    `);

    // User version history
    db.run(`
        CREATE TABLE IF NOT EXISTS users_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT,
            password TEXT,
            clearance_level INTEGER,
            department TEXT,
            rank TEXT,
            is_admin BOOLEAN,
            is_super_admin BOOLEAN,
            version INTEGER,
            changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            changed_by INTEGER,
            change_type TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (changed_by) REFERENCES users(id)
        )
    `);

    // Code of Ethics table (current version)
    db.run(`
        CREATE TABLE IF NOT EXISTS code_of_ethics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clearance_level INTEGER NOT NULL,
            content TEXT NOT NULL,
            version INTEGER DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_by INTEGER,
            FOREIGN KEY (updated_by) REFERENCES users(id)
        )
    `);

    // Code of Ethics history table
    db.run(`
        CREATE TABLE IF NOT EXISTS code_of_ethics_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ethics_id INTEGER,
            clearance_level INTEGER NOT NULL,
            content TEXT NOT NULL,
            version INTEGER,
            changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            changed_by INTEGER,
            change_type TEXT,
            FOREIGN KEY (ethics_id) REFERENCES code_of_ethics(id),
            FOREIGN KEY (changed_by) REFERENCES users(id)
        )
    `);

    // Protocols table (current version)
    db.run(`
        CREATE TABLE IF NOT EXISTS protocols (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            clearance_level INTEGER NOT NULL,
            version INTEGER DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER,
            FOREIGN KEY (created_by) REFERENCES users(id)
        )
    `);

    // Protocols history table
    db.run(`
        CREATE TABLE IF NOT EXISTS protocols_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            protocol_id INTEGER,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            clearance_level INTEGER,
            version INTEGER,
            changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            changed_by INTEGER,
            change_type TEXT,
            FOREIGN KEY (protocol_id) REFERENCES protocols(id),
            FOREIGN KEY (changed_by) REFERENCES users(id)
        )
    `);

    // Lockdown Response Codes table (current version)
    db.run(`
        CREATE TABLE IF NOT EXISTS lockdown_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clearance_level INTEGER NOT NULL,
            code TEXT NOT NULL,
            description TEXT,
            version INTEGER DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_by INTEGER,
            FOREIGN KEY (updated_by) REFERENCES users(id)
        )
    `);

    // Lockdown codes history table
    db.run(`
        CREATE TABLE IF NOT EXISTS lockdown_codes_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lockdown_id INTEGER,
            clearance_level INTEGER NOT NULL,
            code TEXT NOT NULL,
            description TEXT,
            version INTEGER,
            changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            changed_by INTEGER,
            change_type TEXT,
            FOREIGN KEY (lockdown_id) REFERENCES lockdown_codes(id),
            FOREIGN KEY (changed_by) REFERENCES users(id)
        )
    `);

    // Logging table
    db.run(`
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT,
            action TEXT,
            page TEXT,
            details TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            ip_address TEXT,
            user_agent TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // Admin permissions table
    db.run(`
        CREATE TABLE IF NOT EXISTS admin_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER,
            can_edit_ethics BOOLEAN DEFAULT 0,
            can_edit_protocols BOOLEAN DEFAULT 0,
            can_edit_lockdown BOOLEAN DEFAULT 0,
            can_manage_users BOOLEAN DEFAULT 0,
            can_view_logs BOOLEAN DEFAULT 0,
            FOREIGN KEY (admin_id) REFERENCES users(id)
        )
    `);

    // Create default super admin if not exists
    const defaultPassword = bcrypt.hashSync('SCP-Admin-2024', 10);
    db.run(`
        INSERT OR IGNORE INTO users (username, password, clearance_level, is_admin, is_super_admin)
        VALUES ('super_admin', ?, 6, 1, 1)
    `, [defaultPassword]);

    // Create default ethics for all levels with version 1
    const defaultEthics = [
        { level: 1, content: 'Level 1: Standard Foundation Protocols - Follow all basic safety procedures and report any anomalies immediately.' },
        { level: 2, content: 'Level 2: Personnel must maintain confidentiality and follow containment procedures for Euclid-class entities.' },
        { level: 3, content: 'Level 3: Senior personnel must enforce strict containment protocols and oversee D-Class personnel operations.' },
        { level: 4, content: 'Level 4: Command staff must authorize all Keter-class containment procedures and maintain operational security.' },
        { level: 5, content: 'Level 5: O5 Council directives take precedence. Execute containment procedures without hesitation.' },
        { level: 6, content: 'Level 6: Administrator-level access. All ethics are subject to immediate revision based on global security needs.' }
    ];

    defaultEthics.forEach(ethics => {
        db.get('SELECT id FROM code_of_ethics WHERE clearance_level = ?', [ethics.level], (err, row) => {
            if (!row) {
                db.run(`
                    INSERT INTO code_of_ethics (clearance_level, content, version, is_active)
                    VALUES (?, ?, 1, 1)
                `, [ethics.level, ethics.content]);
            }
        });
    });

    // Create default lockdown codes with version 1
    const defaultLockdowns = [
        { level: 1, code: 'LOC-1', description: 'Standard lockdown - All personnel report to designated safe zones.' },
        { level: 2, code: 'LOC-2', description: 'Containment breach - Secure all Euclid-class containment units.' },
        { level: 3, code: 'LOC-3', description: 'Keter response - Immediate evacuation of affected sectors.' },
        { level: 4, code: 'LOC-4', description: 'Site-wide emergency - Activate all automated defenses.' },
        { level: 5, code: 'LOC-5', description: 'Overseer directive - Full site lockdown, no communication in/out.' },
        { level: 6, code: 'LOC-6', description: 'Global threat response - All Foundation assets mobilize.' }
    ];

    defaultLockdowns.forEach(lockdown => {
        db.get('SELECT id FROM lockdown_codes WHERE clearance_level = ?', [lockdown.level], (err, row) => {
            if (!row) {
                db.run(`
                    INSERT INTO lockdown_codes (clearance_level, code, description, version, is_active)
                    VALUES (?, ?, ?, 1, 1)
                `, [lockdown.level, lockdown.code, lockdown.description]);
            }
        });
    });
});

module.exports = db;
