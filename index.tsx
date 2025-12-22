
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';

// Safety shim for process.env in browser ESM
// Only define if it doesn't exist to avoid overwriting injected values
if (typeof (window as any).process === 'undefined') {
  (window as any).process = { env: {} };
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.error("Root element not found");
}
