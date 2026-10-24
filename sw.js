// 안심 PDF 도구 - 오프라인 사용을 위한 서비스 워커
// ※ 이 파일은 tools/build_sw.py가 자동으로 만든다. 직접 고치지 말고 tools/sw.template.js를 고칠 것.
//
// 하는 일: 웹앱 '프로그램 파일'을 브라우저에 보관해 두었다가, 인터넷이 없어도 쓸 수 있게 한다.
// 하지 않는 일: 사용자가 불러온 PDF·사진은 절대 보관하지 않는다. (보관 목록은 아래 고정된 파일뿐)

const VERSION = 'e223cd0695e6';
const CACHE = 'anshim-pdf-' + VERSION;

// 처음 접속할 때 바로 보관하는 핵심 파일
const CORE = [
  './',
  'index.html',
  'guide.html',
  'licenses.html',
  'manifest.webmanifest',
  'page.js',
  'icons/icon-192.png',
  'icons/favicon-32.png',
  'lib/pdf-lib/pdf-lib.min.js',
  'lib/pdfjs/pdf.min.mjs',
  'lib/pdfjs/pdf.worker.min.mjs',
  'style.css?v=15',
  'app.js?v=15',
  'page.js?v=15'
];
// 이어서 뒤에서 보관하는 나머지 파일 (글꼴, 한글 문서 보조 자료 등)
const REST = [
  'icons/apple-touch-icon.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'lib/fontkit/LICENSE.txt',
  'lib/fontkit/fontkit.umd.min.js',
  'lib/fonts/NanumGothic-Bold.ttf',
  'lib/fonts/NanumGothic-Regular.ttf',
  'lib/fonts/OFL.txt',
  'lib/pdf-lib/LICENSE.md',
  'lib/pdf-lib/LICENSE.txt',
  'lib/pdfjs/LICENSE',
  'lib/pdfjs/LICENSE.txt',
  'lib/pdfjs/cmaps/78-EUC-H.bcmap',
  'lib/pdfjs/cmaps/78-EUC-V.bcmap',
  'lib/pdfjs/cmaps/78-H.bcmap',
  'lib/pdfjs/cmaps/78-RKSJ-H.bcmap',
  'lib/pdfjs/cmaps/78-RKSJ-V.bcmap',
  'lib/pdfjs/cmaps/78-V.bcmap',
  'lib/pdfjs/cmaps/78ms-RKSJ-H.bcmap',
  'lib/pdfjs/cmaps/78ms-RKSJ-V.bcmap',
  'lib/pdfjs/cmaps/83pv-RKSJ-H.bcmap',
  'lib/pdfjs/cmaps/90ms-RKSJ-H.bcmap',
  'lib/pdfjs/cmaps/90ms-RKSJ-V.bcmap',
  'lib/pdfjs/cmaps/90msp-RKSJ-H.bcmap',
  'lib/pdfjs/cmaps/90msp-RKSJ-V.bcmap',
  'lib/pdfjs/cmaps/90pv-RKSJ-H.bcmap',
  'lib/pdfjs/cmaps/90pv-RKSJ-V.bcmap',
  'lib/pdfjs/cmaps/Add-H.bcmap',
  'lib/pdfjs/cmaps/Add-RKSJ-H.bcmap',
  'lib/pdfjs/cmaps/Add-RKSJ-V.bcmap',
  'lib/pdfjs/cmaps/Add-V.bcmap',
  'lib/pdfjs/cmaps/Adobe-CNS1-0.bcmap',
  'lib/pdfjs/cmaps/Adobe-CNS1-1.bcmap',
  'lib/pdfjs/cmaps/Adobe-CNS1-2.bcmap',
  'lib/pdfjs/cmaps/Adobe-CNS1-3.bcmap',
  'lib/pdfjs/cmaps/Adobe-CNS1-4.bcmap',
  'lib/pdfjs/cmaps/Adobe-CNS1-5.bcmap',
  'lib/pdfjs/cmaps/Adobe-CNS1-6.bcmap',
  'lib/pdfjs/cmaps/Adobe-CNS1-UCS2.bcmap',
  'lib/pdfjs/cmaps/Adobe-GB1-0.bcmap',
  'lib/pdfjs/cmaps/Adobe-GB1-1.bcmap',
  'lib/pdfjs/cmaps/Adobe-GB1-2.bcmap',
  'lib/pdfjs/cmaps/Adobe-GB1-3.bcmap',
  'lib/pdfjs/cmaps/Adobe-GB1-4.bcmap',
  'lib/pdfjs/cmaps/Adobe-GB1-5.bcmap',
  'lib/pdfjs/cmaps/Adobe-GB1-UCS2.bcmap',
  'lib/pdfjs/cmaps/Adobe-Japan1-0.bcmap',
  'lib/pdfjs/cmaps/Adobe-Japan1-1.bcmap',
  'lib/pdfjs/cmaps/Adobe-Japan1-2.bcmap',
  'lib/pdfjs/cmaps/Adobe-Japan1-3.bcmap',
  'lib/pdfjs/cmaps/Adobe-Japan1-4.bcmap',
  'lib/pdfjs/cmaps/Adobe-Japan1-5.bcmap',
  'lib/pdfjs/cmaps/Adobe-Japan1-6.bcmap',
  'lib/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap',
  'lib/pdfjs/cmaps/Adobe-Korea1-0.bcmap',
  'lib/pdfjs/cmaps/Adobe-Korea1-1.bcmap',
  'lib/pdfjs/cmaps/Adobe-Korea1-2.bcmap',
  'lib/pdfjs/cmaps/Adobe-Korea1-UCS2.bcmap',
  'lib/pdfjs/cmaps/B5-H.bcmap',
  'lib/pdfjs/cmaps/B5-V.bcmap',
  'lib/pdfjs/cmaps/B5pc-H.bcmap',
  'lib/pdfjs/cmaps/B5pc-V.bcmap',
  'lib/pdfjs/cmaps/CNS-EUC-H.bcmap',
  'lib/pdfjs/cmaps/CNS-EUC-V.bcmap',
  'lib/pdfjs/cmaps/CNS1-H.bcmap',
  'lib/pdfjs/cmaps/CNS1-V.bcmap',
  'lib/pdfjs/cmaps/CNS2-H.bcmap',
  'lib/pdfjs/cmaps/CNS2-V.bcmap',
  'lib/pdfjs/cmaps/ETHK-B5-H.bcmap',
  'lib/pdfjs/cmaps/ETHK-B5-V.bcmap',
  'lib/pdfjs/cmaps/ETen-B5-H.bcmap',
  'lib/pdfjs/cmaps/ETen-B5-V.bcmap',
  'lib/pdfjs/cmaps/ETenms-B5-H.bcmap',
  'lib/pdfjs/cmaps/ETenms-B5-V.bcmap',
  'lib/pdfjs/cmaps/EUC-H.bcmap',
  'lib/pdfjs/cmaps/EUC-V.bcmap',
  'lib/pdfjs/cmaps/Ext-H.bcmap',
  'lib/pdfjs/cmaps/Ext-RKSJ-H.bcmap',
  'lib/pdfjs/cmaps/Ext-RKSJ-V.bcmap',
  'lib/pdfjs/cmaps/Ext-V.bcmap',
  'lib/pdfjs/cmaps/GB-EUC-H.bcmap',
  'lib/pdfjs/cmaps/GB-EUC-V.bcmap',
  'lib/pdfjs/cmaps/GB-H.bcmap',
  'lib/pdfjs/cmaps/GB-V.bcmap',
  'lib/pdfjs/cmaps/GBK-EUC-H.bcmap',
  'lib/pdfjs/cmaps/GBK-EUC-V.bcmap',
  'lib/pdfjs/cmaps/GBK2K-H.bcmap',
  'lib/pdfjs/cmaps/GBK2K-V.bcmap',
  'lib/pdfjs/cmaps/GBKp-EUC-H.bcmap',
  'lib/pdfjs/cmaps/GBKp-EUC-V.bcmap',
  'lib/pdfjs/cmaps/GBT-EUC-H.bcmap',
  'lib/pdfjs/cmaps/GBT-EUC-V.bcmap',
  'lib/pdfjs/cmaps/GBT-H.bcmap',
  'lib/pdfjs/cmaps/GBT-V.bcmap',
  'lib/pdfjs/cmaps/GBTpc-EUC-H.bcmap',
  'lib/pdfjs/cmaps/GBTpc-EUC-V.bcmap',
  'lib/pdfjs/cmaps/GBpc-EUC-H.bcmap',
  'lib/pdfjs/cmaps/GBpc-EUC-V.bcmap',
  'lib/pdfjs/cmaps/H.bcmap',
  'lib/pdfjs/cmaps/HKdla-B5-H.bcmap',
  'lib/pdfjs/cmaps/HKdla-B5-V.bcmap',
  'lib/pdfjs/cmaps/HKdlb-B5-H.bcmap',
  'lib/pdfjs/cmaps/HKdlb-B5-V.bcmap',
  'lib/pdfjs/cmaps/HKgccs-B5-H.bcmap',
  'lib/pdfjs/cmaps/HKgccs-B5-V.bcmap',
  'lib/pdfjs/cmaps/HKm314-B5-H.bcmap',
  'lib/pdfjs/cmaps/HKm314-B5-V.bcmap',
  'lib/pdfjs/cmaps/HKm471-B5-H.bcmap',
  'lib/pdfjs/cmaps/HKm471-B5-V.bcmap',
  'lib/pdfjs/cmaps/HKscs-B5-H.bcmap',
  'lib/pdfjs/cmaps/HKscs-B5-V.bcmap',
  'lib/pdfjs/cmaps/Hankaku.bcmap',
  'lib/pdfjs/cmaps/Hiragana.bcmap',
  'lib/pdfjs/cmaps/KSC-EUC-H.bcmap',
  'lib/pdfjs/cmaps/KSC-EUC-V.bcmap',
  'lib/pdfjs/cmaps/KSC-H.bcmap',
  'lib/pdfjs/cmaps/KSC-Johab-H.bcmap',
  'lib/pdfjs/cmaps/KSC-Johab-V.bcmap',
  'lib/pdfjs/cmaps/KSC-V.bcmap',
  'lib/pdfjs/cmaps/KSCms-UHC-H.bcmap',
  'lib/pdfjs/cmaps/KSCms-UHC-HW-H.bcmap',
  'lib/pdfjs/cmaps/KSCms-UHC-HW-V.bcmap',
  'lib/pdfjs/cmaps/KSCms-UHC-V.bcmap',
  'lib/pdfjs/cmaps/KSCpc-EUC-H.bcmap',
  'lib/pdfjs/cmaps/KSCpc-EUC-V.bcmap',
  'lib/pdfjs/cmaps/Katakana.bcmap',
  'lib/pdfjs/cmaps/LICENSE',
  'lib/pdfjs/cmaps/NWP-H.bcmap',
  'lib/pdfjs/cmaps/NWP-V.bcmap',
  'lib/pdfjs/cmaps/RKSJ-H.bcmap',
  'lib/pdfjs/cmaps/RKSJ-V.bcmap',
  'lib/pdfjs/cmaps/Roman.bcmap',
  'lib/pdfjs/cmaps/UniCNS-UCS2-H.bcmap',
  'lib/pdfjs/cmaps/UniCNS-UCS2-V.bcmap',
  'lib/pdfjs/cmaps/UniCNS-UTF16-H.bcmap',
  'lib/pdfjs/cmaps/UniCNS-UTF16-V.bcmap',
  'lib/pdfjs/cmaps/UniCNS-UTF32-H.bcmap',
  'lib/pdfjs/cmaps/UniCNS-UTF32-V.bcmap',
  'lib/pdfjs/cmaps/UniCNS-UTF8-H.bcmap',
  'lib/pdfjs/cmaps/UniCNS-UTF8-V.bcmap',
  'lib/pdfjs/cmaps/UniGB-UCS2-H.bcmap',
  'lib/pdfjs/cmaps/UniGB-UCS2-V.bcmap',
  'lib/pdfjs/cmaps/UniGB-UTF16-H.bcmap',
  'lib/pdfjs/cmaps/UniGB-UTF16-V.bcmap',
  'lib/pdfjs/cmaps/UniGB-UTF32-H.bcmap',
  'lib/pdfjs/cmaps/UniGB-UTF32-V.bcmap',
  'lib/pdfjs/cmaps/UniGB-UTF8-H.bcmap',
  'lib/pdfjs/cmaps/UniGB-UTF8-V.bcmap',
  'lib/pdfjs/cmaps/UniJIS-UCS2-H.bcmap',
  'lib/pdfjs/cmaps/UniJIS-UCS2-HW-H.bcmap',
  'lib/pdfjs/cmaps/UniJIS-UCS2-HW-V.bcmap',
  'lib/pdfjs/cmaps/UniJIS-UCS2-V.bcmap',
  'lib/pdfjs/cmaps/UniJIS-UTF16-H.bcmap',
  'lib/pdfjs/cmaps/UniJIS-UTF16-V.bcmap',
  'lib/pdfjs/cmaps/UniJIS-UTF32-H.bcmap',
  'lib/pdfjs/cmaps/UniJIS-UTF32-V.bcmap',
  'lib/pdfjs/cmaps/UniJIS-UTF8-H.bcmap',
  'lib/pdfjs/cmaps/UniJIS-UTF8-V.bcmap',
  'lib/pdfjs/cmaps/UniJIS2004-UTF16-H.bcmap',
  'lib/pdfjs/cmaps/UniJIS2004-UTF16-V.bcmap',
  'lib/pdfjs/cmaps/UniJIS2004-UTF32-H.bcmap',
  'lib/pdfjs/cmaps/UniJIS2004-UTF32-V.bcmap',
  'lib/pdfjs/cmaps/UniJIS2004-UTF8-H.bcmap',
  'lib/pdfjs/cmaps/UniJIS2004-UTF8-V.bcmap',
  'lib/pdfjs/cmaps/UniJISPro-UCS2-HW-V.bcmap',
  'lib/pdfjs/cmaps/UniJISPro-UCS2-V.bcmap',
  'lib/pdfjs/cmaps/UniJISPro-UTF8-V.bcmap',
  'lib/pdfjs/cmaps/UniJISX0213-UTF32-H.bcmap',
  'lib/pdfjs/cmaps/UniJISX0213-UTF32-V.bcmap',
  'lib/pdfjs/cmaps/UniJISX02132004-UTF32-H.bcmap',
  'lib/pdfjs/cmaps/UniJISX02132004-UTF32-V.bcmap',
  'lib/pdfjs/cmaps/UniKS-UCS2-H.bcmap',
  'lib/pdfjs/cmaps/UniKS-UCS2-V.bcmap',
  'lib/pdfjs/cmaps/UniKS-UTF16-H.bcmap',
  'lib/pdfjs/cmaps/UniKS-UTF16-V.bcmap',
  'lib/pdfjs/cmaps/UniKS-UTF32-H.bcmap',
  'lib/pdfjs/cmaps/UniKS-UTF32-V.bcmap',
  'lib/pdfjs/cmaps/UniKS-UTF8-H.bcmap',
  'lib/pdfjs/cmaps/UniKS-UTF8-V.bcmap',
  'lib/pdfjs/cmaps/V.bcmap',
  'lib/pdfjs/cmaps/WP-Symbol.bcmap',
  'lib/pdfjs/iccs/CGATS001Compat-v2-micro.icc',
  'lib/pdfjs/iccs/LICENSE',
  'lib/pdfjs/standard_fonts/FoxitDingbats.pfb',
  'lib/pdfjs/standard_fonts/FoxitFixed.pfb',
  'lib/pdfjs/standard_fonts/FoxitFixedBold.pfb',
  'lib/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb',
  'lib/pdfjs/standard_fonts/FoxitFixedItalic.pfb',
  'lib/pdfjs/standard_fonts/FoxitSerif.pfb',
  'lib/pdfjs/standard_fonts/FoxitSerifBold.pfb',
  'lib/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb',
  'lib/pdfjs/standard_fonts/FoxitSerifItalic.pfb',
  'lib/pdfjs/standard_fonts/FoxitSymbol.pfb',
  'lib/pdfjs/standard_fonts/LICENSE_FOXIT',
  'lib/pdfjs/standard_fonts/LICENSE_LIBERATION',
  'lib/pdfjs/standard_fonts/LiberationSans-Bold.ttf',
  'lib/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf',
  'lib/pdfjs/standard_fonts/LiberationSans-Italic.ttf',
  'lib/pdfjs/standard_fonts/LiberationSans-Regular.ttf',
  'lib/pdfjs/wasm/LICENSE_JBIG2',
  'lib/pdfjs/wasm/LICENSE_OPENJPEG',
  'lib/pdfjs/wasm/LICENSE_PDFJS_JBIG2',
  'lib/pdfjs/wasm/LICENSE_PDFJS_OPENJPEG',
  'lib/pdfjs/wasm/LICENSE_PDFJS_QCMS',
  'lib/pdfjs/wasm/LICENSE_QCMS',
  'lib/pdfjs/wasm/jbig2.wasm',
  'lib/pdfjs/wasm/jbig2_nowasm_fallback.js',
  'lib/pdfjs/wasm/openjpeg.wasm',
  'lib/pdfjs/wasm/openjpeg_nowasm_fallback.js',
  'lib/pdfjs/wasm/qcms_bg.wasm',
  'lib/pdfjs/wasm/quickjs-eval.js',
  'lib/pdfjs/wasm/quickjs-eval.wasm'
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
