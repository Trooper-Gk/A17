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
        loadHistory('ethics');
        
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
    // Simple prompt-based edit for now
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
    // Switch to history tab
    document.querySelector('.admin-nav button[data-target="history"]').click();
    await loadHistory('users');
    // Scroll to the user's history
    const userSection = document.querySelector(`#historyContent [data-user-id="${userId}"]`);
    if (userSection) {
        userSection.scrollIntoView({ behavior: 'smooth' });
        userSection.style.border = '2px solid #00ff00';
        setTimeout(() => {
            userSection.style.border = '1px solid rgba(0,255,0,0.2)';
        }, 3000);
    }
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
                    white-space: pre-wrap; word-break: break-all;">
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
    // Find and highlight the ethics section
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
                    white-space: pre-wrap; word-break: break-all;">
                    ${displayRedactions(p.content)}
                </div>
                <div style="font-size: 11px; color: rgba(0,255,0,0.4);">
                    Added: ${new Date(p.created_at).toLocaleString()}
                    <button class="edit-btn" onclick="viewProtocolHistory(${p.id})" style="margin-left: 10px;">📜 View History</button>
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
                    white-space: pre-wrap; word-break: break-all;">
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
                const level = parseInt(redactSelect.value
