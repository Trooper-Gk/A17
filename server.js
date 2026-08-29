const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

const db = require('./database');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the public folder
// __dirname = /opt/render/project/src
// So this looks for /opt/render/project/src/public
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'scp-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Logging middleware
const logActivity = (userId, username, action, page, details = '', req = null) => {
    const ip = req ? req.ip || req.connection.remoteAddress : null;
    const userAgent = req ? req.get('User-Agent') : null;
    
    db.run(`
        INSERT INTO activity_logs (user_id, username, action, page, details, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [userId, username, action, page, details, ip, userAgent]);
};

// Process redacted content
const processRedactedContent = (content, userClearance) => {
    if (!content) return content;
    
    const redactionPattern = /\[REDACT:(\d+):([^\]]*)\]/g;
    
    return content.replace(redactionPattern, (match, level, text) => {
        const requiredLevel = parseInt(level);
        if (userClearance >= requiredLevel) {
            return text;
        } else {
            return `[REDACTED - Clearance Level ${requiredLevel} Required]`;
        }
    });
};

// ============ VERSIONING HELPER FUNCTIONS ============

const saveEthicsHistory = (ethicsId, level, content, userId, changeType) => {
    db.get('SELECT version FROM code_of_ethics WHERE id = ?', [ethicsId], (err, row) => {
        if (err || !row) return;
        const newVersion = row.version + 1;
        
        db.run('UPDATE code_of_ethics SET is_active = 0 WHERE id = ?', [ethicsId]);
        
        db.run(`
            INSERT INTO code_of_ethics (clearance_level, content, version, is_active, updated_at, updated_by)
            VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, ?)
        `, [level, content, newVersion, userId]);
        
        db.run(`
            INSERT INTO code_of_ethics_history (ethics_id, clearance_level, content, version, changed_by, change_type)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [ethicsId, level, content, newVersion, userId, changeType]);
    });
};

const saveProtocolHistory = (protocolId, title, content, level, userId, changeType) => {
    db.get('SELECT version FROM protocols WHERE id = ?', [protocolId], (err, row) => {
        if (err || !row) return;
        const newVersion = row.version + 1;
        
        db.run('UPDATE protocols SET is_active = 0 WHERE id = ?', [protocolId]);
        
        db.run(`
            INSERT INTO protocols (title, content, clearance_level, version, is_active, created_at, created_by)
            VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?)
        `, [title, content, level, newVersion, userId]);
        
        db.run(`
            INSERT INTO protocols_history (protocol_id, title, content, clearance_level, version, changed_by, change_type)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [protocolId, title, content, level, newVersion, userId, changeType]);
    });
};

const saveLockdownHistory = (lockdownId, level, code, description, userId, changeType) => {
    db.get('SELECT version FROM lockdown_codes WHERE id = ?', [lockdownId], (err, row) => {
        if (err || !row) return;
        const newVersion = row.version + 1;
        
        db.run('UPDATE lockdown_codes SET is_active = 0 WHERE id = ?', [lockdownId]);
        
        db.run(`
            INSERT INTO lockdown_codes (clearance_level, code, description, version, is_active, updated_at, updated_by)
            VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?)
        `, [level, code, description, newVersion, userId]);
        
        db.run(`
            INSERT INTO lockdown_codes_history (lockdown_id, clearance_level, code, description, version, changed_by, change_type)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [lockdownId, level, code, description, newVersion, userId, changeType]);
    });
};

// Authentication middleware
const authenticateUser = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    db.get('SELECT is_admin, is_super_admin FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user || !user.is_admin) {
            return res.status(403).json({ error: 'Forbidden - Admin access required' });
        }
        next();
    });
};

const requireSuperAdmin = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    db.get('SELECT is_super_admin FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user || !user.is_super_admin) {
            return res.status(403).json({ error: 'Forbidden - Super Admin access required' });
        }
        next();
    });
};

