document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  const payload = Object.fromEntries(formData.entries());

  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    alert('Invalid login credentials');
    return;
  }

  const user = await res.json();

  // Role-based routing
  if (user.role === 'admin') {
    window.location.href = '/admin/dashboard.html';
  } else {
    window.location.href = '/dashboard.html';
  }
});
