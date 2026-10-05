type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

export async function requestCamera(getUserMedia: GetUserMedia): Promise<MediaStream> {
  try {
    return await getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (error) {
    // Only retry unsupported constraints; preserve permission and device errors.
    if ((error as { name?: string })?.name !== 'OverconstrainedError') throw error;
    return await getUserMedia({ audio: false, video: true });
  }
}

export function prepareCameraVideo(video: HTMLVideoElement) {
  video.hidden = false;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  // QrScanner permanently zeroes video size if initialized with display:none.
  video.style.display = 'block';
  video.style.visibility = 'visible';
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.removeProperty('opacity');
}

export function cameraErrorMessage(error: unknown): string {
  const name = (error as { name?: string })?.name;
  switch (name) {
    case 'NotAllowedError': case 'SecurityError':
      return '카메라 권한이 없습니다. Chrome의 이 사이트 권한과 Android 설정의 Chrome 카메라 권한을 허용하세요. (권한 거부)';
    case 'NotFoundError':
      return '사용 가능한 카메라가 없습니다. 사진을 선택하세요. (카메라 없음)';
    case 'NotReadableError':
      return '카메라를 사용할 수 없습니다. 다른 앱의 카메라를 종료하고 다시 시도하세요. (카메라 사용 중)';
    case 'OverconstrainedError':
      return '이 기기의 카메라 설정을 지원하지 않습니다. 사진을 선택하세요. (설정 미지원)';
    case 'AbortError':
      return '카메라 시작이 중단되었습니다. 다시 시도하세요. (시작 중단)';
    default:
      return `카메라 실행 실패. 다시 시도하거나 사진을 선택하세요.${name ? ` (${name})` : ''}`;
  }
}
