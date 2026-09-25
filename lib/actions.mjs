import {randomUUID} from 'node:crypto';
import {chargeMock} from './payments.mjs';
import {z} from 'zod';
import {stages,categories,createState} from './seed.mjs';
const str=(max=300)=>z.string().trim().min(1).max(max);
const idSchema=str(100);
const price=z.number().int().min(1).max(100000000);
const itemSchema=z.object({title:str(120),price,category:z.enum(categories.slice(1)),kind:z.enum(['product','quote','booking']),description:str(3000),city:str(60),stock:z.number().int().min(0).max(99999),image:z.string().max(700000).refine(x=>/^[a-z]+\.jpg$/.test(x)||/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(x),'Используйте JPG, PNG или WebP'),delivery:str(160)});
const getProduct=(s,id)=>{const p=s.products.find(p=>p.id===id);if(!p)throw new Error('Предложение не найдено');return p;};
const event=(s,type,id)=>s.events.push({type,id,at:new Date().toISOString()});
export function applyAction(s,action,input={}){
 const at=new Date().toISOString();const id=()=>idSchema.parse(input.id);
 switch(action){
 case 'favorite':{const pid=id();getProduct(s,pid);s.favorites=s.favorites.includes(pid)?s.favorites.filter(x=>x!==pid):[...s.favorites,pid];break;}
 case 'view':{const p=getProduct(s,id());if(!s.events.some(e=>e.type==='view'&&e.id===p.id)){p.views++;event(s,'view',p.id);}break;}
 case 'cart':{const p=getProduct(s,id()),qty=z.number().int().min(0).max(20).parse(input.qty);if(p.kind!=='product'||p.status!=='active')throw new Error('Этот товар нельзя добавить в корзину');if(qty>p.stock)throw new Error('Недостаточно товара в наличии');s.cart=s.cart.filter(x=>x.id!==p.id);if(qty)s.cart.push({id:p.id,qty});break;}
 case 'checkout':{const requestId=str(100).parse(input.requestId);if(s.orders.some(o=>o.requestId===requestId))break;if(!s.cart.length)throw new Error('Корзина пуста');const address=str(300).parse(input.address);const result=z.enum(['success','decline']).parse(input.result);if(result==='decline')throw new Error('Тестовый банк отклонил оплату. Попробуйте ещё раз.');const groups={};for(const item of s.cart){const p=getProduct(s,item.id);if(p.status!=='active'||p.stock<item.qty)throw new Error('Товар больше не доступен в выбранном количестве');const g=groups[p.seller]??=[];g.push({id:p.id,title:p.title,image:p.image,price:p.price,qty:item.qty});p.stock-=item.qty;}
 for(const [seller,items] of Object.entries(groups)){const total=items.reduce((a,x)=>a+x.price*x.qty,0);const paymentRecord=chargeMock({amount:total,requestId:requestId+'_'+seller,result});s.orders.unshift({id:randomUUID(),requestId,seller,items,total,commission:Math.round(total*.05),payment:'paid',status:'Новый',at,address,provider:paymentRecord.provider,paymentId:paymentRecord.paymentId,refunded:0});event(s,'purchase',seller);}s.cart=[];break;}
 case 'order':{const o=s.orders.find(o=>o.id===id());if(!o)throw new Error('Заказ не найден');const status=z.enum(['Сборка','В доставке','Получен','Отменён']).parse(input.status);const transitions={'Новый':['Сборка','Отменён'],'Сборка':['В доставке','Отменён'],'В доставке':['Получен'],'Получен':[],'Отменён':[]};if(!transitions[o.status]?.includes(status))throw new Error('Недопустимый переход заказа');o.status=status;if(status==='Отменён'){o.payment='refunded';o.refunded=o.total;for(const item of o.items){const p=s.products.find(p=>p.id===item.id);if(p)p.stock+=item.qty;}}break;}
 case 'refund':{const o=s.orders.find(o=>o.id===id());if(!o||o.payment==='refunded')throw new Error('Возврат недоступен');const amount=price.parse(input.amount);if(amount>o.total-o.refunded)throw new Error('Сумма превышает остаток платежа');o.refunded+=amount;o.payment=o.refunded===o.total?'refunded':'partially_refunded';break;}
 case 'inquiry':{const p=getProduct(s,id());if(p.status!=='active')throw new Error('Предложение недоступно');const text=str(1500).parse(input.text);const slot=input.slot?str(50).parse(input.slot):'';if(p.kind==='booking'){if(!slot||!Number.isFinite(Date.parse(slot))||Date.parse(slot)<Date.now())throw new Error('Выберите будущее время');if(s.leads.some(l=>l.productId===p.id&&l.slot===slot&&l.stage!=='Отказ'))throw new Error('Это время уже занято');}const lid=randomUUID();s.leads.unshift({id:lid,productId:p.id,name:s.profile.name,title:p.title,price:p.price,stage:'Новое',note:text,due:slot?'Запись':'Без срока',slot,kind:p.kind});s.messages.push({id:randomUUID(),thread:lid,from:'buyer',text,at});event(s,'inquiry',p.id);break;}
 case 'lead':{const l=s.leads.find(l=>l.id===id());if(!l)throw new Error('Обращение не найдено');if(input.stage)l.stage=z.enum([...stages,'Отказ']).parse(input.stage);if(input.note!==undefined)l.note=z.string().max(1500).parse(input.note);break;}
 case 'message':{const thread=str(100).parse(input.thread);if(thread!=='demo'&&!s.leads.some(l=>l.id===thread))throw new Error('Чат не найден');s.messages.push({id:randomUUID(),thread,from:z.enum(['buyer','seller']).parse(input.from),text:str(2000).parse(input.text),at});break;}
 case 'publish':{if(s.products.length>=50)throw new Error('В демо доступно до 50 объявлений');const p=itemSchema.parse(input);s.products.unshift({...p,id:randomUUID(),seller:s.profile.shop,owned:true,rating:0,reviews:0,verified:false,status:input.draft?'draft':'pending',views:0});break;}
 case 'edit':{const p=getProduct(s,id());if(!p.owned)throw new Error('Можно редактировать только свои объявления');Object.assign(p,itemSchema.parse(input),{status:input.draft?'draft':'pending'});break;}
 case 'listing':{const p=getProduct(s,id());if(!p.owned)throw new Error('Можно менять только свои объявления');p.status=z.enum(['paused','archived','pending']).parse(input.status);break;}
 case 'moderate':{const p=getProduct(s,id());p.status=z.enum(['active','rejected']).parse(input.status);s.audit.unshift({id:randomUUID(),text:`${p.title}: ${p.status==='active'?'одобрено':'отклонено'}`,at});break;}
 case 'profile':{s.profile=z.object({name:str(60),shop:str(80),city:str(60),bio:z.string().max(1000),email:z.union([z.literal(''),z.email()]),phone:z.string().max(40)}).parse(input);s.products.filter(p=>p.owned).forEach(p=>p.seller=s.profile.shop);break;}
 case 'ticket':{s.tickets.unshift({id:randomUUID(),subject:str(120).parse(input.subject),text:str(2000).parse(input.text),status:'Открыто',at});break;}
 case 'resolve':{const t=s.tickets.find(t=>t.id===id());if(!t)throw new Error('Обращение не найдено');t.status='Решено';break;}
 case 'review':{const o=s.orders.find(o=>o.id===id());if(!o||o.status!=='Получен')throw new Error('Отзыв доступен после получения');if(s.reviews.some(r=>r.orderId===o.id))throw new Error('Отзыв уже опубликован');s.reviews.push({id:randomUUID(),orderId:o.id,seller:o.seller,rating:z.number().int().min(1).max(5).parse(input.rating),text:str(1000).parse(input.text),at});break;}
 case 'reset':return {...createState(),version:s.version};
 default:throw new Error('Неизвестное действие');
 }
 s.events=s.events.slice(-2000);s.messages=s.messages.slice(-300);s.audit=s.audit.slice(0,100);if(s.orders.length>150||s.leads.length>200||s.tickets.length>100)throw new Error('Демо заполнено. Сбросьте данные в настройках.');return s;
}
