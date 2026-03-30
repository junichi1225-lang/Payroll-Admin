import { useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/Dashboard";
import LoginPage from "@/pages/LoginPage";
import PlaceholderPage from "@/pages/PlaceholderPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/payroll">
        {() => <PlaceholderPage title="給与管理 詳細" />}
      </Route>
      <Route path="/employees">
        {() => <PlaceholderPage title="社員管理" />}
      </Route>
      <Route path="/reports">
        {() => <PlaceholderPage title="レポート" />}
      </Route>
      <Route path="/settings">
        {() => <PlaceholderPage title="システム設定" />}
      </Route>
      <Route>
        {() => <PlaceholderPage title="404 - ページが見つかりません" />}
      </Route>
    </Switch>
  );
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {isLoggedIn ? (
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        ) : (
          <LoginPage onLogin={() => setIsLoggedIn(true)} />
        )}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
