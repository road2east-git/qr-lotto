export interface Draw { round: number; date: string; numbers: number[]; bonus: number; prizes: number[] }
export interface DrawDatabase { schemaVersion: 1; generatedAt: string; source: string; draws: Draw[] }
export interface Ticket { round: number; games: number[][] }
export interface Match { count: number; bonus: boolean; rank: number; prize: number }

export function validNumbers(numbers: number[]): boolean {
  return numbers.length === 6 && new Set(numbers).size === 6 && numbers.every(n => Number.isInteger(n) && n >= 1 && n <= 45);
}

export function parseTicket(input: string): Ticket {
  let value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('QR 주소 형식을 확인해주세요.'); }
    if (!['qr.dhlottery.co.kr', 'm.dhlottery.co.kr', 'www.dhlottery.co.kr', 'dhlottery.co.kr'].includes(url.hostname) || url.port || url.username || url.password) {
      throw new Error('동행복권 로또 QR이 아닙니다. 복권의 당첨확인 QR을 비춰주세요.');
    }
    if (url.searchParams.getAll('v').length !== 1) throw new Error('QR에 복권 번호가 없습니다.');
    value = url.searchParams.get('v')!;
  }
  // Official QR: 4-digit round, five 13-character slots, 10/18-digit metadata.
  if (!/^\d{4}(?:[msqn]\d{12}){5}(?:\d{10}|\d{18})$/.test(value)) {
    throw new Error('지원하지 않는 QR 형식입니다. 로또 6/45 당첨확인 QR인지 확인해주세요.');
  }
  const round = Number(value.slice(0, 4));
  if (round < 1) throw new Error('복권 회차가 올바르지 않습니다.');
  const games: number[][] = [];
  for (let index = 0; index < 5; index++) {
    const slot = value.slice(4 + index * 13, 17 + index * 13);
    if (slot[0] === 'n') continue; // Unpurchased slot, as on the official QR page.
    const numbers = slot.slice(1).match(/\d{2}/g)!.map(Number);
    if (!validNumbers(numbers)) throw new Error('복권 번호를 정확히 읽지 못했습니다. QR을 다시 읽어주세요.');
    games.push(numbers);
  }
  if (!games.length) throw new Error('QR에서 구매한 게임을 찾지 못했습니다.');
  return { round, games };
}

export function matchGame(numbers: number[], draw: Draw): Match {
  if (!validNumbers(numbers) || !validNumbers(draw.numbers) || !Number.isInteger(draw.bonus) || draw.bonus < 1 || draw.bonus > 45 || draw.numbers.includes(draw.bonus)) throw new Error('번호 데이터가 올바르지 않습니다.');
  const count = numbers.filter(n => draw.numbers.includes(n)).length;
  const bonus = numbers.includes(draw.bonus);
  const rank = count === 6 ? 1 : count === 5 ? (bonus ? 2 : 3) : count === 4 ? 4 : count === 3 ? 5 : 0;
  return { count, bonus, rank, prize: rank ? draw.prizes[rank - 1] : 0 };
}

export function drawDate(round: number): string {
  return new Date(Date.UTC(2002, 11, 7) + (round - 1) * 7 * 86400000).toISOString().slice(0, 10);
}
export function missingDrawState(round: number, now = new Date()): 'pending' | 'missing' {
  const scheduled = Date.parse(`${drawDate(round)}T20:35:00+09:00`);
  return now.getTime() < scheduled ? 'pending' : 'missing';
}
export function validateDatabase(value: unknown): DrawDatabase {
  const db = value as DrawDatabase;
  if (db?.schemaVersion !== 1 || !Array.isArray(db.draws) || !db.draws.length || !Number.isFinite(Date.parse(db.generatedAt))) throw new Error('당첨번호 파일을 읽을 수 없습니다.');
  const seen = new Set<number>();
  for (const draw of db.draws) {
    if (!Number.isInteger(draw.round) || draw.round < 1 || seen.has(draw.round) || !/^\d{4}-\d{2}-\d{2}$/.test(draw.date) || draw.date !== drawDate(draw.round) || !validNumbers(draw.numbers) || !Number.isInteger(draw.bonus) || draw.bonus < 1 || draw.bonus > 45 || draw.numbers.includes(draw.bonus) || !Array.isArray(draw.prizes) || draw.prizes.length !== 5 || draw.prizes.some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('당첨번호 데이터 검증에 실패했습니다.');
    seen.add(draw.round);
  }
  return db;
}
