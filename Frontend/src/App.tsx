import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AdminLayout } from "./components/AdminLayout";
import { ChannelLayout, RequireCaseRole, RequireChannelAdmin } from "./components/ChannelLayout";
import { AccountPage } from "./pages/AccountPage";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { AuditPage } from "./pages/AuditPage";
import { OverviewPage } from "./pages/OverviewPage";
import { SystemPage } from "./pages/SystemPage";
import { TeamPage } from "./pages/TeamPage";
import { TenantCreatePage } from "./pages/TenantCreatePage";
import { TenantDetailPage } from "./pages/TenantDetailPage";
import { TenantLoginPage } from "./pages/TenantLoginPage";
import { TenantsListPage } from "./pages/TenantsListPage";
import { AccessLogPage } from "./pages/channel/AccessLogPage";
import { ChannelAccountPage } from "./pages/channel/ChannelAccountPage";
import { CaseDetailPage } from "./pages/channel/CaseDetailPage";
import { CasesPage } from "./pages/channel/CasesPage";
import { ChannelAreasPage } from "./pages/channel/ChannelAreasPage";
import { ChannelAuditPage } from "./pages/channel/ChannelAuditPage";
import { ChannelBrandingPage } from "./pages/channel/ChannelBrandingPage";
import { ChannelCategoriesPage } from "./pages/channel/ChannelCategoriesPage";
import { ChannelHomePage } from "./pages/channel/ChannelHomePage";
import { ChannelPortalPage } from "./pages/channel/ChannelPortalPage";
import { ChannelSettingsPage } from "./pages/channel/ChannelSettingsPage";
import { ChannelUsersPage } from "./pages/channel/ChannelUsersPage";
import { DeadlinesPage } from "./pages/channel/DeadlinesPage";
import { FlowGuidePage } from "./pages/channel/FlowGuidePage";
import { MessagesPage } from "./pages/channel/MessagesPage";
import { ReportsPage } from "./pages/channel/ReportsPage";
import { RegisterCasePage } from "./pages/channel/RegisterCasePage";
import { ResourcesPage } from "./pages/channel/ResourcesPage";
import { PortalHomePage } from "./pages/portal/PortalHomePage";
import { PortalLayout } from "./pages/portal/PortalLayout";
import { PortalReportPage } from "./pages/portal/PortalReportPage";
import { PortalTrackPage } from "./pages/portal/PortalTrackPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/admin/login" replace />} />

        {/* global_admin (equipo BeeHives) */}
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="tenants" element={<TenantsListPage />} />
          <Route path="tenants/new" element={<TenantCreatePage />} />
          <Route path="tenants/:slug" element={<TenantDetailPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="system" element={<SystemPage />} />
          <Route path="account" element={<AccountPage />} />
        </Route>

        {/* Panel de cada empresa, identificada por su slug. El menú depende del rol. */}
        <Route path="/:slug/login" element={<TenantLoginPage />} />
        {/* Portal público del denunciante: sin sesión, cada empresa en su propia base */}
        <Route path="/:slug/denuncias" element={<PortalLayout />}>
          <Route index element={<PortalHomePage />} />
          <Route path="nueva" element={<PortalReportPage />} />
          <Route path="seguimiento" element={<PortalTrackPage />} />
        </Route>
        <Route path="/:slug" element={<ChannelLayout />}>
          <Route index element={<ChannelHomePage />} />
          <Route path="account" element={<ChannelAccountPage />} />
          {/* Guía del flujo de denuncias: para todos los roles de la empresa */}
          <Route path="flows" element={<FlowGuidePage />} />
          {/* Denuncias: gestor, investigador, resolutor y auditor */}
          <Route element={<RequireCaseRole />}>
            <Route path="cases" element={<CasesPage />} />
            <Route path="cases/:id" element={<CaseDetailPage />} />
            <Route path="resources" element={<ResourcesPage />} />
          </Route>
          <Route element={<RequireCaseRole only={["case_manager"]} />}>
            <Route path="unassigned" element={<CasesPage scope="unassigned" />} />
            <Route path="cases/new" element={<RegisterCasePage />} />
          </Route>
          <Route element={<RequireCaseRole only={["resolver"]} />}>
            <Route path="resolved" element={<CasesPage scope="resolved" />} />
          </Route>
          <Route element={<RequireCaseRole only={["case_manager", "investigator", "auditor"]} />}>
            <Route path="deadlines" element={<DeadlinesPage />} />
          </Route>
          <Route element={<RequireCaseRole only={["case_manager", "investigator"]} />}>
            <Route path="messages" element={<MessagesPage />} />
          </Route>
          <Route element={<RequireCaseRole only={["case_manager", "resolver", "auditor"]} />}>
            <Route path="reports" element={<ReportsPage />} />
          </Route>
          <Route element={<RequireCaseRole only={["auditor"]} />}>
            <Route path="access-log" element={<AccessLogPage />} />
          </Route>
          {/* Configuración del canal: solo client_admin */}
          <Route element={<RequireChannelAdmin />}>
            <Route path="users" element={<ChannelUsersPage />} />
            <Route path="areas" element={<ChannelAreasPage />} />
            <Route path="categories" element={<ChannelCategoriesPage />} />
            <Route path="portal" element={<ChannelPortalPage />} />
            <Route path="branding" element={<ChannelBrandingPage />} />
            <Route path="settings" element={<ChannelSettingsPage />} />
            <Route path="audit" element={<ChannelAuditPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
