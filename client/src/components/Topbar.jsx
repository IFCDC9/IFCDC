import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Topbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header data-testid="topbar" className="topbar">
      <div className="topbar-left">
        <h1>IFCDC Manual System</h1>
      </div>
      <div className="topbar-right">
        <span data-testid="user-name" className="user-name">
          {user?.name} ({user?.role})
        </span>
        <button
          data-testid="btn-logout"
          onClick={handleLogout}
          className="btn-logout"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
