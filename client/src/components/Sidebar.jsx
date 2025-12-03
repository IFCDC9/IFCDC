import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Sidebar() {
  const { user } = useAuth();

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: '📊' },
    { to: '/manual', label: 'Policy Manual', icon: '📖' },
    { to: '/forms', label: 'Forms', icon: '📝' },
    { to: '/training', label: 'Training', icon: '🎓' },
    { to: '/compliance', label: 'Compliance', icon: '✅' },
    { to: '/profile', label: 'Profile', icon: '👤' },
  ];

  if (user?.role === 'admin') {
    navItems.push({ to: '/admin/users', label: 'Users', icon: '👥' });
  }

  return (
    <aside data-testid="sidebar" className="sidebar">
      <div className="sidebar-header">
        <h2>IFCDC Portal</h2>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            data-testid={`nav-${item.label.toLowerCase().replace(' ', '-')}`}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
