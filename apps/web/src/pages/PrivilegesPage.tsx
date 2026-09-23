import { ChevronRight, Coins, Crown, Gift, ShoppingBag, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export function PrivilegesPage() {
  const { user } = useAuth();
  return <div className="page privileges-page">
    <div className="page-heading"><span className="eyebrow">POKER CLUB</span><h1>Клубные привилегии</h1><p>Бонусы участников и фирменные награды</p></div>
    <section className="privileges-balance">
      <span><Coins /></span>
      <div><small>ВАШ БАЛАНС</small><strong>{(user?.clubXp ?? 0).toLocaleString('ru-RU')} Club XP</strong></div>
      <Sparkles />
    </section>
    <section className="privileges-menu card">
      <button><span><Crown /></span><div><strong>Привилегии</strong><small>Особые возможности для участников клуба</small></div><ChevronRight /></button>
      <button><span><ShoppingBag /></span><div><strong>Мерч за баллы</strong><small>Обменивайте Club XP на фирменные вещи</small></div><ChevronRight /></button>
      <div className="privileges-coming-soon"><Gift /><strong>В разработке</strong><span>Скоро</span></div>
    </section>
  </div>;
}
