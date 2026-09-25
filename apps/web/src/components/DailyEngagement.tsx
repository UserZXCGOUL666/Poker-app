import { Brain, CheckCircle2, ChevronDown, Coins, Lightbulb, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, post } from '../lib/api';
import type { DailyContent } from '../types';

function PlayingCard({ value }: { value: string }) {
  const red = value.includes('♥') || value.includes('♦');
  return <span className={`playing-card ${red ? 'red' : ''}`}>{value}</span>;
}

function cachedTipId() {
  try {
    const cached = JSON.parse(localStorage.getItem('poker-club-daily-tip') ?? 'null') as { id?: string } | null;
    return cached?.id;
  } catch {
    return undefined;
  }
}

function countdown(target: string, now: number) {
  const remaining = Math.max(0, new Date(target).getTime() - now);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function DailyEngagement({ before }: { before: ReactNode }) {
  const [data, setData] = useState<DailyContent | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedOptions, setExpandedOptions] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());

  async function load(excludeTipId = cachedTipId()) {
    const query = excludeTipId ? `?excludeTipId=${encodeURIComponent(excludeTipId)}` : '';
    const value = await api<DailyContent>(`/loyalty/daily${query}`);
    setData(value);
    setExpandedOptions(value.hand?.attempt ? new Set([value.hand.attempt.selectedOptionId]) : new Set());
    if (value.tip) localStorage.setItem('poker-club-daily-tip', JSON.stringify(value.tip));
  }

  useEffect(() => {
    void load().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!data?.hand?.attempt) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= new Date(data.nextDayAt).getTime()) void load(data.tip?.id).catch(() => undefined);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [data?.hand?.attempt, data?.nextDayAt, data?.tip?.id]);

  async function answer(optionId: string) {
    if (!data?.hand || data.hand.attempt || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await post<DailyContent>('/loyalty/daily/answer', { optionId });
      setData({ ...next, tip: data.tip });
      setExpandedOptions(new Set([optionId]));
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить ответ');
    } finally {
      setSaving(false);
    }
  }

  function toggleExplanation(optionId: string) {
    if (!data?.hand?.attempt || optionId === data.hand.attempt.selectedOptionId) return;
    setExpandedOptions((current) => {
      const next = new Set(current);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  }

  if (!data || (!data.tip && !data.hand)) return <>{before}</>;
  const attempt = data.hand?.attempt;
  return <>{before}<section className="daily-engagement">
    {data.hand && <article className="daily-hand-card card">
      <header><span><Brain /></span><div><small>ЗАДАЧКА ДНЯ · {data.hand.difficulty}</small><h3>{data.hand.title}</h3></div><em>+{data.hand.rewardXp} XP</em></header>
      <p>{data.hand.scenario}</p>
      <div className="hand-cards"><div><small>ВАША РУКА</small><span>{data.hand.heroCards.map((card) => <PlayingCard key={card} value={card} />)}</span></div>{data.hand.boardCards.length > 0 && <div><small>ДОСКА</small><span>{data.hand.boardCards.map((card) => <PlayingCard key={card} value={card} />)}</span></div>}</div>
      <div className="hand-options">{data.hand.options.map((option) => {
        const selected = attempt?.selectedOptionId === option.id;
        const correct = attempt?.correctOptionId === option.id;
        const expanded = Boolean(attempt && expandedOptions.has(option.id));
        return <button
          key={option.id}
          disabled={saving}
          className={`${attempt ? correct ? 'correct' : selected ? 'wrong' : '' : ''} ${expanded ? 'expanded' : ''}`}
          onClick={() => attempt ? toggleExplanation(option.id) : void answer(option.id)}
          aria-expanded={attempt ? expanded : undefined}
        >
          <span>{correct ? <CheckCircle2 /> : selected && attempt ? <XCircle /> : null}</span>
          <strong>{option.label}</strong>
          {attempt && !selected && <ChevronDown className="option-chevron" />}
          {expanded && option.explanation && <small>{option.explanation}</small>}
        </button>;
      })}</div>
      {attempt && <>
        <div className={`hand-result ${attempt.isCorrect ? 'success' : 'miss'}`}><Coins />{attempt.isCorrect ? `Верно! Начислено ${attempt.awardedXp} Club XP.` : 'Ответ сохранён. Сегодня без награды.'}</div>
        <div className="daily-hand-lock"><strong>Сегодня вы уже решали эту задачку</strong><span>Новая через <b>{countdown(data.nextDayAt, now)}</b></span></div>
      </>}
      {error && <div className="form-error">{error}</div>}
    </article>}
    {data.tip && <article className="daily-tip-card card"><span><Lightbulb /></span><div><small>{data.tip.category} · СОВЕТ ДНЯ</small><h3>{data.tip.title}</h3><p>{data.tip.body}</p></div></article>}
  </section></>;
}
