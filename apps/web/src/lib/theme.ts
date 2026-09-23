export const DEFAULT_ACCENT_COLOR = '#FF3D0A';
export const ACCENT_STORAGE_KEY = 'poker-club-accent-color';

export function normalizeAccentColor(value: string | null | undefined) {
  return value && /^#[0-9A-Fa-f]{6}$/.test(value) ? value.toUpperCase() : DEFAULT_ACCENT_COLOR;
}

export function accentRgb(value: string) {
  const color = normalizeAccentColor(value);
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16)) as [number, number, number];
}

export function applyAccentColor(value: string | null | undefined) {
  const accent = normalizeAccentColor(value);
  const [red, green, blue] = accentRgb(accent);
  const root = document.documentElement;
  root.style.setProperty('--blue', accent);
  root.style.setProperty('--blue-2', `color-mix(in srgb, ${accent} 76%, #00122f)`);
  root.style.setProperty('--cyan', `color-mix(in srgb, ${accent} 58%, white)`);
  root.style.setProperty('--accent-rgb', `${red}, ${green}, ${blue}`);
  localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  return accent;
}
