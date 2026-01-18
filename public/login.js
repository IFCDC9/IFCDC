let requires2FA = false;
let savedEmail = '';
let savedPassword = '';

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const errorMsg = document.getElementById('errorMsg');
  const submitBtn = document.getElementById('submitBtn');
  
  errorMsg.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Logging in...';
  
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const totpCode = document.getElementById('totpCode').value;
  
  const payload = { email: savedEmail || email, password: savedPassword || password };
  if (requires2FA && totpCode) {
    payload.totpCode = totpCode;
  }
  
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    
    if (data.requires2FA) {
      requires2FA = true;
      savedEmail = email;
      savedPassword = password;
      
      document.getElementById('credentialsSection').style.display = 'none';
      document.getElementById('totpSection').classList.add('show');
      document.getElementById('totpCode').focus();
      submitBtn.textContent = 'Verify';
      submitBtn.disabled = false;
      return;
    }
    
    if (res.ok && data.id) {
      const role = data.role;
      if (role === 'admin' || role === 'owner' || role === 'exec') {
        window.location.href = '/admin/dashboard.html';
      } else {
        window.location.href = '/dashboard.html';
      }
    } else {
      errorMsg.textContent = data.error || 'Invalid credentials';
      errorMsg.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = requires2FA ? 'Verify' : 'Login';
    }
  } catch (err) {
    errorMsg.textContent = 'Network error. Please try again.';
    errorMsg.style.display = 'block';
    submitBtn.disabled = false;
    submitBtn.textContent = requires2FA ? 'Verify' : 'Login';
  }
});

// Auto-submit when 6 digits entered
document.getElementById('totpCode').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '');
  if (e.target.value.length === 6) {
    document.getElementById('loginForm').dispatchEvent(new Event('submit'));
  }
});
