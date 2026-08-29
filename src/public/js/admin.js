document.addEventListener('DOMContentLoaded', async () => {
    // Check if user is admin
    try {
        const userResponse = await fetch('/api/user');
        if (!userResponse.ok) {
            window.location.href = '/login.html';
            return;
        }
        const user = await userResponse.json();
        
        if (!user.is_admin) {
            window.location.href = '/dashboard.html';
            return;
        }
        
        // Set user info
        document.getElementById('usernameDisplay').textContent = user.username;
        document.getElementById('clearanceDisplay').textContent = `LEVEL ${user.clearance_level}`;
        document.getElementById('adminBadge').textContent = user.is_super_admin ? 'SUPER ADMIN' : 'ADMIN';
        
        // Setup logout
        document.getElementById('logoutBtn').addEventListener('click', logout);
        
        // Load initial data
        loadUsers();
        loadEthics();
        loadProtocols();
        loadLockdown();
        loadProtocolsForRedaction();
        
        // Setup navigation
        document.querySelectorAll('.admin-nav button').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.admin-panel').forEach(panel => {
                    panel.style.display = 'none';
                });
                document.querySelectorAll('.admin-nav button').forEach(b => {
                    b.classList.remove('active');
                });
                btn.classList.add('active');
                const target = btn.dataset.target;
                document.getElementById(target).style.display = 'block';
                
                // Load logs if logs panel is clicked
                if (target === 'logs') {
                    loadLogs();
                }
                // Load history if history panel is clicked
                if (target === 'history') {
                    loadHistory('ethics');
                }
            });
        });
        
        // Default view
        document.querySelector('.admin-nav button[data-target="users"]').click();
        
        // Setup forms
        document.getElementById('createUserForm').addEventListener('submit', createUser);
        document.getElementById('editEthicsForm').addEventListener('submit', updateEthics);
        document.getElementById('createProtocolForm').addEventListener('submit', createProtocol);
        document.getElementById('editLockdownForm').addEventListener('submit', updateLockdown);
        document.getElementById('redactEthicsForm').addEventListener('submit', redactEthics);
        document.getElementById('redactProtocolForm').addEventListener('submit', redactProtocol);
        document.getElementById('redactLockdownForm').addEventListener('submit', redactLockdown);
        
    } catch (error) {
        console.error('Error loading admin:', error);
        window.location.href = '/login.html';
    }
});

// ============ DISPLAY REDACTIONS AS COLORED BARS ============

function displayRedactions(content) {
    if (!content) return content;
    
    // Replace [REDACT:X:TEXT] with colored bars
    return content.replace(/\[REDACT:(\d+):([^\]]*)\]/g, (match, level, text) => {
        let color = '#dc143c'; // crimson default
        let barColor = 'crimson';
        let label = `Level ${level}`;
        
        // Determine color based on level
        const lvl = parseInt(level);
        if (lvl === 2) {
            color = '#006400'; // dark green
            barColor = 'dark-green';
            label = 'Level 2';
        } else if (lvl === 3) {
            color = '#000000'; // black
            barColor = 'black';
            label = 'Level 3';
        } else if (lvl === 4) {
            color = '#dc143c'; // crimson
            barColor = 'crimson';
            label = 'Level 4';
        } else if (lvl === 5) {
            color = '#800080'; // purple
            barColor = 'purple';
            label = 'Level 5';
        } else if (lvl === 6) {
            color = '#4a0080'; // dark purple
            barColor = 'purple';
            label = 'Level 6';
        } else {
            color = '#8b0000'; // dark red
            barColor = 'dark-red';
            label = `Level ${lvl}`;
        }
        
        // Create a bar with █ characters - length based on text length
        const barLength = Math.min(Math.ceil(text.length / 2), 30);
        const bar = '█'.repeat(barLength);
        
        // Return a colored bar with level indicator on hover
        return `<span class="redaction-bar" style="background-color: ${color}; color: ${color}; padding: 2px 10px; border-radius: 3px; min-width: 30px; border: 1px solid ${color === '#000000' ? '#444' : color}; cursor: help; display: inline-block; font-weight: bold; letter-spacing: 0px;" title="🔴 REDACTED - Requires Clearance ${lvl}">${bar}</span>`;
    });
}

