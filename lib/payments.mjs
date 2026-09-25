/** Payment boundary. Real providers must verify signatures and handle webhook retries. */
export const paymentMethods=Object.freeze([
 {id:'mock',label:'Тестовый банк',enabled:true},
 {id:'digital-ruble',label:'Цифровой рубль',enabled:false,reason:'Требуется банковский партнёр и его API'}
]);
export function chargeMock({amount,requestId,result}){
 if(!Number.isSafeInteger(amount)||amount<=0)throw new Error('Некорректная сумма');
 if(result!=='success')throw new Error('Тестовый банк отклонил оплату. Попробуйте ещё раз.');
 return {provider:'mock',paymentId:'mock_'+requestId,currency:'RUB',amount,status:'paid'};
}
