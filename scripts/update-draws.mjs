import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const SOURCE = 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=all';
export function normalizeResponse(payload, now = new Date()) {
  const list = payload?.data?.list;
  if (!Array.isArray(list) || !list.length) throw new Error('공식 응답에 회차 데이터가 없습니다.');
  const seen = new Set();
  const draws = list.map(row => {
    const round = Number(row.ltEpsd);
    const numbers = Array.from({ length: 6 }, (_, i) => Number(row[`tm${i + 1}WnNo`]));
    const bonus = Number(row.bnsWnNo);
    const dateValue = String(row.ltRflYmd);
    const date = `${dateValue.slice(0, 4)}-${dateValue.slice(4, 6)}-${dateValue.slice(6, 8)}`;
    const expected = new Date(Date.UTC(2002, 11, 7) + (round - 1) * 604800000).toISOString().slice(0, 10);
    const prizes = Array.from({ length: 5 }, (_, i) => Number(row[`rnk${i + 1}WnAmt`]));
    if (!Number.isInteger(round) || round < 1 || seen.has(round) || date !== expected || !/^\d{8}$/.test(dateValue) || new Set(numbers).size !== 6 || numbers.some(n => !Number.isInteger(n) || n < 1 || n > 45) || !Number.isInteger(bonus) || bonus < 1 || bonus > 45 || numbers.includes(bonus) || prizes.some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error(`공식 데이터 검증 실패: ${round}회`);
    if (Date.parse(`${date}T20:35:00+09:00`) > now.getTime()) throw new Error(`추첨 전 데이터: ${round}회`);
    seen.add(round);
    return { round, date, numbers, bonus, prizes };
  }).sort((a, b) => a.round - b.round);
  if (draws.some((draw, i) => draw.round !== i + 1)) throw new Error('과거 회차 데이터가 누락되었습니다.');
  return { schemaVersion: 1, source: SOURCE, generatedAt: now.toISOString(), draws };
}

async function main() {
  const fixtureIndex = process.argv.indexOf('--input');
  let payload;
  if (fixtureIndex !== -1) payload = JSON.parse((await readFile(process.argv[fixtureIndex + 1], 'utf8')).replace(/^\uFEFF/, ''));
  else {
    const response = await fetch(SOURCE, { signal: AbortSignal.timeout(30000), headers: { 'Accept': 'application/json', 'User-Agent': 'LottoLens/1.0', 'Referer': 'https://www.dhlottery.co.kr/lt645/winNumber' } });
    if (!response.ok) throw new Error(`공식 데이터 요청 실패: ${response.status}`);
    payload = await response.json();
  }
  const next = normalizeResponse(payload);
  const path = new URL('../public/draws.json', import.meta.url);
  let previous;
  try { previous = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous?.draws?.length) {
    if (next.draws.length < previous.draws.length) throw new Error('새 데이터가 기존 회차보다 적습니다. 기존 파일을 유지합니다.');
    if (JSON.stringify(next.draws) === JSON.stringify(previous.draws)) { console.log(`변경 없음 · ${next.draws.length}회차`); return; }
  }
  await mkdir(new URL('../public/', import.meta.url), { recursive: true });
  const temporary = new URL('../public/draws.json.tmp', import.meta.url);
  await writeFile(temporary, JSON.stringify(next) + '\n');
  await rename(temporary, path);
  console.log(`공식 당첨번호 갱신 완료 · 1~${next.draws.at(-1).round}회`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
