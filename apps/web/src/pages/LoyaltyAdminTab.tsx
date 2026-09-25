import {
  Award, Brain, CheckCircle2, Coins, Edit3, Gift, Lightbulb, Plus, RefreshCw, Save,
  Settings2, ShieldX, Sparkles, Users, X
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, post } from '../lib/api';
import { tournamentDate } from '../lib/format';

type LoyaltySettings = {
  dailyHandXp: number; referralInviterXp: number; referralInviteeXp: number; streakResetDays: number;
  referralEnabled: boolean; dailyHandEnabled: boolean; tipsEnabled: boolean;
};
type Tip = { id: string; title: string; body: string; category: string; sortOrder: number; isActive: boolean };
type HandOption = { id?: string; label: string; explanation: string; isCorrect: boolean; sortOrder: number };
type Hand = { id: string; title: string; scenario: string; heroCards: string[]; boardCards: string[]; difficulty: string; sortOrder: number; isActive: boolean; options: HandOption[]; _count: { attempts: number } };
type Achievement = { id: string; title: string; description: string; rule: string; threshold: number; xpReward: number; isActive: boolean; _count: { users: number } };
type Referral = { id: string; status: 'PENDING' | 'REWARDED' | 'REJECTED'; inviterXp: number; inviteeXp: number; createdAt: string; referrer: Person; invitedUser: Person };
type Person = { id: string; firstName: string; lastName: string | null; username: string | null; nickname?: string | null; clubXp?: number };
type XpTransaction = { id: string; amount: number; balanceAfter: number; reason: string; source: string; createdAt: string; user: Person; createdBy: Person | null };
type LoyaltyData = {
  settings: LoyaltySettings;
  summary: { players: number; totalClubXp: number; pendingReferrals: number; rewardedReferrals: number; attemptsToday: number; correctToday: number; unlockedAchievements: number };
  tips: Tip[]; hands: Hand[]; achievements: Achievement[]; recentReferrals: Referral[]; recentTransactions: XpTransaction[];
};
type AdminUser = Person & { clubXp: number };
type ContentTab = 'tips' | 'hands' | 'achievements' | 'referrals' | 'ledger';
type HandDraft = Omit<Hand, 'id' | '_count' | 'options'> & { id?: string; options: HandOption[]; attempts?: number };

const emptyHand: HandDraft = {
  title: '', scenario: '', heroCards: ['', ''], boardCards: [], difficulty: 'Начальный', sortOrder: 0, isActive: true,
  options: [
    { label: '', explanation: '', isCorrect: true, sortOrder: 10 },
    { label: '', explanation: '', isCorrect: false, sortOrder: 20 },
    { label: '', explanation: '', isCorrect: false, sortOrder: 30 }
  ]
};