// ============ USER MANAGEMENT ============

async function loadUsers() {
    try {
        const response = await fetch('/api/admin/users');
        if (!response.ok) throw new Error('Failed to load users');
        const users = await response.json();
        
        const tableBody = document.getElementById('usersTableBody');
        tableBody.innerHTML = users.map(user => `
            <tr>
                <td>${user.username}</td>
                <td>LEVEL ${user.clearance_level}</td>
                <td>${user.department || 'N/A'}</td>
                <td>${user.rank || 'N/A'}</td>
                <td>${user.is_admin ? '✅' : '❌'}</td>
                <td>${user.is_super_admin ? '⭐' : ''}</td>
                <td><span class="version-badge version-current">v${user.version || 1}</span></td>
                <td>${new Date(user.last_login || user.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="edit-btn" onclick="editUser(${user.id})">✎</button>
                    ${!user.is_super_admin ? `<button class="edit-btn delete-btn" onclick="deleteUser(${user.id})">✕</button>` : ''}
                    <button class="edit-btn" onclick="viewUserHistory(${user.id})">📜</button>
                </td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('Error loading users:', error);
        document.getElementById('usersTableBody').innerHTML = 
            '<tr><td colspan="9" style="text-align:center;color:#ff0000;">Error loading users</td></tr>';
    }
}

async function createUser(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    
    try {
        const response = await fetch('/api/admin/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: data.username,
                password: data.password,
                clearanceLevel: parseInt(data.clearanceLevel),
                department: data.department,
                rank: data.rank,
                isAdmin: data.isAdmin === 'on',
                isSuperAdmin: data.isSuperAdmin === 'on'
            })
        });
        
        const result = await response.json();
        if (response.ok) {
            alert('User created successfully!');
            form.reset();
            loadUsers();
        } else {
            alert('Error: ' + (result.error || 'Failed to create user'));
        }
    } catch (error) {
        alert('Error creating user: ' + error.message);
    }
}

async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user?')) return;
    
    try {
        const response = await fetch(`/api/admin/users/${userId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            loadUsers();
        } else {
            const result = await response.json();
            alert('Error: ' + (result.error || 'Failed to delete user'));
        }
    } catch (error) {
        alert('Error deleting user: ' + error.message);
    }
}

async function editUser(userId) {
    const newUsername = prompt('Enter new username:');
    if (newUsername) {
        try {
            const response = await fetch(`/api/admin/users/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: newUsername })
            });
            if (response.ok) {
                alert('User updated!');
                loadUsers();
            }
        } catch (error) {
            alert('Error updating user: ' + error.message);
        }
    }
}

async function viewUserHistory(userId) {
    document.querySelector('.admin-nav button[data-target="history"]').click();
    await loadHistory('users');
    const sections = document.querySelectorAll('#historyContent .history-item');
    sections.forEach(s => {
        if (s.dataset.id == userId) {
            s.scrollIntoView({ behavior: 'smooth' });
            s.style.border = '2px solid #00ff00';
            setTimeout(() => {
                s.style.border = '1px solid rgba(0,255,0,0.2)';
            }, 3000);
        }
    });
}

// ============ ETHICS MANAGEMENT ============

async function loadEthics() {
    try {
        const response = await fetch('/api/admin/ethics');
        if (!response.ok) throw new Error('Failed to load ethics');
        const ethics = await response.json();
        
        const container = document.getElementById('ethicsList');
        container.innerHTML = ethics.map(e => `
            <div style="border-bottom: 1px solid rgba(0,255,0,0.1); padding: 10px 0;">
                <strong>LEVEL ${e.clearance_level}</strong>
                <span class="version-badge version-current">v${e.version || 1}</span>
                <span style="font-size: 11px; color: rgba(0,255,0,0.4); margin-left: 10px;">
                    Updated: ${new Date(e.updated_at).toLocaleString()}
                </span>
                <div style="margin: 5px 0; font-size: 13px; background: rgba(0,0,0,0.3); padding: 10px; 
                    white-space: pre-wrap; word-break: break-all; line-height: 2;">
                    ${displayRedactions(e.content)}
                </div>
                <button class="edit-btn" onclick="viewEthicsHistory(${e.clearance_level})">📜 View History</button>
            </div>
        `).join('');
        
        // Set edit form
        const select = document.getElementById('ethicsLevel');
        select.innerHTML = ethics.map(e => 
            `<option value="${e.clearance_level}">Level ${e.clearance_level} (v${e.version || 1})</option>`
        ).join('');
        
        if (ethics.length > 0) {
            document.getElementById('ethicsContent').value = ethics[0].content;
        }
        
        select.addEventListener('change', () => {
            const level = parseInt(select.value);
            const found = ethics.find(e => e.clearance_level === level);
            if (found) {
                document.getElementById('ethicsContent').value = found.content;
            }
        });
        
        // Also update redaction form
        const redactSelect = document.getElementById('redactEthicsLevel');
        if (redactSelect) {
            redactSelect.innerHTML = ethics.map(e => 
                `<option value="${e.clearance_level}">Level ${e.clearance_level} (v${e.version || 1})</option>`
            ).join('');
            
            if (ethics.length > 0) {
                document.getElementById('redactEthicsContent').value = ethics[0].content;
            }
            
            redactSelect.addEventListener('change', () => {
                const level = parseInt(redactSelect.value);
                const found = ethics.find(e => e.clearance_level === level);
                if (found) {
                    document.getElementById('redactEthicsContent').value = found.content;
                }
            });
        }
        
    } catch (error) {
        console.error('Error loading ethics:', error);
    }
}

async function updateEthics(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const level = formData.get('level');
    const content = formData.get('content');
    
    try {
        const response = await fetch(`/api/admin/ethics/${level}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        
        const result = await response.json();
        if (response.ok) {
            alert(`Ethics updated successfully! Version: ${result.version}`);
            loadEthics();
        } else {
            alert('Error: ' + (result.error || 'Failed to update ethics'));
        }
    } catch (error) {
        alert('Error updating ethics: ' + error.message);
    }
}

async function viewEthicsHistory(level) {
    document.querySelector('.admin-nav button[data-target="history"]').click();
    await loadHistory('ethics');
    const sections = document.querySelectorAll('#historyContent .history-item');
    sections.forEach(s => {
        if (s.dataset.level == level) {
            s.scrollIntoView({ behavior: 'smooth' });
            s.style.border = '2px solid #00ff00';
            setTimeout(() => {
                s.style.border = '1px solid rgba(0,255,0,0.2)';
            }, 3000);
        }
    });
}

// ============ PROTOCOL MANAGEMENT ============

async function loadProtocols() {
    try {
        const response = await fetch('/api/admin/protocols');
        if (!response.ok) throw new Error('Failed to load protocols');
        const protocols = await response.json();
        
        const container = document.getElementById('protocolsList');
        container.innerHTML = protocols.map(p => `
            <div style="border-bottom: 1px solid rgba(0,255,0,0.1); padding: 10px 0;">
                <strong>${displayRedactions(p.title)}</strong> 
                <span class="version-badge version-current">v${p.version || 1}</span>
                <span style="font-size: 11px; color: rgba(0,255,0,0.5);">(Level ${p.clearance_level})</span>
                <div style="margin: 5px 0; font-size: 13px; background: rgba(0,0,0,0.3); padding: 10px;
                    white-space: pre-wrap; word-break: break-all; line-height: 2;">
                    ${displayRedactions(p.content)}
                </div>
                <div style="font-size: 11px; color: rgba(0,255,0,0.4);">
                    Added: ${new Date(p.created_at).toLocaleString()}
                    <button class="edit-btn" onclick="viewProtocolHistory(${p.id})" style="margin-left: 10px;">📜 View History</button>
                </div>
            </div>
        `).join('');
        
        loadProtocolsForRedaction();
        
    } catch (error) {
        console.error('Error loading protocols:', error);
    }
}

async function createProtocol(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    
    try {
        const response = await fetch('/api/admin/protocols', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: data.protocolTitle,
                content: data.protocolContent,
                clearanceLevel: parseInt(data.protocolLevel)
            })
        });
        
        const result = await response.json();
        if (response.ok) {
            alert(`Protocol created successfully! Version: ${result.version}`);
            form.reset();
            loadProtocols();
        } else {
            alert('Error: ' + (result.error || 'Failed to create protocol'));
        }
    } catch (error) {
        alert('Error creating protocol: ' + error.message);
    }
}