// ============ ROUTES ============

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    db.get('SELECT * FROM users WHERE username = ? AND is_deleted = 0', [username], async (err, user) => {
        if (err) {
            logActivity(null, username, 'LOGIN_ERROR', 'login', 'Database error');
            return res.status(500).json({ error: 'Server error' });
        }
        
        if (!user) {
            logActivity(null, username, 'LOGIN_FAILED', 'login', 'User not found', req);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            logActivity(user.id, username, 'LOGIN_FAILED', 'login', 'Invalid password', req);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
        
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.clearanceLevel = user.clearance_level;
        req.session.isAdmin = user.is_admin === 1;
        req.session.isSuperAdmin = user.is_super_admin === 1;
        
        logActivity(user.id, username, 'LOGIN_SUCCESS', 'login', 'User logged in successfully', req);
        
        res.json({
            success: true,
            username: user.username,
            clearanceLevel: user.clearance_level,
            isAdmin: user.is_admin === 1,
            isSuperAdmin: user.is_super_admin === 1,
            redirect: user.is_admin ? '/admin.html' : '/dashboard.html'
        });
    });
});

// Logout
app.post('/api/logout', (req, res) => {
    if (req.session.userId) {
        logActivity(req.session.userId, req.session.username, 'LOGOUT', 'logout', 'User logged out', req);
    }
    req.session.destroy();
    res.json({ success: true });
});

// Get user info
app.get('/api/user', authenticateUser, (req, res) => {
    db.get(`
        SELECT id, username, clearance_level, department, rank, is_admin, is_super_admin, last_login, created_at, version
        FROM users WHERE id = ? AND is_deleted = 0
    `, [req.session.userId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    });
});

// Get user's dashboard data
app.get('/api/dashboard/:level', authenticateUser, (req, res) => {
    const level = parseInt(req.params.level);
    
    if (level > req.session.clearanceLevel) {
        logActivity(req.session.userId, req.session.username, 'ACCESS_DENIED', 'dashboard', 
            `Attempted to access level ${level} with clearance ${req.session.clearanceLevel}`, req);
        return res.status(403).json({ error: 'Insufficient clearance' });
    }
    
    db.get('SELECT content FROM code_of_ethics WHERE clearance_level = ? AND is_active = 1', [level], (err, ethics) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        db.all('SELECT title, content, created_at FROM protocols WHERE clearance_level <= ? AND is_active = 1 ORDER BY created_at DESC', 
            [level], (err, protocols) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            db.get('SELECT code, description FROM lockdown_codes WHERE clearance_level = ? AND is_active = 1', [level], (err, lockdown) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }
                
                const userClearance = req.session.clearanceLevel;
                let processedEthics = ethics ? processRedactedContent(ethics.content, userClearance) : 'No ethics code defined for this level';
                
                const processedProtocols = (protocols || []).map(p => ({
                    ...p,
                    content: processRedactedContent(p.content, userClearance),
                    title: processRedactedContent(p.title, userClearance)
                }));
                
                let processedLockdown = lockdown ? {
                    code: processRedactedContent(lockdown.code, userClearance),
                    description: processRedactedContent(lockdown.description, userClearance)
                } : null;
                
                logActivity(req.session.userId, req.session.username, 'VIEW_DASHBOARD', 
                    `level-${level}`, 'Viewed dashboard', req);
                
                res.json({
                    clearanceLevel: level,
                    ethics: processedEthics,
                    protocols: processedProtocols || [],
                    lockdown: processedLockdown
                });
            });
        });
    });
});

// ============ ADMIN ROUTES ============

// Get all active users
app.get('/api/admin/users', requireAdmin, (req, res) => {
    const isSuperAdmin = req.session.isSuperAdmin;
    let query = 'SELECT id, username, clearance_level, department, rank, is_admin, is_super_admin, last_login, created_at, version FROM users WHERE is_deleted = 0';
    
    if (!isSuperAdmin) {
        query += ' AND is_super_admin = 0';
    }
    
    db.all(query, (err, users) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(users);
    });
});

// Get admin permissions
app.get('/api/admin/permissions/:adminId', requireSuperAdmin, (req, res) => {
    const adminId = req.params.adminId;
    
    db.get('SELECT * FROM admin_permissions WHERE admin_id = ?', [adminId], (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(permissions || { can_edit_ethics: 0, can_edit_protocols: 0, can_edit_lockdown: 0, can_manage_users: 0, can_view_logs: 0 });
    });
});

