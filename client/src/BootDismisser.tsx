import React, { useLayoutEffect } from "react";
import { markAppMounted } from "./boot";

/** Remove the HTML boot splash after React paints the first route (avoids blank flash) */
export const BootDismisser: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useLayoutEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => markAppMounted());
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return <>{children}</>;
};
