export function Loading({ label = 'Загружаем клуб…' }: { label?: string }) {
  let cachedTip: { title?: string; body?: string } | null = null;
  try { cachedTip = JSON.parse(localStorage.getItem('poker-club-daily-tip') ?? 'null'); } catch { cachedTip = null; }
  return <div className="state-screen"><span className="loader" /><p>{label}</p>{cachedTip?.body && <div className="loading-tip"><small>СОВЕТ ДНЯ</small><strong>{cachedTip.title}</strong><span>{cachedTip.body}</span></div>}</div>;
}

export function ErrorState({ message }: { message: string }) {
  return <div className="state-screen"><div className="state-icon">!</div><h2>Что-то пошло не так</h2><p>{message}</p></div>;
}
