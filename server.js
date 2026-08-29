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
app.use(express.static('src/public'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'scp-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
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
    
    // Pattern: [REDACT:LEVEL:TEXT]
    const redactionPattern = /\[REDACT:(\d+):([^\]]*)\]/g;
    
    return content.replace(redactionPattern, (match, level, text) => {
        const requiredLevel = parseInt(level);
        if (userClearance >= requiredLevel) {
            return text; // Show the text if user has sufficient clearance
        } else {
            return `[REDACTED - Clearance Level ${requiredLevel} Required]`;
        }
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
    
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
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
        
        // Update last login
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
        SELECT id, username, clearance_level, department, rank, is_admin, is_super_admin, last_login, created_at
        FROM users WHERE id = ?
    `, [req.session.userId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    });
});

// Get user's dashboard data (with redaction processing)
app.get('/api/dashboard/:level', authenticateUser, (req, res) => {
    const level = parseInt(req.params.level);
    
    if (level > req.session.clearanceLevel) {
        logActivity(req.session.userId, req.session.username, 'ACCESS_DENIED', 'dashboard', 
            `Attempted to access level ${level} with clearance ${req.session.clearanceLevel}`, req);
        return res.status(403).json({ error: 'Insufficient clearance' });
    }
    
    db.get('SELECT content FROM code_of_ethics WHERE clearance_level = ?', [level], (err, ethics) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        db.all('SELECT title, content, created_at FROM protocols WHERE clearance_level <= ? ORDER BY created_at DESC', 
            [level], (err, protocols) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            db.get('SELECT code, description FROM lockdown_codes WHERE clearance_level = ?', [level], (err, lockdown) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }
                
                // Process redactions based on user's clearance
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

// Get all users (admin only)
app.get('/api/admin/users', requireAdmin, (req, res) => {
    const isSuperAdmin = req.session.isSuperAdmin;
    let query = 'SELECT id, username, clearance_level, department, rank, is_admin, is_super_admin, last_login, created_at FROM users';
    
    if (!isSuperAdmin) {
        query += ' WHERE is_super_admin = 0';
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

// Create new user (admin only)
app.post('/api/admin/users', requireAdmin, (req, res) => {
    const { username, password, clearanceLevel, department, rank, isAdmin, isSuperAdmin } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    // Check if user making request has permission to create admins
    if (isAdmin && !req.session.isSuperAdmin) {
        return res.status(403).json({ error: 'Only Super Admins can create admin accounts' });
    }
    
    if (isSuperAdmin && !req.session.isSuperAdmin) {
        return res.status(403).json({ error: 'Only Super Admins can create Super Admin accounts' });
    }
    
    const hashedPassword = bcrypt.hashSync(password, 10);
    
    db.run(`
        INSERT INTO users (username, password, clearance_level, department, rank, is_admin, is_super_admin)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [username, hashedPassword, clearanceLevel || 1, department || '', rank || '', isAdmin || 0, isSuperAdmin || 0],
    function(err) {
        if (err) {
            return res.status(400).json({ error: 'Username already exists or invalid data' });
        }
        
        const userId = this.lastID;
        logActivity(req.session.userId, req.session.username, 'CREATE_USER', 'admin', 
            `Created user ${username} with clearance ${clearanceLevel}`, req);
        res.json({ success: true, userId });
    });
});

// Update user
app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
    const userId = req.params.id;
    const { username, password, department, rank, clearanceLevel } = req.body;
    
    let query = 'UPDATE users SET ';
    const params = [];
    const updates = [];
    
    if (username) {
        updates.push('username = ?');
        params.push(username);
    }
    
    if (department !== undefined) {
        updates.push('department = ?');
        params.push(department);
    }
    
    if (rank !== undefined) {
        updates.push('rank = ?');
        params.push(rank);
    }
    
    if (clearanceLevel !== undefined) {
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
    
    query += updates.join(', ');
    query += ' WHERE id = ?';
    params.push(userId);
    
    db.run(query, params, function(err) {
        if (err) {
            return res.status(400).json({ error: 'Update failed' });
        }
        logActivity(req.session.userId, req.session.username, 'UPDATE_USER', 'admin', 
            `Updated user ${userId}`, req);
        res.json({ success: true });
    });
});

// Delete user
app.delete('/api/admin/users/:id', requireSuperAdmin, (req, res) => {
    const userId = req.params.id;
    
    db.run('DELETE FROM users WHERE id = ? AND is_super_admin = 0', [userId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Delete failed' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'User not found or cannot delete super admin' });
        }
        logActivity(req.session.userId, req.session.username, 'DELETE_USER', 'admin', 
            `Deleted user ${userId}`, req);
        res.json({ success: true });
    });
});

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

// Update Code of Ethics
app.put('/api/admin/ethics/:level', requireAdmin, (req, res) => {
    const level = req.params.level;
    const { content } = req.body;
    
    // Check if admin has permission
    db.get('SELECT can_edit_ethics FROM admin_permissions WHERE admin_id = ?', [req.session.userId], (err, perm) => {
        if (err || (!perm?.can_edit_ethics && !req.session.isSuperAdmin)) {
            return res.status(403).json({ error: 'Permission denied' });
        }
        
        db.run(`
            UPDATE code_of_ethics 
            SET content = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
            WHERE clearance_level = ?
        `, [content, req.session.userId, level], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Update failed' });
            }
            if (this.changes === 0) {
                // Insert if not exists
                db.run(`
                    INSERT INTO code_of_ethics (clearance_level, content, updated_by)
                    VALUES (?, ?, ?)
                `, [level, content, req.session.userId]);
            }
            logActivity(req.session.userId, req.session.username, 'UPDATE_ETHICS', 'admin', 
                `Updated ethics for level ${level}`, req);
            res.json({ success: true });
        });
    });
});

