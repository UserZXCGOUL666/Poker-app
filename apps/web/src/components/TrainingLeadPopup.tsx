import { CheckCircle2, GraduationCap, Phone, Send, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api, post } from '../lib/api';

type TrainingLeadConfig = {
  enabled: boolean;
  configured: boolean;
  submitted: boolean;
  submittedAt: string | null;
};

const DISMISSED_KEY = 'poker-training-lead-dismissed';

export function TrainingLeadPopup() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || user.role === 'ADMIN' || sessionStorage.getItem(DISMISSED_KEY) === '1') return;
    let active = true;
    void api<TrainingLeadConfig>('/training-lead/config')
      .then((config) => {
        if (!active) return;
        setSubmitted(config.submitted);
        setVisible(config.enabled && config.configured && !config.submitted);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [user]);

  if (!user || user.role === 'ADMIN' || !visible) return null;

  const close = () => {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      await post('/training-leads', {
        fullName: String(form.get('fullName') ?? ''),
        phoneNumber: String(form.get('phoneNumber') ?? ''),
        preferredContactAt: String(form.get('preferredContactAt') ?? ''),
        preferredVisitAt: String(form.get('preferredVisitAt') ?? '')
      });
      setSubmitted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось отправить заявку');
    } finally {
      setSaving(false);
    }
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return (
    <aside className="training-lead-popup" aria-label="Запись на бесплатное обучение по покеру">
      <button className="training-lead-close" type="button" onClick={close} aria-label="Закрыть"><X /></button>
      {submitted ? (
        <div className="training-lead-success">
          <span><CheckCircle2 /></span>
          <strong>Заявка отправлена</strong>
          <p>Свяжемся с вами и подберём удобное время для бесплатного обучения.</p>
          <button className="button secondary wide" type="button" onClick={close}>Закрыть</button>
        </div>
      ) : (
        <>
          <header className="training-lead-header">
            <span><GraduationCap /></span>
            <div><small>БЕСПЛАТНО</small><h3>Научим играть в покер</h3><p>Оставьте контакты — договоримся о коротком обучении.</p></div>
          </header>
          <form className="training-lead-form" onSubmit={submit}>
            <label>ФИО<input name="fullName" required minLength={3} maxLength={120} defaultValue={fullName} autoComplete="name" placeholder="Иван Иванов" /></label>
            <label>Номер телефона<div className="training-phone-field"><Phone /><input name="phoneNumber" required minLength={6} maxLength={40} inputMode="tel" autoComplete="tel" placeholder="+7 999 000-00-00" /></div></label>
            <label>Когда удобно связаться?<input name="preferredContactAt" required minLength={2} maxLength={160} placeholder="Сегодня после 19:00" /></label>
            <label>Когда удобно прийти?<input name="preferredVisitAt" required minLength={2} maxLength={160} placeholder="В субботу вечером" /></label>
            {error && <div className="training-lead-error">{error}</div>}
            <button className="button primary wide training-lead-submit" disabled={saving}><Send />{saving ? 'Отправляем…' : 'Записаться на обучение'}</button>
          </form>
        </>
      )}
    </aside>
  );
}