export function LoyaltyAdminTab({ onDone }: { onDone: (message: string) => void }) {
  const [data, setData] = useState<LoyaltyData | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tab, setTab] = useState<ContentTab>('tips');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tipEditor, setTipEditor] = useState<Tip | 'new' | null>(null);
  const [handEditor, setHandEditor] = useState<HandDraft | null>(null);
  const [achievementEditor, setAchievementEditor] = useState<Achievement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [loyalty, players] = await Promise.all([api<LoyaltyData>('/admin/loyalty'), api<AdminUser[]>('/admin/users')]);
      setData(loyalty); setUsers(players);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить программу лояльности'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data) return;
    const form = new FormData(event.currentTarget); setSaving(true); setError(null);
    try {
      await post('/admin/loyalty/settings', {
        dailyHandXp: Number(form.get('dailyHandXp')), referralInviterXp: Number(form.get('referralInviterXp')),
        referralInviteeXp: Number(form.get('referralInviteeXp')), streakResetDays: Number(form.get('streakResetDays')),
        referralEnabled: form.get('referralEnabled') === 'on', dailyHandEnabled: form.get('dailyHandEnabled') === 'on', tipsEnabled: form.get('tipsEnabled') === 'on'
      }, 'PUT');
      onDone('Правила лояльности сохранены'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить настройки'); }
    finally { setSaving(false); }
  }

  async function saveTip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const editing = tipEditor !== 'new' ? tipEditor : null;
    setSaving(true); setError(null);
    try {
      await post(editing ? `/admin/loyalty/tips/${editing.id}` : '/admin/loyalty/tips', {
        title: form.get('title'), body: form.get('body'), category: form.get('category'),
        sortOrder: Number(form.get('sortOrder')), isActive: form.get('isActive') === 'on'
      }, editing ? 'PATCH' : 'POST');
      setTipEditor(null); onDone(editing ? 'Совет обновлён' : 'Совет создан'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить совет'); }
    finally { setSaving(false); }
  }

  async function toggleTip(tip: Tip) {
    try { await post(`/admin/loyalty/tips/${tip.id}`, { isActive: !tip.isActive }, 'PATCH'); onDone(tip.isActive ? 'Совет скрыт' : 'Совет включён'); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось изменить совет'); }
  }

  function editHand(hand?: Hand) {
    setError(null);
    setHandEditor(hand ? {
      id: hand.id, title: hand.title, scenario: hand.scenario, heroCards: [...hand.heroCards], boardCards: [...hand.boardCards],
      difficulty: hand.difficulty, sortOrder: hand.sortOrder, isActive: hand.isActive,
      options: hand.options.map(({ id: _id, ...option }) => option), attempts: hand._count.attempts
    } : structuredClone(emptyHand));
  }

  async function saveHand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!handEditor) return;
    setSaving(true); setError(null);
    try {
      const payload = {
        title: handEditor.title, scenario: handEditor.scenario, heroCards: handEditor.heroCards,
        boardCards: handEditor.boardCards.filter(Boolean), difficulty: handEditor.difficulty,
        sortOrder: handEditor.sortOrder, isActive: handEditor.isActive,
        ...(handEditor.attempts ? {} : { options: handEditor.options })
      };
      await post(handEditor.id ? `/admin/loyalty/hands/${handEditor.id}` : '/admin/loyalty/hands', payload, handEditor.id ? 'PATCH' : 'POST');
      setHandEditor(null); onDone(handEditor.id ? 'Раздача обновлена' : 'Раздача создана'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить раздачу'); }
    finally { setSaving(false); }
  }

  async function toggleHand(hand: Hand) {
    try { await post(`/admin/loyalty/hands/${hand.id}`, { isActive: !hand.isActive }, 'PATCH'); onDone(hand.isActive ? 'Раздача скрыта' : 'Раздача включена'); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось изменить раздачу'); }
  }

  async function saveAchievement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!achievementEditor) return; const form = new FormData(event.currentTarget);
    setSaving(true); setError(null);
    try {
      await post(`/admin/loyalty/achievements/${achievementEditor.id}`, {
        title: form.get('title'), description: form.get('description'), threshold: Number(form.get('threshold')),
        xpReward: Number(form.get('xpReward')), isActive: form.get('isActive') === 'on'
      }, 'PATCH');
      setAchievementEditor(null); onDone('Достижение обновлено'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить достижение'); }
    finally { setSaving(false); }
  }

  async function adjustXp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true); setError(null);
    try {
      await post('/admin/loyalty/club-xp', { userId: form.get('userId'), amount: Number(form.get('amount')), reason: form.get('reason') });
      event.currentTarget.reset(); onDone('Club XP обновлены'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось изменить Club XP'); }
    finally { setSaving(false); }
  }

  async function rejectReferral(referral: Referral) {
    if (!window.confirm('Отклонить это приглашение без начисления награды?')) return;
    try { await post(`/admin/loyalty/referrals/${referral.id}/reject`); onDone('Приглашение отклонено'); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось отклонить приглашение'); }
  }

  const successRate = data?.summary.attemptsToday ? Math.round(data.summary.correctToday / data.summary.attemptsToday * 100) : 0;
  if (!data) return <div className="admin-view"><div className="admin-heading"><span>УДЕРЖАНИЕ И БОНУСЫ</span><h1>Лояльность</h1><p>Загружаем настройки и контент…</p></div>{error && <div className="form-error">{error}</div>}</div>;
  return <div className="admin-view loyalty-admin">
    <div className="admin-heading-row"><div className="admin-heading"><span>УДЕРЖАНИЕ И БОНУСЫ</span><h1>Лояльность</h1><p>Club XP, ежедневный контент, достижения и приглашённые игроки</p></div><div className="admin-heading-actions"><button className="button secondary" onClick={() => void load()}><RefreshCw />Обновить</button></div></div>
    {error && <div className="form-error settings-error">{error}</div>}
    <div className="loyalty-admin-stats">
      <Metric icon={<Coins />} label="Club XP у игроков" value={data.summary.totalClubXp.toLocaleString('ru-RU')} />
      <Metric icon={<Users />} label="Успешные приглашения" value={String(data.summary.rewardedReferrals)} note={`${data.summary.pendingReferrals} ожидают`} />
      <Metric icon={<Brain />} label="Ответили сегодня" value={String(data.summary.attemptsToday)} note={`${successRate}% верно`} />
      <Metric icon={<Award />} label="Открыто достижений" value={String(data.summary.unlockedAchievements)} />
    </div>

    <form className="loyalty-settings-card" onSubmit={saveSettings}>
      <header><span><Settings2 /></span><div><h2>Правила начислений</h2><p>Меняются без деплоя. Rating PTS эти настройки не затрагивают.</p></div><button className="button primary" disabled={saving}><Save />Сохранить</button></header>
      <div className="loyalty-settings-grid">
        <label>Правильная раздача<input name="dailyHandXp" type="number" min="0" max="10000" defaultValue={data.settings.dailyHandXp} /><small>Club XP</small></label>
        <label>Пригласившему<input name="referralInviterXp" type="number" min="0" max="100000" defaultValue={data.settings.referralInviterXp} /><small>после визита</small></label>
        <label>Новому игроку<input name="referralInviteeXp" type="number" min="0" max="100000" defaultValue={data.settings.referralInviteeXp} /><small>после визита</small></label>
        <label>Сброс серии<input name="streakResetDays" type="number" min="1" max="365" defaultValue={data.settings.streakResetDays} /><small>дней перерыва</small></label>
      </div>
      <div className="loyalty-switches"><label><input type="checkbox" name="tipsEnabled" defaultChecked={data.settings.tipsEnabled} />Советы дня</label><label><input type="checkbox" name="dailyHandEnabled" defaultChecked={data.settings.dailyHandEnabled} />Раздача дня</label><label><input type="checkbox" name="referralEnabled" defaultChecked={data.settings.referralEnabled} />Реферальная программа</label></div>
    </form>

    <nav className="loyalty-admin-tabs">{([
      ['tips', 'Советы', Lightbulb], ['hands', 'Раздачи', Brain], ['achievements', 'Достижения', Award],
      ['referrals', 'Рефералы', Users], ['ledger', 'Club XP', Coins]
    ] as const).map(([id, label, Icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon />{label}</button>)}</nav>

    {tab === 'tips' && <section className="loyalty-content-section"><SectionHead title="Советы дня" text={`${data.tips.filter((item) => item.isActive).length} активных советов`} action={<button className="button primary" onClick={() => setTipEditor('new')}><Plus />Добавить</button>} /><div className="loyalty-content-list">{data.tips.map((tip) => <article className={!tip.isActive ? 'inactive' : ''} key={tip.id}><span><Lightbulb /></span><div><small>{tip.category}</small><strong>{tip.title}</strong><p>{tip.body}</p></div><div><button onClick={() => setTipEditor(tip)}><Edit3 /></button><button onClick={() => void toggleTip(tip)}>{tip.isActive ? 'Скрыть' : 'Включить'}</button></div></article>)}</div></section>}

    {tab === 'hands' && <section className="loyalty-content-section"><SectionHead title="Раздачи дня" text={`${data.hands.filter((item) => item.isActive).length} активных сценариев`} action={<button className="button primary" onClick={() => editHand()}><Plus />Добавить</button>} /><div className="loyalty-content-list hand-admin-list">{data.hands.map((hand) => <article className={!hand.isActive ? 'inactive' : ''} key={hand.id}><span><Brain /></span><div><small>{hand.difficulty} · ответов: {hand._count.attempts}</small><strong>{hand.title}</strong><p>{hand.scenario}</p><em>{hand.heroCards.join(' ')} {hand.boardCards.length ? `· ${hand.boardCards.join(' ')}` : ''}</em></div><div><button onClick={() => editHand(hand)}><Edit3 /></button><button onClick={() => void toggleHand(hand)}>{hand.isActive ? 'Скрыть' : 'Включить'}</button></div></article>)}</div></section>}

    {tab === 'achievements' && <section className="loyalty-content-section"><SectionHead title="Достижения" text="Автоматически проверяются после активности игрока" /><div className="achievement-admin-grid">{data.achievements.map((achievement) => <article className={!achievement.isActive ? 'inactive' : ''} key={achievement.id}><span><Gift /></span><div><small>{achievement.rule} · порог {achievement.threshold}</small><strong>{achievement.title}</strong><p>{achievement.description}</p><em>+{achievement.xpReward} XP · открыли {achievement._count.users}</em></div><button onClick={() => setAchievementEditor(achievement)}><Edit3 /></button></article>)}</div></section>}

    {tab === 'referrals' && <section className="loyalty-content-section"><SectionHead title="Реферальные приглашения" text="Награда появляется только после первого подтверждённого посещения" /><div className="referral-admin-list">{data.recentReferrals.map((referral) => <article key={referral.id}><span className={referral.status.toLowerCase()}>{referral.status === 'REWARDED' ? <CheckCircle2 /> : referral.status === 'REJECTED' ? <ShieldX /> : '…'}</span><div><strong>{personName(referral.referrer)} → {personName(referral.invitedUser)}</strong><small>{tournamentDate(referral.createdAt).full}</small></div><em>{referral.status === 'REWARDED' ? `+${referral.inviterXp} / +${referral.inviteeXp} XP` : referral.status === 'PENDING' ? 'Ожидает визита' : 'Отклонено'}</em>{referral.status === 'PENDING' && <button onClick={() => void rejectReferral(referral)}><X />Отклонить</button>}</article>)}{!data.recentReferrals.length && <p className="empty-inline">Приглашений пока нет</p>}</div></section>}

    {tab === 'ledger' && <section className="loyalty-content-section"><SectionHead title="Журнал Club XP" text="Отдельный от турнирного рейтинга неизменяемый баланс" /><form className="xp-adjust-form" onSubmit={adjustXp}><label>Игрок<select name="userId" required defaultValue=""><option value="" disabled>Выберите игрока</option>{users.map((user) => <option key={user.id} value={user.id}>{personName(user)} · {user.clubXp ?? 0} XP</option>)}</select></label><label>Изменение<input name="amount" type="number" min="-100000" max="100000" required placeholder="+50 или -20" /></label><label>Причина<input name="reason" minLength={3} maxLength={300} required placeholder="Бонус клуба" /></label><button className="button primary" disabled={saving}><Sparkles />Применить</button></form><div className="xp-admin-ledger">{data.recentTransactions.map((entry) => <article key={entry.id}><span className={entry.amount > 0 ? 'positive' : 'negative'}>{entry.amount > 0 ? '+' : ''}{entry.amount}</span><div><strong>{personName(entry.user)}</strong><small>{entry.reason} · {tournamentDate(entry.createdAt).full}</small></div><em>{entry.balanceAfter} XP</em></article>)}</div></section>}

    {tipEditor && <EditorModal title={tipEditor === 'new' ? 'Новый совет' : 'Редактировать совет'} onClose={() => setTipEditor(null)}><form className="admin-form" onSubmit={saveTip}><label>Заголовок<input name="title" minLength={3} maxLength={100} required defaultValue={tipEditor === 'new' ? '' : tipEditor.title} /></label><label>Текст<textarea name="body" rows={6} minLength={20} maxLength={2000} required defaultValue={tipEditor === 'new' ? '' : tipEditor.body} /></label><div className="form-row"><label>Категория<input name="category" required defaultValue={tipEditor === 'new' ? 'Стратегия' : tipEditor.category} /></label><label>Порядок<input name="sortOrder" type="number" min="0" defaultValue={tipEditor === 'new' ? data.tips.length * 10 + 10 : tipEditor.sortOrder} /></label></div><label className="checkbox"><input name="isActive" type="checkbox" defaultChecked={tipEditor === 'new' || tipEditor.isActive} />Показывать игрокам</label><button className="button primary wide" disabled={saving}><Save />Сохранить</button></form></EditorModal>}

    {handEditor && <EditorModal title={handEditor.id ? 'Редактировать раздачу' : 'Новая раздача'} onClose={() => setHandEditor(null)}><form className="admin-form hand-editor-form" onSubmit={saveHand}><label>Название<input required minLength={3} value={handEditor.title} onChange={(event) => setHandEditor({ ...handEditor, title: event.target.value })} /></label><label>Сценарий<textarea rows={6} required minLength={20} value={handEditor.scenario} onChange={(event) => setHandEditor({ ...handEditor, scenario: event.target.value })} /></label><div className="form-row"><label>Карты игрока<input required placeholder="A♠ K♠" value={handEditor.heroCards.join(' ')} onChange={(event) => setHandEditor({ ...handEditor, heroCards: event.target.value.trimStart().split(/\s+/).slice(0, 2) })} /></label><label>Карты доски<input placeholder="Q♠ J♦ 2♣" value={handEditor.boardCards.join(' ')} onChange={(event) => setHandEditor({ ...handEditor, boardCards: event.target.value.trimStart().split(/\s+/).filter(Boolean).slice(0, 5) })} /></label></div><div className="form-row"><label>Сложность<input required value={handEditor.difficulty} onChange={(event) => setHandEditor({ ...handEditor, difficulty: event.target.value })} /></label><label>Порядок<input type="number" min="0" value={handEditor.sortOrder} onChange={(event) => setHandEditor({ ...handEditor, sortOrder: Number(event.target.value) })} /></label></div>{handEditor.attempts ? <div className="destructive-note"><Brain /><span>У раздачи уже есть ответы. Варианты заблокированы, чтобы история оставалась корректной.</span></div> : <div className="hand-option-editor"><strong>Варианты ответа</strong>{handEditor.options.map((option, index) => <div key={index}><input type="radio" name="correctOption" checked={option.isCorrect} onChange={() => setHandEditor({ ...handEditor, options: handEditor.options.map((item, itemIndex) => ({ ...item, isCorrect: itemIndex === index })) })} aria-label="Правильный ответ" /><input required minLength={2} placeholder={`Вариант ${index + 1}`} value={option.label} onChange={(event) => setHandEditor({ ...handEditor, options: handEditor.options.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) })} /><textarea required minLength={10} rows={2} placeholder="Почему это решение верное или ошибочное" value={option.explanation} onChange={(event) => setHandEditor({ ...handEditor, options: handEditor.options.map((item, itemIndex) => itemIndex === index ? { ...item, explanation: event.target.value } : item) })} /></div>)}</div>}<label className="checkbox"><input type="checkbox" checked={handEditor.isActive} onChange={(event) => setHandEditor({ ...handEditor, isActive: event.target.checked })} />Показывать игрокам</label><button className="button primary wide" disabled={saving}><Save />Сохранить раздачу</button></form></EditorModal>}

    {achievementEditor && <EditorModal title="Редактировать достижение" onClose={() => setAchievementEditor(null)}><form className="admin-form" onSubmit={saveAchievement}><label>Название<input name="title" required minLength={2} defaultValue={achievementEditor.title} /></label><label>Описание<textarea name="description" required minLength={5} rows={4} defaultValue={achievementEditor.description} /></label><div className="form-row"><label>Порог<input name="threshold" type="number" min="1" required defaultValue={achievementEditor.threshold} /></label><label>Награда Club XP<input name="xpReward" type="number" min="0" required defaultValue={achievementEditor.xpReward} /></label></div><label className="checkbox"><input name="isActive" type="checkbox" defaultChecked={achievementEditor.isActive} />Достижение активно</label><button className="button primary wide" disabled={saving}><Save />Сохранить</button></form></EditorModal>}
  </div>;
}

function Metric({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note?: string }) {
  return <article><span>{icon}</span><div><small>{label}</small><strong>{value}</strong>{note && <em>{note}</em>}</div></article>;
}

function SectionHead({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="admin-section-title"><div><h2>{title}</h2><p>{text}</p></div>{action}</div>;
}

function EditorModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button onClick={onClose}><X /></button></div>{children}</div></div>;
}

function personName(person: Person) { return person.nickname || (person.username ? `@${person.username}` : `${person.firstName} ${person.lastName ?? ''}`.trim()); }
