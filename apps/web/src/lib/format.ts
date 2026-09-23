export const points = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

export function initials(firstName?: string, lastName?: string | null) {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || 'PL';
}

export function tournamentDate(value: string) {
  const date = new Date(value);
  return {
    day: new Intl.DateTimeFormat('ru-RU', { day: '2-digit' }).format(date),
    month: new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(date).replace('.', '').toUpperCase(),
    full: new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date),
    time: new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date)
  };
}
