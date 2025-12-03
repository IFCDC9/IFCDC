import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';

import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ManualPage from './pages/ManualPage';
import FormsPage from './pages/FormsPage';
import TrainingPage from './pages/TrainingPage';
import CompliancePage from './pages/CompliancePage';
import AdminUsersPage from './pages/AdminUsersPage';
import ProfilePage from './pages/ProfilePage';
import BarbershopPage from './pages/BarbershopPage';
import Layout from './components/Layout';

function ProtectedRoute({ children, roles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="manual" element={<ManualPage />} />
            <Route path="forms" element={<FormsPage />} />
            <Route path="training" element={<TrainingPage />} />
            <Route path="compliance" element={<CompliancePage />} />
            <Route path="admin/users" element={
              <ProtectedRoute roles={['admin']}>
                <AdminUsersPage />
              </ProtectedRoute>
            } />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="barbershop" element={<BarbershopPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
