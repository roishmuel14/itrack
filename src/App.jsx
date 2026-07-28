import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/api/auth';
import { ToastProvider } from '@/lib/toast';
import AppShell from '@/components/layout/AppShell';
import ErrorBoundary from '@/components/ErrorBoundary';
import Landing from '@/pages/Landing';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import OrderDetail from '@/pages/OrderDetail';
import Onboarding from '@/pages/Onboarding';
import Refunds from '@/pages/Refunds';
import Settings from '@/pages/Settings';

function FullScreenSpinner() {
  return (
    <div className="min-h-screen grid place-items-center" aria-busy="true">
      <div className="w-8 h-8 border-2 border-muted border-t-primary rounded-full animate-spin" />
    </div>
  );
}

function Gate() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'anonymous') {
    // Password-reset emails land on "/" with a token in the query string;
    // those visitors need the auth screen, not marketing.
    const params = new URLSearchParams(location.search);
    const hasResetToken = params.has('reset_token') || params.has('token');
    if (location.pathname === '/' && !hasResetToken) return <Landing />;
    return <Login />;
  }
  return <AppShell />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Gate />}>
                <Route index element={<Dashboard />} />
                <Route path="orders/:id" element={<OrderDetail />} />
                <Route path="onboarding" element={<Onboarding />} />
                <Route path="refunds" element={<Refunds />} />
                <Route path="settings" element={<Settings />} />
                <Route path="login" element={<Navigate to="/" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
