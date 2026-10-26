import { lazy, Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Redirect, Route, Switch, Router as WouterRouter } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import DashboardLayout from "./components/DashboardLayout";
import { canAdministerUsers, canViewEngineering } from "@/lib/access";

const Cybersecurity = lazy(() => import("./pages/Cybersecurity"));
const EquipmentView = lazy(() => import("./pages/EquipmentView"));
const OnesaIntegration = lazy(() => import("./pages/OnesaIntegration"));
const Home = lazy(() => import("./pages/Home"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const Monitoring = lazy(() => import("./pages/Monitoring"));
const Devices = lazy(() => import("./pages/Devices"));
const DeviceDetail = lazy(() => import("./pages/DeviceDetail"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Notifications = lazy(() => import("./pages/Notifications"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const Assistant = lazy(() => import("./pages/Assistant"));
const OTAUpdates = lazy(() => import("./pages/OTAUpdates"));
const Assets = lazy(() => import("./pages/Assets"));
const AssetAdministrationShell = lazy(
  () => import("./pages/AssetAdministrationShell"),
);
const UserAccess = lazy(() => import("./pages/UserAccess"));
const ProductPassport = lazy(() => import("./pages/ProductPassport"));

// Keep hash query context available to each workspace while matching the route path.
function useHashPath(): ReturnType<typeof useHashLocation> {
  const [location, navigate] = useHashLocation();
  return [location.split("?")[0], navigate];
}
useHashPath.hrefs = useHashLocation.hrefs;

function RouteLoading() {
  return (
    <div
      role="status"
      className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground"
    >
      Loading page…
    </div>
  );
}

function AppRouter() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="min-h-screen flex items-center justify-center bg-background text-foreground"
      >
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span
            aria-hidden="true"
            className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary"
          />
          <span>Loading your factory workspace…</span>
        </div>
      </div>
    );
  }

  // Show login page for unauthenticated users
  if (!user) {
    return (
      <WouterRouter hook={useHashPath}>
        <Suspense fallback={<RouteLoading />}>
          <Switch>
            <Route path="/passport/:id" component={ProductPassport} />
            <Route path="/login" component={Login} />
            <Route path="/register" component={Register} />
            <Route path="/forgot-password" component={ForgotPassword} />
            <Route path="/" component={Login} />
            <Route component={Login} />
          </Switch>
        </Suspense>
      </WouterRouter>
    );
  }

  return (
    <WouterRouter hook={useHashPath}>
      <Suspense fallback={<RouteLoading />}>
        <Switch>
          {/* Keep the public passport in a standalone shell even when the
              viewer is signed in, so navigation never enters print output. */}
          <Route path="/passport/:id" component={ProductPassport} />
          <Route>
            <DashboardLayout>
              <Switch>
                <Route path="/" component={Home} />
                <Route path="/monitoring" component={Monitoring} />
                <Route path="/devices" component={Devices} />
                <Route path="/devices/:id" component={DeviceDetail} />
                <Route path="/cybersecurity" component={Cybersecurity} />
                <Route path="/equipment" component={EquipmentView} />
                <Route path="/assets" component={Assets} />
                <Route
                  path="/assets/:id/aas"
                  component={AssetAdministrationShell}
                />
                <Route path="/integrations/onesa">
                  {canViewEngineering(user.role) ? (
                    <OnesaIntegration />
                  ) : (
                    <NotFound />
                  )}
                </Route>
                <Route path="/users">
                  {canAdministerUsers(user.role) ? (
                    <UserAccess />
                  ) : (
                    <NotFound />
                  )}
                </Route>
                <Route path="/alerts" component={Alerts} />
                <Route path="/alerts/:eventId" component={Alerts} />
                <Route path="/notifications" component={Notifications} />
                <Route path="/alert-history">
                  <Redirect to="/alerts" />
                </Route>
                <Route path="/analytics" component={AnalyticsPage} />
                <Route path="/assistant" component={Assistant} />
                <Route path="/ota">
                  {canViewEngineering(user.role) ? (
                    <OTAUpdates />
                  ) : (
                    <NotFound />
                  )}
                </Route>
                <Route path="/404" component={NotFound} />
                <Route component={NotFound} />
              </Switch>
            </DashboardLayout>
          </Route>
        </Switch>
      </Suspense>
    </WouterRouter>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ThemeProvider defaultTheme="dark" switchable>
          <TooltipProvider>
            <Toaster />
            <AppRouter />
            {import.meta.env.PROD && <Analytics />}
          </TooltipProvider>
        </ThemeProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
