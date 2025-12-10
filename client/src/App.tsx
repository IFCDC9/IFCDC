import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./auth/ProtectedRoute";
import { useAuth } from "./auth/AuthContext";

import AdminLayout from "./layouts/AdminLayout";
import AdminDashboard from "./dashboards/AdminDashboard";
import HrOnboardingPage from "./pages/HrOnboardingPage";
import ProgramsDashboard from "./pages/ProgramsDashboard";
import ProgramDetailPage from "./pages/ProgramDetailPage";
import FundingSourcesAdminPage from "./pages/FundingSourcesAdminPage";
import AdminTimeOverviewPage from "./pages/AdminTimeOverviewPage";
import GrantReportPage from "./pages/GrantReportPage";
import LogicModelPage from "./pages/LogicModelPage";
import AIAssistantPage from "./pages/AIAssistantPage";

import BarberDashboard from "./dashboards/BarberDashboard";
import RadioDashboard from "./dashboards/RadioDashboard";
import MyTimeEntriesPage from "./pages/MyTimeEntriesPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";

const RoleRouter: React.FC = () => {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;

  if (user.role === "admin") return <Navigate to="/admin" replace />;
  if (user.role === "barber") return <Navigate to="/barber" replace />;
  if (user.role === "radio_host") return <Navigate to="/radio" replace />;
  if (user.role === "program_staff") return <Navigate to="/programs" replace />;

  return <Navigate to="/login" replace />;
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

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
              <AdminLayout>
                <HrOnboardingPage />
              </AdminLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/programs"
          element={
            <ProtectedRoute allowedRoles={["admin", "program_staff"]}>
              <AdminLayout>
                <ProgramsDashboard />
              </AdminLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/programs/:programId"
          element={
            <ProtectedRoute allowedRoles={["admin", "program_staff"]}>
              <AdminLayout>
                <ProgramDetailPage />
              </AdminLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/funding-sources"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <AdminLayout>
                <FundingSourcesAdminPage />
              </AdminLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/time"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <AdminLayout>
                <AdminTimeOverviewPage />
              </AdminLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/grant-report"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <AdminLayout>
                <GrantReportPage />
              </AdminLayout>
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
          path="/my-time"
          element={
            <ProtectedRoute allowedRoles={["admin", "barber", "radio_host", "program_staff"]}>
              <MyTimeEntriesPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/logic-model"
          element={
            <ProtectedRoute allowedRoles={["admin", "program_staff", "owner"]}>
              <AdminLayout>
                <LogicModelPage />
              </AdminLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/ai-assistant"
          element={
            <ProtectedRoute allowedRoles={["admin", "barber", "radio_host", "program_staff", "owner"]}>
              <AIAssistantPage />
            </ProtectedRoute>
          }
        />

        <Route path="/unauthorized" element={<div>Unauthorized</div>} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
