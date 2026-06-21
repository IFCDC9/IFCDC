import { IFCDC_BRAND, getButtonClasses } from "@ifcdc/ui-components";

export default function App() {
  return (
    <div style={{ minHeight: "100vh", background: IFCDC_BRAND.colors.primary, color: "#fff", padding: "2rem" }}>
      <h1 style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>__APP_DISPLAY_NAME__</h1>
      <p style={{ color: "#ccc", marginBottom: "2rem" }}>Powered by {IFCDC_BRAND.fullName}</p>
      <button className={getButtonClasses("default", "lg")}>Get Started</button>
    </div>
  );
}
