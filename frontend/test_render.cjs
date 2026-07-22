const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const DashboardMapaGeografico = require('./src/components/dashboard/DashboardMapaGeografico.jsx').default;

try {
  const html = renderToStaticMarkup(
    React.createElement(DashboardMapaGeografico, {
      estados: [],
      ciudades: [],
      title: "Test",
      subtitle: "Test",
      source: "TEST"
    })
  );
  console.log("Rendered successfully!", html.length);
} catch (e) {
  console.error("Render failed:", e);
}