async function viewProtocolHistory(protocolId) {
    document.querySelector('.admin-nav button[data-target="history"]').click();
    await loadHistory('protocols');
    const sections = document.querySelectorAll('#historyContent .history-item');
    sections.forEach(s => {
        if (s.dataset.id == protocolId) {
            s.scrollIntoView({ behavior: 'smooth' });
            s.style.border = '2px solid #00ff00';
            setTimeout(() => {
                s.style.border = '1px solid rgba(0,255,0,0.2)';
            }, 3000);
        }
    });
}

// ============ LOCKDOWN MANAGEMENT ============

async function loadLockdown() {
    try {
        const response = await fetch('/api/admin/lockdown');
        if (!response.ok) throw new Error('Failed to load lockdown codes');
        const lockdowns = await response.json();
        
        const container = document.getElementById('lockdownList');
        container.innerHTML = lockdowns.map(l => `
            <div style="border-bottom: 1px solid rgba(0,255,0,0.1); padding: 10px 0;">
                <strong>${displayRedactions(l.code)}</strong> 
                <span class="version-badge version-current">v${l.version || 1}</span>
                <span style="font-size: 11px; color: rgba(0,255,0,0.5);">(Level ${l.clearance_level})</span>
                <div style="margin: 5px 0; font-size: 13px; background: rgba(0,0,0,0.3); padding: 10px;
                    white-space: pre-wrap; word-break: break-all; line-height: 2;">
                    ${displayRedactions(l.description)}
                </div>
                <div style="font-size: 11px; color: rgba(0,255,0,0.4);">
                    Updated: ${new Date(l.updated_at).toLocaleString()}
                    <button class="edit-btn" onclick="viewLockdownHistory(${l.clearance_level})" style="margin-left: 10px;">📜 View History</button>
                </div>
            </div>
        `).join('');
        
        // Set edit form
        const select = document.getElementById('lockdownLevel');
        select.innerHTML = lockdowns.map(l => 
            `<option value="${l.clearance_level}">Level ${l.clearance_level} (v${l.version || 1})</option>`
        ).join('');
        
        if (lockdowns.length > 0) {
            document.getElementById('lockdownCode').value = lockdowns[0].code;
            document.getElementById('lockdownDescription').value = lockdowns[0].description;
        }
        
        select.addEventListener('change', () => {
            const level = parseInt(select.value);
            const found = lockdowns.find(l => l.clearance_level === level);
            if (found) {
                document.getElementById('lockdownCode').value = found.code;
                document.getElementById('lockdownDescription').value = found.description;
            }
        });
        
        // Update redaction form
        const redactSelect = document.getElementById('redactLockdownLevel');
        if (redactSelect) {
            redactSelect.innerHTML = lockdowns.map(l => 
                `<option value="${l.clearance_level}">Level ${l.clearance_level} (v${l.version || 1})</option>`
            ).join('');
            
            if (lockdowns.length > 0) {
                document.getElementById('redactLockdownCode').value = lockdowns[0].code;
                document.getElementById('redactLockdownDescription').value = lockdowns[0].description;
            }
            
            redactSelect.addEventListener('change', () => {
                const level = parseInt(redactSelect.value);
                const found = lockdowns.find(l => l.clearance_level === level);
                if (found) {
                    document.getElementById('redactLockdownCode').value = found.code;
                    document.getElementById('redactLockdownDescription').value = found.description;
                }
            });
        }
        
    } catch (error) {
        console.error('Error loading lockdown codes:', error);
    }
}

