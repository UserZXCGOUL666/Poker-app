import { useEffect, useMemo, useState } from 'react';
import { apiAssetUrl } from '../lib/api';

export function Avatar({ firstName, lastName, photoUrl, size = 'md' }: { firstName: string; lastName?: string | null; photoUrl?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const fallback = useMemo(() => defaultAvatar(firstName, lastName), [firstName, lastName]);
  const resolvedPhoto = photoUrl?.startsWith('/') ? apiAssetUrl(photoUrl) : photoUrl;
  const [source, setSource] = useState(resolvedPhoto || fallback);
  useEffect(() => setSource(resolvedPhoto || fallback), [resolvedPhoto, fallback]);
  return <img className={`avatar avatar-${size}`} src={source} alt="" onError={() => setSource(fallback)} />;
}

const maleNamesEndingWithA = new Set([
  'илья', 'никита', 'кузьма', 'лука', 'фома', 'савва', 'данила', 'миша', 'саша', 'женя'
]);
const femaleNamesWithoutA = new Set([
  'любовь', 'нинэль', 'николь', 'эстер', 'руфь', 'мариам'
]);

function defaultAvatar(firstName: string, lastName?: string | null) {
  const name = firstName.trim().toLocaleLowerCase('ru-RU');
  const female = femaleNamesWithoutA.has(name) || (!maleNamesEndingWithA.has(name) && /[ая]$/.test(name));
  const key = `${firstName}:${lastName ?? ''}`;
  const seed = [...key].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 7);
  const pool = female ? ['/avatars/default-female.svg'] : ['/avatars/default-male.svg'];
  return pool[seed % pool.length];
}