// Update admin permissions
app.post('/api/admin/permissions', requireSuperAdmin, (req, res) => {
    const { adminId, permissions } = req.body;
    
    db.run(`
        INSERT OR REPLACE INTO admin_permissions (admin_id, can_edit_ethics, can_edit_protocols, can_edit_lockdown, can_manage_users, can_view_logs)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [adminId, 
        permissions.can_edit_ethics || 0,
        permissions.can_edit_protocols || 0,
        permissions.can_edit_lockdown || 0,
        permissions.can_manage_users || 0,
        permissions.can_view_logs || 0
    ], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        logActivity(req.session.userId, req.session.username, 'UPDATE_PERMISSIONS', 'admin', 
            `Updated permissions for admin ${adminId}`, req);
        res.json({ success: true });
    });
});

// ============ USER MANAGEMENT WITH VERSIONING ============

// Create new user
app.post('/api/admin/users', requireAdmin, (req, res) => {
    const { username, password, clearanceLevel, department, rank, isAdmin, isSuperAdmin } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    if (isAdmin && !req.session.isSuperAdmin) {
        return res.status(403).json({ error: 'Only Super Admins can create admin accounts' });
    }
    
    if (isSuperAdmin && !req.session.isSuperAdmin) {
        return res.status(403).json({ error: 'Only Super Admins can create Super Admin accounts' });
    }
    
    const hashedPassword = bcrypt.hashSync(password, 10);
    
    db.run(`
        INSERT INTO users (username, password, clearance_level, department, rank, is_admin, is_super_admin, version)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `, [username, hashedPassword, clearanceLevel || 1, department || '', rank || '', isAdmin || 0, isSuperAdmin || 0],
    function(err) {
        if (err) {
            return res.status(400).json({ error: 'Username already exists or invalid data' });
        }
        
        const userId = this.lastID;
        db.run(`
            INSERT INTO users_history (user_id, username, password, clearance_level, department, rank, is_admin, is_super_admin, version, changed_by, change_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `, [userId, username, hashedPassword, clearanceLevel || 1, department || '', rank || '', isAdmin || 0, isSuperAdmin || 0, req.session.userId, 'CREATE']);
        
        logActivity(req.session.userId, req.session.username, 'CREATE_USER', 'admin', 
            `Created user ${username} with clearance ${clearanceLevel}`, req);
        res.json({ success: true, userId });
    });
});

// Update user
app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
    const userId = req.params.id;
    const { username, password, department, rank, clearanceLevel } = req.body;
    
    db.get('SELECT * FROM users WHERE id = ? AND is_deleted = 0', [userId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const updates = [];
        const params = [];
        let newVersion = user.version + 1;
        
        if (username && username !== user.username) {
            updates.push('username = ?');
            params.push(username);
        }
        
        if (department !== undefined && department !== user.department) {
            updates.push('department = ?');
            params.push(department);
        }
        
        if (rank !== undefined && rank !== user.rank) {
            updates.push('rank = ?');
            params.push(rank);
        }
        
        if (clearanceLevel !== undefined && clearanceLevel !== user.clearance_level) {
            updates.push('clearance_level = ?');
            params.push(clearanceLevel);
        }
        
        if (password) {
            updates.push('password = ?');
            params.push(bcrypt.hashSync(password, 10));
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'No updates provided' });
        }
        
        updates.push('version = ?');
        params.push(newVersion);
        params.push(userId);
        
        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
        
        db.run(query, params, function(err) {
            if (err) {
                return res.status(400).json({ error: 'Update failed' });
            }
            
            db.get('SELECT * FROM users WHERE id = ?', [userId], (err, updatedUser) => {
                if (err || !updatedUser) return;
                
                db.run(`
                    INSERT INTO users_history (user_id, username, password, clearance_level, department, rank, is_admin, is_super_admin, version, changed_by, change_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [userId, updatedUser.username, updatedUser.password, updatedUser.clearance_level, 
                    updatedUser.department, updatedUser.rank, updatedUser.is_admin, updatedUser.is_super_admin, 
                    newVersion, req.session.userId, 'UPDATE']);
                
                logActivity(req.session.userId, req.session.username, 'UPDATE_USER', 'admin', 
                    `Updated user ${userId} to version ${newVersion}`, req);
                res.json({ success: true, version: newVersion });
            });
        });
    });
});

