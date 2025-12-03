import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth";
import Dashboard from "@/pages/dashboard";
import ChaptersPage from "@/pages/chapters";
import FormsPage from "@/pages/forms";

function Router() {
  return (
    <Switch>
      <Route path="/login" component={AuthPage} />
      <Route path="/" component={Dashboard} />
      <Route path="/chapters" component={ChaptersPage} />
      <Route path="/forms" component={FormsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
