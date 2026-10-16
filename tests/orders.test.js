import test from 'node:test';
import assert from 'node:assert/strict';
import { orderSchema } from '../src/validations/orderTekegramValidation.js';
import { createOrder, formatOrder } from '../src/controllers/orderTelegram.js';
function telegramEnv(t) {
  const previous = { TG_API_KEY: process.env.TG_API_KEY, TG_ID: process.env.TG_ID };
  process.env.TG_API_KEY = 'test-token'; process.env.TG_ID = 'test-chat';
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}
const order = { customer: { firstname: 'Іван', lastname: 'Тест', socialMedia: '@test_user' }, items: [
  { name: 'Nike [Test]', barcode: 'ABC_123', size: '42', quantity: 2, price: 1900 },
  { name: 'Adidas', barcode: 'DEF', size: '43', quantity: 1, price: 1500 },
] };
const response = () => ({ status(code) { this.code = code; return this; }, json(body) {this.body = body; return this;} });
test('cart and legacy payloads are accepted; invalid carts are rejected', () => {
  assert.equal(orderSchema.body.validate(order).error, undefined);
  assert.equal(orderSchema.body.validate({...order.customer, productTitle:'Nike', productSize:'42', productBarcode:'ABC'}).error, undefined);
  for (const body of [{...order,items:[]}, {...order, items:[{...order.items[0], quantity:0}]}, {...order, customer:{...order.customer, firstname:'  '}}]) {
    assert.ok(orderSchema.body.validate(body).error);
  }
  assert.match(formatOrder(order), /Сума з кошика: 5300 грн/);
});
test('delivery checks Telegram confirmation and preserves plain-text contact details', async t => {
  telegramEnv(t);
  let payload;
  t.mock.method(globalThis,'fetch',async (_url,options)=>{
    payload=JSON.parse(options.body);
    assert.ok(options.signal);
    return {ok:true,json:async()=>({ok:true})};
  });
  const res=response(); await createOrder({body:order},res);
  assert.equal(res.code,201); assert.equal(payload.parse_mode,undefined);
  assert.match(payload.text,/@test_user/); assert.match(payload.text,/ABC_123/);
});
test('Telegram failure and network timeout never report success', async t => {
  telegramEnv(t);
  for (const impl of [async()=>({ok:true,json:async()=>({ok:false})}), async()=>{throw new Error('timeout');}]) {
    const mock=t.mock.method(globalThis,'fetch',impl);
    const res=response(); await createOrder({body:order},res); assert.equal(res.code,502);
    mock.mock.restore();
  }
});
test('oversized orders are rejected before any outbound request', async t => {
  telegramEnv(t);
  const outbound=t.mock.method(globalThis,'fetch',async()=>{throw new Error('unexpected request');});
  const res=response(); await createOrder({body:{...order,items:Array(50).fill({...order.items[0],name:'x'.repeat(200)})}},res);
  assert.equal(res.code,400); assert.equal(outbound.mock.callCount(),0);
});
