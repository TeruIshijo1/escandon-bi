/**
 * AppShell.jsx — Layout principal con Sidebar + Navbar + Outlet + Copiloto MAR-IA
 */
import { Outlet } from 'react-router-dom';
import Sidebar    from './Sidebar';
import Navbar     from './Navbar';
import AriaCopilotWidget from '../aria/AriaCopilotWidget';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../utils/rbac';

export default function AppShell() {
  const { user } = useAuth();
  const showAI   = user && can(user.role, 'usarAsistenteIA');

  return (
    <div className="app-shell">
      <Sidebar />
      <Navbar />
      <main className="main-content">
        <Outlet />
      </main>
      {showAI && <AriaCopilotWidget />}
    </div>
  );
}
