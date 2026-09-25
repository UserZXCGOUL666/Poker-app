import {NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {readState,initState,mutateState} from '../../../lib/store.mjs';
import {applyAction} from '../../../lib/actions.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const validId=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
function error(e){const messages={DATABASE_REQUIRED:'Для размещения на Vercel подключите PostgreSQL и задайте DATABASE_URL.',CONFLICT:'Данные изменились. Обновили экран — повторите действие.',SESSION_EXPIRED:'Сессия истекла. Обновите страницу.'};const msg=messages[e.message]??(e.name==='ZodError'?'Проверьте заполнение полей.':e.code?'Не удалось обратиться к базе данных. Попробуйте позже.':e.message);return NextResponse.json({error:msg},{status:e.message==='CONFLICT'?409:e.message==='DATABASE_REQUIRED'?503:400});}
export async function GET(req){try{let id=req.cookies.get('ryad_guest')?.value;if(!validId(id)||!await readState(id))id=randomUUID();const state=await initState(id);const res=NextResponse.json(state,{headers:{'Cache-Control':'no-store'}});res.cookies.set('ryad_guest',id,{httpOnly:true,secure:!!process.env.VERCEL,sameSite:'strict',maxAge:60*60*24*30,path:'/'});return res;}catch(e){return error(e);}}
export async function POST(req){try{const origin=req.headers.get('origin');if(origin&&new URL(origin).host!==req.headers.get('host'))return NextResponse.json({error:'Недопустимый источник запроса'},{status:403});const id=req.cookies.get('ryad_guest')?.value;if(!validId(id))throw new Error('SESSION_EXPIRED');const raw=await req.text();if(raw.length>750000)throw new Error('Слишком большой запрос');const {action,input,version}=JSON.parse(raw);if(!Number.isSafeInteger(version))throw new Error('Обновите страницу');const s=await mutateState(id,version,s=>applyAction(s,action,input));return NextResponse.json(s,{headers:{'Cache-Control':'no-store'}});}catch(e){return error(e);}}
