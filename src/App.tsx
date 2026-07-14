import { Suspense, lazy } from "react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { OrganizationProvider, useOrganization } from "@/context/OrganizationContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ClientProvider } from "@/context/ClientContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { AppErrorBoundary } from "@/components/errors/AppErrorBoundary";


import Landing from "./pages/Landing";
import AuthPage from "./pages/Auth";
import AgencyHome from "./pages/AgencyHome";
import PostLoginRedirect from "./pages/PostLoginRedirect";
// PlanipretLogin removed — auth handled via avastatistic.ca SSO
import PlanipretMobile from "./pages/planipret/PlanipretMobile";
import StorePreflightPreview from "./pages/planipret/StorePreflightPreview";
import { AppSeparationGuard } from "./components/auth/AppSeparationGuard";
import { MplanipretGuard } from "./components/auth/MplanipretGuard";
import RouteDebugOverlay from "./components/debug/RouteDebugOverlay";
import { ROUTES, loginWithRedirect } from "./lib/routes";
// Mobile screens — lazy-loaded so the initial /mplanipret shell paints fast.
// Each screen becomes its own chunk; Suspense fallback renders a mobile skeleton.
const MHome = lazyWithRetry(() => import("./pages/planipret/mobile/MHome"));
const MCalls = lazyWithRetry(() => import("./pages/planipret/mobile/MCalls"));
const MMessages = lazyWithRetry(() => import("./pages/planipret/mobile/MMessages"));
const MVoicemail = lazyWithRetry(() => import("./pages/planipret/mobile/MVoicemail"));
const MMore = lazyWithRetry(() => import("./pages/planipret/mobile/MMore"));
const MContacts = lazyWithRetry(() => import("./pages/planipret/mobile/MContacts"));
const MPipeline = lazyWithRetry(() => import("./pages/planipret/mobile/MPipeline"));
const MSearch = lazyWithRetry(() => import("./pages/planipret/mobile/MSearch"));
const MStats = lazyWithRetry(() => import("./pages/planipret/mobile/MStats"));
const MAvaChat = lazyWithRetry(() => import("./pages/planipret/mobile/MAvaChat"));
const MAvaNotifications = lazyWithRetry(() => import("./pages/planipret/mobile/MAvaNotifications"));
const MExtensionSync = lazyWithRetry(() => import("./pages/planipret/mobile/MExtensionSync"));
import PlanipretAudit from "./pages/planipret/PlanipretAudit";
import Ms365Callback from "./pages/planipret/Ms365Callback";
import Ms365Diagnostics from "./pages/planipret/Ms365Diagnostics";
import MStyleDiagnosticsWeb from "./pages/MStyleDiagnosticsWeb";
import SoftphoneSetup from "./pages/lemtel/SoftphoneSetup";
// Lazy-load admin pages (each is its own chunk)
const PlanipretAdminLayout = lazyWithRetry(() => import("./pages/planipret/admin/PlanipretAdminLayout"));
const PAOverview = lazyWithRetry(() => import("./pages/planipret/admin/PAOverview"));
const PAUsers = lazyWithRetry(() => import("./pages/planipret/admin/PAUsers"));
const PACalls = lazyWithRetry(() => import("./pages/planipret/admin/PACalls"));
const PAMessages = lazyWithRetry(() => import("./pages/planipret/admin/PAMessages"));
const PAVoicemails = lazyWithRetry(() => import("./pages/planipret/admin/PAVoicemails"));
const PARecordings = lazyWithRetry(() => import("./pages/planipret/admin/PARecordings"));
const PAReports = lazyWithRetry(() => import("./pages/planipret/admin/PAReports"));
const PAAuditLog = lazyWithRetry(() => import("./pages/planipret/admin/PAAuditLog"));
const PAAuditChecklist = lazyWithRetry(() => import("./pages/planipret/admin/PAAuditChecklist"));
const PACompliance = lazyWithRetry(() => import("./pages/planipret/admin/PACompliance"));
const PALeads = lazyWithRetry(() => import("./pages/planipret/admin/PALeads"));
const PATemplates = lazyWithRetry(() => import("./pages/planipret/admin/PATemplates"));
const PADebug = lazyWithRetry(() => import("./pages/planipret/admin/PADebug"));
const PAAva = lazyWithRetry(() => import("./pages/planipret/admin/PAAva"));
const PAAvaAgent = lazyWithRetry(() => import("./pages/planipret/admin/PAAvaAgent"));
const PAAvaLogs = lazyWithRetry(() => import("./pages/planipret/admin/PAAvaLogs"));
const PAMobileDevices = lazyWithRetry(() => import("./pages/planipret/admin/PAMobileDevices"));
const PASipDiagnostic = lazyWithRetry(() => import("./pages/planipret/admin/PASipDiagnostic"));
const PADiagnostics = lazyWithRetry(() => import("./pages/planipret/admin/PADiagnostics"));
const PlanipretPrivacy = lazyWithRetry(() => import("./pages/planipret/PlanipretPrivacy"));
const PlanipretIntegrationsLazy = lazyWithRetry(() => import("./pages/planipret/PlanipretIntegrations"));
import { AdminPageSkeleton } from "./components/planipret/Skeletons";

import Dashboard from "./pages/Dashboard";
import VoiceAnalytics from "./pages/VoiceAnalytics";
import Conversations from "./pages/Conversations";
import ConversationDetail from "./pages/ConversationDetail";
import KnowledgeBase from "./pages/KnowledgeBase";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";
import Clients from "./pages/Clients";
import ClientCreateWizard from "./pages/admin/ClientCreateWizard";
import Integrations from "./pages/Integrations";
import WebhookLogs from "./pages/WebhookLogs";
import StripeBilling from "./pages/StripeBilling";
import SaaSConfigurator from "./pages/SaaSConfigurator";
import EmailTemplates from "./pages/EmailTemplates";
import Agents from "./pages/Agents";
import AgentSettings from "./pages/AgentSettings";
import Workflows from "./pages/Workflows";
import WorkflowBuilder from "./pages/WorkflowBuilder";
import Team from "./pages/Team";
import ApiKeys from "./pages/ApiKeys";
import ClientDetail from "./pages/ClientDetail";
import ClientLogin from "./pages/ClientLogin";
import ClientForgotPassword from "./pages/ClientForgotPassword";
import ClientResetPassword from "./pages/ClientResetPassword";
import ResetPassword from "./pages/ResetPassword";
import ClientPortal from "./pages/ClientPortal";
import ClientAgentPortal from "./pages/ClientAgentPortal";
import ClientConversations from "./pages/ClientConversations";
import ClientAnalytics from "./pages/ClientAnalytics";
import ClientAgentDashboard from "./pages/ClientAgentDashboard";
import ClientAgentConversations from "./pages/ClientAgentConversations";
import ClientAgentAnalytics from "./pages/ClientAgentAnalytics";
import ClientAgentKnowledge from "./pages/ClientAgentKnowledge";
import ClientAgentSettings from "./pages/ClientAgentSettings";
import ClientAgentEndpoints from "./pages/ClientAgentEndpoints";
import ClientAgentMCP from "./pages/ClientAgentMCP";
import ClientAgentWebhooks from "./pages/ClientAgentWebhooks";
import ClientAgentWidget from "./pages/ClientAgentWidget";
import WidgetPrototype from "./pages/WidgetPrototype";
import WidgetIframe from "./pages/WidgetIframe";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import Terms from "./pages/Terms";
import BAAgreement from "./pages/BAAgreement";
import Legal from "./pages/Legal";
import Support from "./pages/Support";
import Docs from "./pages/Docs";
import Topics from "./pages/Topics";
import Campaigns from "./pages/Campaigns";
import Appointments from "./pages/Appointments";
import AgentReports from "./pages/AgentReports";
import AgentBuilder from "./pages/AgentBuilder";
import AgentComparison from "./pages/AgentComparison";
import Leads from "./pages/Leads";
import PhoneNumbers from "./pages/PhoneNumbers";
import Handoffs from "./pages/Handoffs";
import SmsTemplates from "./pages/SmsTemplates";
import NotFound from "./pages/NotFound";
import DemoCenter from "./pages/DemoCenter";
import RealtimeMonitor from "./pages/RealtimeMonitor";
import ApiExplorer from "./pages/ApiExplorer";
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import TwilioManagement from "./pages/TwilioManagement";
import FeaturesPage from "./pages/Features";
import DemoRequestPage from "./pages/DemoRequest";
import ContactUs from "./pages/ContactUs";
import AuditLogs from "./pages/AuditLogs";
import Download from "./pages/Download";
import MobilePreview from "./pages/MobilePreview";
import MobileEmbed from "./pages/MobileEmbed";

