import fs from 'node:fs';
import path from 'node:path';
import {createState} from './seed.mjs';
let local,pool,ready;
async function database(){
 if(process.env.DATABASE_URL){
  if(!pool){const {Pool}=await import('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});ready=pool.query('CREATE TABLE IF NOT EXISTS guest_workspaces (id TEXT PRIMARY KEY, state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');}await ready;return pool;
 }
 if(process.env.VERCEL)throw new Error('DATABASE_REQUIRED');
 if(!local){const {default:Database}=await import('better-sqlite3');fs.mkdirSync('.data',{recursive:true});local=new Database(path.resolve('.data/market.db'));local.pragma('journal_mode = WAL');local.exec('CREATE TABLE IF NOT EXISTS guest_workspaces (id TEXT PRIMARY KEY,state TEXT NOT NULL,updated_at TEXT NOT NULL)');}return local;
}
export async function readState(id){const db=await database();if(pool){const row=await db.query('SELECT state FROM guest_workspaces WHERE id=$1',[id]);return row.rows[0]?.state??null;}const row=db.prepare('SELECT state FROM guest_workspaces WHERE id=?').get(id);return row?JSON.parse(row.state):null;}
export async function initState(id){const db=await database(),s=createState();if(pool){await db.query('INSERT INTO guest_workspaces(id,state) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,JSON.stringify(s)]);}else db.prepare('INSERT OR IGNORE INTO guest_workspaces VALUES(?,?,?)').run(id,JSON.stringify(s),new Date().toISOString());return await readState(id);}
export async function mutateState(id,version,fn){const db=await database();if(pool){const c=await db.connect();try{await c.query('BEGIN');const row=await c.query('SELECT state FROM guest_workspaces WHERE id=$1 FOR UPDATE',[id]);if(!row.rows[0])throw new Error('SESSION_EXPIRED');let s=row.rows[0].state;if(s.version!==version)throw new Error('CONFLICT');s=fn(s);s.version=version+1;await c.query('UPDATE guest_workspaces SET state=$1,updated_at=NOW() WHERE id=$2',[JSON.stringify(s),id]);await c.query('COMMIT');return s;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 return db.transaction(()=>{const row=db.prepare('SELECT state FROM guest_workspaces WHERE id=?').get(id);if(!row)throw new Error('SESSION_EXPIRED');let s=JSON.parse(row.state);if(s.version!==version)throw new Error('CONFLICT');s=fn(s);s.version=version+1;db.prepare('UPDATE guest_workspaces SET state=?,updated_at=? WHERE id=?').run(JSON.stringify(s),new Date().toISOString(),id);return s;})();
}
