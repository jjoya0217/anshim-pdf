// 안심 PDF 도구 - 메인 코드
//
// 1단계-① 뼈대와 보안 점검
// 1단계-② PDF 불러와 미리보기   ← 이번 단계
//
// [핵심 개념] 모든 작업은 브라우저 메모리 안에서만 일어난다.
//  - 사용자가 고른 파일을 읽어 메모리에 담고(ArrayBuffer)
//  - PDF.js로 각 페이지를 작은 그림(canvas)으로 그린다.
//  - 어디에도 전송·저장하지 않는다. 탭을 닫으면 사라진다.

import * as pdfjsLib from './lib/pdfjs/pdf.min.mjs';

// PDF.js는 무거운 작업을 '워커'라는 별도 일꾼에게 맡긴다. 워커 파일도 웹앱 폴더 안에 있다.
pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdfjs/pdf.worker.min.mjs';

// 한글 문서 표시에 필요한 보조 자료(글꼴 정보 등)도 웹앱 폴더 안에서 가져온다.
const LIB = new URL('./lib/pdfjs/', location.href).href;
const PDFJS_OPTIONS = {
  cMapUrl: LIB + 'cmaps/',
  cMapPacked: true,
  standardFontDataUrl: LIB + 'standard_fonts/',
  wasmUrl: LIB + 'wasm/',
  iccUrl: LIB + 'iccs/',
};

// =====================================================================
// 1. 작업 상태 (메모리에만 있음)
// =====================================================================
//  files: 불러온 파일 목록  { id, name, size, bytes, pdf, pageCount }
//    - bytes: 원본 파일 데이터. 나중에 pdf-lib로 병합·저장할 때 쓴다.
//    - pdf  : PDF.js가 연 문서. 미리보기를 그릴 때 쓴다.
//  pages: 화면에 보이는 페이지 순서 { fileId, index }
//    - 다음 단계에서 삭제·순서 변경·회전은 이 목록만 바꾸면 된다.
const state = {
  files: [],
  pages: [],
};
let nextFileId = 0;

// =====================================================================
// 2. 화면 요소
// =====================================================================
const $ = (id) => document.getElementById(id);
const els = {
  drop: $('drop'),
  input: $('fileInput'),
  msg: $('msg'),
  filesCard: $('filesCard'),
  total: $('total'),
  fileList: $('fileList'),
  clearBtn: $('clearBtn'),
  pagesCard: $('pagesCard'),
  pageGrid: $('pageGrid'),
};

// =====================================================================
// 3. 작은 도우미 함수들
// =====================================================================

// 바이트 수를 사람이 읽기 쉬운 크기로 (10MB 판정과 같은 기준: 1MB = 1,000,000바이트)
function formatSize(bytes) {
  if (bytes < 1_000_000) return (bytes / 1000).toFixed(0) + 'KB';
  return (bytes / 1_000_000).toFixed(1) + 'MB';
}

// 0 → A, 1 → B ... 파일을 구분하는 글자
function fileLabel(n) {
  return String.fromCharCode(65 + (n % 26));
}

function showMsg(text, type = 'ok') {
  els.msg.hidden = !text;
  els.msg.textContent = text;
  els.msg.className = 'msg ' + type;
}

// =====================================================================
// 4. 파일 불러오기
// =====================================================================

// 파일 선택 창에서 고른 경우
els.input.addEventListener('change', () => {
  addFiles(els.input.files);
  els.input.value = '';            // 같은 파일을 다시 골라도 동작하도록 비워 둔다
});

// PC에서 끌어다 놓은 경우
els.drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.drop.classList.add('over');
});
els.drop.addEventListener('dragleave', () => els.drop.classList.remove('over'));
els.drop.addEventListener('drop', (e) => {
  e.preventDefault();
  els.drop.classList.remove('over');
  addFiles(e.dataTransfer.files);
});