// Add new protocol
app.post('/api/admin/protocols', requireAdmin, (req, res) => {
    const { title, content, clearanceLevel } = req.body;
    
    if (!title || !content || !clearanceLevel) {
        return res.status(400).json({ error: 'Title, content, and clearance level required' });
    }
    
    // Check if admin has permission
    db.get('SELECT can_edit_protocols FROM admin_permissions WHERE admin_id = ?', [req.session.userId], (err, perm) => {
        if (err || (!perm?.can_edit_protocols && !req.session.isSuperAdmin)) {
            return res.status(403).json({ error: 'Permission denied' });
        }
        
        db.run(`
            INSERT INTO protocols (title, content, clearance_level, created_by)
            VALUES (?, ?, ?, ?)
        `, [title, content, clearanceLevel, req.session.userId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to create protocol' });
            }
            logActivity(req.session.userId, req.session.username, 'CREATE_PROTOCOL', 'admin', 
                `Created protocol: ${title}`, req);
            res.json({ success: true, protocolId: this.lastID });
        });
    });
});

// Update lockdown code
app.put('/api/admin/lockdown/:level', requireAdmin, (req, res) => {
    const level = req.params.level;
    const { code, description } = req.body;
    
    if (!code || !description) {
        return res.status(400).json({ error: 'Code and description required' });
    }
    
    // Check if admin has permission
    db.get('SELECT can_edit_lockdown FROM admin_permissions WHERE admin_id = ?', [req.session.userId], (err, perm) => {
        if (err || (!perm?.can_edit_lockdown && !req.session.isSuperAdmin)) {
            return res.status(403).json({ error: 'Permission denied' });
        }
        
        db.run(`
            UPDATE lockdown_codes 
            SET code = ?, description = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
            WHERE clearance_level = ?
        `, [code, description, req.session.userId, level], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Update failed' });
            }
            if (this.changes === 0) {
                db.run(`
                    INSERT INTO lockdown_codes (clearance_level, code, description, updated_by)
                    VALUES (?, ?, ?)
                `, [level, code, description, req.session.userId]);
            }
            logActivity(req.session.userId, req.session.username, 'UPDATE_LOCKDOWN', 'admin', 
                `Updated lockdown code for level ${level}`, req);
            res.json({ success: true });
        });
    });
});

// Get all protocols (for admin)
app.get('/api/admin/protocols', requireAdmin, (req, res) => {
    db.all('SELECT * FROM protocols ORDER BY clearance_level, created_at DESC', (err, protocols) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(protocols);
    });
});

// Get all ethics (for admin)
app.get('/api/admin/ethics', requireAdmin, (req, res) => {
    db.all('SELECT * FROM code_of_ethics ORDER BY clearance_level', (err, ethics) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(ethics);
    });
});

// Get all lockdown codes (for admin)
app.get('/api/admin/lockdown', requireAdmin, (req, res) => {
    db.all('SELECT * FROM lockdown_codes ORDER BY clearance_level', (err, lockdowns) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(lockdowns);
    });
});

// ============ REDACTION ROUTES ============

// Redact Ethics Content
app.put('/api/admin/ethics/redact', requireAdmin, (req, res) => {
    const { level, content } = req.body;
    
    db.get('SELECT can_edit_ethics FROM admin_permissions WHERE admin_id = ?', [req.session.userId], (err, perm) => {
        if (err || (!perm?.can_edit_ethics && !req.session.isSuperAdmin)) {
            return res.status(403).json({ error: 'Permission denied' });
        }
        
        db.run(`
            UPDATE code_of_ethics 
            SET content = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
            WHERE clearance_level = ?
        `, [content, req.session.userId, level], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Update failed' });
            }
            if (this.changes === 0) {
                db.run(`
                    INSERT INTO code_of_ethics (clearance_level, content, updated_by)
                    VALUES (?, ?, ?)
                `, [level, content, req.session.userId]);
            }
            logActivity(req.session.userId, req.session.username, 'REDACT_ETHICS', 'admin', 
                `Redacted ethics for level ${level}`, req);
            res.json({ success: true });
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
        
        db.run(`
            UPDATE protocols 
            SET content = ?, created_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [content, protocolId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Update failed' });
            }
            logActivity(req.session.userId, req.session.username, 'REDACT_PROTOCOL', 'admin', 
                `Redacted protocol ${protocolId}`, req);
            res.json({ success: true });
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
        
        db.run(`
            UPDATE lockdown_codes 
            SET code = ?, description = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
            WHERE clearance_level = ?
        `, [code, description, req.session.userId, level], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Update failed' });
            }
            if (this.changes === 0) {
                db.run(`
                    INSERT INTO lockdown_codes (clearance_level, code, description, updated_by)
                    VALUES (?, ?, ?)
                `, [level, code, description, req.session.userId]);
            }
            logActivity(req.session.userId, req.session.username, 'REDACT_LOCKDOWN', 'admin', 
                `Redacted lockdown for level ${level}`, req);
            res.json({ success: true });
        });
    });
});

// ============ SERVE HTML ============
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'public', 'login.html'));
});

app.listen(PORT, () => {
    console.log(`SCP Foundation Server running on http://localhost:${PORT}`);
    console.log('Default Super Admin: super_admin / SCP-Admin-2024');
});
