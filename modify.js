const fs = require('fs');
let content = fs.readFileSync('frontend/src/App.jsx', 'utf8');
content = content.replace(
  '<Route path="almacen/traslados" element={<ProtectedRoute><TrasladosAlmacen /></ProtectedRoute>} />',
  '<Route path="almacen/traslados" element={<ProtectedRoute><TrasladosAlmacen /></ProtectedRoute>} />\n          <Route path="almacen/reportes" element={<ProtectedRoute><ReportesAlmacen /></ProtectedRoute>} />'
);
fs.writeFileSync('frontend/src/App.jsx', content);
