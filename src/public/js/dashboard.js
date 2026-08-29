document.addEventListener('DOMContentLoaded', async () => {
    // Check if user is logged in
    try {
        const userResponse = await fetch('/api/user');
        if (!userResponse.ok) {
            window.location.href = '/login.html';
            return;
        }
        const user = await userResponse.json();
        
        // Set user info
        document.getElementById('usernameDisplay').textContent = user.username;
        document.getElementById('clearanceDisplay').textContent = `LEVEL ${user.clearance_level}`;
        document.getElementById('departmentDisplay').textContent = user.department || 'UNASSIGNED';
        document.getElementById('rankDisplay').textContent = user.rank || 'PERSONNEL';
        
        // Load dashboard data
        loadDashboard(user.clearance_level);
        
        // Setup logout
        document.getElementById('logoutBtn').addEventListener('click', logout);
        
    } catch (error) {
        console.error('Error loading user:', error);
        window.location.href = '/login.html';
    }
});

async function loadDashboard(level) {
    try {
        const response = await fetch(`/api/dashboard/${level}`);
        if (!response.ok) {
            throw new Error('Failed to load dashboard');
        }
        const data = await response.json();
        
        // Display Code of Ethics
        document.getElementById('ethicsContent').textContent = data.ethics || 'No ethics code defined for this level.';
        
        // Display Protocols
        const protocolsContainer = document.getElementById('protocolsContent');
        if (data.protocols && data.protocols.length > 0) {
            protocolsContainer.innerHTML = data.protocols.map(p => `
                <div class="protocol-item">
                    <strong>${p.title}</strong>
                    <div style="margin-top: 5px; font-size: 13px; color: rgba(0,255,0,0.7);">
                        ${p.content}
                    </div>
                    <div style="font-size: 11px; color: rgba(0,255,0,0.4); margin-top: 5px;">
                        Added: ${new Date(p.created_at).toLocaleDateString()}
                    </div>
                </div>
            `).join('');
        } else {
            protocolsContainer.innerHTML = '<div style="color: rgba(0,255,0,0.5);">No protocols available for this clearance level.</div>';
        }
        
        // Display Lockdown Code
        const lockdownContent = document.getElementById('lockdownContent');
        if (data.lockdown) {
            lockdownContent.innerHTML = `
                <div style="font-weight: bold; font-size: 18px; color: #ff0000;">${data.lockdown.code}</div>
                <div style="margin-top: 5px;">${data.lockdown.description}</div>
            `;
        } else {
            lockdownContent.innerHTML = '<div style="color: rgba(0,255,0,0.5);">No lockdown code assigned for this level.</div>';
        }
        
    } catch (error) {
        console.error('Error loading dashboard:', error);
        document.querySelector('.dashboard-grid').innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; color: #ff0000; padding: 40px;">
                ⚠ ERROR: Failed to load dashboard data. Please refresh or contact administrator.
            </div>
        `;
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
