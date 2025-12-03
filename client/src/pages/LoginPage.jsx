import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { loginApi } from '../api/authApi';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');

  const onChange = e => setForm({ ...form, [e.target.name]: e.target.value });

  const onSubmit = async e => {
    e.preventDefault();
    setError('');
    try {
      const res = await loginApi(form.email, form.password);
      login(res.token, res.user);
      navigate('/dashboard');
    } catch (err) {
      setError('Invalid login. Please check your credentials.');
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>IFCDC Staff Portal</h1>
        <p>Sign in to access the operations manual & tools.</p>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={onSubmit}>
          <label>
            Email
            <input name="email" type="email" value={form.email} onChange={onChange} />
          </label>
          <label>
            Password
            <input name="password" type="password" value={form.password} onChange={onChange} />
          </label>
          <button type="submit">Sign In</button>
        </form>
      </div>
    </div>
  );
}