// Delete user
app.delete('/api/admin/users/:id', requireSuperAdmin, (req, res) => {
    const userId = req.params.id;
    
    db.get('SELECT * FROM users WHERE id = ? AND is_super_admin = 0 AND is_deleted = 0', [userId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'User not found or cannot delete super admin' });
        }
        
        const newVersion = user.version + 1;
        
        db.run('UPDATE users SET is_deleted = 1, version = ? WHERE id = ?', [newVersion, userId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Delete failed' });
            }
            
            db.run(`
                INSERT INTO users_history (user_id, username, password, clearance_level, department, rank, is_admin, is_super_admin, version, changed_by, change_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [userId, user.username, user.password, user.clearance_level, user.department, user.rank, 
                user.is_admin, user.is_super_admin, newVersion, req.session.userId, 'DELETE']);
            
            logActivity(req.session.userId, req.session.username, 'DELETE_USER', 'admin', 
                `Deleted user ${userId}`, req);
            res.json({ success: true });
        });
    });
});

// Get user history
app.get('/api/admin/users/:id/history', requireAdmin, (req, res) => {
    const userId = req.params.id;
    
    db.all(`
        SELECT uh.*, u.username as changed_by_name
        FROM users_history uh
        LEFT JOIN users u ON u.id = uh.changed_by
        WHERE uh.user_id = ?
        ORDER BY uh.version DESC
    `, [userId], (err, history) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(history);
    });
});

// ============ ETHICS MANAGEMENT WITH VERSIONING ============

// Get all active ethics
app.get('/api/admin/ethics', requireAdmin, (req, res) => {
    db.all('SELECT * FROM code_of_ethics WHERE is_active = 1 ORDER BY clearance_level', (err, ethics) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(ethics);
    });
});

// Update Code of Ethics
app.put('/api/admin/ethics/:level', requireAdmin, (req, res) => {
    const level = req.params.level;
    const { content } = req.body;
    
    db.get('SELECT can_edit_ethics FROM admin_permissions WHERE admin_id = ?', [req.session.userId], (err, perm) => {
        if (err || (!perm?.can_edit_ethics && !req.session.isSuperAdmin)) {
            return res.status(403).json({ error: 'Permission denied' });
        }
        
        db.get('SELECT id, version FROM code_of_ethics WHERE clearance_level = ? AND is_active = 1', [level], (err, current) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (current) {
                db.run('UPDATE code_of_ethics SET is_active = 0 WHERE id = ?', [current.id]);
                
                const newVersion = current.version + 1;
                db.run(`
                    INSERT INTO code_of_ethics (clearance_level, content, version, is_active, updated_at, updated_by)
                    VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, ?)
                `, [level, content, newVersion, req.session.userId], function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Update failed' });
                    }
                    
                    db.run(`
                        INSERT INTO code_of_ethics_history (ethics_id, clearance_level, content, version, changed_by, change_type)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [current.id, level, content, newVersion, req.session.userId, 'UPDATE']);
                    
                    logActivity(req.session.userId, req.session.username, 'UPDATE_ETHICS', 'admin', 
                        `Updated ethics for level ${level} to version ${newVersion}`, req);
                    res.json({ success: true, version: newVersion });
                });
            } else {
                db.run(`
                    INSERT INTO code_of_ethics (clearance_level, content, version, is_active, updated_at, updated_by)
                    VALUES (?, ?, 1, 1, CURRENT_TIMESTAMP, ?)
                `, [level, content, req.session.userId], function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Create failed' });
                    }
                    logActivity(req.session.userId, req.session.username, 'CREATE_ETHICS', 'admin', 
                        `Created ethics for level ${level}`, req);
                    res.json({ success: true, version: 1 });
                });
            }
        });
    });
});

// Get ethics history
app.get('/api/admin/ethics/:level/history', requireAdmin, (req, res) => {
    const level = req.params.level;
    
    db.all(`
        SELECT e.*, eh.changed_at, eh.change_type, u.username as changed_by_name
        FROM code_of_ethics_history eh
        JOIN code_of_ethics e ON e.id = eh.ethics_id
        LEFT JOIN users u ON u.id = eh.changed_by
        WHERE eh.clearance_level = ?
        ORDER BY eh.version DESC
    `, [level], (err, history) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(history);
    });
});

