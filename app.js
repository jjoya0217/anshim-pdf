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
//  files: 불러온 파일 목록  { id, label, name, size, bytes, pdf, pageCount }
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
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      problems.push(`${file.name}: PDF 파일이 아닙니다.`);
      continue;
    }

    try {
      // (1) 파일 내용을 메모리로 읽는다
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // (2) PDF.js로 연다.
      //     PDF.js는 넘겨받은 데이터를 워커로 옮기며 비워 버리므로 복사본을 넘긴다.
      const pdf = await pdfjsLib.getDocument({ ...PDFJS_OPTIONS, data: bytes.slice() }).promise;

      const id = nextFileId++;
      state.files.push({
        id,
        label: fileLabel(id),
        colorClass: 'c' + (id % 6),
        name: file.name,
        size: file.size,
        bytes,
        pdf,
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

// 모두 지우기
els.clearBtn.addEventListener('click', () => {
  for (const f of state.files) f.pdf.destroy();     // PDF.js가 쓰던 메모리 정리
  state.files = [];
  state.pages = [];
  render();
  showMsg('');
});

// =====================================================================
// 5. 화면 그리기
// =====================================================================

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
  for (const f of state.files) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="file-tag ${f.colorClass}">${f.label}</span>
      <span class="file-name"></span>
      <span class="file-meta">${f.pageCount}쪽 · ${formatSize(f.size)}</span>`;
    li.querySelector('.file-name').textContent = f.name;   // 파일 이름은 글자 그대로 넣는다(안전)
    els.fileList.appendChild(li);
  }
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
      <figcaption>
        <span class="file-tag ${file.colorClass}">${file.label}</span>
        ${order + 1}쪽
      </figcaption>`;
    els.pageGrid.appendChild(fig);
    observer.observe(fig.querySelector('.thumb'));
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
