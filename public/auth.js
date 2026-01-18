(function() {
  async function checkAuth() {
    try {
      const res = await fetch('/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        return data.user;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function updateNav(user) {
    const authButtons = document.querySelectorAll('.auth-buttons');
    authButtons.forEach(container => {
      if (user) {
        container.innerHTML = `
          <a href="/dashboard.html" class="btn btn-login">Dashboard</a>
          <button class="btn btn-register" id="logoutBtn">Logout</button>
        `;
        const logoutBtn = container.querySelector('#logoutBtn');
        if (logoutBtn) {
          logoutBtn.addEventListener('click', logout);
        }
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
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
      window.location.href = '/';
    } catch (e) {
      console.error('Logout error', e);
    }
  }

  function initLoginForm() {
    const form = document.getElementById('loginForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const formData = new FormData(e.target);
      const payload = Object.fromEntries(formData.entries());

      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        window.location.href = '/dashboard.html';
      } else {
        alert('Invalid login credentials');
      }
    });
  }

  function initRegisterForm() {
    const form = document.getElementById('registerForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const formData = new FormData(e.target);
      const payload = Object.fromEntries(formData.entries());

      if (payload.password !== payload.confirmPassword) {
        alert('Passwords do not match');
        return;
      }

      const res = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: payload.name,
          email: payload.email,
          password: payload.password
        })
      });

      if (res.ok) {
        const loginRes = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: payload.email, password: payload.password })
        });
        if (loginRes.ok) {
          window.location.href = '/dashboard.html';
        } else {
          window.location.href = '/login.html';
        }
      } else {
        const data = await res.json();
        alert(data.error || 'Registration failed');
      }
    });
  }

  async function init() {
    const user = await checkAuth();
    updateNav(user);

    if (user && (window.location.pathname === '/login.html' || window.location.pathname === '/register.html')) {
      window.location.href = '/dashboard.html';
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
})();
