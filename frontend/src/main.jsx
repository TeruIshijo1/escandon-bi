/**
 * main.jsx — Punto de entrada de la aplicación React
 * Hospital Escandón BI Platform v3.5
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/globals.css'
import { ErrorBoundary } from './components/shared/ErrorBoundary.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
