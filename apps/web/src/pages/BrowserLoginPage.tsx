import { KeyRound, LockKeyhole, Mail, Send, ShieldCheck, UserPlus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';

type EntryMethod = 'email' | 'telegram';
type EmailMode = 'login' | 'register';

export function BrowserLoginPage() {
  const { error: sessionError, loginWithBrowserCode, loginWithEmail, registerWithEmail } = useAuth();
  const [entryMethod, setEntryMethod] = useState<EntryMethod>('email');
  const [emailMode, setEmailMode] = useState<EmailMode>('login');
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [botUrl, setBotUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ botUrl: string | null }>('/auth/browser/config').then((config) => setBotUrl(config.botUrl)).catch(() => undefined);
  }, []);

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    try { await loginWithBrowserCode(code); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось войти по коду'); }
    finally { setSaving(false); }
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      if (emailMode === 'register') await registerWithEmail(firstName, email, password);
      else await loginWithEmail(email, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : emailMode === 'register' ? 'Не удалось зарегистрироваться' : 'Не удалось войти');
    } finally {
      setSaving(false);
    }
  }

  const normalizedCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const shownError = error ?? sessionError;

  return <main className="browser-login-shell">
    <section className="browser-login-card">
      <header><span>{entryMethod === 'email' ? <Mail /> : <KeyRound />}</span><div><small>POKER CLUB</small><h1>Вход в браузере</h1><p>Зарегистрируйтесь по почте или подтвердите существующий Telegram-профиль.</p></div></header>
      <nav className="browser-login-methods">
        <button className={entryMethod === 'email' ? 'active' : ''} onClick={() => { setEntryMethod('email'); setError(null); }}><Mail />Почта</button>
        <button className={entryMethod === 'telegram' ? 'active' : ''} onClick={() => { setEntryMethod('telegram'); setError(null); }}><Send />Telegram</button>
      </nav>

      {entryMethod === 'email' ? <>
        <div className="browser-email-modes">
          <button className={emailMode === 'login' ? 'active' : ''} onClick={() => { setEmailMode('login'); setError(null); }}>Войти</button>
          <button className={emailMode === 'register' ? 'active' : ''} onClick={() => { setEmailMode('register'); setError(null); }}>Регистрация</button>
        </div>
        <form onSubmit={submitEmail} className="browser-email-form">
          {emailMode === 'register' && <label>Имя или клубный никнейм<input autoFocus autoComplete="name" value={firstName} onChange={(event) => setFirstName(event.target.value)} minLength={2} maxLength={50} placeholder="Например, RiverFox" /></label>}
          <label>Электронная почта<input autoFocus={emailMode === 'login'} autoComplete="email" inputMode="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="player@example.com" /></label>
          <label>Пароль<input autoComplete={emailMode === 'register' ? 'new-password' : 'current-password'} type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={emailMode === 'register' ? 8 : 1} maxLength={128} placeholder={emailMode === 'register' ? 'Минимум 8 символов' : 'Ваш пароль'} /></label>
          {shownError && <div className="form-error">{shownError}</div>}
          <button className="button primary wide" disabled={saving || !email || password.length < (emailMode === 'register' ? 8 : 1) || (emailMode === 'register' && firstName.trim().length < 2)}>
            {emailMode === 'register' ? <UserPlus /> : <LockKeyhole />}{saving ? 'Подождите…' : emailMode === 'register' ? 'Создать аккаунт' : 'Войти'}
          </button>
        </form>
        <footer><ShieldCheck />Аккаунты, созданные по почте, получают только права игрока. Админ-панель им недоступна.</footer>
      </> : <>
        <ol><li><span>1</span><div><strong>Откройте Telegram-бота</strong><small>Нажмите кнопку ниже или отправьте боту команду <code>/login</code>.</small></div></li><li><span>2</span><div><strong>Получите одноразовый код</strong><small>Он действует 10 минут и срабатывает только один раз.</small></div></li><li><span>3</span><div><strong>Введите код здесь</strong><small>Вы войдёте в тот же профиль, которым пользуетесь в Telegram.</small></div></li></ol>
        {botUrl && <a className="browser-login-bot" href={botUrl} target="_blank" rel="noreferrer"><Send />Открыть Telegram-бота</a>}
        <form onSubmit={submitCode}><label>Код из Telegram<input autoFocus autoComplete="one-time-code" inputMode="text" value={normalizedCode} onChange={(event) => setCode(event.target.value)} placeholder="ABCD-EFGH" /></label>{shownError && <div className="form-error">{shownError}</div>}<button className="button primary wide" disabled={saving || normalizedCode.length !== 8}><ShieldCheck />{saving ? 'Проверяем…' : 'Войти'}</button></form>
        <footer><ShieldCheck />Одноразовый код хранится только в виде хеша и уничтожается после использования.</footer>
      </>}
    </section>
  </main>;
}
