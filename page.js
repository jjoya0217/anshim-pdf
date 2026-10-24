// 안내 페이지(사용 방법·라이선스)용 작은 코드
//  - 인쇄 버튼
//  - 오프라인 사용 준비(서비스 워커 등록)

document.getElementById('printBtn')?.addEventListener('click', () => window.print());

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 준비 실패해도 페이지는 그대로 동작 */ });
}
