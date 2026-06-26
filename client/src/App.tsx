import React, { Suspense, lazy } from "react";
import { lazyWithRetry } from "./utils/lazyWithRetry";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProtectedRoute from "./auth/ProtectedRoute";
import { HqErrorBoundary } from "./components/hq/HqErrorBoundary";
import { HqLoading } from "./components/hq/HqLoading";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";

const AdminLayout = lazy(() => import("./layouts/AdminLayout"));
const AdminDashboard = lazy(() => import("./dashboards/AdminDashboard"));
const ProgramsDashboard = lazy(() => import("./pages/ProgramsDashboard"));
const ProgramDetailPage = lazy(() => import("./pages/ProgramDetailPage"));
const FundingSourcesAdminPage = lazy(() => import("./pages/FundingSourcesAdminPage"));
const AdminFundingPage = lazy(() => import("./pages/AdminFundingPage"));
const AdminTimeOverviewPage = lazy(() => import("./pages/AdminTimeOverviewPage"));
const GrantReportPage = lazy(() => import("./pages/GrantReportPage"));
const LogicModelPage = lazy(() => import("./pages/LogicModelPage"));
const AIAssistantPage = lazy(() => import("./pages/AIAssistantPage"));
const SoftwareDivisionPage = lazy(() => import("./pages/hq/SoftwareDivisionPage"));
const HqShellRoute = lazyWithRetry(
  () => import("./components/hq/HqShellRoute").then((m) => ({ default: m.HqShellRoute })),
  "HqShellRoute"
);
const ExecutiveDashboard = lazyWithRetry(
  () => import("./pages/hq/ExecutiveDashboard"),
  "ExecutiveDashboard"
);
const AuraCommandCenterPage = lazy(() => import("./pages/hq/AuraCommandCenterPage"));
const PeopleManagementCenter = lazy(() => import("./pages/hq/PeopleManagementCenter"));
const StaffSelfServicePage = lazy(() => import("./pages/hq/StaffSelfServicePage"));
const ManagerPortalPage = lazy(() => import("./pages/hq/ManagerPortalPage"));
const HqPayrollPage = lazy(() => import("./pages/hq/HqPayrollPage"));
const HqProgramsPage = lazy(() => import("./pages/hq/HqProgramsPage"));
const ProgramModulePage = lazy(() => import("./pages/hq/ProgramModulePage"));
const GrantCenterPage = lazy(() => import("./pages/hq/GrantCenterPage"));
const FinancialCenterPage = lazy(() => import("./pages/hq/FinancialCenterPage"));
const OrganizationAnalyticsPage = lazy(() => import("./pages/hq/OrganizationAnalyticsPage"));
const EnterpriseOperationsPage = lazy(() => import("./pages/hq/EnterpriseOperationsPage"));
const OperationsCenterPage = lazy(() => import("./pages/hq/OperationsCenterPage"));
const OrganizationSettingsPage = lazy(() => import("./pages/hq/OrganizationSettingsPage"));
const NotificationsCenterPage = lazy(() => import("./pages/hq/NotificationsCenterPage"));
const DeveloperPortalPage = lazy(() => import("./pages/hq/DeveloperPortalPage"));
const CommunicationsCenterPage = lazy(() => import("./pages/hq/CommunicationsCenterPage"));
const DocumentCenterPage = lazy(() => import("./pages/hq/DocumentCenterPage"));
const EnterpriseIntelligencePage = lazy(() => import("./pages/hq/EnterpriseIntelligencePage"));
const Phase10ExecutivePlatformPage = lazy(() => import("./pages/hq/Phase10ExecutivePlatformPage"));
const Phase9OperatingSystemPage = lazy(() => import("./pages/hq/Phase9OperatingSystemPage"));
const WorkflowAutomationPage = lazy(() => import("./pages/hq/WorkflowAutomationPage"));
const SecurityCenterPage = lazy(() => import("./pages/hq/SecurityCenterPage"));
const IntegrationsHubPage = lazy(() => import("./pages/hq/IntegrationsHubPage"));
const SsoGatewayPage = lazy(() => import("./pages/hq/SsoGatewayPage"));
const FounderCommandCenterPage = lazy(() => import("./pages/hq/FounderCommandCenterPage"));
const BoardPortalPage = lazy(() => import("./pages/hq/BoardPortalPage"));
const EnterpriseReportingPage = lazy(() => import("./pages/hq/EnterpriseReportingPage"));
const BarberDashboard = lazy(() => import("./dashboards/BarberDashboard"));
const RadioDashboard = lazy(() => import("./dashboards/RadioDashboard"));
const MyTimeEntriesPage = lazy(() => import("./pages/MyTimeEntriesPage"));
const BarbershopApp = lazy(() => import("./apps/BarbershopApp"));
const RadioApp = lazy(() => import("./apps/RadioApp"));
const ProgramsApp = lazy(() => import("./apps/ProgramsApp"));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

