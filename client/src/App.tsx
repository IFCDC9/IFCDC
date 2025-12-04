import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./auth/ProtectedRoute";
import { useAuth } from "./auth/AuthContext";
import AdminDashboard from "./dashboards/AdminDashboard";
import BarberDashboard from "./dashboards/BarberDashboard";
import RadioDashboard from "./dashboards/RadioDashboard";
import HrOnboardingPage from "./pages/HrOnboardingPage";
import ProgramsDashboard from "./pages/ProgramsDashboard";
import ProgramDetailPage from "./pages/ProgramDetailPage";
import MyTimeEntriesPage from "./pages/MyTimeEntriesPage";
import AdminTimeOverviewPage from "./pages/AdminTimeOverviewPage";
import LoginPage from "./pages/LoginPage";

const RoleRouter: React.FC = () => {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;

  if (user.role === "admin") return <Navigate to="/admin" replace />;
  if (user.role === "barber") return <Navigate to="/barber" replace />;
  if (user.role === "radio_host") return <Navigate to="/radio" replace />;

  return <Navigate to="/login" replace />;
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <RoleRouter />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/hr"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <HrOnboardingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/time-overview"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <AdminTimeOverviewPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/barber"
          element={
            <ProtectedRoute allowedRoles={["barber", "admin"]}>
              <BarberDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/radio"
          element={
            <ProtectedRoute allowedRoles={["radio_host", "admin"]}>
              <RadioDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/programs"
          element={
            <ProtectedRoute allowedRoles={["admin", "program_staff"]}>
              <ProgramsDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/programs/:programId"
          element={
            <ProtectedRoute allowedRoles={["admin", "program_staff"]}>
              <ProgramDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-time"
          element={
            <ProtectedRoute allowedRoles={["admin", "barber", "radio_host", "program_staff"]}>
              <MyTimeEntriesPage />
            </ProtectedRoute>
          }
        />

        <Route path="/unauthorized" element={<div>Unauthorized</div>} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
