import { useAuth } from '../context/AuthContext';

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div data-testid="dashboard-page" className="page">
      <h2>Welcome, {user?.name}</h2>
      
      <div className="card-list">
        <div className="card">
          <h3>📖 Policy Manual</h3>
          <p>View and acknowledge policy chapters</p>
        </div>
        
        <div className="card">
          <h3>📝 Forms</h3>
          <p>Access and complete required forms</p>
        </div>
        
        <div className="card">
          <h3>🎓 Training</h3>
          <p>Complete required training modules</p>
        </div>
        
        <div className="card">
          <h3>✅ Compliance</h3>
          <p>Track your compliance status</p>
        </div>
      </div>
    </div>
  );
}
