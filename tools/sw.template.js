// 안심 PDF 도구 - 오프라인 사용을 위한 서비스 워커
// ※ 이 파일은 tools/build_sw.py가 자동으로 만든다. 직접 고치지 말고 tools/sw.template.js를 고칠 것.
//
// 하는 일: 웹앱 '프로그램 파일'을 브라우저에 보관해 두었다가, 인터넷이 없어도 쓸 수 있게 한다.
// 하지 않는 일: 사용자가 불러온 PDF·사진은 절대 보관하지 않는다. (보관 목록은 아래 고정된 파일뿐)

const VERSION = '__VERSION__';
const CACHE = 'anshim-pdf-' + VERSION;

// 처음 접속할 때 바로 보관하는 핵심 파일
const CORE = [
  __CORE__
];
// 이어서 뒤에서 보관하는 나머지 파일 (글꼴, 한글 문서 보조 자료 등)
const REST = [
  __REST__
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 예전 버전 보관함 지우기
    for (const key of await caches.keys()) {
      if (key.startsWith('anshim-pdf-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
    // 나머지 파일은 기다리지 않고 뒤에서 보관 (실패해도 다음 접속 때 다시 시도)
    caches.open(CACHE).then(async (c) => {
      if (!(await c.match('lib/fonts/OFL.txt'))) await c.addAll(REST);
    }).catch(() => {});
  })());
});

// 같은 웹앱 주소의 프로그램 파일만 다룬다. 다른 주소로의 요청은 손대지 않는다.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // 페이지: 인터넷이 되면 최신 화면, 안 되면 보관한 화면
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(async () => (await caches.match(req)) || caches.match('./')),
    );
    return;
  }

  // 그 밖의 프로그램 파일: 보관한 것을 먼저 쓰고, 없으면 내려받아 보관
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});

// 화면에서 '오프라인 준비 상태'를 물어보면 답한다
self.addEventListener('message', async (event) => {
  if (event.data === 'status') {
    const c = await caches.open(CACHE);
    const ready = !!(await c.match('lib/fonts/OFL.txt'));
    event.source?.postMessage({ type: 'status', ready, version: VERSION });
  }
});
