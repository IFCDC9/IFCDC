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
      body: JSON.stringify({
        email: payload.email,
        password: payload.password
      })
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
