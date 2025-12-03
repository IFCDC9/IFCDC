export default function FormsPage() {
  return (
    <div data-testid="forms-page" className="page">
      <h2>Forms</h2>
      <p>Access and complete required forms.</p>
      
      <div className="card-list">
        <div className="card">
          <h3>📝 Employee Forms</h3>
          <p>HR and employment related forms</p>
        </div>
        
        <div className="card">
          <h3>📋 Incident Reports</h3>
          <p>Report workplace incidents</p>
        </div>
        
        <div className="card">
          <h3>📄 Request Forms</h3>
          <p>Time off, equipment, and other requests</p>
        </div>
      </div>
    </div>
  );
}
