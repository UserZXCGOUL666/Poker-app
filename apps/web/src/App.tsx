import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ErrorState, Loading } from './components/Loading';
import { useAuth } from './contexts/AuthContext';
import { AdminPage } from './pages/AdminPage';
import { GamesPage } from './pages/GamesPage';
import { HomePage } from './pages/HomePage';
import { ProfilePage } from './pages/ProfilePage';
import { PrivilegesPage } from './pages/PrivilegesPage';
import { RatingPage } from './pages/RatingPage';
import { BrowserLoginPage } from './pages/BrowserLoginPage';
import { TournamentTimerPage } from './pages/TournamentTimerPage';
import { api } from './lib/api';
import { applyAccentColor } from './lib/theme';

export default function App() {
  const { user, loading, error } = useAuth();
  const location = useLocation();
  useEffect(() => {
    void api<{ accentColor: string }>('/branding/theme').then((theme) => applyAccentColor(theme.accentColor)).catch(() => undefined);
  }, []);
  useEffect(() => {
    const telegram = window.Telegram?.WebApp;
    const root = document.documentElement;
    const syncInsets = () => {
      const platform = telegram?.platform ?? '';
      const reportedTop = Math.max(telegram?.contentSafeAreaInset?.top ?? 0, telegram?.safeAreaInset?.top ?? 0);
      const appleFallback = platform === 'ios' ? 54 : 0;
      root.style.setProperty('--telegram-content-top', `${Math.max(reportedTop, appleFallback)}px`);
      if (platform) root.dataset.telegramPlatform = platform;
      else delete root.dataset.telegramPlatform;
    };
    syncInsets();
    telegram?.onEvent?.('safeAreaChanged', syncInsets);
    telegram?.onEvent?.('contentSafeAreaChanged', syncInsets);
    telegram?.onEvent?.('viewportChanged', syncInsets);
    return () => {
      telegram?.offEvent?.('safeAreaChanged', syncInsets);
      telegram?.offEvent?.('contentSafeAreaChanged', syncInsets);
      telegram?.offEvent?.('viewportChanged', syncInsets);
    };
  }, []);
  const publicTimerRoute = /^\/timer\/[^/]+\/?$/.test(location.pathname);
  if (publicTimerRoute) return <Routes><Route path="timer/:tournamentId" element={<TournamentTimerPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>;
  if (loading) return <div className="app-shell"><Loading /></div>;
  if (!user && !window.Telegram?.WebApp?.initData) return <BrowserLoginPage />;
  if (error || !user) return <div className="app-shell"><ErrorState message={error ?? 'Откройте приложение из Telegram-бота'} /></div>;
  const launchView = location.pathname === '/' ? new URLSearchParams(location.search).get('view') : null;
  const launchPath = launchView && ({ games: '/games', profile: '/profile', rating: '/rating', privileges: '/privileges' } as Record<string, string>)[launchView];
  if (launchPath) return <Navigate to={launchPath} replace />;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="games" element={<GamesPage />} />
        <Route path="rating" element={<RatingPage />} />
        <Route path="privileges" element={<PrivilegesPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="admin" element={user.role === 'ADMIN' ? <AdminPage /> : <Navigate to="/" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