// Lemtel module
import { LemtelGuard } from "./pages/lemtel/LemtelGuard";
import LemtelDashboard from "./pages/lemtel/LemtelDashboard";
import PortalDiagnostic from "./pages/lemtel/PortalDiagnostic";
import LemtelPortalDashboard from "./pages/lemtel/PortalDashboard";
import LemtelSettings from "./pages/lemtel/LemtelSettings";
import ProviderCredentials from "./pages/lemtel/ProviderCredentials";
import LemtelMessages from "./pages/lemtel/LemtelMessages";
import LemtelPortalCalls from "./pages/lemtel/LemtelPortalCalls";
import LemtelStub from "./pages/lemtel/LemtelStub";
import LemtelCustomers from "./pages/lemtel/LemtelCustomers";
import PortingQueue from "./pages/lemtel/admin/PortingQueue";
import CustomerDetail from "./pages/lemtel/CustomerDetail";
import CustomerPortalGate from "./pages/CustomerPortalGate";
import LemtelGateways from "./pages/lemtel/LemtelGateways";
import LemtelVoiceGateways from "./pages/lemtel/LemtelVoiceGateways";
import LemtelExtensions from "./pages/lemtel/LemtelExtensions";
import LemtelPbxUsers from "./pages/lemtel/LemtelPbxUsers";
import LemtelDIDs from "./pages/lemtel/LemtelDIDs";
import LemtelQueues from "./pages/lemtel/LemtelQueues";
import LemtelIVR from "./pages/lemtel/LemtelIVR";
import BusinessHours from "./pages/lemtel/BusinessHours";
import CustomerSettings from "./pages/lemtel/CustomerSettings";
import LemtelVoiceAgents from "./pages/lemtel/LemtelVoiceAgents";
import LemtelSoftphoneUsers from "./pages/lemtel/LemtelSoftphoneUsers";
import LemtelDevices from "./pages/lemtel/LemtelDevices";
import TelephonyDashboard from "./pages/telephony/TelephonyDashboard";
import TelephonySettings from "./pages/telephony/TelephonySettings";
import TelephonyRecordings from "./pages/telephony/TelephonyRecordings";
import CallIntelligenceDashboard from "./pages/admin/CallIntelligenceDashboard";
import TelephonyMediaCenter from "./pages/telephony/TelephonyMediaCenter";
import TelephonyRingGroups from "./pages/telephony/TelephonyRingGroups";
import TelephonyAI from "./pages/telephony/TelephonyAI";
import TelephonyWebphone from "./pages/telephony/TelephonyWebphone";
import TelephonyVoicemail from "./pages/telephony/TelephonyVoicemail";
import TelephonyTeam from "./pages/telephony/TelephonyTeam";
import TelephonyUserPreferences from "./pages/telephony/TelephonyUserPreferences";
import CallCenterAgent from "./pages/callcenter/CallCenterAgent";
import CallCenterWallboard from "./pages/callcenter/CallCenterWallboard";
import CallCenterAdmin from "./pages/callcenter/CallCenterAdmin";
import TelephonyDiagnostics from "./pages/telephony/TelephonyDiagnostics";
import TelephonySourceAudit from "./pages/telephony/TelephonySourceAudit";
import PhoneNumbersUnified from "./pages/telephony/PhoneNumbersUnified";
import PbxAdminUsers from "./pages/telephony/PbxAdminUsers";
import LiveRegistrations from "./pages/telephony/LiveRegistrations";
import VoiceAgentsLive from "./pages/telephony/VoiceAgentsLive";
import TelephonyAdvanced from "./pages/telephony/TelephonyAdvanced";
import TelephonySyncHealth from "./pages/telephony/TelephonySyncHealth";
import TelephonyChecklist from "./pages/telephony/TelephonyChecklist";
import TelephonyPortalMappings from "./pages/telephony/TelephonyPortalMappings";
import TelephonyUsers from "./pages/telephony/TelephonyUsers";
import { TelephonyLayout } from "./components/telephony/TelephonyLayout";
import { PortalGuard } from "./components/telephony/PortalGuard";
import LemtelAnalytics from "./pages/lemtel/LemtelAnalytics";
import { AdminPortalLayout, UserPortalLayout } from "./components/portal/LemtelPortalShells";
import AdminDashboard from "./pages/lemtel/admin/AdminDashboard";
import MyDashboard from "./pages/lemtel/my/MyDashboard";
import AdminRecordings from "./pages/lemtel/admin/AdminRecordings";
import AdminVoicemail from "./pages/lemtel/admin/AdminVoicemail";
import { ConsoleShell } from "./components/console/ConsoleShell";
import ConsoleDashboard from "./pages/console/ConsoleDashboard";
import ConsoleExtensions from "./pages/console/ConsoleExtensions";
import {
  ConsoleDevices, ConsoleIVRs, ConsoleQueues, ConsoleRingGroups, ConsoleDIDs,
  ConsoleInboundRoutes, ConsoleVoicemail, ConsoleRegistrations, ConsoleActiveCalls, ConsoleCdr,
} from "./pages/console/ConsoleWrappers";
import ConsoleInsights from "./pages/console/ConsoleInsights";
import ConsoleChatbot from "./pages/console/ConsoleChatbot";
import ConsoleAudit from "./pages/console/ConsoleAudit";
import ConsolePresence from "./pages/console/ConsolePresence";
import ConsoleChat from "./pages/console/ConsoleChat";
import AdminReports from "./pages/lemtel/admin/AdminReports";
import AdminDestinations from "./pages/lemtel/admin/AdminDestinations";
import AdminTimeConditions from "./pages/lemtel/admin/AdminTimeConditions";
import AdminConferences from "./pages/lemtel/admin/AdminConferences";
import AdminHoldMusic from "./pages/lemtel/admin/AdminHoldMusic";
import AdminSyncHealth from "./pages/lemtel/admin/AdminSyncHealth";
import AdminSipProfiles from "./pages/lemtel/admin/AdminSipProfiles";
import AdminDialplans from "./pages/lemtel/admin/AdminDialplans";
import AdminFeatureCodes from "./pages/lemtel/admin/AdminFeatureCodes";
import AdminCallForwarding from "./pages/lemtel/admin/AdminCallForwarding";
import AdminRecordingRules from "./pages/lemtel/admin/AdminRecordingRules";
import AdminVoicemailSettings from "./pages/lemtel/admin/AdminVoicemailSettings";
import AdminActiveCalls from "./pages/lemtel/admin/AdminActiveCalls";
import AdminRegistrations from "./pages/lemtel/admin/AdminRegistrations";
import AdminSystemStatus from "./pages/lemtel/admin/AdminSystemStatus";
import AdminAIActions from "./pages/lemtel/admin/AdminAIActions";
import MySettings from "./pages/lemtel/my/MySettings";
import MyForwarding from "./pages/lemtel/my/MyForwarding";
import MyDevices from "./pages/lemtel/my/MyDevices";
import MyGreetings from "./pages/lemtel/my/MyGreetings";
import { DownloadCenter } from "./components/portal/DownloadCenter";
import { AppLayout } from "./components/layout/AppLayout";
import CustomerDomainGate from "./components/portal/CustomerDomainGate";
import DomainDashboard from "./pages/lemtel/admin/DomainDashboard";

