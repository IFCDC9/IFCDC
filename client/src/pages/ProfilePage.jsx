import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';

export default function ProfilePage() {
  const { user } = useAuth();

  return (
    <Layout>
      <div data-testid="profile-page" className="profile-page">
        <h2>Profile</h2>
        
        <div className="profile-card">
          <div className="profile-field">
            <label>Name</label>
            <span data-testid="profile-name">{user?.name}</span>
          </div>
          
          <div className="profile-field">
            <label>Role</label>
            <span data-testid="profile-role">{user?.role}</span>
          </div>
        </div>
      </div>
    </Layout>
  );
}
