import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function Layout({ children }) {
  return (
    <div className="layout">
      <Sidebar />
      <div className="main-area">
        <Topbar />
        <main className="content">
          {children}
        </main>
      </div>
    </div>
  );
}