async function addFiles(fileList) {
  const picked = [...fileList];
  if (picked.length === 0) return;

  const problems = [];
  let added = 0;
  showMsg('불러오는 중…');

  // 고른 순서대로 하나씩 처리한다
  for (const file of picked) {
    try {
      // (1) 파일 내용을 메모리로 읽는다
      const buffer = await file.arrayBuffer();
      let bytes = new Uint8Array(buffer);

      // 파일 종류 확인: 파일 이름이 아니라 내용의 첫머리를 본다.
      // (휴대폰에서는 파일 이름에 확장자가 빠진 채 전달되는 경우가 있다)
      const kind = detectKind(bytes);
      let fromImage = false;

      if (kind === 'heic') {
        problems.push(`${file.name}: 아이폰 사진 형식(HEIC)은 열 수 없습니다. JPG로 바꾼 뒤 불러와 주세요.`);
        continue;
      }
      if (kind === 'jpg' || kind === 'png') {
        showMsg(`${file.name} 사진을 PDF로 바꾸는 중…`);
        bytes = await imageToPdf(file);       // 사진 → 1쪽짜리 PDF
        fromImage = true;
      } else if (kind !== 'pdf') {
        problems.push(`${file.name}: PDF나 사진(JPG·PNG) 파일이 아닙니다.`);
        continue;
      }

      // (2) PDF.js로 연다.
      //     PDF.js는 넘겨받은 데이터를 워커로 옮기며 비워 버리므로 복사본을 넘긴다.
      const task = pdfjsLib.getDocument({ ...PDFJS_OPTIONS, data: bytes.slice() });
      const pdf = await task.promise;

      const id = nextFileId++;
      state.files.push({
        id,
        name: file.name,
        size: bytes.length,        // 사진은 변환 후 PDF 크기 (10MB 판정에 쓰이는 실제 크기)
        originalSize: file.size,
        fromImage,
        bytes,
        pdf,
        task,                      // 나중에 메모리를 정리할 때 쓴다
        pageCount: pdf.numPages,
      });
      for (let i = 0; i < pdf.numPages; i++) {
        state.pages.push({ fileId: id, index: i });
      }
      added++;
    } catch (err) {
      problems.push(`${file.name}: ${explainError(err)}`);
    }
  }

  render();

  if (problems.length) {
    showMsg(problems.join('\n'), 'bad');
  } else {
    showMsg(added ? `${added}개 파일을 불러왔습니다.` : '');
  }
}

// 파일 종류를 내용의 첫머리(파일 서명)로 알아낸다
function detectKind(bytes) {
  const b = bytes;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';            // JPG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png'; // PNG
  const head = new TextDecoder('latin1').decode(b.subarray(0, 1024));
  if (head.includes('%PDF')) return 'pdf';
  if (/^....ftyp(heic|heix|hevc|mif1|msf1)/.test(head)) return 'heic';              // 아이폰 사진
  return 'unknown';
}

// =====================================================================
// 4-1. 사진 → PDF 변환 (1단계-③)
// =====================================================================
// 처리 순서
//  1) 사진을 그림으로 읽는다. 휴대폰 사진의 회전 정보도 반영한다.
//  2) A4에 인쇄하기 충분한 크기(긴 변 2339픽셀 ≒ 200dpi)를 넘으면 줄인다.
//  3) 캔버스에 다시 그려 JPG로 저장한다.
//     → 이 과정에서 촬영 위치(GPS)·기기 정보 같은 숨은 정보가 모두 사라진다.
//  4) pdf-lib로 A4 페이지 한 장짜리 PDF를 만들고, 사진을 비율 그대로 페이지에 맞춘다.

const A4 = { w: 595.28, h: 841.89 };   // A4 크기 (PDF 단위: 1/72인치)
const MAX_SIDE = 2339;                  // A4 긴 변을 200dpi로 인쇄할 때의 픽셀 수
const JPG_QUALITY = 0.88;

async function imageToPdf(file) {
  // 1) 사진 읽기 (회전 정보 반영)
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

  // 2) 크기 줄이기 (이미 작으면 그대로)
  const ratio = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * ratio);
  const h = Math.round(bitmap.height * ratio);

  // 3) 캔버스에 다시 그려 JPG로 만들기
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';            // 투명한 PNG는 흰 바탕으로
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', JPG_QUALITY));
  const jpgBytes = new Uint8Array(await blob.arrayBuffer());

  // 4) A4 PDF 만들기 (가로 사진이면 가로 페이지)
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.create();
  const landscape = w > h;
  const pageW = landscape ? A4.h : A4.w;
  const pageH = landscape ? A4.w : A4.h;
  const page = doc.addPage([pageW, pageH]);

  const image = await doc.embedJpg(jpgBytes);
  const scale = Math.min(pageW / w, pageH / h);   // 비율을 유지하며 페이지 안에 꼭 맞추기
  const drawW = w * scale;
  const drawH = h * scale;
  page.drawImage(image, {
    x: (pageW - drawW) / 2,                       // 가운데 정렬
    y: (pageH - drawH) / 2,
    width: drawW,
    height: drawH,
  });

  // 만든 프로그램 이름 같은 PDF 속성 정보도 비워 둔다
  doc.setProducer('');
  doc.setCreator('');

  return await doc.save();
}

