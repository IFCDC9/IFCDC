(function() {
  const AUTH_KEY = 'ifcdc_user';
  
  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        return data.user;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function getDashboardUrl(role) {
    const r = (role || '').toLowerCase();
    if (['owner', 'admin', 'exec'].includes(r)) return '/admin';
    if (r === 'barber') return '/barber';
    if (r === 'radio' || r === 'radio_host') return '/radio';
    if (r === 'program_staff') return '/programs';
    return '/admin';
  }

  function updateNav(user) {
    const authButtons = document.querySelectorAll('.auth-buttons');
    authButtons.forEach(container => {
      if (user) {
        const dashUrl = getDashboardUrl(user.role);
        container.innerHTML = `
          <a href="${dashUrl}" class="btn btn-login">Dashboard</a>
          <button class="btn btn-register" id="logoutBtn">Logout</button>
        `;
        container.querySelector('#logoutBtn').addEventListener('click', logout);
      } else {
        container.innerHTML = `
          <a href="/login.html" class="btn btn-login">Login</a>
          <a href="/register.html" class="btn btn-register">Register</a>
        `;
      }
    });
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      localStorage.removeItem(AUTH_KEY);
      window.location.href = '/';
    } catch (e) {
      console.error('Logout error', e);
    }
  }

  async function login(email, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    localStorage.setItem(AUTH_KEY, JSON.stringify(data.user));
    return data;
  }

  async function register(name, email, password) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    return data;
  }

  function initLoginForm() {
    const form = document.getElementById('loginForm');
    if (!form) return;
    
    const errorEl = document.getElementById('loginError');
    const submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      errorEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in...';

      try {
        const email = form.email.value.trim();
        const password = form.password.value;
        const data = await login(email, password);
        window.location.href = getDashboardUrl(data.role);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    });
  }

  function initRegisterForm() {
    const form = document.getElementById('registerForm');
    if (!form) return;

    const errorEl = document.getElementById('registerError');
    const successEl = document.getElementById('registerSuccess');
    const submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      errorEl.style.display = 'none';
      successEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating account...';

      try {
        const name = form.name.value.trim();
        const email = form.email.value.trim();
        const password = form.password.value;
        const confirmPassword = form.confirmPassword.value;

        if (password !== confirmPassword) {
          throw new Error('Passwords do not match');
        }
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters');
        }

        await register(name, email, password);
        
        successEl.textContent = 'Account created! Signing you in...';
        successEl.style.display = 'block';

        const data = await login(email, password);
        setTimeout(() => {
          window.location.href = getDashboardUrl(data.role);
        }, 1000);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account';
      }
    });
  }

  async function init() {
    const user = await checkAuth();
    updateNav(user);

    if (user && (window.location.pathname === '/login.html' || window.location.pathname === '/register.html')) {
      window.location.href = getDashboardUrl(user.role);
      return;
    }

    initLoginForm();
    initRegisterForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.ifcdcAuth = { checkAuth, login, register, logout, getDashboardUrl };
})();
