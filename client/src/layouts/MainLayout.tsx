import React from "react";
import Header from "../components/IFCDCHeader";

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  return (
    <>
      <Header />
      <main className="ifcdc-main">
        {children}
      </main>
    </>
  );
}
