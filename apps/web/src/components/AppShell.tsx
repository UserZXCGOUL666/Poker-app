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
    <div className={`app-shell ${gamesMode ? 'app-shell-games' : ''}`}>
      <header className="brand-header">
        <div className="brand-mark" aria-hidden="true">♠</div>
        <div className="brand-copy"><strong>POKER CLUB</strong><span>SPORTS LEAGUE · LIVE SYSTEM</span></div>
        <div className="header-actions">
          {user?.role === 'ADMIN' && <NavLink className="admin-shortcut" to="/admin" aria-label="Админка"><ShieldCheck size={19} /></NavLink>}
          {user && <NavLink className="header-profile-link" to="/profile" aria-label="Открыть профиль"><Avatar firstName={user.firstName} lastName={user.lastName} photoUrl={user.photoUrl} /></NavLink>}
        </div>
      </header>
      <main className="app-content"><Outlet /></main>
      <TrainingLeadPopup />
      <nav className="bottom-nav">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'active' : ''}>
            <Icon size={22} strokeWidth={1.9} /><span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
