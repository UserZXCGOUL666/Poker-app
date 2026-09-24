import { BarChart3, CalendarDays, Gift, Home, ShieldCheck, UserRound } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Avatar } from './Avatar';
import { TrainingLeadPopup } from './TrainingLeadPopup';

const navItems = [
  { to: '/', label: 'Главная', icon: Home },
  { to: '/games', label: 'Турниры', icon: CalendarDays },
  { to: '/rating', label: 'Рейтинг', icon: BarChart3 },
  { to: '/privileges', label: 'Привилегии', icon: Gift },
  { to: '/profile', label: 'Профиль', icon: UserRound }
];

export function AppShell() {
  const { user } = useAuth();
  const location = useLocation();
  const adminMode = location.pathname.startsWith('/admin');
  const gamesMode = location.pathname.startsWith('/games');

  if (adminMode) return <Outlet />;
  return (
    <div className={`app-shell hud-v2-shell ${gamesMode ? 'app-shell-games' : ''}`}>
      <div className="hud-system-rail" aria-hidden="true">
        <span><i /> CLUB SYSTEM</span>
        <b>LIVE</b>
        <span>V1.21 / PERFORMANCE UI</span>
      </div>
      <header className="brand-header hud-v2-header">
        <div className="brand-mark hud-v2-brand-mark" aria-hidden="true">PL</div>
        <div className="brand-copy"><strong>POKER CLUB</strong><span>SPORTS LEAGUE / CONTROL SYSTEM</span></div>
        <div className="hud-header-status"><i /> ONLINE</div>
        <div className="header-actions">
          {user?.role === 'ADMIN' && <NavLink className="admin-shortcut" to="/admin" aria-label="Админка"><ShieldCheck size={18} /></NavLink>}
          {user && <NavLink className="header-profile-link" to="/profile" aria-label="Открыть профиль"><Avatar firstName={user.firstName} lastName={user.lastName} photoUrl={user.photoUrl} /></NavLink>}
        </div>
      </header>
      <main className="app-content"><Outlet /></main>
      <TrainingLeadPopup />
      <nav className="bottom-nav hud-v2-nav">
        {navItems.map(({ to, label, icon: Icon }, index) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'active' : ''}>
            <small>0{index + 1}</small><Icon size={20} strokeWidth={1.8} /><span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