// PDF.js 오류를 이해하기 쉬운 말로 바꾼다
function explainError(err) {
  if (err?.name === 'PasswordException') {
    return '암호가 걸린 PDF는 열 수 없습니다. 암호를 해제한 뒤 다시 불러와 주세요.';
  }
  if (err?.name === 'InvalidPDFException') {
    return '손상되었거나 올바르지 않은 PDF입니다.';
  }
  return '파일을 여는 중 문제가 생겼습니다.';
}

// =====================================================================
// 4-2. 파일 정리: 순서 바꾸기, 하나씩 지우기, 모두 지우기
// =====================================================================

// 파일 목록의 버튼은 목록 전체에서 한 번에 받는다(이벤트 위임).
// 버튼마다 data-act(무엇을)와 data-id(어떤 파일)를 붙여 두었다.
els.fileList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.act === 'up') moveFile(id, -1);
  if (btn.dataset.act === 'down') moveFile(id, +1);
  if (btn.dataset.act === 'remove') removeFile(id);
});

// 파일 순서를 한 칸 옮긴다 (dir: -1 = 위로, +1 = 아래로)
function moveFile(id, dir) {
  const from = state.files.findIndex((f) => f.id === id);
  const to = from + dir;
  if (to < 0 || to >= state.files.length) return;

  // 1) 파일 목록에서 자리 바꾸기
  const [file] = state.files.splice(from, 1);
  state.files.splice(to, 0, file);

  // 2) 페이지도 파일 순서대로 다시 모으기 (같은 파일 안의 페이지 순서는 그대로)
  const order = new Map(state.files.map((f, i) => [f.id, i]));
  state.pages = state.pages
    .map((p, i) => ({ p, i }))
    .sort((a, b) => order.get(a.p.fileId) - order.get(b.p.fileId) || a.i - b.i)
    .map((x) => x.p);

  render();
  // 옮긴 파일이 화면에서 눈에 띄도록 잠깐 강조한다
  const li = els.fileList.querySelector(`li[data-id="${id}"]`);
  li?.classList.add('flash');
}

// 파일 하나와 그 파일의 페이지를 모두 지운다
function removeFile(id) {
  const file = state.files.find((f) => f.id === id);
  if (!file) return;
  if (!confirm(`"${file.name}" 파일을 목록에서 뺄까요?\n(원본 파일은 그대로 남아 있습니다.)`)) return;

  forgetFile(file);
  state.files = state.files.filter((f) => f.id !== id);
  state.pages = state.pages.filter((p) => p.fileId !== id);
  render();
  showMsg(`"${file.name}" 파일을 뺐습니다.`);
}

// 모두 지우기
els.clearBtn.addEventListener('click', () => {
  if (!confirm('불러온 파일을 모두 뺄까요?')) return;
  state.files.forEach(forgetFile);
  state.files = [];
  state.pages = [];
  render();
  showMsg('');
});

// 파일이 쓰던 메모리(PDF.js 문서, 미리보기 그림)를 정리한다
function forgetFile(file) {
  file.task.destroy();
  for (const key of thumbCache.keys()) {
    if (key.startsWith(file.id + ':')) thumbCache.delete(key);
  }
}

// =====================================================================
// 5. 화면 그리기
// =====================================================================

// 파일 표시(A, B, C…)와 색은 '지금 몇 번째 파일인가'로 정한다.
// 그래서 순서를 바꾸면 맨 위 파일이 항상 A가 된다.
function tagOf(file) {
  const n = state.files.indexOf(file);
  return `<span class="file-tag c${n % 6}">${fileLabel(n)}</span>`;
}

function render() {
  renderFiles();
  renderPages();
}

