/**
 * AppShell.jsx — Layout principal con Sidebar + Navbar + Outlet + Copiloto MAR-IA
 */
import { Outlet } from 'react-router-dom';
import Sidebar    from './Sidebar';
import Navbar     from './Navbar';
import AriaCopilotWidget from '../aria/AriaCopilotWidget';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../utils/rbac';
import { useState } from 'react';

export default function AppShell() {
  const { user } = useAuth();
  const showAI   = user && can(user.role, 'usarAsistenteIA');
  const [sidebarVisible, setSidebarVisible] = useState(true);

  return (
    <div
      className="app-shell"
      style={!sidebarVisible ? { '--sidebar-width': '0px', '--content-max': 'none' } : undefined}
    >
      {sidebarVisible && <Sidebar />}
      <Navbar
        onToggleSidebar={() => setSidebarVisible(v => !v)}
        isSidebarCollapsed={!sidebarVisible}
      />
      <main className="main-content">
        <Outlet />
      </main>
      {showAI && <AriaCopilotWidget />}
    </div>
  );
}
