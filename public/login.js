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

  if (res.ok) {
    const data = await res.json();
    const role = (data.role || '').toLowerCase();

    if (role === 'admin' || role === 'owner' || role === 'exec') {
      window.location.href = '/admin';
    } else if (role === 'barber') {
      window.location.href = '/barber';
    } else if (role === 'radio' || role === 'radio_host') {
      window.location.href = '/radio';
    } else {
      window.location.href = '/dashboard.html';
    }
  } else {
    alert('Invalid login credentials');
  }
});