// Rollback ethics
app.post('/api/admin/ethics/:level/rollback/:version', requireSuperAdmin, (req, res) => {
    const level = req.params.level;
    const targetVersion = parseInt(req.params.version);
    
    db.get(`
        SELECT * FROM code_of_ethics_history 
        WHERE clearance_level = ? AND version = ?
        ORDER BY changed_at DESC LIMIT 1
    `, [level, targetVersion], (err, history) => {
        if (err || !history) {
            return res.status(404).json({ error: 'Version not found' });
        }
        
        db.run('UPDATE code_of_ethics SET is_active = 0 WHERE clearance_level = ? AND is_active = 1', [level]);
        
        db.run(`
            INSERT INTO code_of_ethics (clearance_level, content, version, is_active, updated_at, updated_by)
            VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, ?)
        `, [history.clearance_level, history.content, history.version + 1, req.session.userId]);
        
        logActivity(req.session.userId, req.session.username, 'ROLLBACK_ETHICS', 'admin', 
            `Rolled back ethics level ${level} to version ${targetVersion}`, req);
        res.json({ success: true, message: `Rolled back to version ${targetVersion}` });
    });
});

// ============ PROTOCOL MANAGEMENT WITH VERSIONING ============

// Get all active protocols
app.get('/api/admin/protocols', requireAdmin, (req, res) => {
    db.all('SELECT * FROM protocols WHERE is_active = 1 ORDER BY clearance_level, created_at DESC', (err, protocols) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(protocols);
    });
});

