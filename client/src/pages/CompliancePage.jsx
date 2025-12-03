export default function CompliancePage() {
  return (
    <div data-testid="compliance-page" className="page">
      <h2>Compliance</h2>
      <p>Monitor compliance status and requirements.</p>
      
      <div className="card-list">
        <div className="card">
          <h3>📊 Compliance Dashboard</h3>
          <p>Overview of your compliance status</p>
        </div>
        
        <div className="card">
          <h3>⚠️ Pending Items</h3>
          <p>Actions required for compliance</p>
        </div>
        
        <div className="card">
          <h3>📜 Certifications</h3>
          <p>View and manage certifications</p>
        </div>
      </div>
    </div>
  );
}
