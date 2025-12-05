import React from "react";
import IFCDCHeader from "../components/IFCDCHeader";

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  return (
    <>
      <IFCDCHeader />
      <main className="ifcdc-main">
        {children}
      </main>
    </>
  );
}