const RouteFallback: React.FC = () => (
  <div className="hq-shell" style={{ alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
    <HqLoading message="Loading module…" />
  </div>
);

/** Permission-gated HQ route */
const HqRoute: React.FC<{ path: string; children: React.ReactNode }> = ({ path, children }) => (
  <ProtectedRoute requiredRoute={path}>
    <HqErrorBoundary>{children}</HqErrorBoundary>
  </ProtectedRoute>
);

const UnauthorizedPage: React.FC = () => (
  <div className="hq-shell" style={{ alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
    <div className="hq-panel" style={{ maxWidth: 420, textAlign: "center", padding: "2rem" }}>
      <h2 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Access Denied</h2>
      <p style={{ color: "var(--hq-text-muted)", fontSize: "0.9rem" }}>
        Your role does not have permission to access this module. Contact an administrator if you believe this is an error.
      </p>
      <a href="/hq" className="hq-btn hq-btn-primary" style={{ marginTop: "1.25rem" }}>Return to Headquarters</a>
    </div>
  </div>
);

const HqNotFoundPage: React.FC = () => (
  <HqRoute path="/hq">
    <div className="hq-shell" style={{ alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div className="hq-panel" style={{ maxWidth: 420, textAlign: "center", padding: "2rem" }}>
        <h2 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Module Not Found</h2>
        <p style={{ color: "var(--hq-text-muted)", fontSize: "0.9rem" }}>
          This headquarters route is not registered. Use the sidebar navigation or return to the executive dashboard.
        </p>
        <a href="/hq" className="hq-btn hq-btn-primary" style={{ marginTop: "1.25rem" }}>Return to Headquarters</a>
      </div>
    </div>
  </HqRoute>
);

const App: React.FC = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<Navigate to="/login" replace />} />

          <Route
            path="/hq"
            element={
              <HqShellRoute
                path="/hq"
                title="Founder Dashboard"
                subtitle="IFCDC Enterprise Operating System — command center for the entire organization"
              >
                <ExecutiveDashboard />
              </HqShellRoute>
            }
          />
          <Route path="/hq/founder" element={<HqRoute path="/hq/founder"><FounderCommandCenterPage /></HqRoute>} />
          <Route path="/hq/reports" element={<HqRoute path="/hq/reports"><EnterpriseReportingPage /></HqRoute>} />
          <Route path="/hq/operations" element={<HqRoute path="/hq/operations"><OperationsCenterPage /></HqRoute>} />
          <Route path="/hq/software" element={<HqRoute path="/hq/software"><SoftwareDivisionPage /></HqRoute>} />
          <Route path="/hq/sso" element={<HqRoute path="/hq/sso"><SsoGatewayPage /></HqRoute>} />
          <Route path="/hq/developer" element={<HqRoute path="/hq/developer"><DeveloperPortalPage /></HqRoute>} />
          <Route path="/hq/aura" element={<HqRoute path="/hq/aura"><AuraCommandCenterPage /></HqRoute>} />
          <Route path="/hq/people" element={<HqRoute path="/hq/people"><PeopleManagementCenter /></HqRoute>} />
          <Route path="/hq/my-workspace" element={<HqRoute path="/hq/my-workspace"><StaffSelfServicePage /></HqRoute>} />
          <Route path="/hq/manager" element={<HqRoute path="/hq/manager"><ManagerPortalPage /></HqRoute>} />
          <Route path="/hq/hr" element={<Navigate to="/hq/people" replace />} />
          <Route path="/admin/hr" element={<Navigate to="/hq/people" replace />} />
          <Route path="/hq/payroll" element={<HqRoute path="/hq/payroll"><HqPayrollPage /></HqRoute>} />
          <Route path="/hq/programs" element={<HqRoute path="/hq/programs"><HqProgramsPage /></HqRoute>} />
          <Route path="/hq/programs/:slug" element={<HqRoute path="/hq/programs"><ProgramModulePage /></HqRoute>} />
          <Route path="/hq/finance" element={<HqRoute path="/hq/finance"><FinancialCenterPage /></HqRoute>} />
          <Route path="/hq/grants" element={<HqRoute path="/hq/grants"><GrantCenterPage /></HqRoute>} />
          <Route path="/hq/analytics" element={<HqRoute path="/hq/analytics"><OrganizationAnalyticsPage /></HqRoute>} />
          <Route path="/hq/notifications" element={<HqRoute path="/hq/notifications"><NotificationsCenterPage /></HqRoute>} />
          <Route path="/hq/volunteers" element={<Navigate to="/hq/people?type=volunteer" replace />} />
          <Route path="/hq/donations" element={<HqRoute path="/hq/donations"><FinancialCenterPage /></HqRoute>} />
          <Route path="/hq/housing" element={<HqRoute path="/hq/housing"><EnterpriseOperationsPage moduleKey="housing" /></HqRoute>} />
          <Route path="/hq/scholarships" element={<HqRoute path="/hq/scholarships"><EnterpriseOperationsPage moduleKey="scholarships" /></HqRoute>} />
          <Route path="/hq/media" element={<HqRoute path="/hq/media"><EnterpriseOperationsPage moduleKey="media" /></HqRoute>} />
          <Route path="/hq/communications" element={<HqRoute path="/hq/communications"><CommunicationsCenterPage /></HqRoute>} />
          <Route path="/hq/intelligence" element={<HqRoute path="/hq/intelligence"><EnterpriseIntelligencePage /></HqRoute>} />
          <Route path="/hq/phase10" element={<HqRoute path="/hq/phase10"><Phase10ExecutivePlatformPage /></HqRoute>} />
          <Route path="/hq/phase9" element={<HqRoute path="/hq/phase9"><Phase9OperatingSystemPage /></HqRoute>} />
          <Route path="/hq/workflows" element={<HqRoute path="/hq/workflows"><WorkflowAutomationPage /></HqRoute>} />
          <Route path="/hq/integrations" element={<HqRoute path="/hq/integrations"><IntegrationsHubPage /></HqRoute>} />
          <Route path="/hq/security" element={<HqRoute path="/hq/security"><SecurityCenterPage /></HqRoute>} />
          <Route path="/hq/documents" element={<HqRoute path="/hq/documents"><DocumentCenterPage /></HqRoute>} />
          <Route path="/hq/assets" element={<HqRoute path="/hq/assets"><EnterpriseOperationsPage moduleKey="assets" /></HqRoute>} />
          <Route path="/hq/fleet" element={<HqRoute path="/hq/fleet"><EnterpriseOperationsPage moduleKey="fleet" /></HqRoute>} />
          <Route path="/hq/facilities" element={<HqRoute path="/hq/facilities"><EnterpriseOperationsPage moduleKey="facilities" /></HqRoute>} />
          <Route path="/hq/board" element={<HqRoute path="/hq/board"><BoardPortalPage /></HqRoute>} />
          <Route path="/hq/compliance" element={<HqRoute path="/hq/compliance"><EnterpriseOperationsPage moduleKey="compliance" /></HqRoute>} />
          <Route path="/hq/calendar" element={<HqRoute path="/hq/calendar"><EnterpriseOperationsPage moduleKey="calendar" /></HqRoute>} />
          <Route path="/hq/settings" element={<HqRoute path="/hq/settings"><OrganizationSettingsPage /></HqRoute>} />

          <Route path="/admin" element={<HqRoute path="/hq"><AdminDashboard /></HqRoute>} />
          <Route path="/admin/funding" element={<HqRoute path="/hq/finance"><AdminFundingPage /></HqRoute>} />
          <Route path="/programs" element={<HqRoute path="/hq/programs"><AdminLayout><ProgramsDashboard /></AdminLayout></HqRoute>} />
          <Route path="/programs/:programId" element={<HqRoute path="/hq/programs"><AdminLayout><ProgramDetailPage /></AdminLayout></HqRoute>} />
          <Route path="/admin/funding-sources" element={<HqRoute path="/hq/finance"><AdminLayout><FundingSourcesAdminPage /></AdminLayout></HqRoute>} />
          <Route path="/admin/time" element={<HqRoute path="/hq/payroll"><AdminLayout><AdminTimeOverviewPage /></AdminLayout></HqRoute>} />
          <Route path="/admin/grant-report" element={<HqRoute path="/hq/grants"><AdminLayout><GrantReportPage /></AdminLayout></HqRoute>} />

          <Route path="/barber" element={<ProtectedRoute requiredRoute="/barber"><BarberDashboard /></ProtectedRoute>} />
          <Route path="/radio" element={<ProtectedRoute allowedRoles={["radio_host", "radio", "admin", "owner", "EXEC"]}><RadioDashboard /></ProtectedRoute>} />
          <Route path="/my-time" element={<ProtectedRoute allowedRoles={["admin", "owner", "barber", "radio_host", "program_staff", "EXEC"]}><MyTimeEntriesPage /></ProtectedRoute>} />
          <Route path="/logic-model" element={<ProtectedRoute allowedRoles={["admin", "program_staff", "owner"]}><AdminLayout><LogicModelPage /></AdminLayout></ProtectedRoute>} />
          <Route path="/ai-assistant" element={<ProtectedRoute requiredPermission="hq.aura"><AIAssistantPage /></ProtectedRoute>} />
          <Route path="/unauthorized" element={<UnauthorizedPage />} />

          <Route path="/app/barbershop" element={<ProtectedRoute requiredRoute="/app/barbershop"><BarbershopApp /></ProtectedRoute>} />
          <Route path="/app/radio" element={<ProtectedRoute allowedRoles={["radio_host", "radio", "admin", "owner"]}><RadioApp /></ProtectedRoute>} />
          <Route path="/app/programs" element={<ProtectedRoute requiredRoute="/hq/programs"><ProgramsApp /></ProtectedRoute>} />

          <Route path="/hq/*" element={<HqNotFoundPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
