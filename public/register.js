document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  const payload = Object.fromEntries(formData.entries());

  if (payload.password !== payload.confirm) {
    alert('Passwords do not match');
    return;
  }

  const res = await fetch('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    window.location.href = '/dashboard.html';
  } else {
    alert('Registration failed');
  }
});