// v4.0.0 — Multi-tenant reseller architecture
import { WhitelabelProvider } from "./contexts/WhitelabelContext";
import { ImpersonationProvider } from "./contexts/ImpersonationContext";
import { MasterShell, ResellerShell } from "./components/portal/MasterShells";
import MasterDashboard from "./pages/lemtel/master/MasterDashboard";
import MasterOrganizations from "./pages/lemtel/master/MasterOrganizations";
import MasterAllUsers from "./pages/lemtel/master/MasterAllUsers";
import MasterAllCalls from "./pages/lemtel/master/MasterAllCalls";
import MasterBilling from "./pages/lemtel/master/MasterBilling";
import MasterSystem from "./pages/lemtel/master/MasterSystem";
import MasterAuditLogs from "./pages/lemtel/master/MasterAuditLogs";
import ResellerDashboard from "./pages/lemtel/reseller/ResellerDashboard";
import ResellerSettings from "./pages/lemtel/reseller/ResellerSettings";

// Portal pages
import PortalLogin from "./pages/PortalLogin";
import PortalLayout from "./components/portal/PortalLayout";
import PortalDashboard from "./pages/PortalDashboard";
import PortalConversations from "./pages/PortalConversations";
import PortalAnalytics from "./pages/PortalAnalytics";
import PortalKnowledge from "./pages/PortalKnowledge";
import PortalPrompt from "./pages/PortalPrompt";
import PortalSettings from "./pages/PortalSettings";
import PortalProfile from "./pages/PortalProfile";
import UniversalLogin from "./pages/UniversalLogin";

import EndUserLogin from "./pages/EndUserLogin";
import PortalChooser from "./pages/PortalChooser";


// Three-portal architecture (Platform / Customer / My)
import { PlatformAdminShell, CustomerAdminShell } from "./components/portals/PortalShells";
import { MyWorkspaceShellSidebar } from "./components/portals/MyWorkspaceShellSidebar";
const MyTelecomSettings = lazyWithRetry(() => import("./pages/my/TelecomSettings"));
const MyOrgChat = lazyWithRetry(() => import("./pages/my/OrgChat"));
const MyAIAssistant = lazyWithRetry(() => import("./pages/my/AIAssistant"));
const MyVoicemail = lazyWithRetry(() => import("./pages/my/Voicemail"));
const MyGreetingsLibrary = lazyWithRetry(() => import("./pages/my/Greetings"));
const MyRecordings = lazyWithRetry(() => import("./pages/my/Recordings"));
const CustomerAdminAIChat = lazyWithRetry(() => import("./pages/customer/AdminAIChat"));
const CustomerSyncHealth = lazyWithRetry(() => import("./pages/customer/SyncHealthCenter"));
import { RolePortalGuard } from "./components/portals/RolePortalGuard";
import { AVA_STANDALONE_ORG_ID, LEMTEL_ORG_ID, PLANIPRET_ORG_ID } from "./lib/avaOwner";
import PlatformDashboard from "./pages/portals/PlatformDashboard";
import PlatformSystemHealth from "./pages/platform/SystemHealth";
import PlatformTelephonyQA from "./pages/platform/TelephonyQA";
import PlatformAIUsage from "./pages/platform/AIUsage";
import CustomerDashboard from "./pages/portals/CustomerDashboard";
import MyDashboardLanding from "./pages/portals/MyDashboardLanding";
const DesignPreview = lazyWithRetry(() => import("./pages/DesignPreview"));


// SWR-friendly defaults: keep data on screen while revalidating in background,
// dedupe repeated fetches from many components, avoid noisy refetch-on-focus.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

import { TrialExpiredGate } from "./components/billing/TrialExpiredGate";

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--gradient-hero)]">
        <div className="text-2xl font-bold gradient-text">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return <TrialExpiredGate>{children}</TrialExpiredGate>;
};

const LemtelOrgOnly = ({ children, fallback = "/dashboard" }: { children: React.ReactNode; fallback?: string }) => {
  const { selectedOrgId, isLoading } = useOrganization();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  if (selectedOrgId !== LEMTEL_ORG_ID) return <Navigate to={fallback} replace />;
  return <>{children}</>;
};

const AvaPlatformOrgOnly = ({ children }: { children: React.ReactNode }) => {
  const { selectedOrgId, organizations, setSelectedOrgId, isLoading } = useOrganization();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  if (selectedOrgId === AVA_STANDALONE_ORG_ID) return <>{children}</>;
  const isMember = organizations.some((org) => org.id === AVA_STANDALONE_ORG_ID);
  if (isMember) {
    setSelectedOrgId(AVA_STANDALONE_ORG_ID);
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Switching to AVA…</div>;
  }
  return <Navigate to="/login" replace />;
};

/**
 * Restrict the AVA admin portal (the main /dashboard and its sub-routes)
 * to the Planipret organization. If the user is a member of Planipret but
 * has another org selected, auto-switch. Otherwise redirect to /portal.
 */
const PlanipretOrgOnly = ({ children }: { children: React.ReactNode }) => {
  const { selectedOrgId, organizations, setSelectedOrgId, isLoading, isSuperAdmin } = useOrganization();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  if (selectedOrgId === PLANIPRET_ORG_ID) return <>{children}</>;
  const isMember = organizations.some((o: any) => (o.id || o.organization?.id) === PLANIPRET_ORG_ID);
  // Super admins always force-load the Planipret context, even if they are
  // not an explicit member of the organization. This guarantees that
  // /planipret/admin/* never inherits a stale "default" org from localStorage.
  if (isMember || isSuperAdmin) {
    setSelectedOrgId(PLANIPRET_ORG_ID);
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Switching to Planipret…</div>;
  }
  return <Navigate to="/dashboard" replace />;
};


const LemtelAdminPage = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute><AppSeparationGuard app="lemtel"><LemtelGuard><ImpersonationProvider><AdminPortalLayout>{children}</AdminPortalLayout></ImpersonationProvider></LemtelGuard></AppSeparationGuard></ProtectedRoute>
);

const LemtelUserPage = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute><AppSeparationGuard app="lemtel"><LemtelGuard><UserPortalLayout>{children}</UserPortalLayout></LemtelGuard></AppSeparationGuard></ProtectedRoute>
);

const LemtelTelephonyPage = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute><AppSeparationGuard app="lemtel"><LemtelGuard><TelephonyLayout>{children}</TelephonyLayout></LemtelGuard></AppSeparationGuard></ProtectedRoute>
);