function renderFiles() {
  const has = state.files.length > 0;
  els.filesCard.hidden = !has;
  if (!has) return;

  const totalSize = state.files.reduce((s, f) => s + f.size, 0);
  els.total.textContent =
    `파일 ${state.files.length}개 · 총 ${state.pages.length}쪽 · ${formatSize(totalSize)}`;

  els.fileList.innerHTML = '';
  const last = state.files.length - 1;
  state.files.forEach((f, i) => {
    const li = document.createElement('li');
    li.dataset.id = f.id;
    li.innerHTML = `
      ${tagOf(f)}
      <div class="file-info">
        <span class="file-name"></span>
        <span class="file-meta">${f.fromImage ? '<span class="badge">사진→PDF</span> ' : ''}${f.pageCount}쪽 · ${formatSize(f.size)}</span>
      </div>
      <div class="file-btns">
        <button type="button" class="icon-btn" data-act="up" data-id="${f.id}" ${i === 0 ? 'disabled' : ''} aria-label="위로">▲</button>
        <button type="button" class="icon-btn" data-act="down" data-id="${f.id}" ${i === last ? 'disabled' : ''} aria-label="아래로">▼</button>
        <button type="button" class="icon-btn danger" data-act="remove" data-id="${f.id}" aria-label="빼기">✕</button>
      </div>`;
    li.querySelector('.file-name').textContent = f.name;   // 파일 이름은 글자 그대로 넣는다(안전)
    els.fileList.appendChild(li);
  });
}

// 미리보기는 '화면에 보일 때' 그린다(지연 그리기).
// 300쪽짜리 PDF를 한꺼번에 그리면 컴퓨터가 느려지기 때문이다.
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      observer.unobserve(entry.target);
      drawThumb(entry.target);
    }
  }
}, { rootMargin: '300px' });   // 화면에 들어오기 조금 전에 미리 그리기 시작

// 한 번 그린 미리보기는 기억해 두었다가 다시 쓴다(순서를 바꿀 때 다시 그리지 않도록)
const thumbCache = new Map();   // '파일id:페이지번호' → canvas

function renderPages() {
  const has = state.pages.length > 0;
  els.pagesCard.hidden = !has;
  observer.disconnect();
  els.pageGrid.innerHTML = '';
  if (!has) return;

  state.pages.forEach((p, order) => {
    const file = state.files.find((f) => f.id === p.fileId);
    const fig = document.createElement('figure');
    fig.className = 'page';
    fig.innerHTML = `
      <div class="thumb" data-file="${p.fileId}" data-index="${p.index}"></div>
      <figcaption>${tagOf(file)} ${order + 1}쪽</figcaption>`;
    els.pageGrid.appendChild(fig);

    const box = fig.querySelector('.thumb');
    const cached = thumbCache.get(`${p.fileId}:${p.index}`);
    if (cached) box.appendChild(cached);
    else observer.observe(box);
  });
}

// 페이지 한 장을 작은 그림으로 그린다
async function drawThumb(box) {
  const file = state.files.find((f) => f.id === Number(box.dataset.file));
  if (!file) return;
  try {
    const page = await file.pdf.getPage(Number(box.dataset.index) + 1);

    // 썸네일 가로 크기를 약 220픽셀(선명하게 보이도록 화면 크기의 2배)에 맞춘다
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 220 / base.width });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    await page.render({ canvas, viewport }).promise;
    thumbCache.set(`${box.dataset.file}:${box.dataset.index}`, canvas);
    box.innerHTML = '';
    box.appendChild(canvas);
  } catch {
    box.textContent = '미리보기 실패';
  }
}

// =====================================================================
// 6. 안심 점검 (1단계-①)
// =====================================================================

function mark(key, ok) {
  const li = document.querySelector(`#checks li[data-key="${key}"]`);
  li.classList.add(ok ? 'ok' : 'bad');
  return ok;
}

// 외부 통신 차단 시험: 일부러 바깥 주소로 요청을 보내 보고, 브라우저가 막는지 확인한다.
function testCsp() {
  return new Promise((resolve) => {
    let blocked = false;
    const onViolation = (e) => {
      if (e.violatedDirective.startsWith('connect-src')) blocked = true;
    };
    document.addEventListener('securitypolicyviolation', onViolation);

    fetch('https://example.invalid/csp-test')
      .catch(() => {})
      .finally(() => {
        setTimeout(() => {
          document.removeEventListener('securitypolicyviolation', onViolation);
          resolve(blocked);
        }, 300);
      });
  });
}

async function runChecks() {
  const results = [];
  results.push(mark('pdfjs', typeof pdfjsLib.getDocument === 'function'));
  results.push(mark('pdflib', typeof window.PDFLib?.PDFDocument === 'function'));
  results.push(mark('csp', await testCsp()));

  const summary = $('summary');
  if (results.every(Boolean)) {
    summary.textContent = '모든 준비가 끝났습니다. 외부 통신은 차단된 상태입니다.';
    summary.className = 'hint ok';
  } else {
    summary.textContent = '일부 항목이 준비되지 않았습니다. 빨간 점 항목을 확인해 주세요.';
    summary.className = 'hint bad';
  }
}

runChecks();
