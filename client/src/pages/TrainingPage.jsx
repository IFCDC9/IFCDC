export default function TrainingPage() {
  return (
    <div data-testid="training-page" className="page">
      <h2>Training</h2>
      <p>Complete required training modules and track your progress.</p>
      
      <div className="card-list">
        <div className="card">
          <h3>🎓 Required Training</h3>
          <p>Mandatory training courses for all staff</p>
        </div>
        
        <div className="card">
          <h3>📚 Professional Development</h3>
          <p>Optional courses for skill development</p>
        </div>
        
        <div className="card">
          <h3>✅ Completed Courses</h3>
          <p>View your training history</p>
        </div>
      </div>
    </div>
  );
}
