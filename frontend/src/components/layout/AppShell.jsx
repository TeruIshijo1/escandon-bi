/**
 * AppShell.jsx — Layout principal con Sidebar + Navbar + Outlet
 */
import { Outlet } from 'react-router-dom';
import Sidebar    from './Sidebar';
import Navbar     from './Navbar';
import AIAssistant from '../ai/AIAssistant';
import { useAuth } from '../../context/AuthContext';
import { can, ROLES } from '../../utils/rbac';

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
      {showAI && <AIAssistant />}
    </div>
  );
}
