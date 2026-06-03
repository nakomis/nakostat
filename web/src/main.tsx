import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from 'react-oidc-context';
import { oidcConfig } from '@/lib/auth';
import { router } from '@/router';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <AuthProvider {...oidcConfig}>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
