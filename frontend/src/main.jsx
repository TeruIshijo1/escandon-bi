/**
 * main.jsx — Punto de entrada de la aplicación React
 * Hospital Escandón BI Platform v3.5
 */
import { StrictMode } from 'react';
import { createRoot }  from 'react-dom/client';
import App             from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
