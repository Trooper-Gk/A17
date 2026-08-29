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
                <td>${new Date(user.last_login || user.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="edit-btn" onclick="editUser(${user.id})">✎</button>
                    ${!user.is_super_admin ? `<button class="edit-btn delete-btn" onclick="deleteUser(${user.id})">✕</button>` : ''}
                </td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('Error loading users:', error);
        document.getElementById('usersTableBody').innerHTML = 
            '<tr><td colspan="8" style="text-align:center;color:#ff0000;">Error loading users</td></tr>';
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

// Load Ethics with redaction display
async function loadEthics() {
    try {
        const response = await fetch('/api/admin/ethics');
        if (!response.ok) throw new Error('Failed to load ethics');
        const ethics = await response.json();
        
        const container = document.getElementById('ethicsList');
        container.innerHTML = ethics.map(e => `
            <div style="border-bottom: 1px solid rgba(0,255,0,0.1); padding: 10px 0;">
                <strong>LEVEL ${e.clearance_level}</strong>
                <div style="margin: 5px 0; font-size: 13px; background: rgba(0,0,0,0.3); padding: 10px; 
                    white-space: pre-wrap; word-break: break-all;">
                    ${e.content.replace(/\[REDACT:(\d+):([^\]]*)\]/g, (match, level, text) => 
                        `<span style="background: #ff000033; padding: 2px 5px; border: 1px solid #ff0000; 
                            border-radius: 3px;">🔴 [REQUIRES LEVEL ${level}]</span>`
                    )}
                </div>
                <div style="font-size: 11px; color: rgba(0,255,0,0.4);">
                    Updated: ${new Date(e.updated_at).toLocaleString()}
                </div>
            </div>
        `).join('');
        
        // Set edit form
        const select = document.getElementById('ethicsLevel');
        select.innerHTML = ethics.map(e => 
            `<option value="${e.clearance_level}">Level ${e.clearance_level}</option>`
        ).join('');
        
        // Load first ethics content
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
        
        // Also update redaction form with current ethics
        const redactSelect = document.getElementById('redactEthicsLevel');
        if (redactSelect) {
            redactSelect.innerHTML = ethics.map(e => 
                `<option value="${e.clearance_level}">Level ${e.clearance_level}</option>`
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
            alert('Ethics updated successfully!');
            loadEthics();
        } else {
            alert('Error: ' + (result.error || 'Failed to update ethics'));
        }
    } catch (error) {
        alert('Error updating ethics: ' + error.message);
    }
}

// Load Protocols with redaction display
async function loadProtocols() {
    try {
        const response = await fetch('/api/admin/protocols');
        if (!response.ok) throw new Error('Failed to load protocols');
        const protocols = await response.json();
        
        const container = document.getElementById('protocolsList');
        container.innerHTML = protocols.map(p => `
            <div style="border-bottom: 1px solid rgba(0,255,0,0.1); padding: 10px 0;">
                <strong>${p.title.replace(/\[REDACT:(\d+):([^\]]*)\]/g, (match, level, text) => 
                    `<span style="background: #ff000033; padding: 2px 5px; border: 1px solid #ff0000; 
                        border-radius: 3px;">🔴 [REQUIRES LEVEL ${level}]</span>`
                )}</strong> 
                <span style="font-size: 11px; color: rgba(0,255,0,0.5);">(Level ${p.clearance_level})</span>
                <div style="margin: 5px 0; font-size: 13px; background: rgba(0,0,0,0.3); padding: 10px;
                    white-space: pre-wrap; word-break: break-all;">
                    ${p.content.replace(/\[REDACT:(\d+):([^\]]*)\]/g, (match, level, text) => 
                        `<span style="background: #ff000033; padding: 2px 5px; border: 1px solid #ff0000; 
                            border-radius: 3px;">🔴 [REQUIRES LEVEL ${level}]</span>`
                    )}
                </div>
                <div style="font-size: 11px; color: rgba(0,255,0,0.4);">
                    Added: ${new Date(p.created_at).toLocaleString()}
                </div>
            </div>
        `).join('');
        
        // Load protocols for redaction dropdown
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
            alert('Protocol created successfully!');
            form.reset();
            loadProtocols();
        } else {
            alert('Error: ' + (result.error || 'Failed to create protocol'));
        }
    } catch (error) {
        alert('Error creating protocol: ' + error.message);
    }
}

// Load Lockdown with redaction display
async function loadLockdown() {
    try {
        const response = await fetch('/api/admin/lockdown');
        if (!response.ok) throw new Error('Failed to load lockdown codes');
        const lockdowns = await response.json();
        
        const container = document.getElementById('lockdownList');
        container.innerHTML = lockdowns.map(l => `
            <div style="border-bottom: 1px solid rgba(0,255,0,0.1); padding: 10px 0;">
                <strong>${l.code.replace(/\[REDACT:(\d+):([^\]]*)\]/g, (match, level, text) => 
                    `<span style="background: #ff000033; padding: 2px 5px; border: 1px solid #ff0000; 
                        border-radius: 3px;">🔴 [REQUIRES LEVEL ${level}]</span>`
                )}</strong> 
                <span style="font-size: 11px; color: rgba(0,255,0,0.5);">(Level ${l.clearance_level})</span>
                <div style="margin: 5px 0; font-size: 13px; background: rgba(0,0,0,0.3); padding: 10px;
                    white-space: pre-wrap; word-break: break-all;">
                    ${l.description.replace(/\[REDACT:(\d+):([^\]]*)\]/g, (match, level, text) => 
                        `<span style="background: #ff000033; padding: 2px 5px; border: 1px solid #ff0000; 
                            border-radius: 3px;">🔴 [REQUIRES LEVEL ${level}]</span>`
                    )}
                </div>
                <div style="font-size: 11px; color: rgba(0,255,0,0.4);">
                    Updated: ${new Date(l.updated_at).toLocaleString()}
                </div>
            </div>
        `).join('');
        
        // Set edit form
        const select = document.getElementById('lockdownLevel');
        select.innerHTML = lockdowns.map(l => 
            `<option value="${l.clearance_level}">Level ${l.clearance_level}</option>`
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
                `<option value="${l.clearance_level}">Level ${l.clearance_level}</option>`
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
            alert('Lockdown code updated successfully!');
            loadLockdown();
        } else {
            alert('Error: ' + (result.error || 'Failed to update lockdown code'));
        }
    } catch (error) {
        alert('Error updating lockdown code: ' + error.message);
    }
}

// Load protocols for redaction dropdown
async function loadProtocolsForRedaction() {
    try {
        const response = await fetch('/api/admin/protocols');
        if (!response.ok) throw new Error('Failed to load protocols');
        const protocols = await response.json();
        
        const select = document.getElementById('redactProtocolSelect');
        select.innerHTML = protocols.map(p => 
            `<option value="${p.id}">${p.title} (Level ${p.clearance_level})</option>`
        ).join('');
        
        // Load first protocol content
        if (protocols.length > 0) {
            document.getElementById('redactProtocolContent').value = protocols[0].content;
        }
        
        // Add change listener
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
            alert('Ethics redactions applied successfully!');
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
            alert('Protocol redactions applied successfully!');
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
            alert('Lockdown redactions applied successfully!');
            loadLockdown();
        } else {
            alert('Error: ' + (result.error || 'Failed to apply redactions'));
        }
    } catch (error) {
        alert('Error applying redactions: ' + error.message);
    }
}

async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login.html';
    } catch (error) {
        console.error('Logout error:', error);
        window.location.href = '/login.html';
    }
}
