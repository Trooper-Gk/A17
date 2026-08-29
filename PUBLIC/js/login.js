document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errorDiv = document.getElementById('loginError');
    
    // Auto-focus username
    usernameInput.focus();
    
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        
        if (!username || !password) {
            errorDiv.textContent = '⚠ Username and password required';
            return;
        }
        
        // Disable form during submission
        const submitBtn = loginForm.querySelector('.login-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'AUTHENTICATING...';
        errorDiv.textContent = '';
        
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
                // Login success - redirect based on user role
                window.location.href = data.redirect || '/dashboard.html';
            } else {
                errorDiv.textContent = `⚠ ${data.error || 'Authentication failed'}`;
                // Shake the form on error
                loginForm.style.animation = 'shake 0.5s';
                setTimeout(() => {
                    loginForm.style.animation = '';
                }, 500);
                passwordInput.value = '';
                passwordInput.focus();
            }
        } catch (error) {
            errorDiv.textContent = '⚠ Network error - check server connection';
            console.error('Login error:', error);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'ACCESS DATABASE';
        }
    });
    
    // Enter key to submit
    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            loginForm.dispatchEvent(new Event('submit'));
        }
    });
    
    // Add shake animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-10px); }
            75% { transform: translateX(10px); }
        }
    `;
    document.head.appendChild(style);
});
