import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/api/auth';
import { ToastProvider } from '@/lib/toast';
import AppShell from '@/components/layout/AppShell';
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
  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'anonymous') return <Login />;
  return <AppShell />;
}

export default function App() {
  return (
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
  );
}
