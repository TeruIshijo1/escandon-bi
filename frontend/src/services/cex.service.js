const API_BASE = '/api/cex';

const getHeaders = () => {
  const token = sessionStorage.getItem('escandon_token');
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
};

const handleResponse = async (res) => {
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Error en la petición');
  return json;
};

const cexService = {
  // Sincronización
  syncAgenda: async () => {
    const res = await fetch(`${API_BASE}/sync`, { method: 'POST', headers: getHeaders() });
    return handleResponse(res);
  },

  // Citas
  getAgenda: async (params = {}) => {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`${API_BASE}/agenda?${query}`, { headers: getHeaders() });
    return handleResponse(res);
  },
  
  createCita: async (citaData) => {
    const res = await fetch(`${API_BASE}/citas`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(citaData)
    });
    return handleResponse(res);
  },

  updateCitaEstado: async (id, estado) => {
    const res = await fetch(`${API_BASE}/citas/${id}/estado`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ Estado: estado })
    });
    return handleResponse(res);
  },

  updateNotas: async (id, notasData) => {
    const res = await fetch(`${API_BASE}/citas/${id}/notas`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(notasData)
    });
    return handleResponse(res);
  },

  // Pacientes
  searchPacientes: async (query) => {
    const res = await fetch(`${API_BASE}/pacientes?search=${encodeURIComponent(query)}`, { headers: getHeaders() });
    return handleResponse(res);
  },

  // Consultas
  registrarConsulta: async (consultaData) => {
    const res = await fetch(`${API_BASE}/consultas`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(consultaData)
    });
    return handleResponse(res);
  },

  // Reportes
  getReportes: async (params = {}) => {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`${API_BASE}/reportes?${query}`, { headers: getHeaders() });
    return handleResponse(res);
  }
};

export default cexService;
