import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import QrScanner from 'qr-scanner';
import { requestCamera, prepareCameraVideo, cameraErrorMessage } from '../src/camera';

test('preview retains its size after actual QrScanner initialization', async () => {
  const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
  const dom = new JSDOM(`<style>${css}</style><div class="viewfinder" hidden><video></video></div>`, { pretendToBeVisual: true });
  const video = dom.window.document.querySelector('video')! as unknown as HTMLVideoElement;
  const keys = ['window', 'document', 'requestAnimationFrame'] as const;
  const originals = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const engine = QrScanner.createQrEngine;
  let scanner: QrScanner | undefined;
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: dom.window.requestAnimationFrame.bind(dom.window) });
    QrScanner.createQrEngine = async () => ({ postMessage() {} }) as unknown as Worker;
    assert.equal(dom.window.getComputedStyle(video.parentElement!).display, 'none', 'idle camera must not take up space');
    prepareCameraVideo(video);
    video.parentElement!.hidden = false;
    video.parentElement!.classList.add('active');
    scanner = new QrScanner(video, () => {}, { returnDetailedScanResult: true });
    await new Promise<void>(resolve => dom.window.requestAnimationFrame(() => resolve()));
    assert.equal(video.style.width, '100%', 'library must not set video width to 0');
    assert.equal(video.style.height, '100%', 'library must not set video height to 0');
    const computed = dom.window.getComputedStyle(video as unknown as Element);
    assert.equal(computed.display, 'block');
    assert.equal(dom.window.getComputedStyle(video as unknown as Element).opacity, '1', 'active stream must be visible');
    video.parentElement!.hidden = true;
    video.parentElement!.classList.remove('active');
    assert.equal(dom.window.getComputedStyle(video.parentElement!).display, 'none', 'stopped camera must collapse after scanning');
    assert.equal(video.muted, true);
    assert.equal(video.playsInline, true);
  } finally {
    // Detach listeners without exercising real media APIs in this DOM test.
    if (scanner) {
      video.removeEventListener('play', (scanner as any)._onPlay);
      video.removeEventListener('loadedmetadata', (scanner as any)._onLoadedMetaData);
    }
    QrScanner.createQrEngine = engine;
    keys.forEach((key, i) => { if (originals[i]) Object.defineProperty(globalThis, key, originals[i]!); else Reflect.deleteProperty(globalThis, key); });
    dom.window.close();
  }
});

test('camera uses optional rear-facing constraints without mandatory dimensions', async () => {
  const stream = {} as MediaStream;
  let received: MediaStreamConstraints | undefined;
  assert.equal(await requestCamera(async constraints => { received = constraints; return stream; }), stream);
  assert.deepEqual(received, { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
});
test('permission denial preserves the actual error and does not request repeatedly', async () => {
  const error = new DOMException('Denied', 'NotAllowedError');
  let calls = 0;
  await assert.rejects(requestCamera(async () => { calls++; throw error; }), e => e === error);
  assert.equal(calls, 1);
  assert.match(cameraErrorMessage(error), /권한/);
});
test('unavailable constraints fall back to any video camera', async () => {
  const stream = {} as MediaStream;
  const received: MediaStreamConstraints[] = [];
  const result = await requestCamera(async constraints => {
    received.push(constraints);
    if (received.length === 1) throw new DOMException('', 'OverconstrainedError');
    return stream;
  });
  assert.equal(result, stream);
  assert.deepEqual(received[1], { audio: false, video: true });
});
test('busy hardware and missing devices report distinct errors', () => {
  assert.match(cameraErrorMessage(new DOMException('', 'NotReadableError')), /사용 중/);
  assert.match(cameraErrorMessage(new DOMException('', 'NotFoundError')), /카메라 없음/);
});
