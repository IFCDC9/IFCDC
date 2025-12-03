import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <Layout>
      <div data-testid="dashboard-page" className="dashboard-page">
        <h2>Welcome, {user?.name}</h2>
        
        <div className="dashboard-cards">
          <div className="dashboard-card">
            <h3>📖 Policy Manual</h3>
            <p>View and acknowledge policy chapters</p>
          </div>
          
          <div className="dashboard-card">
            <h3>✅ My Acknowledgements</h3>
            <p>Track your policy acknowledgements</p>
          </div>
          
          <div className="dashboard-card">
            <h3>👤 Profile</h3>
            <p>View and update your profile</p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
