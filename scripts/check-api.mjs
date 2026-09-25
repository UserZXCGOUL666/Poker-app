import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL||'http://localhost:3000';
async function session(){const r=await fetch(base+'/api/state');assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],state:await r.json()}}
const a=await session(),b=await session();assert.notEqual(a.cookie,b.cookie);
async function action(w,action,input,version=w.state.version){const r=await fetch(base+'/api/state',{method:'POST',headers:{cookie:w.cookie,'Content-Type':'application/json',origin:base},body:JSON.stringify({action,input,version})});const data=await r.json();if(r.ok)w.state=data;return {status:r.status,data}}
assert.equal((await action(a,'favorite',{id:'chair'})).status,200);
const isolated=await fetch(base+'/api/state',{headers:{cookie:b.cookie}}).then(r=>r.json());assert.equal(isolated.favorites.length,0);
assert.equal((await action(a,'favorite',{id:'chair'},0)).status,409);
const csrf=await fetch(base+'/api/state',{method:'POST',headers:{cookie:a.cookie,'Content-Type':'application/json',origin:'https://other.invalid'},body:JSON.stringify({action:'reset',input:{},version:a.state.version})});assert.equal(csrf.status,403);
await action(a,'cart',{id:'chair',qty:1});assert.equal((await action(a,'checkout',{requestId:'api-test',address:'Тестовый адрес',result:'success'})).status,200);
assert.equal(a.state.orders[0].total,18900);
const readback=await fetch(base+'/api/state',{headers:{cookie:a.cookie}}).then(r=>r.json());assert.equal(readback.orders[0].total,18900);
console.log('API passed: guest isolation, CSRF, version conflicts, cart, checkout, persistence.');
