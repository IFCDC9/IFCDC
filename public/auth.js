(async () => {
  const res = await fetch('/auth/me', { credentials: 'include' });
  if (!res.ok) return;

  const data = await res.json();
  const user = data.user;

  // Update nav buttons
  const authButtons = document.querySelectorAll('.auth-buttons');
  authButtons.forEach(container => {
    container.innerHTML = `
      <a href="/dashboard.html" class="btn btn-login">Dashboard</a>
      <button class="btn btn-register" onclick="(async()=>{await fetch('/auth/logout',{method:'POST',credentials:'include'});window.location.href='/';})()">Logout</button>
    `;
  });

  // Show admin-only elements
  if (user.role === 'admin' || user.role === 'owner' || user.role === 'exec') {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block');
  }
})();
