import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', background: '#fee2e2', color: '#991b1b', height: '100vh' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold' }}>No se pudo mostrar esta página.</h1>
          <p>Vuelve a cargar la página. Si el problema continúa, contacta a soporte.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: '0.75rem 1rem', borderRadius: '8px', cursor: 'pointer' }}>
            Volver a cargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
