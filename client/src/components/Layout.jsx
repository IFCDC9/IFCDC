import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import logo from '../assets/logo.jpeg';

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src={logo} alt="IFCDC Logo" className="sidebar-logo-img" />
          <span>Staff Portal</span>
        </div>
        <nav>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/manual">Manual</NavLink>
          <NavLink to="/forms">Forms</NavLink>
          <NavLink to="/training">Training</NavLink>
          <NavLink to="/compliance">Compliance</NavLink>
          {user?.role === 'admin' && <NavLink to="/admin/users">Admin</NavLink>}
          <NavLink to="/profile">My Profile</NavLink>
        </nav>
        <button onClick={logout}>Logout</button>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div>Welcome, {user?.name}</div>
          <div className="role-tag">{user?.role}</div>
        </header>
        <section className="page-body">
          <Outlet />
        </section>
      </main>
    </div>
  );
}
