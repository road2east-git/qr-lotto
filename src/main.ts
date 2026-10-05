import QrScanner from 'qr-scanner';
import { requestCamera, prepareCameraVideo, cameraErrorMessage } from './camera';
import { type Draw, type DrawDatabase, type Ticket, parseTicket, matchGame, missingDrawState, drawDate, validateDatabase } from './lotto';
import './style.css';

const icons = {
  scan: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h3v3h3v3h-6v-3m6-3v-1"/>',
  camera: '<path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z"/><path d="m8 12 3 3 5-6"/>',
};
function icon(name: keyof typeof icons) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`; }
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="site-header"><a class="brand" href="./" aria-label="로또 렌즈 홈"><span class="brand-icon">${icon('scan')}</span><span>로또 렌즈</span></a></header>
  <main>
    <section class="winning-panel" aria-labelledby="winning-title"><a class="winning-link" id="official-draw-link" target="_blank" rel="noopener noreferrer"><div class="winning-head"><div><p class="eyebrow" id="draw-context">최근 추첨 결과</p><h2 id="winning-title">당첨번호 조회 중</h2></div><span class="source-pill"><i></i> 동행복권 ↗</span></div><div class="winning-content"><div class="winning-balls" id="winning-balls" aria-label="당첨번호"></div><p id="draw-date" class="draw-date"></p></div></a><p id="data-message" class="data-message" role="status"></p><button id="reload-data" class="text-button" hidden>당첨번호 다시 조회 ↻</button></section>
    <div class="workspace">
      <section class="scan-panel" aria-labelledby="scan-title"><div class="panel-heading"><span class="step">01</span><h2 id="scan-title">복권 QR 스캔</h2><span class="small-note">당첨확인 QR</span></div>
        <div class="viewfinder" id="viewfinder"><video id="camera" muted playsinline aria-label="QR 스캔 카메라"></video><div class="viewfinder-content" id="camera-idle"><span class="scanner-illustration">${icon('scan')}</span><h3>당첨확인 QR을 촬영하세요</h3></div><div class="scan-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></div><span class="camera-state" id="camera-state"><i></i> 카메라 대기 중</span></div>
        <button class="button primary" id="start-camera">${icon('camera')}<span>카메라로 스캔하기</span>${icon('arrow')}</button><button class="button secondary" id="upload-button">${icon('image')} 사진에서 QR 읽기</button><input type="file" id="photo" accept="image/*" hidden>
        <p class="scan-message" id="scan-message" role="status" aria-live="polite"></p>
        <details class="manual-entry"><summary>QR 주소 직접 입력 <span>＋</span></summary><form id="qr-form"><label for="qr-input">QR을 읽었을 때 나온 주소</label><textarea id="qr-input" rows="3" maxlength="500" placeholder="https://qr.dhlottery.co.kr/?v=..."></textarea><button class="button secondary" type="submit">번호 확인하기</button></form></details>
        <div class="privacy-note">${icon('shield')}<p>QR·사진은 기기에서만 처리됩니다.</p></div>
      </section>
      <section class="ticket-panel" aria-labelledby="ticket-title"><div class="panel-heading"><span class="step">02</span><h2 id="ticket-title">내 복권 확인</h2><span id="ticket-count" class="small-note">스캔 대기</span></div>
        <div id="ticket-empty" class="ticket-empty"><p>QR을 스캔하면 게임별 번호와<br>당첨 결과가 표시됩니다.</p><button class="demo-button" id="demo">샘플 결과 ${icon('arrow')}</button></div>
        <div id="ticket-result" hidden><div id="result-summary" class="result-summary" aria-live="polite"></div><div class="legend"><span><i class="legend-match">✓</i> 당첨번호 일치</span><span><i class="legend-bonus">+</i> 보너스 일치</span><span id="demo-label" class="demo-label" hidden>샘플 복권</span></div><div id="games" class="games"></div><div class="ticket-bottom"><p id="result-note"></p><button class="button primary" id="next-ticket">${icon('scan')} 다음 복권 스캔 ${icon('arrow')}</button></div></div>
      </section>
    </div>
    <footer><p>QR 확인 결과는 실물 복권과 함께 대조해주세요.</p><div><span id="data-updated">당첨번호 준비 중</span><a href="https://www.dhlottery.co.kr/lt645/result" target="_blank" rel="noopener noreferrer">동행복권에서 확인 ↗</a></div></footer>
  </main>`;

