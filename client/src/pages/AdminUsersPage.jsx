import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { getUsers } from '../api/usersApi';

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await getUsers();
      setUsers(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div data-testid="admin-users-page" className="admin-users-page">
        <h2>User Management</h2>
        
        {loading && <div className="loading">Loading users...</div>}
        {error && <div className="error">Error: {error}</div>}
        
        {!loading && !error && (
          <table className="users-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} data-testid={`user-row-${user.id}`}>
                  <td>{user.id}</td>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td>{user.role}</td>
                  <td>{user.isActive ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
