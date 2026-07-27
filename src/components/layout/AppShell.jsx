import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Package, ReceiptText, Settings, LogOut } from 'lucide-react';
import { useAuth } from '@/api/auth';
import AssistantChat from '@/components/AssistantChat';
import BrandMark from '@/components/BrandMark';

const NAV = [
  { to: '/', label: 'Dashboard', icon: Package, end: true },
  { to: '/refunds', label: 'Refunds', icon: ReceiptText },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const nav = NAV;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <button onClick={() => navigate('/')} aria-label="iTrack home">
            <BrandMark markClass="w-8 h-8" textClass="text-lg" />
          </button>
          <nav className="flex items-center gap-1" aria-label="Main">
            {nav.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    isActive ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`
                }
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm text-muted-foreground truncate max-w-[140px] hidden md:block" title={user?.email}>
              {user?.full_name || user?.email}
            </span>
            <button
              onClick={logout}
              className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">
        <Outlet />
      </main>
      <AssistantChat />
    </div>
  );
}
