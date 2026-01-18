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
    window.location.href = '/dashboard.html';
  } else {
    alert('Invalid login credentials');
  }
});