const App = () => (
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ThemeProvider>
          <TooltipProvider>
            <Toaster />
          <Sonner />
          <BrowserRouter>

            <OrganizationProvider>
              <RouteDebugOverlay />
              <Suspense fallback={<AdminPageSkeleton />}>
              <Routes>
                {/* Landing page on root */}
                <Route path="/" element={<Landing />} />

                {/* Public full feature list */}
                <Route path="/features" element={<FeaturesPage />} />

                {/* Public demo request */}
                <Route path="/demo-request" element={<DemoRequestPage />} />
                
                {/* Contact Us */}
                <Route path="/contact" element={<ContactUs />} />

                {/* Public download page */}
                <Route path="/download" element={<Download />} />
                <Route path="/mobile-preview" element={<MobilePreview />} />
                <Route path="/m" element={<MobileEmbed />} />
                
                {/* Universal login - redirects based on user type */}
                <Route path="/login" element={<UniversalLogin />} />
                <Route path="/portal" element={<Navigate to="/login" replace />} />
                <Route path="/reset-password" element={<ResetPassword />} />

                <Route path="/portals" element={<PortalChooser />} />
                <Route path="/c/:domain" element={<CustomerPortalGate />} />
                <Route path="/end-user/login" element={<EndUserLogin />} />
                <Route path="/extension/login" element={<Navigate to="/end-user/login" replace />} />
                
                {/* Admin auth (legacy, redirects to /login) */}
                <Route path="/auth" element={<Navigate to="/login" replace />} />

                {/* Planiprêt — auth via avastatistic.ca SSO */}
                <Route path="/planipret" element={<Navigate to="/planipret/admin/overview" replace />} />
                <Route path="/planipret/login" element={<Navigate to={loginWithRedirect(ROUTES.MPLANIPRET)} replace />} />
                {/* Legacy alias — old links/bookmarks land here, forward to the canonical mobile app */}
                <Route path="/planipret/mobile" element={<Navigate to={ROUTES.MPLANIPRET} replace />} />
                <Route path="/planipret/mobile/*" element={<Navigate to={ROUTES.MPLANIPRET} replace />} />
                <Route path="/lemtel/setup/:token" element={<SoftphoneSetup />} />
                <Route path="/lemtel/redeem/:token" element={<SoftphoneSetup />} />
                <Route path={ROUTES.MPLANIPRET} element={<MplanipretGuard><PlanipretMobile /></MplanipretGuard>}>
                  <Route index element={<MHome />} />
                  <Route path="home" element={<MHome />} />
                  <Route path="calls" element={<MCalls />} />
                  <Route path="messages" element={<MMessages />} />
                  <Route path="voicemail" element={<MVoicemail />} />
                  <Route path="contacts" element={<MContacts />} />
                  <Route path="more" element={<MMore />} />
                  <Route path="pipeline" element={<MPipeline />} />
                  <Route path="search" element={<MSearch />} />
                  <Route path="stats" element={<MStats />} />
                  <Route path="ava" element={<MAvaChat />} />
                  <Route path="notifications" element={<MAvaNotifications />} />
                  <Route path="extension-sync" element={<MExtensionSync />} />
                </Route>
                <Route path="/planipret/dashboard" element={<Navigate to="/planipret/admin/overview" replace />} />
                <Route path="/planipret/integrations" element={<Navigate to="/planipret/admin/integrations" replace />} />
                <Route path="/auth/ms365/callback" element={<Ms365Callback />} />
                <Route path="/auth/microsoft/callback" element={<Ms365Callback />} />
                <Route path="/auth/callback" element={<Ms365Callback />} />
                <Route path="/mplanipret/ms365-diagnostics" element={<Ms365Diagnostics />} />
                <Route path="/planipret/ms365-diagnostics" element={<Ms365Diagnostics />} />
                <Route path="/mplanipret/style-diagnostics" element={<MStyleDiagnosticsWeb />} />
                <Route path="/planipret/style-diagnostics" element={<MStyleDiagnosticsWeb />} />

                <Route path="/planipret/audit" element={<AppSeparationGuard app="planipret"><PlanipretAudit /></AppSeparationGuard>} />
                <Route path="/planipret/store-preflight" element={<AppSeparationGuard app="planipret"><StorePreflightPreview /></AppSeparationGuard>} />


                {/* Planipret Admin sub-routes (layout with sidebar) — lazy-loaded */}
                <Route
                  path="/planipret/admin"
                  element={
                    <AppSeparationGuard app="planipret">
                      <PlanipretOrgOnly>
                        <Suspense fallback={<AdminPageSkeleton />}>
                          <PlanipretAdminLayout />
                        </Suspense>
                      </PlanipretOrgOnly>
                    </AppSeparationGuard>
                  }
                >
                  <Route index element={<Suspense fallback={<AdminPageSkeleton />}><PAOverview /></Suspense>} />
                  <Route path="overview" element={<Suspense fallback={<AdminPageSkeleton />}><PAOverview /></Suspense>} />
                  <Route path="users" element={<Suspense fallback={<AdminPageSkeleton />}><PAUsers /></Suspense>} />
                  <Route path="calls" element={<Suspense fallback={<AdminPageSkeleton />}><PACalls /></Suspense>} />
                  <Route path="messages" element={<Suspense fallback={<AdminPageSkeleton />}><PAMessages /></Suspense>} />
                  <Route path="voicemails" element={<Navigate to="/planipret/admin/recordings" replace />} />
                  <Route path="recordings" element={<Suspense fallback={<AdminPageSkeleton />}><PARecordings /></Suspense>} />
                  <Route path="reports" element={<Suspense fallback={<AdminPageSkeleton />}><PAReports /></Suspense>} />
                  <Route path="audit" element={<Suspense fallback={<AdminPageSkeleton />}><PAAuditLog /></Suspense>} />
                  <Route path="audit-checklist" element={<Suspense fallback={<AdminPageSkeleton />}><PAAuditChecklist /></Suspense>} />
                  <Route path="compliance" element={<Suspense fallback={<AdminPageSkeleton />}><PACompliance /></Suspense>} />
                  <Route path="leads" element={<Suspense fallback={<AdminPageSkeleton />}><PALeads /></Suspense>} />
                  <Route path="templates" element={<Suspense fallback={<AdminPageSkeleton />}><PATemplates /></Suspense>} />
                  <Route path="integrations" element={<Suspense fallback={<AdminPageSkeleton />}><PlanipretIntegrationsLazy /></Suspense>} />
                  <Route path="debug" element={<Suspense fallback={<AdminPageSkeleton />}><PADebug /></Suspense>} />
                  <Route path="ava" element={<Suspense fallback={<AdminPageSkeleton />}><PAAva /></Suspense>} />
                  <Route path="ava-agent" element={<Suspense fallback={<AdminPageSkeleton />}><PAAvaAgent /></Suspense>} />
                  <Route path="ava-logs" element={<Suspense fallback={<AdminPageSkeleton />}><PAAvaLogs /></Suspense>} />
                  <Route path="mobile-devices" element={<Suspense fallback={<AdminPageSkeleton />}><PAMobileDevices /></Suspense>} />
                  <Route path="sip-diagnostic" element={<Suspense fallback={<AdminPageSkeleton />}><PASipDiagnostic /></Suspense>} />
                  <Route path="diagnostics" element={<Suspense fallback={<AdminPageSkeleton />}><PADiagnostics /></Suspense>} />
                </Route>
                <Route path="/planipret/privacy" element={<Suspense fallback={<AdminPageSkeleton />}><PlanipretPrivacy /></Suspense>} />

                {/* Protected routes */}
                <Route
                  path="/home"
                  element={
                    <ProtectedRoute>
                      <AgencyHome />
                    </ProtectedRoute>
                  }
                />

                {/* Main multi-org dashboard (org switcher with Planipret / Lemtel / AVA) */}
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  }
                />

                {/* Legacy AVA admin portal is now strictly hosted inside the Planipret organization. */}
                <Route element={<ProtectedRoute><Outlet /></ProtectedRoute>}>


                <Route
                  path="/analytics"
                  element={
                    <ProtectedRoute>
                      <VoiceAnalytics />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/conversations"
                  element={
                    <ProtectedRoute>
                      <Conversations />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/conversations/:id"
                  element={
                    <ProtectedRoute>
                      <ConversationDetail />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/knowledge-base"
                  element={
                    <ProtectedRoute>
                      <KnowledgeBase />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute>
                      <Settings />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/profile"
                  element={
                    <ProtectedRoute>
                      <Profile />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/clients"
                  element={
                    <ProtectedRoute>
                      <Clients />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/clients/new"
                  element={
                    <ProtectedRoute>
                      <ClientCreateWizard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/clients/:clientId"
                  element={
                    <ProtectedRoute>
                      <ClientDetail />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/integrations"
                  element={
                    <ProtectedRoute>
                      <Integrations />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/twilio-management"
                  element={
                    <ProtectedRoute>
                      <TwilioManagement />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/webhook-logs"
                  element={
                    <ProtectedRoute>
                      <WebhookLogs />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/stripe-billing"
                  element={
                    <ProtectedRoute>
                      <StripeBilling />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/saas-config"
                  element={
                    <ProtectedRoute>
                      <SaaSConfigurator />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/email-templates"
                  element={
                    <ProtectedRoute>
                      <EmailTemplates />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/agents"
                  element={
                    <ProtectedRoute>
                      <Agents />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/agent-settings/:agentId"
                  element={
                    <ProtectedRoute>
                      <AgentSettings />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/team"
                  element={
                    <ProtectedRoute>
                      <Team />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/api-keys"
                  element={
                    <ProtectedRoute>
                      <ApiKeys />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/workflows"
                  element={
                    <ProtectedRoute>
                      <Workflows />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/workflow-builder/:workflowId"
                  element={
                    <ProtectedRoute>
                      <WorkflowBuilder />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/topics"
                  element={
                    <ProtectedRoute>
                      <Topics />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/campaigns"
                  element={
                    <ProtectedRoute>
                      <Campaigns />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/appointments"
                  element={
                    <ProtectedRoute>
                      <Appointments />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/agent-reports"
                  element={
                    <ProtectedRoute>
                      <AgentReports />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/agent-builder"
                  element={
                    <ProtectedRoute>
                      <AgentBuilder />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/agent-builder/:agentId"
                  element={
                    <ProtectedRoute>
                      <AgentBuilder />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/agent-comparison"
                  element={
                    <ProtectedRoute>
                      <AgentComparison />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/leads"
                  element={
                    <ProtectedRoute>
                      <Leads />
                    </ProtectedRoute>
                  }
                />
                {/* /phone-numbers removed — use Domain → Destinations */}
                <Route path="/phone-numbers" element={<Navigate to="/lemtel/dids" replace />} />
                <Route
                  path="/handoffs"
                  element={
                    <ProtectedRoute>
                      <Handoffs />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/sms-templates"
                  element={
                    <ProtectedRoute>
                      <SmsTemplates />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/settings/baa"
                  element={
                    <ProtectedRoute>
                      <BAAgreement />
                    </ProtectedRoute>
                  }
                />
                </Route>
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/support" element={<Support />} />
                <Route path="/legal" element={<Legal />} />
                <Route path="/docs" element={<Docs />} />
                <Route element={<ProtectedRoute><Outlet /></ProtectedRoute>}>
                <Route
                  path="/demo"
                  element={
                    <ProtectedRoute>
                      <DemoCenter />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/realtime"
                  element={<RealtimeMonitor />}
                />
                <Route
                  path="/api-explorer"
                  element={<ApiExplorer />}
                />
                <Route
                  path="/super-admin"
                  element={<SuperAdminDashboard />}
                />
                <Route
                  path="/audit-logs"
                  element={<AuditLogs />}
                />
                </Route>
                
                {/* Lemtel Telecom Module — gated to Lemtel org members */}
                <Route path="/lemtel/dashboard" element={<ProtectedRoute><LemtelGuard><LemtelDashboard /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/settings" element={<ProtectedRoute><LemtelGuard><LemtelSettings /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/integrations/providers" element={<ProtectedRoute><LemtelGuard><ProviderCredentials /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/messages" element={<ProtectedRoute><LemtelGuard><LemtelMessages /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/customers" element={<ProtectedRoute><LemtelGuard><LemtelCustomers /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/dids" element={<ProtectedRoute><LemtelGuard><LemtelDIDs /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/extensions" element={<ProtectedRoute><LemtelGuard><LemtelExtensions /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/devices" element={<ProtectedRoute><LemtelGuard><LemtelDevices /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/queues" element={<ProtectedRoute><LemtelGuard><LemtelQueues /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/ivr" element={<ProtectedRoute><LemtelGuard><LemtelIVR /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/voice-agents" element={<ProtectedRoute><LemtelGuard><LemtelVoiceAgents /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/softphone-users" element={<ProtectedRoute><LemtelGuard><LemtelSoftphoneUsers /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/analytics" element={<ProtectedRoute><LemtelGuard><LemtelAnalytics /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/portal/calls" element={<ProtectedRoute><LemtelGuard><LemtelPortalCalls /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/portal/dashboard" element={<ProtectedRoute><LemtelGuard><LemtelDashboard /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/portal/extensions" element={<ProtectedRoute><LemtelGuard><LemtelExtensions /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/portal/recordings" element={<ProtectedRoute><LemtelGuard><LemtelStub title="Recordings" description="Call recordings will appear here once FusionPBX is connected." /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/portal/queues" element={<ProtectedRoute><LemtelGuard><LemtelQueues /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/portal/ivr" element={<ProtectedRoute><LemtelGuard><LemtelIVR /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/portal/messages" element={<ProtectedRoute><LemtelGuard><LemtelMessages /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/portal/agents" element={<ProtectedRoute><LemtelGuard><LemtelVoiceAgents /></LemtelGuard></ProtectedRoute>} />
                <Route path="/lemtel/portal/softphone" element={<ProtectedRoute><LemtelGuard><LemtelStub title="Softphone" description="Use the floating softphone widget at the bottom-right." /></LemtelGuard></ProtectedRoute>} />

                {/* New /org/lemtel/telephony/* admin routes */}
                <Route path="/org/lemtel/telephony/dashboard" element={<LemtelTelephonyPage><TelephonyDashboard /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/numbers" element={<LemtelTelephonyPage><LemtelDIDs /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/extensions" element={<LemtelTelephonyPage><LemtelExtensions /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/users" element={<LemtelTelephonyPage><TelephonyUsers /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/devices" element={<LemtelTelephonyPage><LemtelDevices /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/calls" element={<LemtelTelephonyPage><LemtelPortalCalls /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/recordings" element={<LemtelTelephonyPage><TelephonyRecordings /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/ai-pipeline" element={<LemtelTelephonyPage><CallIntelligenceDashboard /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/media" element={<LemtelTelephonyPage><TelephonyMediaCenter scope="org" /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/ivr" element={<LemtelTelephonyPage><LemtelIVR /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/queues" element={<LemtelTelephonyPage><LemtelQueues /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/ring-groups" element={<LemtelTelephonyPage><TelephonyRingGroups /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/messages" element={<LemtelTelephonyPage><LemtelMessages /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/agents" element={<LemtelTelephonyPage><LemtelVoiceAgents /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/ai" element={<LemtelTelephonyPage><TelephonyAI /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/webphone" element={<LemtelTelephonyPage><TelephonyWebphone /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/settings" element={<LemtelTelephonyPage><TelephonySettings /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/voicemail" element={<LemtelTelephonyPage><TelephonyVoicemail /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/team" element={<LemtelTelephonyPage><TelephonyTeam /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/preferences" element={<LemtelTelephonyPage><TelephonyUserPreferences /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/advanced" element={<LemtelTelephonyPage><TelephonyAdvanced /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/sync-health" element={<LemtelTelephonyPage><TelephonySyncHealth /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/callcenter/agent" element={<LemtelTelephonyPage><CallCenterAgent /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/callcenter/wallboard" element={<LemtelTelephonyPage><CallCenterWallboard /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/callcenter/admin" element={<LemtelTelephonyPage><CallCenterAdmin /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/diagnostics" element={<LemtelTelephonyPage><TelephonyDiagnostics /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/qa" element={<LemtelTelephonyPage><TelephonyDiagnostics /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/source-audit" element={<LemtelTelephonyPage><TelephonySourceAudit /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/_diagnostics" element={<LemtelTelephonyPage><TelephonySourceAudit /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/phone-numbers-unified" element={<LemtelTelephonyPage><PhoneNumbersUnified /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/admin-users" element={<LemtelTelephonyPage><PbxAdminUsers /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/registrations-live" element={<LemtelTelephonyPage><LiveRegistrations /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/voice-agents-live" element={<LemtelTelephonyPage><VoiceAgentsLive /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/checklist" element={<LemtelTelephonyPage><TelephonyChecklist /></LemtelTelephonyPage>} />
                <Route path="/org/lemtel/telephony/portal-mappings" element={<LemtelTelephonyPage><TelephonyPortalMappings /></LemtelTelephonyPage>} />

                {/* v3.0 Admin Portal (/org/lemtel/admin/*) */}
                <Route path="/org/lemtel/admin" element={<Navigate to="/org/lemtel/admin/dashboard" replace />} />
                <Route path="/org/lemtel/admin/dashboard" element={<LemtelAdminPage><AdminDashboard /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/extensions" element={<LemtelAdminPage><LemtelExtensions /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/pbx-users" element={<LemtelAdminPage><LemtelPbxUsers /></LemtelAdminPage>} />
                {/* Phone Numbers page removed — duplicate of Inbound Routes/Destinations */}
                <Route path="/org/lemtel/admin/dids" element={<Navigate to="/org/lemtel/admin/destinations" replace />} />
                <Route path="/org/lemtel/admin/devices" element={<LemtelAdminPage><LemtelDevices /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/ivr" element={<LemtelAdminPage><LemtelIVR /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/queues" element={<LemtelAdminPage><LemtelQueues /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/ring-groups" element={<LemtelAdminPage><TelephonyRingGroups /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/agents" element={<LemtelAdminPage><LemtelVoiceAgents /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/conversations" element={<LemtelAdminPage><Conversations /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/customers" element={<LemtelAdminPage><LemtelCustomers /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/customers/:domainUuid" element={<LemtelAdminPage><CustomerDetail /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/porting" element={<LemtelAdminPage><PortingQueue /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/gateways" element={<LemtelAdminPage><LemtelGateways /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/voice-gateways" element={<LemtelAdminPage><LemtelVoiceGateways /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/calls" element={<LemtelAdminPage><TelephonyMediaCenter scope="org" /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/cdrs" element={<Navigate to="/org/lemtel/admin/calls" replace />} />
                <Route path="/org/lemtel/admin/recordings" element={<LemtelAdminPage><AdminRecordings /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/voicemail" element={<LemtelAdminPage><AdminVoicemail /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/reports" element={<LemtelAdminPage><AdminReports /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/destinations" element={<LemtelAdminPage><AdminDestinations /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/time-conditions" element={<LemtelAdminPage><AdminTimeConditions /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/settings" element={<LemtelAdminPage><TelephonySettings /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/hours" element={<LemtelAdminPage><BusinessHours /></LemtelAdminPage>} />
                <Route path="/org/:slug/admin" element={<Navigate to="dashboard" replace />} />
                <Route path="/org/:slug/admin/dashboard" element={<ProtectedRoute><AdminPortalLayout><CustomerDashboard /></AdminPortalLayout></ProtectedRoute>} />
                <Route path="/org/:slug/admin/hours" element={<ProtectedRoute><AdminPortalLayout><BusinessHours /></AdminPortalLayout></ProtectedRoute>} />
                <Route path="/org/:slug/admin/settings" element={<ProtectedRoute><AdminPortalLayout><CustomerSettings /></AdminPortalLayout></ProtectedRoute>} />
                <Route path="/org/lemtel/admin/downloads" element={<LemtelAdminPage><DownloadCenter /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/fax" element={<LemtelAdminPage><LemtelStub title="Fax Server" description="Configure inbound/outbound fax routing." /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/conferences" element={<LemtelAdminPage><AdminConferences /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/hold-music" element={<LemtelAdminPage><AdminHoldMusic /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/sync-health" element={<LemtelAdminPage><AdminSyncHealth /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/active-calls" element={<LemtelAdminPage><AdminActiveCalls /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/registrations" element={<LemtelAdminPage><AdminRegistrations /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/system-status" element={<LemtelAdminPage><AdminSystemStatus /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/ai-actions" element={<LemtelAdminPage><AdminAIActions /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/sip-profiles" element={<LemtelAdminPage><AdminSipProfiles /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/dialplans" element={<LemtelAdminPage><AdminDialplans /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/feature-codes" element={<LemtelAdminPage><AdminFeatureCodes /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/call-forwarding" element={<LemtelAdminPage><AdminCallForwarding /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/recording-rules" element={<LemtelAdminPage><AdminRecordingRules /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/voicemail-settings" element={<LemtelAdminPage><AdminVoicemailSettings /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/conference-centers" element={<LemtelAdminPage><LemtelStub title="Conference Centers" description="Multi-tenant conference bridges." /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/email-queue" element={<LemtelAdminPage><LemtelStub title="Email Queue" description="Outbound notification email queue." /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/call-block" element={<LemtelAdminPage><LemtelStub title="Call Block" description="Block inbound caller IDs and patterns." /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/contacts" element={<LemtelAdminPage><LemtelStub title="Contacts" description="Shared contact directory." /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/fax-queue" element={<LemtelAdminPage><LemtelStub title="Fax Queue" description="Pending and recent fax transmissions." /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/event-guard" element={<LemtelAdminPage><LemtelStub title="Event Guard" description="Fraud detection and abuse alerts." /></LemtelAdminPage>} />
                <Route path="/org/lemtel/admin/business-hours" element={<Navigate to="/org/lemtel/admin/hours" replace />} />
                <Route path="/org/lemtel/analytics/cdrs" element={<Navigate to="/org/lemtel/telephony/calls" replace />} />
                <Route path="/org/lemtel/analytics/calls" element={<Navigate to="/org/lemtel/telephony/calls" replace />} />
                <Route path="/org/lemtel/analytics" element={<Navigate to="/org/lemtel/telephony/calls" replace />} />

                {/* Per-customer-domain phone-system cockpit (/domain/:slug/admin/*).
                    Mirrors the Lemtel admin portal but scoped to the customer's org. */}
                <Route path="/domain/:slug/admin" element={<Navigate to="dashboard" replace />} />
                <Route path="/domain/:slug/admin/dashboard" element={<ProtectedRoute><CustomerDomainGate><DomainDashboard /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/extensions" element={<ProtectedRoute><CustomerDomainGate><LemtelExtensions /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/pbx-users" element={<ProtectedRoute><CustomerDomainGate><LemtelPbxUsers /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/devices" element={<ProtectedRoute><CustomerDomainGate><LemtelDevices /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/dids" element={<ProtectedRoute><CustomerDomainGate><LemtelDIDs /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/numbers" element={<Navigate to="../dids" replace />} />
                <Route path="/domain/:slug/admin/ivr" element={<ProtectedRoute><CustomerDomainGate><LemtelIVR /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/queues" element={<ProtectedRoute><CustomerDomainGate><LemtelQueues /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/ring-groups" element={<ProtectedRoute><CustomerDomainGate><TelephonyRingGroups /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/hold-music" element={<ProtectedRoute><CustomerDomainGate><AdminHoldMusic /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/recordings" element={<ProtectedRoute><CustomerDomainGate><AdminRecordings /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/calls" element={<ProtectedRoute><CustomerDomainGate><TelephonyMediaCenter scope="org" /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/voicemail" element={<ProtectedRoute><CustomerDomainGate><AdminVoicemail /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/hours" element={<ProtectedRoute><CustomerDomainGate><BusinessHours /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/time-conditions" element={<ProtectedRoute><CustomerDomainGate><AdminTimeConditions /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/conferences" element={<ProtectedRoute><CustomerDomainGate><AdminConferences /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/destinations" element={<ProtectedRoute><CustomerDomainGate><AdminDestinations /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/call-forwarding" element={<ProtectedRoute><CustomerDomainGate><AdminCallForwarding /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/recording-rules" element={<ProtectedRoute><CustomerDomainGate><AdminRecordingRules /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/voicemail-settings" element={<ProtectedRoute><CustomerDomainGate><AdminVoicemailSettings /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/active-calls" element={<ProtectedRoute><CustomerDomainGate><AdminActiveCalls /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/registrations" element={<ProtectedRoute><CustomerDomainGate><AdminRegistrations /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/reports" element={<ProtectedRoute><CustomerDomainGate><AdminReports /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/sync-health" element={<ProtectedRoute><CustomerDomainGate><AdminSyncHealth /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/agents" element={<ProtectedRoute><CustomerDomainGate><LemtelVoiceAgents /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/settings" element={<ProtectedRoute><CustomerDomainGate><CustomerSettings /></CustomerDomainGate></ProtectedRoute>} />
                <Route path="/domain/:slug/admin/downloads" element={<ProtectedRoute><CustomerDomainGate><DownloadCenter /></CustomerDomainGate></ProtectedRoute>} />




                {/* v3.0 User Portal (/org/lemtel/my/*) */}
                <Route path="/org/lemtel/my" element={<Navigate to="/my" replace />} />
                <Route path="/org/lemtel/my/dashboard" element={<Navigate to="/my" replace />} />
                <Route path="/org/lemtel/my/calls" element={<Navigate to="/my/calls" replace />} />
                <Route path="/org/lemtel/my/recordings" element={<Navigate to="/my/recordings" replace />} />
                <Route path="/org/lemtel/my/voicemail" element={<Navigate to="/my/voicemail" replace />} />
                <Route path="/org/lemtel/my/sms" element={<Navigate to="/my/messages" replace />} />
                <Route path="/org/lemtel/my/settings" element={<Navigate to="/my/settings" replace />} />
                <Route path="/org/lemtel/my/downloads" element={<Navigate to="/my/downloads" replace />} />
                <Route path="/org/lemtel/my/forwarding" element={<Navigate to="/my/telecom" replace />} />
                <Route path="/org/lemtel/my/devices" element={<Navigate to="/my/telecom" replace />} />
                <Route path="/org/lemtel/my/greetings" element={<Navigate to="/my/greetings" replace />} />

                {/* /org/lemtel/portal/* customer routes (PortalGuard enforces customer scope) */}
                <Route path="/org/lemtel/portal" element={<Navigate to="/org/lemtel/portal/dashboard" replace />} />
                <Route path="/org/lemtel/portal/diagnostic" element={<ProtectedRoute><PortalDiagnostic /></ProtectedRoute>} />
                <Route path="/org/lemtel/portal/dashboard" element={<ProtectedRoute><LemtelGuard><PortalGuard><TelephonyLayout portal><LemtelPortalDashboard /></TelephonyLayout></PortalGuard></LemtelGuard></ProtectedRoute>} />
                <Route path="/org/lemtel/portal/extensions" element={<ProtectedRoute><LemtelGuard><PortalGuard><TelephonyLayout portal><LemtelExtensions /></TelephonyLayout></PortalGuard></LemtelGuard></ProtectedRoute>} />
                <Route path="/org/lemtel/portal/calls" element={<ProtectedRoute><LemtelGuard><PortalGuard><TelephonyLayout portal><LemtelPortalCalls scope="mine" /></TelephonyLayout></PortalGuard></LemtelGuard></ProtectedRoute>} />
                <Route path="/org/lemtel/portal/recordings" element={<ProtectedRoute><LemtelGuard><PortalGuard><TelephonyLayout portal><TelephonyRecordings scope="mine" /></TelephonyLayout></PortalGuard></LemtelGuard></ProtectedRoute>} />
                <Route path="/org/lemtel/portal/media" element={<ProtectedRoute><LemtelGuard><PortalGuard><TelephonyLayout portal><TelephonyMediaCenter scope="mine" /></TelephonyLayout></PortalGuard></LemtelGuard></ProtectedRoute>} />
                <Route path="/org/lemtel/portal/ivr" element={<ProtectedRoute><LemtelGuard><PortalGuard><TelephonyLayout portal><LemtelIVR /></TelephonyLayout></PortalGuard></LemtelGuard></ProtectedRoute>} />
                <Route path="/org/lemtel/portal/queues" element={<ProtectedRoute><LemtelGuard><PortalGuard><TelephonyLayout portal><LemtelQueues /></TelephonyLayout></PortalGuard></LemtelGuard></ProtectedRoute>} />
                <Route path="/org/lemtel/portal/messages" element={<ProtectedRoute><LemtelGuard><PortalGuard><TelephonyLayout portal><LemtelMessages /></TelephonyLayout></PortalGuard></LemtelGuard></ProtectedRoute>} />
                <Route path="/org/lemtel/portal/agents" element={<ProtectedRoute><LemtelGuard><PortalGuard><TelephonyLayout portal><LemtelVoiceAgents /></TelephonyLayout></PortalGuard></LemtelGuard></ProtectedRoute>} />
                <Route path="/org/lemtel/portal/softphone" element={<ProtectedRoute><LemtelGuard><PortalGuard><TelephonyLayout portal><TelephonyWebphone /></TelephonyLayout></PortalGuard></LemtelGuard></ProtectedRoute>} />

                
                <Route
                  path="/client/login"
                  element={
                    <ClientProvider>
                      <ClientLogin />
                    </ClientProvider>
                  }
                />
                <Route
                  path="/client/forgot-password"
                  element={
                    <ClientProvider>
                      <ClientForgotPassword />
                    </ClientProvider>
                  }
                />
                <Route
                  path="/client/reset-password/:token"
                  element={
                    <ClientProvider>
                      <ClientResetPassword />
                    </ClientProvider>
                  }
                />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/client/:clientId" element={<ClientPortal />}>

                  <Route path="conversations" element={<ClientConversations />} />
                  <Route path="analytics" element={<ClientAnalytics />} />
                </Route>

                {/* Client Agent Portal Routes - Per agent access */}
                <Route path="/client/:clientId/agent/:agentId" element={<ClientAgentPortal />}>
                  <Route path="dashboard" element={<ClientAgentDashboard />} />
                  <Route path="conversations" element={<ClientAgentConversations />} />
                  <Route path="analytics" element={<ClientAgentAnalytics />} />
                  <Route path="knowledge" element={<ClientAgentKnowledge />} />
                  <Route path="settings" element={<ClientAgentSettings />} />
                  <Route path="endpoints" element={<ClientAgentEndpoints />} />
                  <Route path="mcp" element={<ClientAgentMCP />} />
                  <Route path="webhooks" element={<ClientAgentWebhooks />} />
                  <Route path="widget" element={<ClientAgentWidget />} />
                </Route>

                {/* New Portal Routes - Agent slug based directly at root */}
                <Route path="/:agentSlug">
                  <Route index element={<PortalLogin />} />
                  <Route element={<PortalLayout />}>
                    <Route path="dashboard" element={<PortalDashboard />} />
                    <Route path="conversations" element={<PortalConversations />} />
                    <Route path="analytics" element={<PortalAnalytics />} />
                    <Route path="knowledge" element={<PortalKnowledge />} />
                    <Route path="prompt" element={<PortalPrompt />} />
                    <Route path="settings" element={<PortalSettings />} />
                    <Route path="profile" element={<PortalProfile />} />
                  </Route>
                </Route>

                {/* Keep legacy portal routes for backward compatibility */}
                <Route path="/portal/:agentSlug">
                  <Route index element={<PortalLogin />} />
                  <Route element={<PortalLayout />}>
                    <Route path="dashboard" element={<PortalDashboard />} />
                    <Route path="conversations" element={<PortalConversations />} />
                    <Route path="analytics" element={<PortalAnalytics />} />
                    <Route path="knowledge" element={<PortalKnowledge />} />
                    <Route path="prompt" element={<PortalPrompt />} />
                    <Route path="settings" element={<PortalSettings />} />
                    <Route path="profile" element={<PortalProfile />} />
                  </Route>
                </Route>

                {/* Public Widget Routes - No authentication */}
                <Route path="/prototype/:agentId" element={<WidgetPrototype />} />
                <Route path="/iframe/:agentId" element={<WidgetIframe />} />

                {/* v4.0.0 — Multi-tenant routes (white-labelled per :slug) */}
                <Route
                  path="/org/:slug/master"
                  element={
                    <ProtectedRoute>
                      <WhitelabelProvider>
                        <ImpersonationProvider>
                          <LemtelGuard>
                            <MasterShell />
                          </LemtelGuard>
                        </ImpersonationProvider>
                      </WhitelabelProvider>
                    </ProtectedRoute>
                  }
                >
                  <Route path="dashboard" element={<MasterDashboard />} />
                  <Route path="organizations" element={<MasterOrganizations />} />
                  <Route path="users" element={<MasterAllUsers />} />
                  <Route path="calls" element={<MasterAllCalls />} />
                  <Route path="billing" element={<MasterBilling />} />
                  <Route path="system" element={<MasterSystem />} />
                  <Route path="audit" element={<MasterAuditLogs />} />
                </Route>

                <Route
                  path="/org/:slug/reseller"
                  element={
                    <ProtectedRoute>
                      <WhitelabelProvider>
                        <ImpersonationProvider>
                          <ResellerShell />
                        </ImpersonationProvider>
                      </WhitelabelProvider>
                    </ProtectedRoute>
                  }
                >
                  <Route path="dashboard" element={<ResellerDashboard />} />
                  <Route path="customers" element={<ResellerDashboard />} />
                  <Route path="users" element={<ResellerDashboard />} />
                  <Route path="settings" element={<ResellerSettings />} />
                  <Route path="billing" element={<ResellerDashboard />} />
                </Route>

                <Route path="/post-login" element={<ProtectedRoute><PostLoginRedirect /></ProtectedRoute>} />

                {/* === Three-portal architecture === */}
                {/* Platform Admin — AVA super-admin org only */}
                <Route path="/platform" element={<ProtectedRoute><AvaPlatformOrgOnly><RolePortalGuard portal="platform"><PlatformAdminShell /></RolePortalGuard></AvaPlatformOrgOnly></ProtectedRoute>}>
                  <Route index element={<PlatformDashboard />} />
                  <Route path="organizations" element={<MasterOrganizations />} />
                  <Route path="users" element={<MasterAllUsers />} />
                  <Route path="calls" element={<LemtelOrgOnly fallback="/platform"><MasterAllCalls /></LemtelOrgOnly>} />
                  <Route path="telephony" element={<LemtelOrgOnly fallback="/platform"><TelephonyDashboard /></LemtelOrgOnly>} />
                  <Route path="billing" element={<MasterBilling />} />
                  <Route path="system" element={<MasterSystem />} />
                  <Route path="health" element={<PlatformSystemHealth />} />
                  <Route path="qa" element={<LemtelOrgOnly fallback="/platform"><PlatformTelephonyQA /></LemtelOrgOnly>} />
                  <Route path="audit" element={<MasterAuditLogs />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="ai-usage" element={<PlatformAIUsage />} />
                </Route>

                {/* Customer Admin — workspace owners / resellers */}
                <Route path="/customer" element={<ProtectedRoute><RolePortalGuard portal="customer"><CustomerAdminShell /></RolePortalGuard></ProtectedRoute>}>
                  <Route index element={<CustomerDashboard />} />
                  <Route path="team" element={<Team />} />
                  <Route path="extensions" element={<LemtelOrgOnly fallback="/customer"><LemtelExtensions /></LemtelOrgOnly>} />
                  <Route path="queues" element={<LemtelOrgOnly fallback="/customer"><LemtelQueues /></LemtelOrgOnly>} />
                  <Route path="ivr" element={<LemtelOrgOnly fallback="/customer"><LemtelIVR /></LemtelOrgOnly>} />
                  <Route path="numbers" element={<Navigate to="/lemtel/dids" replace />} />
                  <Route path="calls" element={<LemtelOrgOnly fallback="/customer"><TelephonyMediaCenter scope="org" /></LemtelOrgOnly>} />
                  <Route path="cdrs" element={<LemtelOrgOnly fallback="/customer"><LemtelPortalCalls /></LemtelOrgOnly>} />
                  <Route path="recordings" element={<LemtelOrgOnly fallback="/customer"><AdminRecordings /></LemtelOrgOnly>} />
                  <Route path="analytics" element={<LemtelOrgOnly fallback="/customer"><LemtelAnalytics /></LemtelOrgOnly>} />
                  <Route path="knowledge" element={<KnowledgeBase />} />
                  <Route path="billing" element={<StripeBilling />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="chat" element={<MyOrgChat />} />
                  <Route path="ai-admin" element={<CustomerAdminAIChat />} />
                  <Route path="sync-health" element={<LemtelOrgOnly fallback="/customer"><CustomerSyncHealth /></LemtelOrgOnly>} />
                  <Route path="reports" element={<LemtelOrgOnly fallback="/customer"><LemtelAnalytics /></LemtelOrgOnly>} />
                </Route>

                {/* My Workspace — end users */}
                <Route path="/my" element={<ProtectedRoute><RolePortalGuard portal="my"><MyWorkspaceShellSidebar /></RolePortalGuard></ProtectedRoute>}>
                  <Route index element={<MyDashboardLanding />} />
                  <Route path="dashboard" element={<MyDashboardLanding />} />
                  <Route path="softphone" element={<LemtelOrgOnly fallback="/my"><TelephonyWebphone /></LemtelOrgOnly>} />
                  <Route path="calls" element={<LemtelOrgOnly fallback="/my"><TelephonyMediaCenter scope="mine" /></LemtelOrgOnly>} />
                  <Route path="voicemail" element={<LemtelOrgOnly fallback="/my"><MyVoicemail /></LemtelOrgOnly>} />
                  <Route path="greetings" element={<LemtelOrgOnly fallback="/my"><MyGreetingsLibrary /></LemtelOrgOnly>} />
                  <Route path="messages" element={<LemtelOrgOnly fallback="/my"><LemtelMessages /></LemtelOrgOnly>} />
                  <Route path="recordings" element={<LemtelOrgOnly fallback="/my"><MyRecordings /></LemtelOrgOnly>} />
                  <Route path="chat" element={<MyOrgChat />} />
                  <Route path="telecom" element={<LemtelOrgOnly fallback="/my"><MyTelecomSettings /></LemtelOrgOnly>} />
                  <Route path="ai" element={<MyAIAssistant />} />
                  <Route path="downloads" element={<DownloadCenter personalize />} />
                  <Route path="profile" element={<Profile />} />
                  <Route path="settings" element={<MySettings />} />
                </Route>

                {/* PBX Command Center (desktop admin shell) */}
                <Route path="/console" element={<ProtectedRoute><LemtelOrgOnly><ConsoleShell /></LemtelOrgOnly></ProtectedRoute>}>
                  <Route index element={<ConsoleDashboard />} />
                  <Route path="extensions" element={<ConsoleExtensions />} />
                  <Route path="devices" element={<ConsoleDevices />} />
                  <Route path="ivrs" element={<ConsoleIVRs />} />
                  <Route path="ring-groups" element={<ConsoleRingGroups />} />
                  <Route path="queues" element={<ConsoleQueues />} />
                  <Route path="dids" element={<ConsoleDIDs />} />
                  <Route path="inbound-routes" element={<ConsoleInboundRoutes />} />
                  <Route path="voicemail" element={<ConsoleVoicemail />} />
                  <Route path="registrations" element={<ConsoleRegistrations />} />
                  <Route path="active-calls" element={<ConsoleActiveCalls />} />
                  <Route path="cdr" element={<ConsoleCdr />} />
                  <Route path="insights" element={<ConsoleInsights />} />
                  <Route path="chatbot" element={<ConsoleChatbot />} />
                  <Route path="audit" element={<ConsoleAudit />} />
                  <Route path="presence" element={<ConsolePresence />} />
                  <Route path="chat" element={<ConsoleChat />} />
                </Route>


                {/* Legacy /admin/* redirects → /platform/* */}
                <Route path="/admin" element={<Navigate to="/platform" replace />} />
                <Route path="/admin/users" element={<Navigate to="/platform/users" replace />} />
                <Route path="/admin/audit" element={<Navigate to="/platform/audit" replace />} />
                <Route path="/admin/organizations" element={<Navigate to="/platform/organizations" replace />} />
                <Route path="/admin/billing" element={<Navigate to="/platform/billing" replace />} />
                <Route path="/admin/system" element={<Navigate to="/platform/system" replace />} />
                <Route path="/admin/settings" element={<Navigate to="/platform/settings" replace />} />
                <Route path="/admin/*" element={<Navigate to="/platform" replace />} />

                {import.meta.env.DEV && <Route path="/_design" element={<DesignPreview />} />}

                <Route path="*" element={<NotFound />} />



              </Routes>
              {/* MascotProvider removed — MyAIChatLauncher is the single AVA assistant */}
            </Suspense>
          </OrganizationProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </LanguageProvider>
  </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