// Add new protocol
app.post('/api/admin/protocols', requireAdmin, (req, res) => {
    const { title, content, clearanceLevel } = req.body;
    
    if (!title || !content || !clearanceLevel) {
        return res.status(400).json({ error: 'Title, content, and clearance level required' });
    }
    
    db.get('SELECT can_edit_protocols FROM admin_permissions WHERE admin_id = ?', [req.session.userId], (err, perm) => {
        if (err || (!perm?.can_edit_protocols && !req.session.isSuperAdmin)) {
            return res.status(403).json({ error: 'Permission denied' });
        }
        
        db.get('SELECT id, version FROM protocols WHERE title = ? AND is_active = 1', [title], (err, existing) => {
            if (existing) {
                db.run('UPDATE protocols SET is_active = 0 WHERE id = ?', [existing.id]);
                
                const newVersion = existing.version + 1;
                db.run(`
                    INSERT INTO protocols (title, content, clearance_level, version, is_active, created_at, created_by)
                    VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?)
                `, [title, content, clearanceLevel, newVersion, req.session.userId], function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to create protocol' });
                    }
                    
                    const protocolId = this.lastID;
                    db.run(`
                        INSERT INTO protocols_history (protocol_id, title, content, clearance_level, version, changed_by, change_type)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [existing.id, title, content, clearanceLevel, newVersion, req.session.userId, 'UPDATE']);
                    
                    logActivity(req.session.userId, req.session.username, 'UPDATE_PROTOCOL', 'admin', 
                        `Updated protocol: ${title} to version ${newVersion}`, req);
                    res.json({ success: true, protocolId, version: newVersion });
                });
            } else {
                db.run(`
                    INSERT INTO protocols (title, content, clearance_level, version, is_active, created_at, created_by)
                    VALUES (?, ?, ?, 1, 1, CURRENT_TIMESTAMP, ?)
                `, [title, content, clearanceLevel, req.session.userId], function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to create protocol' });
                    }
                    
                    const protocolId = this.lastID;
                    db.run(`
                        INSERT INTO protocols_history (protocol_id, title, content, clearance_level, version, changed_by, change_type)
                        VALUES (?, ?, ?, ?, 1, ?, ?)
                    `, [protocolId, title, content, clearanceLevel, req.session.userId, 'CREATE']);
                    
                    logActivity(req.session.userId, req.session.username, 'CREATE_PROTOCOL', 'admin', 
                        `Created protocol: ${title}`, req);
                    res.json({ success: true, protocolId, version: 1 });
                });
            }
        });
    });
});

// Get protocol history
app.get('/api/admin/protocols/:id/history', requireAdmin, (req, res) => {
    const protocolId = req.params.id;
    
    db.all(`
        SELECT ph.*, u.username as changed_by_name
        FROM protocols_history ph
        LEFT JOIN users u ON u.id = ph.changed_by
        WHERE ph.protocol_id = ?
        ORDER BY ph.version DESC
    `, [protocolId], (err, history) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(history);
    });
});

// Rollback protocol
app.post('/api/admin/protocols/:id/rollback/:version', requireSuperAdmin, (req, res) => {
    const protocolId = req.params.id;
    const targetVersion = parseInt(req.params.version);
    
    db.get(`
        SELECT * FROM protocols_history 
        WHERE protocol_id = ? AND version = ?
        ORDER BY changed_at DESC LIMIT 1
    `, [protocolId, targetVersion], (err, history) => {
        if (err || !history) {
            return res.status(404).json({ error: 'Version not found' });
        }
        
        db.run('UPDATE protocols SET is_active = 0 WHERE id = ?', [protocolId]);
        
        db.run(`
            INSERT INTO protocols (title, content, clearance_level, version, is_active, created_at, created_by)
            VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?)
        `, [history.title, history.content, history.clearance_level, history.version + 1, req.session.userId]);
        
        logActivity(req.session.userId, req.session.username, 'ROLLBACK_PROTOCOL', 'admin', 
            `Rolled back protocol ${protocolId} to version ${targetVersion}`, req);
        res.json({ success: true, message: `Rolled back to version ${targetVersion}` });
    });
});

// ============ LOCKDOWN MANAGEMENT WITH VERSIONING ============

// Get all active lockdown codes
app.get('/api/admin/lockdown', requireAdmin, (req, res) => {
    db.all('SELECT * FROM lockdown_codes WHERE is_active = 1 ORDER BY clearance_level', (err, lockdowns) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(lockdowns);
    });
});

// Update lockdown code
app.put('/api/admin/lockdown/:level', requireAdmin, (req, res) => {
    const level = req.params.level;
    const { code, description } = req.body;
    
    if (!code || !description) {
        return res.status(400).json({ error: 'Code and description required' });
    }
    
    db.get('SELECT can_edit_lockdown FROM admin_permissions WHERE admin_id = ?', [req.session.userId], (err, perm) => {
        if (err || (!perm?.can_edit_lockdown && !req.session.isSuperAdmin)) {
            return res.status(403).json({ error: 'Permission denied' });
        }
        
        db.get('SELECT id, version FROM lockdown_codes WHERE clearance_level = ? AND is_active = 1', [level], (err, current) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (current) {
                db.run('UPDATE lockdown_codes SET is_active = 0 WHERE id = ?', [current.id]);
                
                const newVersion = current.version + 1;
                db.run(`
                    INSERT INTO lockdown_codes (clearance_level, code, description, version, is_active, updated_at, updated_by)
                    VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?)
                `, [level, code, description, newVersion, req.session.userId], function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Update failed' });
                    }
                    
                    db.run(`
                        INSERT INTO lockdown_codes_history (lockdown_id, clearance_level, code, description, version, changed_by, change_type)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [current.id, level, code, description, newVersion, req.session.userId, 'UPDATE']);
                    
                    logActivity(req.session.userId, req.session.username, 'UPDATE_LOCKDOWN', 'admin', 
                        `Updated lockdown code for level ${level} to version ${newVersion}`, req);
                    res.json({ success: true, version: newVersion });
                });
            } else {
                db.run(`
                    INSERT INTO lockdown_codes (clearance_level, code, description, version, is_active, updated_at, updated_by)
                    VALUES (?, ?, ?, 1, 1, CURRENT_TIMESTAMP, ?)
                `, [level, code, description, req.session.userId], function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Create failed' });
                    }
                    logActivity(req.session.userId, req.session.username, 'CREATE_LOCKDOWN', 'admin', 
                        `Created lockdown code for level ${level}`, req);
                    res.json({ success: true, version: 1 });
                });
            }
        });
    });
});

