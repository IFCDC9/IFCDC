import React, { Suspense } from "react";
import HQLayout from "../../layouts/HQLayout";
import { HqErrorBoundary } from "./HqErrorBoundary";
import { HqAuthGate } from "./HqAuthGate";
import { HqLoading } from "./HqLoading";

interface HqShellRouteProps {
  path: string;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}

/** HQ chrome always renders; auth + dashboard errors stay in the content pane */
export const HqShellRoute: React.FC<HqShellRouteProps> = ({
  path,
  title = "IFCDC Headquarters",
  subtitle = "Enterprise Operating System",
  children,
}) => (
  <HQLayout title={title} subtitle={subtitle}>
    <HqAuthGate path={path}>
      <HqErrorBoundary>
        <Suspense fallback={<HqLoading message="Loading dashboard…" />}>
          {children}
        </Suspense>
      </HqErrorBoundary>
    </HqAuthGate>
  </HQLayout>
);
