import React, { useState, useEffect } from 'react';
import { API_BASE } from '../../api/config';
import PremiumLoader from '../shared/PremiumLoader';
import DashboardMapaGeografico from './DashboardMapaGeografico';

export default function DashboardSitiMapa() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem('escandon_token');
    const headers = { Authorization: `Bearer ${token}` };

    fetch(`${API_BASE}/siti/demografia`, { headers })
      .then(res => res.json())
      .then(res => {
        if(res.success) {
          setData(res);
        }
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PremiumLoader message="Cargando mapa demográfico SITI..." />;
  if (!data) return <div className="p-8 text-center text-red-500">Error al cargar datos geográficos.</div>;

  return (
    <DashboardMapaGeografico 
      estados={data.estados} 
      ciudades={data.ciudades} 
      title="Demografía Geográfica Histórica (SITI)"
      targetId="dashboard-siti-mapa"
    />
  );
}