// Get lockdown history
app.get('/api/admin/lockdown/:level/history', requireAdmin, (req, res) => {
    const level = req.params.level;
    
    db.all(`
        SELECT lc.*, lch.changed_at, lch.change_type, u.username as changed_by_name
        FROM lockdown_codes_history lch
        JOIN lockdown_codes lc ON lc.id = lch.lockdown_id
        LEFT JOIN users u ON u.id = lch.changed_by
        WHERE lch.clearance_level = ?
        ORDER BY lch.version DESC
    `, [level], (err, history) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(history);
    });
});

// Rollback lockdown
app.post('/api/admin/lockdown/:level/rollback/:version', requireSuperAdmin, (req, res) => {
    const level = req.params.level;
    const targetVersion = parseInt(req.params.version);
    
    db.get(`
        SELECT * FROM lockdown_codes_history 
        WHERE clearance_level = ? AND version = ?
        ORDER BY changed_at DESC LIMIT 1
    `, [level, targetVersion], (err, history) => {
        if (err || !history) {
            return res.status(404).json({ error: 'Version not found' });
        }
        
        db.run('UPDATE lockdown_codes SET is_active = 0 WHERE clearance_level = ? AND is_active = 1', [level]);
        
        db.run(`
            INSERT INTO lockdown_codes (clearance_level, code, description, version, is_active, updated_at, updated_by)
            VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?)
        `, [history.clearance_level, history.code, history.description, history.version + 1, req.session.userId]);
        
        logActivity(req.session.userId, req.session.username, 'ROLLBACK_LOCKDOWN', 'admin', 
            `Rolled back lockdown level ${level} to version ${targetVersion}`, req);
        res.json({ success: true, message: `Rolled back to version ${targetVersion}` });
    });
});

// ============ REDACTION ROUTES ============

// Redact Ethics
app.put('/api/admin/ethics/redact', requireAdmin, (req, res) => {
    const { level, content } = req.body;
    
    db.get('SELECT can_edit_ethics FROM admin_permissions WHERE admin_id = ?', [req.session.userId], (err, perm) => {
        if (err || (!perm?.can_edit_ethics && !req.session.isSuperAdmin)) {
            return res.status(403).json({ error: 'Permission denied' });
        }
        
        db.get('SELECT id, version FROM code_of_ethics WHERE clearance_level = ? AND is_active = 1', [level], (err, current) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (current) {
                db.run('UPDATE code_of_ethics SET is_active = 0 WHERE id = ?', [current.id]);
                
                const newVersion = current.version + 1;
                db.run(`
                    INSERT INTO code_of_ethics (clearance_level, content, version, is_active, updated_at, updated_by)
                    VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, ?)
                `, [level, content, newVersion, req.session.userId], function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Update failed' });
                    }
                    
                    db.run(`
                        INSERT INTO code_of_ethics_history (ethics_id, clearance_level, content, version, changed_by, change_type)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [current.id, level, content, newVersion, req.session.userId, 'REDACT']);
                    
                    logActivity(req.session.userId, req.session.username, 'REDACT_ETHICS', 'admin', 
                        `Redacted ethics for level ${level}`, req);
                    res.json({ success: true, version: newVersion });
                });
            } else {
                db.run(`
                    INSERT INTO code_of_ethics (clearance_level, content, version, is_active, updated_at, updated_by)
                    VALUES (?, ?, 1, 1, CURRENT_TIMESTAMP, ?)
                `, [level, content, req.session.userId], function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Create failed' });
                    }
                    logActivity(req.session.userId, req.session.username, 'REDACT_ETHICS', 'admin', 
                        `Created redacted ethics for level ${level}`, req);
                    res.json({ success: true, version: 1 });
                });
            }
        });
    });
});

// Redact Protocol
app.put('/api/admin/protocols/:id/redact', requireAdmin, (req, res) => {
    const protocolId = req.params.id;
    const { content } = req.body;
    
    db.get('SELECT can_edit_protocols FROM admin_permissions WHERE admin_id = ?', [req.session.userId], (err, perm) => {
        if (err || (!perm?.can_edit_protocols && !req.session.isSuperAdmin)) {
            return res.status(403).json({ error: 'Permission denied' });
        }
        
        db.get('SELECT id, version FROM protocols WHERE id = ? AND is_active = 1', [protocolId], (err, current) => {
            if (err || !current) {
                return res.status(404).json({ error: 'Protocol not found' });
            }
            
            db.run('UPDATE protocols SET is_active = 0 WHERE id = ?', [current.id]);
            
            const newVersion = current.version + 1;
            db.run(`
                INSERT INTO protocols (title, content, clearance_level, version, is_active, created_at, created_by)
                VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?)
            `, [current.title, content, current.clearance_level, newVersion, req.session.userId], function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Update failed' });
                }
                
                db.run(`
                    INSERT INTO protocols_history (protocol_id, title, content, clearance_level, version, changed_by, change_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [current.id, current.title, content, current.clearance_level, newVersion, req.session.userId, 'REDACT']);
                
                logActivity(req.session.userId, req.session.username, 'REDACT_PROTOCOL', 'admin', 
                    `Redacted protocol ${protocolId}`, req);
                res.json({ success: true, version: newVersion });
            });
        });
    });
});