async function updateLockdown(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const level = formData.get('level');
    const code = formData.get('code');
    const description = formData.get('description');
    
    try {
        const response = await fetch(`/api/admin/lockdown/${level}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, description })
        });
        
        const result = await response.json();
        if (response.ok) {
            alert(`Lockdown code updated successfully! Version: ${result.version}`);
            loadLockdown();
        } else {
            alert('Error: ' + (result.error || 'Failed to update lockdown code'));
        }
    } catch (error) {
        alert('Error updating lockdown code: ' + error.message);
    }
}

async function viewLockdownHistory(level) {
    document.querySelector('.admin-nav button[data-target="history"]').click();
    await loadHistory('lockdown');
    const sections = document.querySelectorAll('#historyContent .history-item');
    sections.forEach(s => {
        if (s.dataset.level == level) {
            s.scrollIntoView({ behavior: 'smooth' });
            s.style.border = '2px solid #00ff00';
            setTimeout(() => {
                s.style.border = '1px solid rgba(0,255,0,0.2)';
            }, 3000);
        }
    });
}

// ============ REDACTION FUNCTIONS ============

async function loadProtocolsForRedaction() {
    try {
        const response = await fetch('/api/admin/protocols');
        if (!response.ok) throw new Error('Failed to load protocols');
        const protocols = await response.json();
        
        const select = document.getElementById('redactProtocolSelect');
        select.innerHTML = protocols.map(p => 
            `<option value="${p.id}">${p.title} (Level ${p.clearance_level}) v${p.version || 1}</option>`
        ).join('');
        
        if (protocols.length > 0) {
            document.getElementById('redactProtocolContent').value = protocols[0].content;
        }
        
        select.addEventListener('change', () => {
            const id = parseInt(select.value);
            const found = protocols.find(p => p.id === id);
            if (found) {
                document.getElementById('redactProtocolContent').value = found.content;
            }
        });
        
    } catch (error) {
        console.error('Error loading protocols for redaction:', error);
    }
}

// Redact Ethics
async function redactEthics(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const level = formData.get('level');
    const content = formData.get('content');
    
    try {
        const response = await fetch('/api/admin/ethics/redact', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level, content })
        });
        
        const result = await response.json();
        if (response.ok) {
            alert(`Ethics redactions applied successfully! Version: ${result.version}`);
            loadEthics();
        } else {
            alert('Error: ' + (result.error || 'Failed to apply redactions'));
        }
    } catch (error) {
        alert('Error applying redactions: ' + error.message);
    }
}

// Redact Protocol
async function redactProtocol(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const protocolId = formData.get('protocolId');
    const content = formData.get('content');
    
    if (!protocolId) {
        alert('Please select a protocol');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/protocols/${protocolId}/redact`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        
        const result = await response.json();
        if (response.ok) {
            alert(`Protocol redactions applied successfully! Version: ${result.version}`);
            loadProtocols();
            loadProtocolsForRedaction();
        } else {
            alert('Error: ' + (result.error || 'Failed to apply redactions'));
        }
    } catch (error) {
        alert('Error applying redactions: ' + error.message);
    }
}

// Redact Lockdown
async function redactLockdown(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const level = formData.get('level');
    const code = formData.get('code');
    const description = formData.get('description');
    
    try {
        const response = await fetch('/api/admin/lockdown/redact', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level, code, description })
        });
        
        const result = await response.json();
        if (response.ok) {
            alert(`Lockdown redactions applied successfully! Version: ${result.version}`);
            loadLockdown();
        } else {
            alert('Error: ' + (result.error || 'Failed to apply redactions'));
        }
    } catch (error) {
        alert('Error applying redactions: ' + error.message);
    }
}

