/// <reference types="vite/client" />

interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  platform?: string;
  safeAreaInset?: { top: number; right: number; bottom: number; left: number };
  contentSafeAreaInset?: { top: number; right: number; bottom: number; left: number };
  ready(): void;
  expand(): void;
  close(): void;
  onEvent?(event: 'safeAreaChanged' | 'contentSafeAreaChanged' | 'viewportChanged', callback: () => void): void;
  offEvent?(event: 'safeAreaChanged' | 'contentSafeAreaChanged' | 'viewportChanged', callback: () => void): void;
  openTelegramLink?(url: string): void;
  requestContact?(callback?: (shared: boolean) => void): void;
  HapticFeedback?: { impactOccurred(style: 'light' | 'medium' | 'heavy'): void };
}

interface Window {
  Telegram?: { WebApp: TelegramWebApp };
}