function el<T extends HTMLElement = HTMLElement>(id: string) { return document.getElementById(id) as T; }
let database: DrawDatabase | null = null;
let ticket: Ticket | null = null;
let demo = false;
let scanner: QrScanner | null = null;
let scanStarting = false;
let scanActive = false;
let operation = 0;
let loadingData = false;
const money = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const dateText = (date: string) => `${date.replaceAll('-', '.')} 추첨`;
function ball(n: number, state: 'winning' | 'match' | 'bonus' | 'plain') {
  const color = n <= 10 ? 'yellow' : n <= 20 ? 'blue' : n <= 30 ? 'red' : n <= 40 ? 'gray' : 'green';
  const label = state === 'match' ? ', 당첨번호 일치' : state === 'bonus' ? ', 보너스 번호 일치' : '';
  return `<span class="ball ${state} ${color}" aria-label="${n}${label}">${String(n).padStart(2, '0')}${state === 'match' ? '<b aria-hidden="true">✓</b>' : state === 'bonus' ? '<b aria-hidden="true">+</b>' : ''}</span>`;
}
function render() {
  const draw: Draw | undefined = ticket ? database?.draws.find(d => d.round === ticket!.round) : database?.draws.at(-1);
  el('draw-context').textContent = ticket ? (demo ? '샘플 복권의 추첨 결과' : '읽은 복권의 추첨 결과') : '최근 추첨 결과';
  el('winning-title').textContent = draw ? `제 ${draw.round}회 당첨번호` : ticket ? `제 ${ticket.round}회` : '당첨번호 조회 중';
  const officialLink = el<HTMLAnchorElement>('official-draw-link');
  if (draw) {
    officialLink.href = `https://www.dhlottery.co.kr/lt645/result?ltEpsd=${draw.round}`;
    officialLink.setAttribute('aria-label', `${draw.round}회 당첨번호 동행복권에서 보기 (새 창)`);
    officialLink.removeAttribute('aria-disabled');
    officialLink.tabIndex = 0;
  } else {
    officialLink.removeAttribute('href');
    officialLink.removeAttribute('aria-label');
    officialLink.setAttribute('aria-disabled', 'true');
    officialLink.tabIndex = -1;
  }
  el('winning-balls').innerHTML = draw ? draw.numbers.map(n => ball(n, 'winning')).join('') + `<span class="bonus-separator">+<small>보너스</small></span>${ball(draw.bonus, 'winning')}` : '<span class="numbers-pending">당첨번호 없음</span>';
  el('draw-date').textContent = draw ? dateText(draw.date) : ticket ? `${drawDate(ticket.round).replaceAll('-', '.')} 추첨 예정` : '';
  let state = '';
  if (!database) state = loadingData ? '공식 당첨번호 조회 중' : '당첨번호 조회 실패. 연결을 확인하고 다시 시도하세요.';
  else if (ticket && !draw) state = missingDrawState(ticket.round) === 'pending' ? '추첨 전' : '해당 회차 결과 데이터 미갱신';
  el('data-message').textContent = state;
  el('reload-data').hidden = !state || loadingData || (!!database && !!ticket && missingDrawState(ticket.round) === 'pending');
  el('ticket-empty').hidden = !!ticket;
  el('ticket-result').hidden = !ticket;
  el('demo-label').hidden = !demo;
  el<HTMLButtonElement>('demo').disabled = !database;
  el('ticket-count').textContent = ticket ? `${ticket.games.length}게임 · ${ticket.round}회` : '스캔 대기';
  if (database) el('data-updated').textContent = `1~${database.draws.at(-1)!.round}회 수록 · ${new Date(database.generatedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} 갱신`;
  if (!ticket) return;
  const matches = draw ? ticket.games.map(game => matchGame(game, draw)) : null;
  const winners = matches?.filter(m => m.rank > 0) ?? [];
  const total = winners.reduce((sum, m) => sum + m.prize, 0);
  el('result-summary').className = `result-summary ${winners.length ? 'has-win' : ''}`;
  el('result-summary').innerHTML = draw ? `<div><p>${demo ? '샘플 결과 · ' : ''}총 ${ticket.games.length}게임 확인 완료</p><h3>${winners.length ? `${winners.length}게임 당첨${winners.every(m => m.prize > 0) ? ` · ${money(total)}` : ' · 당첨금 집계 중'}` : '미당첨'}</h3></div>` : `<div><p>총 ${ticket.games.length}게임 · 번호 읽기 완료</p><h3>${!database ? '당첨번호 조회 대기' : missingDrawState(ticket.round) === 'pending' ? '추첨 전' : '결과 데이터 갱신 대기'}</h3></div>`;
  el('games').innerHTML = ticket.games.map((game, i) => {
    const match = matches?.[i];
    const status = match ? match.rank ? `${match.rank}등 당첨` : '미당첨' : '확인 대기';
    const detail = match ? `${match.count}개 일치${match.bonus ? ' + 보너스' : ''}` : '당첨번호 발표 후 확인';
    return `<div class="game-row ${match?.rank ? 'winning-row' : ''}"><div class="game-heading"><span class="game-letter">${'ABCDE'[i]}</span><span class="game-status ${match?.rank ? 'winner' : ''}">${status}</span><span class="match-count">${detail}</span></div><div class="game-content"><div class="game-balls">${game.map(n => ball(n, draw?.numbers.includes(n) ? 'match' : n === draw?.bonus ? 'bonus' : 'plain')).join('')}</div><span class="game-prize">${match?.rank ? match.prize > 0 ? money(match.prize) : '집계 중' : '—'}</span></div></div>`;
  }).join('');
  el('result-note').textContent = demo ? '화면 확인용 가상 복권' : '실물 복권의 A~E 순서';
}