// ============ VERSION HISTORY ============

async function loadHistory(type) {
    const content = document.getElementById('historyContent');
    content.innerHTML = '<p style="color: rgba(0,255,0,0.5);">Loading history...</p>';
    
    // Update active tab
    document.querySelectorAll('.history-tab').forEach(tab => {
        tab.classList.remove('active');
        tab.style.background = 'transparent';
    });
    const activeTab = document.querySelector(`.history-tab[onclick*="${type}"]`);
    if (activeTab) {
        activeTab.classList.add('active');
        activeTab.style.background = 'rgba(0, 255, 0, 0.1)';
    }
    
    try {
        let items = [];
        let title = '';
        
        switch(type) {
            case 'ethics':
                title = 'Code of Ethics';
                const ethicsRes = await fetch('/api/admin/ethics');
                if (ethicsRes.ok) {
                    const ethics = await ethicsRes.json();
                    for (const e of ethics) {
                        const historyRes = await fetch(`/api/admin/ethics/${e.clearance_level}/history`);
                        if (historyRes.ok) {
                            const history = await historyRes.json();
                            items.push({
                                id: e.clearance_level,
                                label: `Level ${e.clearance_level}`,
                                currentVersion: e.version || 1,
                                history: history,
                                type: 'ethics'
                            });
                        }
                    }
                }
                break;
                
            case 'protocols':
                title = 'Protocols';
                const protocolsRes = await fetch('/api/admin/protocols');
                if (protocolsRes.ok) {
                    const protocols = await protocolsRes.json();
                    for (const p of protocols) {
                        const historyRes = await fetch(`/api/admin/protocols/${p.id}/history`);
                        if (historyRes.ok) {
                            const history = await historyRes.json();
                            items.push({
                                id: p.id,
                                label: p.title,
                                currentVersion: p.version || 1,
                                history: history,
                                type: 'protocols'
                            });
                        }
                    }
                }
                break;
                
            case 'lockdown':
                title = 'Lockdown Codes';
                const lockdownRes = await fetch('/api/admin/lockdown');
                if (lockdownRes.ok) {
                    const lockdowns = await lockdownRes.json();
                    for (const l of lockdowns) {
                        const historyRes = await fetch(`/api/admin/lockdown/${l.clearance_level}/history`);
                        if (historyRes.ok) {
                            const history = await historyRes.json();
                            items.push({
                                id: l.clearance_level,
                                label: `Level ${l.clearance_level} - ${l.code}`,
                                currentVersion: l.version || 1,
                                history: history,
                                type: 'lockdown'
                            });
                        }
                    }
                }
                break;
                
            case 'users':
                title = 'Users';
                const usersRes = await fetch('/api/admin/users');
                if (usersRes.ok) {
                    const users = await usersRes.json();
                    for (const u of users) {
                        const historyRes = await fetch(`/api/admin/users/${u.id}/history`);
                        if (historyRes.ok) {
                            const history = await historyRes.json();
                            items.push({
                                id: u.id,
                                label: u.username,
                                currentVersion: u.version || 1,
                                history: history,
                                type: 'users'
                            });
                        }
                    }
                }
                break;
        }
        
        if (items.length === 0) {
            content.innerHTML = `<p style="color: rgba(0,255,0,0.5);">No ${title} history found.</p>`;
            return;
        }
        
        let html = `<h3>${title} - Version History</h3>`;
        
        for (const item of items) {
            html += `
                <div class="history-item" data-id="${item.id}" data-level="${item.id}" style="border: 1px solid rgba(0,255,0,0.2); margin: 15px 0; padding: 15px; border-radius: 5px;">
                    <h4 style="color: #00ff00; margin: 0 0 10px 0;">
                        ${item.label}
                        <span class="version-badge version-current">Current: v${item.currentVersion}</span>
                    </h4>
                    <div style="max-height: 300px; overflow-y: auto;">
                        <table class="history-table">
                            <thead>
                                <tr>
                                    <th>Version</th>
                                    <th>Changed By</th>
                                    <th>Change Type</th>
                                    <th>Changed At</th>
                                    ${item.type === 'users' ? '<th>Details</th>' : ''}
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                    `;
            
            if (item.history.length === 0) {
                html += `<tr><td colspan="6" style="text-align:center;color:rgba(0,255,0,0.3);">No history records</td></tr>`;
            } else {
                for (const h of item.history) {
                    const changeClass = `change-type-${(h.change_type || 'update').toLowerCase()}`;
                    let details = '';
                    if (item.type === 'users') {
                        details = `Clearance: ${h.clearance_level}, Dept: ${h.department || 'N/A'}`;
                    }
                    
                    // Show content preview for non-user items
                    if (item.type !== 'users' && h.content) {
                        const preview = h.content.substring(0, 50) + (h.content.length > 50 ? '...' : '');
                        details = `<span title="${h.content.replace(/"/g, '&quot;')}">${displayRedactions(preview)}</span>`;
                    }
                    
                    html += `
                        <tr>
                            <td><strong>v${h.version}</strong></td>
                            <td>${h.changed_by_name || 'System'}</td>
                            <td><span class="${changeClass}">${h.change_type || 'UPDATE'}</span></td>
                            <td>${new Date(h.changed_at || h.created_at || Date.now()).toLocaleString()}</td>
                            <td style="font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${details || 'N/A'}</td>
                            <td>
                                ${h.version !== item.currentVersion && h.version > 0 ? 
                                    `<button class="rollback-btn" onclick="rollback('${item.type}', ${item.id}, ${h.version})">Rollback</button>` : 
                                    '<span style="color: rgba(0,255,0,0.3);">Current</span>'
                                }
                            </td>
                        </tr>
                    `;
                }
            }
            
            html += `
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }
        
        content.innerHTML = html;
        
    } catch (error) {
        console.error('Error loading history:', error);
        content.innerHTML = `<p style="color: #ff0000;">Error loading history: ${error.message}</p>`;
    }
}

// ============ ROLLBACK FUNCTIONS ============

async function rollback(type, id, version) {
    if (!confirm(`Are you sure you want to rollback ${type} ${id} to version ${version}? This will create a new version.`)) return;
    
    try {
        let url = '';
        switch(type) {
            case 'ethics':
                url = `/api/admin/ethics/${id}/rollback/${version}`;
                break;
            case 'protocols':
                url = `/api/admin/protocols/${id}/rollback/${version}`;
                break;
            case 'lockdown':
                url = `/api/admin/lockdown/${id}/rollback/${version}`;
                break;
            case 'users':
                alert('User rollback is not available. Please edit the user manually.');
                return;
        }
        
        const response = await fetch(url, { method: 'POST' });
        const result = await response.json();
        
        if (response.ok) {
            alert(`Rollback successful! ${result.message}`);
            loadUsers();
            loadEthics();
            loadProtocols();
            loadLockdown();
            loadHistory(type);
        } else {
            alert('Error: ' + (result.error || 'Failed to rollback'));
        }
    } catch (error) {
        alert('Error rolling back: ' + error.message);
    }
}

// ============ LOGS ============

async function loadLogs(page = 1) {
    try {
        const response = await fetch(`/api/admin/logs?page=${page}&limit=50`);
        if (!response.ok) throw new Error('Failed to load logs');
        const data = await response.json();
        
        const tableBody = document.getElementById('logsTableBody');
        if (data.logs && data.logs.length > 0) {
            tableBody.innerHTML = data.logs.map(log => `
                <tr>
                    <td style="font-size: 11px;">${new Date(log.timestamp).toLocaleString()}</td>
                    <td>${log.username || 'Unknown'}</td>
                    <td><span style="color: ${log.action.includes('ERROR') || log.action.includes('FAILED') ? '#ff0000' : '#00ff00'};">${log.action}</span></td>
                    <td>${log.page || 'N/A'}</td>
                    <td style="font-size: 12px; max-width: 200px; word-wrap: break-word;">${log.details || 'N/A'}</td>
                    <td style="font-size: 11px;">${log.ip_address || 'N/A'}</td>
                </tr>
            `).join('');
        } else {
            tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:rgba(0,255,0,0.3);">No logs found</td></tr>';
        }
        
        const pagination = document.getElementById('logsPagination');
        if (data.totalPages > 1) {
            let pagesHtml = '';
            for (let i = 1; i <= data.totalPages; i++) {
                pagesHtml += `<button onclick="loadLogs(${i})" style="background: ${i === data.page ? '#00ff00' : 'transparent'}; color: ${i === data.page ? '#000' : '#00ff00'}; border: 1px solid #00ff00; padding: 5px 10px; margin: 2px; cursor: pointer; font-family: 'Courier New', monospace;">${i}</button>`;
            }
            pagination.innerHTML = pagesHtml;
        } else {
            pagination.innerHTML = '';
        }
        
    } catch (error) {
        console.error('Error loading logs:', error);
        document.getElementById('logsTableBody').innerHTML = 
            '<tr><td colspan="6" style="text-align:center;color:#ff0000;">Error loading logs</td></tr>';
    }
}

// ============ LOGOUT ============

async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login.html';
    } catch (error) {
        console.error('Logout error:', error);
        window.location.href = '/login.html';
    }
}

// Make functions globally accessible
window.loadHistory = loadHistory;
window.rollback = rollback;
window.loadLogs = loadLogs;
window.editUser = editUser;
window.deleteUser = deleteUser;
window.viewUserHistory = viewUserHistory;
window.viewEthicsHistory = viewEthicsHistory;
window.viewProtocolHistory = viewProtocolHistory;
window.viewLockdownHistory = viewLockdownHistory;
