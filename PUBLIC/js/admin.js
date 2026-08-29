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
