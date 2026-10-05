import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTicket, matchGame, missingDrawState, validateDatabase, type Draw } from '../src/lotto';
// @ts-expect-error Plain Node.js module is shared with the data update workflow.
import { normalizeResponse } from '../scripts/update-draws.mjs';

const draw: Draw = { round: 1244, date: '2026-10-03', numbers: [1,13,18,26,34,38], bonus: 25, prizes: [1604686625,60175749,1290287,50000,5000] };
const slot = 'm011318263438';
const qr = (slots = slot.repeat(5), tail = '9999999999') => `1244${slots}${tail}`;
test('official 79-character URL preserves all five games', () => {
  const ticket = parseTicket(`https://qr.dhlottery.co.kr/?v=${qr()}`);
  assert.equal(ticket.round, 1244);
  assert.equal(ticket.games.length, 5);
  assert.deepEqual(ticket.games[0], draw.numbers);
});
test('legacy mobile HTTP URL and 87-character metadata supported', () => {
  assert.equal(parseTicket(`http://m.dhlottery.co.kr/?v=${qr(slot.repeat(5), '123456789012345678')}`).games.length, 5);
});
test('unbought n slots are omitted', () => {
  assert.equal(parseTicket(qr(slot + 'n000000000000'.repeat(4))).games.length, 1);
});
test('all purchase types are accepted', () => {
  assert.equal(parseTicket(qr('m011318263438s011318263438q011318263438n000000000000n000000000000')).games.length, 3);
});
test('foreign URL, duplicate v and credentials rejected', () => {
  for (const value of [`https://evil.test/?v=${qr()}`, `https://qr.dhlottery.co.kr.evil.test/?v=${qr()}`, `https://qr.dhlottery.co.kr/?v=${qr()}&v=${qr()}`, `https://name@qr.dhlottery.co.kr/?v=${qr()}`]) assert.throws(() => parseTicket(value));
});
test('malformed QR, empty ticket and invalid numbers rejected', () => {
  for (const value of ['', 'pd1212441s123456', qr().slice(0,-1), qr()+'1', qr('n000000000000'.repeat(5)), qr('m010118263438'+slot.repeat(4)), qr('m001318263438'+slot.repeat(4)), qr('m461318263438'+slot.repeat(4))]) assert.throws(() => parseTicket(value));
});
test('all ranks and nonwinner match correctly', () => {
  const cases: [number[], number][] = [ [[1,13,18,26,34,38],1], [[1,13,18,26,34,25],2], [[1,13,18,26,34,2],3], [[1,13,18,26,2,3],4], [[1,13,18,2,3,4],5], [[1,13,2,3,4,5],0], [[2,3,4,5,6,7],0] ];
  for (const [game, rank] of cases) assert.equal(matchGame(game,draw).rank,rank);
});
test('bonus never counts as a normal winning number', () => {
  const match = matchGame([1,13,25,2,3,4],draw);
  assert.equal(match.count,2); assert.equal(match.bonus,true); assert.equal(match.rank,0);
});
test('round-specific prizes include historical variable 4th/5th payouts', () => {
  const old = {...draw, prizes:[0,143934100,5140500,113400,10000]};
  assert.equal(matchGame([1,13,18,26,2,3],old).prize,113400);
});
test('pending draw is distinct from missing data after draw time', () => {
  assert.equal(missingDrawState(1245,new Date('2026-10-10T20:34:59+09:00')),'pending');
  assert.equal(missingDrawState(1245,new Date('2026-10-10T20:35:00+09:00')),'missing');
});
test('bundled official database validates and contains latest known draw', async () => {
  const db = validateDatabase(JSON.parse(await readFile(new URL('../public/draws.json',import.meta.url),'utf8')));
  assert.ok(db.draws.length >= 1244);
  assert.deepEqual(db.draws.find(d => d.round === 1244)?.numbers,draw.numbers);
});
test('database validation rejects duplicate rounds and corrupt bonus', () => {
  const base={schemaVersion:1,source:'official',generatedAt:'2026-10-05T00:00:00Z',draws:[draw]};
  assert.throws(()=>validateDatabase({...base,draws:[draw,draw]}));
  assert.throws(()=>validateDatabase({...base,draws:[{...draw,bonus:1}]}));
});
const row = {ltEpsd:1,ltRflYmd:'20021207',tm1WnNo:10,tm2WnNo:23,tm3WnNo:29,tm4WnNo:33,tm5WnNo:37,tm6WnNo:40,bnsWnNo:16,rnk1WnAmt:0,rnk2WnAmt:143934100,rnk3WnAmt:5140500,rnk4WnAmt:113400,rnk5WnAmt:10000};
test('official API normalization and schema validation work together', () => {
  const db=normalizeResponse({data:{list:[row]}});
  assert.equal(validateDatabase(db).draws[0].prizes[3],113400);
});
test('data updater rejects broken response, gaps and future draws', () => {
  assert.throws(()=>normalizeResponse({data:{list:[]}}));
  assert.throws(()=>normalizeResponse({data:{list:[{...row,tm2WnNo:10}]}}));
  assert.throws(()=>normalizeResponse({data:{list:[{...row,ltEpsd:2,ltRflYmd:'20021214'}]}}));
  assert.throws(()=>normalizeResponse({data:{list:[row]}},new Date('2002-12-06')));
});