// Redact Lockdown
app.put('/api/admin/lockdown/redact', requireAdmin, (req, res) => {
    const { level, code, description } = req.body;
    
    db.get('SELECT can_edit_lockdown FROM admin_permissions WHERE admin_id = ?', [req.session.userId], (err, perm) => {
        if (err || (!perm?.can_edit_lockdown && !req.session.isSuperAdmin)) {
            return res.status(403).json({ error: 'Permission denied' });
        }
        
        db.get('SELECT id, version FROM lockdown_codes WHERE clearance_level = ? AND is_active = 1', [level], (err, current) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (current) {
                db.run('UPDATE lockdown_codes SET is_active = 0 WHERE id = ?', [current.id]);
                
                const newVersion = current.version + 1;
                db.run(`
                    INSERT INTO lockdown_codes (clearance_level, code, description, version, is_active, updated_at, updated_by)
                    VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?)
                `, [level, code, description, newVersion, req.session.userId], function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Update failed' });
                    }
                    
                    db.run(`
                        INSERT INTO lockdown_codes_history (lockdown_id, clearance_level, code, description, version, changed_by, change_type)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [current.id, level, code, description, newVersion, req.session.userId, 'REDACT']);
                    
                    logActivity(req.session.userId, req.session.username, 'REDACT_LOCKDOWN', 'admin', 
                        `Redacted lockdown for level ${level}`, req);
                    res.json({ success: true, version: newVersion });
                });
            } else {
                db.run(`
                    INSERT INTO lockdown_codes (clearance_level, code, description, version, is_active, updated_at, updated_by)
                    VALUES (?, ?, ?, 1, 1, CURRENT_TIMESTAMP, ?)
                `, [level, code, description, req.session.userId], function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Create failed' });
                    }
                    logActivity(req.session.userId, req.session.username, 'REDACT_LOCKDOWN', 'admin', 
                        `Created redacted lockdown for level ${level}`, req);
                    res.json({ success: true, version: 1 });
                });
            }
        });
    });
});

// ============ ACTIVITY LOGS ============

// Get activity logs
app.get('/api/admin/logs', requireAdmin, (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;
    
    db.all(`
        SELECT * FROM activity_logs 
        ORDER BY timestamp DESC 
        LIMIT ? OFFSET ?
    `, [limit, offset], (err, logs) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        db.get('SELECT COUNT(*) as total FROM activity_logs', (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({
                logs,
                total: result.total,
                page,
                totalPages: Math.ceil(result.total / limit)
            });
        });
    });
});

// ============ SERVE HTML ============
// Serve the login page at the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Catch-all route to serve any HTML file from public
app.get('*.html', (req, res) => {
    const fileName = req.path.substring(1); // Remove leading slash
    const filePath = path.join(__dirname, 'public', fileName);
    res.sendFile(filePath);
});

app.listen(PORT, () => {
    console.log(`SCP Foundation Server running on http://localhost:${PORT}`);
    console.log('Default Super Admin: super_admin / SCP-Admin-2024');
    console.log('Versioning system enabled - all changes are tracked with history');
});
