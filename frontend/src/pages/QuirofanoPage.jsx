import React from 'react';
import { useLocation } from 'react-router-dom';
import SurgicalAgenda from '../components/pharmacy/SurgicalAgenda';
import SurgicalKits from '../components/pharmacy/SurgicalKits';
import DoctorVariations from '../components/pharmacy/DoctorVariations';
import AlmacenQuirofano from '../components/quirofano/AlmacenQuirofano';

export default function QuirofanoPage({ defaultTab }) {
  const location = useLocation();

  const getActiveTabFromPath = () => {
    const path = location.pathname;
    if (path.includes('/quirofano/kits')) return 'kits';
    if (path.includes('/quirofano/variaciones')) return 'variations';
    if (path.includes('/quirofano/almacen')) return 'almacen';
    if (path.includes('/quirofano/agenda')) return 'agenda';
    return defaultTab || 'agenda';
  };

  const activeTab = getActiveTabFromPath();

  return (
    <div style={{ padding: '2rem', maxWidth: 'var(--content-max, 1400px)', margin: '0 auto', fontFamily: 'Inter, sans-serif' }}>
      {/* Component Content directly without duplicate inner tab bar */}
      {activeTab === 'agenda' && <SurgicalAgenda />}
      {activeTab === 'kits' && <SurgicalKits />}
      {activeTab === 'variations' && <DoctorVariations />}
      {activeTab === 'almacen' && <AlmacenQuirofano />}
    </div>
  );
}
