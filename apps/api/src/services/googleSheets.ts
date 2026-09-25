import crypto from 'node:crypto';
import { env } from '../config.js';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
let cachedToken: { value: string; expiresAt: number } | null = null;

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

export function googleSheetsConfigured() {
  return Boolean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_PRIVATE_KEY);
}

export function extractGoogleSpreadsheetId(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname !== 'docs.google.com') return null;
    const match = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) throw new Error('Google Sheets service account не настроен');

  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${payload}`;
  const privateKey = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const data = await response.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description || 'Не удалось авторизоваться в Google Sheets');
  cachedToken = { value: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

export async function appendTrainingLeadToSheet(input: {
  sheetUrl: string;
  createdAt: Date;
  fullName: string;
  phoneNumber: string;
  preferredContactAt: string;
  preferredVisitAt: string;
  userLabel: string;
  userId: string;
}) {
  const spreadsheetId = extractGoogleSpreadsheetId(input.sheetUrl);
  if (!spreadsheetId) throw new Error('Некорректная ссылка Google Sheets');
  const token = await accessToken();
  const range = encodeURIComponent('A:G');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      majorDimension: 'ROWS',
      values: [[
        input.createdAt.toISOString(),
        input.fullName,
        input.phoneNumber,
        input.preferredContactAt,
        input.preferredVisitAt,
        input.userLabel,
        input.userId
      ]]
    })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(data.error?.message || `Google Sheets вернул ${response.status}`);
  }
}
