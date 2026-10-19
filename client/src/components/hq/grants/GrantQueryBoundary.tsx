import React from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { HqLoading } from "../HqLoading";
import { HqDataUnavailable } from "../HqDataUnavailable";
import { grantCallFailure, grantCallFailureText } from "./grantCallFailure";

export const GrantQueryBoundary: React.FC<{
  query: Pick<UseQueryResult, "isLoading" | "isError" | "error" | "refetch" | "isFetched">;
  title?: string;
  message?: string;
  loadingMessage?: string;
  children: React.ReactNode;
}> = ({ query, title, message, loadingMessage, children }) => {
  if (query.isLoading) return <HqLoading message={loadingMessage} />;
  if (query.isError && query.isFetched) {
    const failure = grantCallFailure(query.error);
    return (
      <HqDataUnavailable
        title={failure.permission ? "Permission required" : (title ?? "Grant data unavailable")}
        message={failure.permission
          ? grantCallFailureText(query.error, "You do not have permission to view this panel.")
          : (message ?? "This section could not load live data from headquarters.")}
        detail={failure.permission ? undefined : (query.error as Error)?.message}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return <>{children}</>;
};