async function loadData() {
  if (loadingData) return;
  loadingData = true;
  render();
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}draws.json`, { cache: 'no-cache', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('당첨번호 조회 실패');
    database = validateDatabase(await response.json());
  } catch {
    if (database) message('갱신 실패. 기존 당첨번호를 유지합니다.', true);
  } finally { loadingData = false; render(); }
}
function message(text: string, error = false) {
  el('scan-message').textContent = text;
  el('scan-message').classList.toggle('error', error);
}
function cameraUI(active: boolean) {
  scanActive = active;
  el('viewfinder').classList.toggle('active', active);
  el('camera-idle').hidden = active;
  el('camera-state').innerHTML = `<i></i> ${active ? 'QR을 찾고 있어요' : '카메라 대기 중'}`;
  el('start-camera').innerHTML = `${icon('camera')}<span>${active ? '카메라 멈추기' : '카메라로 스캔하기'}</span>${icon('arrow')}`;
}
function stopCamera() {
  operation++;
  scanner?.stop();
  const video = el<HTMLVideoElement>('camera');
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach(track => track.stop());
  video.srcObject = null;
  cameraUI(false);
}
function readTicket(value: string) {
  const parsed = parseTicket(value);
  stopCamera();
  ticket = parsed;
  demo = false;
  render();
  message(`${parsed.round}회 · ${parsed.games.length}게임 인식 완료`);
  if (!database) void loadData();
  if (window.innerWidth < 760) el('winning-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function startCamera() {
  if (scanStarting) return;
  if (scanActive) { stopCamera(); return; }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    message('카메라를 사용할 수 없습니다. 사진을 선택하세요.', true); return;
  }
  scanStarting = true;
  const token = ++operation;
  el<HTMLButtonElement>('start-camera').disabled = true;
  message('카메라 사용 권한을 허용해주세요.');
  try {
    const video = el<HTMLVideoElement>('camera');
    const stream = await requestCamera(constraints => navigator.mediaDevices.getUserMedia(constraints));
    if (token !== operation || document.hidden) { stream.getTracks().forEach(track => track.stop()); return; }
    prepareCameraVideo(video);
    cameraUI(true);
    video.srcObject = stream;
    if (!scanner) scanner = new QrScanner(video, result => {
      if (!scanActive) return;
      try { readTicket(result.data); } catch (error) { message((error as Error).message, true); }
    }, { preferredCamera: 'environment', maxScansPerSecond: 8, returnDetailedScanResult: true });
    // Attach our stream so QrScanner does not swallow getUserMedia errors.
    await scanner.start();
    if (token !== operation) return;
    message('당첨확인 QR을 네모 안에 맞추세요.');
  } catch (error) {
    if (token !== operation) return;
    stopCamera();
    message(cameraErrorMessage(error), true);
  } finally { scanStarting = false; el<HTMLButtonElement>('start-camera').disabled = false; }
}
el('start-camera').addEventListener('click', () => void startCamera());
el('next-ticket').addEventListener('click', () => { el('viewfinder').scrollIntoView({ behavior: 'smooth', block: 'center' }); void startCamera(); });
el('upload-button').addEventListener('click', () => el<HTMLInputElement>('photo').click());
el<HTMLInputElement>('photo').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  stopCamera();
  const token = operation;
  el<HTMLButtonElement>('upload-button').disabled = true;
  message('사진 QR 인식 중');
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('사진이 너무 큽니다. 20MB 이하의 사진을 선택해주세요.');
    const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
    if (token === operation) readTicket(result.data);
  } catch (error) {
    if (token === operation) message(error instanceof Error && !error.message.includes('QR code') ? error.message : 'QR 인식 실패. 선명한 QR 사진을 선택하세요.', true);
  } finally { input.value = ''; el<HTMLButtonElement>('upload-button').disabled = false; }
});
el('qr-form').addEventListener('submit', event => {
  event.preventDefault();
  try { readTicket(el<HTMLTextAreaElement>('qr-input').value); } catch (error) { message((error as Error).message, true); }
});
el('reload-data').addEventListener('click', () => void loadData());
el('demo').addEventListener('click', () => {
  const draw = database?.draws.at(-1);
  if (!draw) return;
  stopCamera();
  const rest = Array.from({ length: 45 }, (_, i) => i + 1).filter(n => !draw.numbers.includes(n) && n !== draw.bonus);
  ticket = { round: draw.round, games: [ [...draw.numbers.slice(0, 5), draw.bonus], [...draw.numbers.slice(0, 4), ...rest.slice(0, 2)], [...draw.numbers.slice(0, 3), ...rest.slice(2, 5)], [...draw.numbers.slice(0, 2), ...rest.slice(5, 9)], rest.slice(9, 15) ].map(g => g.sort((a, b) => a - b)) };
  demo = true;
  render();
  message('샘플 복권');
});
// Android's OS permission dialog can hide Chrome while permission is pending.
document.addEventListener('visibilitychange', () => { if (document.hidden && scanActive) { stopCamera(); message('카메라 중지'); } });
window.addEventListener('pagehide', () => { stopCamera(); scanner?.destroy(); scanner = null; });
void loadData();
