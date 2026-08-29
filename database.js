const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new sqlite3.Database('./scp_foundation.db');

// Initialize database
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
            last_login DATETIME
        )
    `);

    // Code of Ethics table
    db.run(`
        CREATE TABLE IF NOT EXISTS code_of_ethics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clearance_level INTEGER NOT NULL,
            content TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_by INTEGER,
            FOREIGN KEY (updated_by) REFERENCES users(id)
        )
    `);

    // Protocols table
    db.run(`
        CREATE TABLE IF NOT EXISTS protocols (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            clearance_level INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER,
            FOREIGN KEY (created_by) REFERENCES users(id)
        )
    `);

    // Lockdown Response Codes table
    db.run(`
        CREATE TABLE IF NOT EXISTS lockdown_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clearance_level INTEGER NOT NULL,
            code TEXT NOT NULL,
            description TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_by INTEGER,
            FOREIGN KEY (updated_by) REFERENCES users(id)
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

    // Create default super admin
    const defaultPassword = bcrypt.hashSync('SCP-Admin-2024', 10);
    db.run(`
        INSERT OR IGNORE INTO users (username, password, clearance_level, is_admin, is_super_admin)
        VALUES ('super_admin', ?, 6, 1, 1)
    `, [defaultPassword]);

    // Create default ethics for all levels
    const defaultEthics = [
        { level: 1, content: 'Level 1: Standard Foundation Protocols - Follow all basic safety procedures and report any anomalies immediately.' },
        { level: 2, content: 'Level 2: Personnel must maintain confidentiality and follow containment procedures for Euclid-class entities.' },
        { level: 3, content: 'Level 3: Senior personnel must enforce strict containment protocols and oversee D-Class personnel operations.' },
        { level: 4, content: 'Level 4: Command staff must authorize all Keter-class containment procedures and maintain operational security.' },
        { level: 5, content: 'Level 5: O5 Council directives take precedence. Execute containment procedures without hesitation.' },
        { level: 6, content: 'Level 6: Administrator-level access. All ethics are subject to immediate revision based on global security needs.' }
    ];

    defaultEthics.forEach(ethics => {
        db.run(`
            INSERT OR IGNORE INTO code_of_ethics (clearance_level, content)
            VALUES (?, ?)
        `, [ethics.level, ethics.content]);
    });

    // Create default lockdown codes
    const defaultLockdowns = [
        { level: 1, code: 'LOC-1', description: 'Standard lockdown - All personnel report to designated safe zones.' },
        { level: 2, code: 'LOC-2', description: 'Containment breach - Secure all Euclid-class containment units.' },
        { level: 3, code: 'LOC-3', description: 'Keter response - Immediate evacuation of affected sectors.' },
        { level: 4, code: 'LOC-4', description: 'Site-wide emergency - Activate all automated defenses.' },
        { level: 5, code: 'LOC-5', description: 'Overseer directive - Full site lockdown, no communication in/out.' },
        { level: 6, code: 'LOC-6', description: 'Global threat response - All Foundation assets mobilize.' }
    ];

    defaultLockdowns.forEach(lockdown => {
        db.run(`
            INSERT OR IGNORE INTO lockdown_codes (clearance_level, code, description)
            VALUES (?, ?, ?)
        `, [lockdown.level, lockdown.code, lockdown.description]);
    });
});

module.exports = db;