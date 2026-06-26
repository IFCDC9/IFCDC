import React from "react";

interface IFCDCFormShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export default function IFCDCFormShell({ title, subtitle, children }: IFCDCFormShellProps) {
  return (
    <section className="ifcdc-form-shell">
      <div className="ifcdc-form-card">
        <div className="ifcdc-form-header">
          <img src="/ifcdc-logo.png" alt="IFCDC Logo" className="ifcdc-form-logo" />
          <div className="ifcdc-form-header-text">
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}
