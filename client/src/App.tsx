import { lazy, Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import {
  useParams,
  Redirect,
  Route,
  Switch,
  Router as WouterRouter,
} from "wouter";
import { useWorkspaceLocation as useHashLocation } from "@/lib/hashLocation";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import DashboardLayout from "./components/DashboardLayout";
import { canAdministerUsers, canViewEngineering } from "@/lib/access";

const Inventory = lazy(() => import("./pages/Inventory"));
const ItemWorkspace = lazy(() => import("./pages/ItemWorkspace"));
const Cybersecurity = lazy(() => import("./pages/Cybersecurity"));
const EquipmentView = lazy(() => import("./pages/EquipmentView"));
const FactoryModels = lazy(() => import("./pages/FactoryModels"));
const FactoryLayouts = lazy(() => import("./pages/FactoryLayouts"));
const DemoSandbox = lazy(() => import("./pages/DemoSandbox"));
const OnesaIntegration = lazy(() => import("./pages/OnesaIntegration"));
const Demonstration = lazy(() => import("./pages/Demonstration"));
const Home = lazy(() => import("./pages/Home"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const Monitoring = lazy(() => import("./pages/Monitoring"));
const NetworkDiagnostics = lazy(() => import("./pages/NetworkDiagnostics"));
const Devices = lazy(() => import("./pages/Devices"));
const DeviceDetail = lazy(() => import("./pages/DeviceDetail"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Notifications = lazy(() => import("./pages/Notifications"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const Assistant = lazy(() => import("./pages/Assistant"));
const ServiceHealth = lazy(() => import("./pages/ServiceHealth"));
const OTAUpdates = lazy(() => import("./pages/OTAUpdates"));
const Assets = lazy(() => import("./pages/Assets"));
const AssetAdministrationShell = lazy(
  () => import("./pages/AssetAdministrationShell"),
);
const Administration = lazy(() => import("./pages/Administration"));
const UserAccess = lazy(() => import("./pages/UserAccess"));
const ProductPassport = lazy(() => import("./pages/ProductPassport"));
const ChangePassword = lazy(() => import("./pages/ChangePassword"));

// Keep hash query context available to each workspace while matching the route path.
function useHashPath(): ReturnType<typeof useHashLocation> {
  const [location, navigate] = useHashLocation();
  return [location.split("?")[0], navigate];
}
useHashPath.hrefs = (href: string) => "#" + href;

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

function LegacyItem({
  kind,
  section,
}: {
  kind: "asset" | "device";
  section: string;
}) {
  const params = useParams<{ id: string }>();
  const [hash] = useHashLocation();
  const q = new URLSearchParams(hash.split("?")[1] ?? "");
  const nextSection = q.get("section") ?? section;
  q.delete("section");
  return (
    <Redirect
      to={`/inventory/${kind}:${params.id}/${nextSection}${q.size ? "?" + q : ""}`}
    />
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
            <Route
              path="/passport/published/:publicId"
              component={ProductPassport}
            />
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

  if (user.passwordChangeRequired)
    return (
      <Suspense fallback={<RouteLoading />}>
        <ChangePassword />
      </Suspense>
    );
  return (
    <WouterRouter hook={useHashPath}>
      <Suspense fallback={<RouteLoading />}>
        <Switch>
          {/* Keep the public passport in a standalone shell even when the
              viewer is signed in, so navigation never enters print output. */}
          <Route
            path="/passport/published/:publicId"
            component={ProductPassport}
          />
          <Route path="/passport/:id" component={ProductPassport} />
          <Route>
            <DashboardLayout>
              <Suspense fallback={<RouteLoading />}>
                <Switch>
                  <Route path="/account/password" component={ChangePassword} />
                  <Route path="/inventory" component={Inventory} />
                  <Route
                    path="/inventory/:ref/:section"
                    component={ItemWorkspace}
                  />
                  <Route path="/inventory/:ref" component={ItemWorkspace} />
                  <Route path="/" component={Home} />
                  <Route path="/demo" component={Demonstration} />
                  <Route path="/monitoring" component={Monitoring} />
                  <Route path="/network" component={NetworkDiagnostics} />
                  <Route path="/layouts" component={FactoryLayouts} />
                  <Route path="/sandbox" component={DemoSandbox} />
                  <Route path="/devices">
                    <Redirect to="/inventory?view=devices" />
                  </Route>
                  <Route path="/devices/:id">
                    <LegacyItem kind="device" section="overview" />
                  </Route>
                  <Route path="/cybersecurity" component={Cybersecurity} />
                  <Route path="/equipment">
                    <EquipmentView />
                  </Route>
                  <Route path="/models" component={FactoryModels} />
                  <Route path="/assets">
                    <Redirect to="/inventory?view=assets" />
                  </Route>
                  <Route path="/assets/:id/aas">
                    <LegacyItem kind="asset" section="aas" />
                  </Route>
                  <Route
                    path="/administration/:section"
                    component={Administration}
                  />
                  <Route path="/administration">
                    <Redirect to="/administration/integrations" />
                  </Route>
                  <Route path="/integrations/onesa">
                    <Redirect to="/administration/integrations" />
                  </Route>
                  <Route path="/users">
                    <Redirect to="/administration/users" />
                  </Route>
                  <Route path="/alerts" component={Alerts} />
                  <Route path="/alerts/:eventId" component={Alerts} />
                  <Route path="/notifications" component={Notifications} />
                  <Route path="/alert-history">
                    <Redirect to="/alerts" />
                  </Route>
                  <Route path="/analytics" component={AnalyticsPage} />
                  <Route path="/assistant" component={Assistant} />
                  <Route
                    path="/infrastructure/service-health/:section"
                    component={ServiceHealth}
                  />
                  <Route
                    path="/infrastructure/service-health"
                    component={ServiceHealth}
                  />
                  <Route path="/ota">
                    {user.access?.demoOnly || canViewEngineering(user.role) ? (
                      <OTAUpdates />
                    ) : (
                      <NotFound />
                    )}
                  </Route>
                  <Route path="/404" component={NotFound} />
                  <Route component={NotFound} />
                </Switch>
              </Suspense>
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
        <TooltipProvider>
          <Toaster />
          <AppRouter />
          {import.meta.env.PROD && <Analytics />}
        </TooltipProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
