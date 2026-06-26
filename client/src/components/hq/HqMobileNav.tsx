import React from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, BarChart3, Bell, Sparkles, Users, Wallet } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";

const MOBILE_NAV = [
  { path: "/hq", icon: LayoutDashboard, label: "Home" },
  { path: "/hq/analytics", icon: BarChart3, label: "Analytics" },
  { path: "/hq/finance", icon: Wallet, label: "Finance" },
  { path: "/hq/people", icon: Users, label: "People" },
  { path: "/hq/aura", icon: Sparkles, label: "AURA" },
  { path: "/hq/notifications", icon: Bell, label: "Alerts" },
];

export const HqMobileNav: React.FC = () => {
  const location = useLocation();
  const { user, canAccessRoute } = useAuth();

  const isActive = (path: string) => {
    if (path === "/hq") return location.pathname === "/hq";
    return location.pathname.startsWith(path);
  };

  const visible = MOBILE_NAV.filter((item) => user && canAccessRoute(item.path));

  return (
    <nav className="hq-mobile-nav" aria-label="Mobile navigation">
      {visible.map((item) => {
        const Icon = item.icon;
        return (
          <Link key={item.path} to={item.path} className={`hq-mobile-nav-item ${isActive(item.path) ? "active" : ""}`}>
            <Icon size={20} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};
