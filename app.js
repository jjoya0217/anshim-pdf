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
//  pages: 화면에 보이는 페이지 순서 { fileId, index, key, rot, masks }
//    - rot: 사용자가 돌린 각도(0·90·180·270)
//    - masks: 가린 영역 목록 { x, y, w, h, color } (0~1 비율, 회전 전 기준)
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
  pageMsg: $('pageMsg'),
  selectAllBtn: $('selectAllBtn'),
  toolbar: $('toolbar'),
  selCount: $('selCount'),
  saveCard: $('saveCard'),
  nameInput: $('nameInput'),
  saveBtn: $('saveBtn'),
  saveMsg: $('saveMsg'),
  savePanel: $('savePanel'),
  imgCard: $('imgCard'),
  imgTarget: $('imgTarget'),
  imgBtn: $('imgBtn'),
  imgMsg: $('imgMsg'),
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
        state.pages.push({ fileId: id, index: i, key: `${id}:${i}`, rot: 0, masks: [], items: [] });
      }
      added++;
    } catch (err) {
      problems.push(`${file.name}: ${explainError(err)}`);
    }
  }

  resetPageEdits();
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

  resetPageEdits();
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
  resetPageEdits();
  render();
  showMsg(`"${file.name}" 파일을 뺐습니다.`);
}

// 모두 지우기
els.clearBtn.addEventListener('click', () => {
  if (!confirm('불러온 파일을 모두 뺄까요?')) return;
  state.files.forEach(forgetFile);
  state.files = [];
  state.pages = [];
  resetPageEdits();
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

// 파일의 쪽수 표시: 일부 페이지를 지웠으면 '사용 3/38쪽'
function usedPages(f) {
  const used = state.pages.filter((p) => p.fileId === f.id).length;
  return used === f.pageCount ? `${f.pageCount}쪽` : `사용 ${used}/${f.pageCount}쪽`;
}

function render() {
  renderFiles();
  renderPages();
  renderSave();
  renderImgCard();
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
        <span class="file-meta">${f.fromImage ? '<span class="badge">사진→PDF</span> ' : ''}${usedPages(f)} · ${formatSize(f.size)}</span>
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
// 열쇠: '파일id:페이지번호@회전각도' → canvas
const thumbCache = new Map();
const thumbKey = (p) => `${p.key}@${p.rot}`;

function renderPages() {
  const has = state.pages.length > 0;
  els.pagesCard.hidden = !has;
  observer.disconnect();
  els.pageGrid.innerHTML = '';
  renderToolbar();
  if (!has) return;

  state.pages.forEach((p, order) => {
    const file = state.files.find((f) => f.id === p.fileId);
    const fig = document.createElement('figure');
    fig.className = 'page' + (selected.has(p.key) ? ' selected' : '');
    fig.dataset.key = p.key;
    fig.innerHTML = `
      <div class="thumb" data-key="${p.key}">
        <span class="check" aria-hidden="true">✓</span>
      </div>
      <figcaption>${tagOf(file)} ${order + 1}쪽${p.rot ? ` <span class="rot">↻${p.rot}°</span>` : ''}${p.masks.length ? ` <span class="mask-count">가림 ${p.masks.length}</span>` : ''}${p.items.length ? ` <span class="item-count">편집 ${p.items.length}</span>` : ''}</figcaption>`;
    els.pageGrid.appendChild(fig);

    const box = fig.querySelector('.thumb');
    const cached = thumbCache.get(thumbKey(p));
    if (cached) showSheet(box, cached, p);
    else observer.observe(box);
  });
}

// 미리보기 그림 위에 가린 영역을 겹쳐 보여 준다
function showSheet(box, canvas, p) {
  box.querySelector('.sheet')?.remove();
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.appendChild(canvas);
  for (const m of p.masks) sheet.appendChild(maskEl(toDisplay(m, p.rot), m.color));
  if (p.items.length) sheet.appendChild(itemsSvg(p));
  box.appendChild(sheet);
}

// 페이지 한 장을 작은 그림으로 그린다 (회전 반영)
async function drawThumb(box) {
  const p = state.pages.find((x) => x.key === box.dataset.key);
  const file = p && state.files.find((f) => f.id === p.fileId);
  if (!file) return;
  try {
    const page = await file.pdf.getPage(p.index + 1);
    const rotation = (page.rotate + p.rot) % 360;   // 원래 회전 + 사용자가 돌린 각도

    // 썸네일 가로 크기를 약 220픽셀(선명하게 보이도록 화면 크기의 2배)에 맞춘다
    const base = page.getViewport({ scale: 1, rotation });
    const viewport = page.getViewport({ scale: 220 / base.width, rotation });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    await page.render({ canvas, viewport }).promise;
    const sv = page.getViewport({ scale: 1 });   // 글씨 크기 계산용 페이지 크기 기억
    (file.sizes ||= [])[p.index] = { w: sv.width, h: sv.height };
    thumbCache.set(thumbKey(p), canvas);
    showSheet(box, canvas, p);
  } catch {
    box.append('미리보기 실패');
  }
}

// =====================================================================
// 5-1. 페이지 정리 (1단계-④): 선택 → 회전·이동·삭제, 되돌리기
// =====================================================================

const selected = new Set();   // 선택한 페이지들의 key
const history = [];           // 되돌리기용: 바꾸기 전 페이지 목록을 쌓아 둔다
const HISTORY_MAX = 30;

// 페이지를 누르면 선택/해제
els.pageGrid.addEventListener('click', (e) => {
  const fig = e.target.closest('.page');
  if (!fig) return;
  const key = fig.dataset.key;
  if (selected.has(key)) selected.delete(key);
  else selected.add(key);
  fig.classList.toggle('selected');
  renderToolbar();
});

els.selectAllBtn.addEventListener('click', () => {
  const all = selected.size === state.pages.length;
  selected.clear();
  if (!all) state.pages.forEach((p) => selected.add(p.key));
  renderPages();
});

// 도구 막대 버튼
els.toolbar.addEventListener('click', (e) => {
  const act = e.target.closest('button[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'mask') openEditorForSelection();
  if (act === 'rotL') rotateSelected(-90);
  if (act === 'rotR') rotateSelected(90);
  if (act === 'prev') shiftSelected(-1);
  if (act === 'next') shiftSelected(+1);
  if (act === 'moveTo') moveSelectedTo();
  if (act === 'delete') deleteSelected();
  if (act === 'undo') undo();
  if (act === 'clearSel') { selected.clear(); renderPages(); }
});

// 페이지 하나를 통째로 복사 (가림 상자·글씨·도형까지)
function copyPage(p) {
  return { ...p, masks: p.masks.map((m) => ({ ...m })), items: p.items.map((it) => ({ ...it })) };
}

// 바꾸기 직전의 페이지 목록을 기록해 둔다 (페이지 객체도 복사: 회전값이 바뀌므로)
function remember() {
  history.push(state.pages.map(copyPage));
  if (history.length > HISTORY_MAX) history.shift();
}

// 파일을 추가·삭제·이동하면 되돌리기 기록과 선택을 비운다(꼬이지 않도록)
function resetPageEdits() {
  history.length = 0;
  selected.clear();
}

function undo() {
  if (!history.length) return;
  state.pages = history.pop();
  for (const k of [...selected]) {
    if (!state.pages.some((p) => p.key === k)) selected.delete(k);
  }
  render();
  showPageMsg('되돌렸습니다.');
}

function rotateSelected(deg) {
  if (!selected.size) return;
  remember();
  for (const p of state.pages) {
    if (selected.has(p.key)) p.rot = (p.rot + deg + 360) % 360;
  }
  renderPages();
}

// 선택한 페이지를 한 칸 앞(-1) 또는 뒤(+1)로
function shiftSelected(dir) {
  if (!selected.size) return;
  remember();
  const a = state.pages;
  const isSel = (i) => selected.has(a[i].key);
  if (dir < 0) {
    for (let i = 1; i < a.length; i++) {
      if (isSel(i) && !isSel(i - 1)) [a[i - 1], a[i]] = [a[i], a[i - 1]];
    }
  } else {
    for (let i = a.length - 2; i >= 0; i--) {
      if (isSel(i) && !isSel(i + 1)) [a[i], a[i + 1]] = [a[i + 1], a[i]];
    }
  }
  renderPages();
  scrollToFirstSelected();
}

// 선택한 페이지를 원하는 위치(몇 쪽)로 한 번에 옮긴다
function moveSelectedTo() {
  if (!selected.size) return;
  const total = state.pages.length;
  const answer = prompt(`선택한 ${selected.size}쪽을 몇 쪽 자리로 옮길까요? (1~${total})\n예: 1 = 맨 앞, ${total} = 맨 뒤`);
  if (answer === null) return;
  const target = parseInt(answer, 10);
  if (!(target >= 1 && target <= total)) {
    showPageMsg(`1부터 ${total} 사이의 숫자를 입력해 주세요.`, 'bad');
    return;
  }
  remember();
  const moving = state.pages.filter((p) => selected.has(p.key));
  const rest = state.pages.filter((p) => !selected.has(p.key));
  const at = Math.min(target - 1, rest.length);
  rest.splice(at, 0, ...moving);
  state.pages = rest;
  renderPages();
  scrollToFirstSelected();
  showPageMsg(`${moving.length}쪽을 ${at + 1}쪽 자리로 옮겼습니다.`);
}

function deleteSelected() {
  if (!selected.size) return;
  if (selected.size === state.pages.length) {
    showPageMsg('모든 페이지를 지울 수는 없습니다. 파일을 빼려면 위의 ✕ 버튼을 쓰세요.', 'bad');
    return;
  }
  remember();
  const n = selected.size;
  state.pages = state.pages.filter((p) => !selected.has(p.key));
  selected.clear();
  render();   // 파일 목록의 쪽수도 바뀌므로 전체를 다시 그린다
  showPageMsg(`${n}쪽을 지웠습니다. 실수했다면 되돌리기를 누르세요.`);
}

function scrollToFirstSelected() {
  els.pageGrid.querySelector('.page.selected')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function showPageMsg(text, type = 'ok') {
  els.pageMsg.textContent = text;
  els.pageMsg.className = 'msg ' + type;
  els.pageMsg.hidden = !text;
}

// 아래 도구 막대: 선택한 페이지가 있거나 되돌릴 것이 있을 때만 보인다
function renderToolbar() {
  const n = selected.size;
  els.toolbar.hidden = n === 0 && history.length === 0;
  els.selCount.textContent = n ? `${n}쪽 선택` : '선택 없음';
  for (const btn of els.toolbar.querySelectorAll('button[data-act]')) {
    const act = btn.dataset.act;
    btn.disabled = act === 'undo' ? history.length === 0 : n === 0;
  }
  els.selectAllBtn.textContent =
    n > 0 && n === state.pages.length ? '선택 해제' : '전체 선택';
  renderImgCard();
}

// =====================================================================
// 5-3. 편집 화면: 개인정보 가리기(2단계) + 글씨·도형 추가(4단계-②)
// =====================================================================
// 위치는 페이지 크기에 대한 비율(0~1)로 저장한다. 예: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 }
// 기준은 '사용자가 돌리기 전' 페이지 모습이다. 그래서 나중에 페이지를 돌려도
// 위치가 어긋나지 않는다. 화면에 보여 줄 때만 돌린 각도만큼 변환한다.
//
//  p.masks : 가린 영역  { x, y, w, h, color }            → 저장할 때 아래 내용까지 실제로 지운다
//  p.items : 글씨·도형
//     사각형·원·형광펜 { type: 'rect'|'ellipse'|'highlight', x, y, w, h, color, width }
//     선·화살표        { type: 'line'|'arrow', x1, y1, x2, y2, color, width }
//     글씨             { type: 'text', x, y, rot0, size, color, bold, text }
//        - x, y  : 글씨 상자 왼쪽 위 (돌리기 전 기준 비율)
//        - rot0  : 글씨를 넣을 때 페이지가 돌아가 있던 각도 (그때 화면에서 똑바로 보이도록)
//        - size  : 글자 크기 (pt, PDF 단위)

const TEXT_FONT = 'AnshimNanum';   // style.css의 @font-face 이름 (나눔고딕)
const TEXT_ASC = 0.85;             // 글씨 상자 위쪽 → 첫 줄 기준선까지 (글자 크기에 대한 비율)
const TEXT_LH = 1.3;               // 줄 간격 (글자 크기에 대한 비율)
const HL_OPACITY = 0.35;           // 형광펜 투명도

const TOOLS = {
  mask:      { name: '가리기', colors: [['#000000', '검은색'], ['#808080', '회색'], ['#ffffff', '흰색']] },
  text:      { name: '글씨',   colors: [['#111111', '검정'], ['#d32f2f', '빨강'], ['#1565c0', '파랑'], ['#2e7d32', '초록']] },
  rect:      { name: '사각형', colors: [['#d32f2f', '빨강'], ['#1565c0', '파랑'], ['#111111', '검정'], ['#2e7d32', '초록']] },
  ellipse:   { name: '원',     colors: [['#d32f2f', '빨강'], ['#1565c0', '파랑'], ['#111111', '검정'], ['#2e7d32', '초록']] },
  line:      { name: '선',     colors: [['#d32f2f', '빨강'], ['#1565c0', '파랑'], ['#111111', '검정'], ['#2e7d32', '초록']] },
  arrow:     { name: '화살표', colors: [['#d32f2f', '빨강'], ['#1565c0', '파랑'], ['#111111', '검정'], ['#2e7d32', '초록']] },
  highlight: { name: '형광펜', colors: [['#ffeb3b', '노랑'], ['#76ff03', '연두'], ['#ff80ab', '분홍']] },
};
const WIDTHS = [['1', '가늘게'], ['2', '보통'], ['4', '굵게']];   // 선 굵기 (pt)
const toolState = {
  tool: 'mask',
  color: { mask: '#000000', text: '#111111', rect: '#d32f2f', ellipse: '#d32f2f', line: '#d32f2f', arrow: '#d32f2f', highlight: '#ffeb3b' },
  width: 2,
  size: 14,
  bold: false,
};

// ---- 좌표 변환 (돌리기 전 기준 ↔ 화면 기준) ----
// 상자: 시계 방향으로 90도씩 돌린다 (돌리기 전 → 화면)
function toDisplay(r, rot) {
  let { x, y, w, h } = r;
  for (let k = 0; k < rot / 90; k++) [x, y, w, h] = [1 - (y + h), x, h, w];
  return { x, y, w, h };
}
// 반대 방향 (화면 → 돌리기 전)
function toBase(r, rot) {
  let { x, y, w, h } = r;
  for (let k = 0; k < rot / 90; k++) [x, y, w, h] = [y, 1 - (x + w), h, w];
  return { x, y, w, h };
}
// 점 하나
function ptToDisplay(x, y, rot) {
  for (let k = 0; k < rot / 90; k++) [x, y] = [1 - y, x];
  return { x, y };
}
function ptToBase(x, y, rot) {
  for (let k = 0; k < rot / 90; k++) [x, y] = [y, 1 - x];
  return { x, y };
}

// 가림 상자 하나를 화면 요소로 만든다 (위치는 % 단위)
function maskEl(r, color) {
  const div = document.createElement('div');
  div.className = 'mask';
  setBoxStyle(div, r);
  div.style.background = color;
  return div;
}

function setBoxStyle(el, r) {
  Object.assign(el.style, {
    left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%',
  });
}

// ---- 페이지 크기 (pt) : 글씨 크기를 비율로 바꿀 때 필요 ----
// 미리보기를 그릴 때 file.sizes에 기억해 둔다. { w, h } = 돌리기 전(원래 회전만 반영) 크기
function baseSize(p) {
  const file = state.files.find((f) => f.id === p.fileId);
  return file?.sizes?.[p.index] || { w: 595.28, h: 841.89 };
}
async function ensureSize(p) {
  const file = state.files.find((f) => f.id === p.fileId);
  file.sizes ||= [];
  if (!file.sizes[p.index]) {
    const page = await file.pdf.getPage(p.index + 1);
    const v = page.getViewport({ scale: 1 });
    file.sizes[p.index] = { w: v.width, h: v.height };
  }
  return file.sizes[p.index];
}

// 글씨 줄 너비 재기 (pt). 같은 글꼴로 재므로 화면과 저장 파일의 크기가 같다.
const measureCtx = document.createElement('canvas').getContext('2d');
function textBoxPt(it) {
  measureCtx.font = `${it.bold ? 700 : 400} ${it.size}px ${TEXT_FONT}`;
  const lines = it.text.split('\n');
  const w = Math.max(...lines.map((l) => measureCtx.measureText(l).width), it.size * 0.5);
  return { w, h: lines.length * it.size * TEXT_LH, lines };
}

// 글씨의 화면 정보: 왼쪽 위 점(화면 비율), 화면에서의 시계 방향 각도, 차지하는 상자(화면 비율)
function textDisplayGeom(it, p) {
  const bs = baseSize(p);
  const dims = p.rot % 180 ? { w: bs.h, h: bs.w } : bs;          // 화면 기준 페이지 크기(pt)
  const a = ptToDisplay(it.x, it.y, p.rot);
  const ang = (((p.rot - it.rot0) % 360) + 360) % 360;             // 화면에서 시계 방향 각도
  const box = textBoxPt(it);
  const rad = (ang * Math.PI) / 180;
  const ux = Math.cos(rad), uy = Math.sin(rad);                    // 글자가 이어지는 방향
  const vx = -Math.sin(rad), vy = Math.cos(rad);                   // 아래쪽 방향
  const ax = a.x * dims.w, ay = a.y * dims.h;
  const pts = [[0, 0], [box.w, 0], [0, box.h], [box.w, box.h]].map(([s, t]) => [ax + ux * s + vx * t, ay + uy * s + vy * t]);
  const xs = pts.map((q) => q[0] / dims.w), ys = pts.map((q) => q[1] / dims.h);
  return {
    dims, ang, box, ax, ay, ux, uy, vx, vy,
    bbox: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
  };
}

// 항목이 화면에서 차지하는 상자 (선택·이동용)
function itemDisplayBox(it, p) {
  if (it.type === 'text') return textDisplayGeom(it, p).bbox;
  if (it.type === 'line' || it.type === 'arrow') {
    const a = ptToDisplay(it.x1, it.y1, p.rot), b = ptToDisplay(it.x2, it.y2, p.rot);
    const pad = 0.012;
    const x0 = Math.min(a.x, b.x) - pad, y0 = Math.min(a.y, b.y) - pad;
    return { x: x0, y: y0, w: Math.abs(a.x - b.x) + pad * 2, h: Math.abs(a.y - b.y) + pad * 2 };
  }
  return toDisplay(it, p.rot);
}

// ---- 글씨·도형 그리기 (SVG): 미리보기와 편집 화면에서 함께 쓴다 ----
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function itemsSvg(p) {
  const bs = baseSize(p);
  const dims = p.rot % 180 ? { w: bs.h, h: bs.w } : bs;
  const svg = svgEl('svg', { viewBox: `0 0 ${dims.w} ${dims.h}`, class: 'items-svg', preserveAspectRatio: 'none' });
  for (const it of p.items) {
    if (it.type === 'rect' || it.type === 'ellipse' || it.type === 'highlight') {
      const r = toDisplay(it, p.rot);
      const x = r.x * dims.w, y = r.y * dims.h, w = r.w * dims.w, h = r.h * dims.h;
      if (it.type === 'ellipse') {
        svg.appendChild(svgEl('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, fill: 'none', stroke: it.color, 'stroke-width': it.width }));
      } else if (it.type === 'rect') {
        svg.appendChild(svgEl('rect', { x, y, width: w, height: h, fill: 'none', stroke: it.color, 'stroke-width': it.width }));
      } else {
        svg.appendChild(svgEl('rect', { x, y, width: w, height: h, fill: it.color, 'fill-opacity': HL_OPACITY }));
      }
    } else if (it.type === 'line' || it.type === 'arrow') {
      const a = ptToDisplay(it.x1, it.y1, p.rot), b = ptToDisplay(it.x2, it.y2, p.rot);
      const x1 = a.x * dims.w, y1 = a.y * dims.h, x2 = b.x * dims.w, y2 = b.y * dims.h;
      svg.appendChild(svgEl('line', { x1, y1, x2, y2, stroke: it.color, 'stroke-width': it.width, 'stroke-linecap': 'round' }));
      if (it.type === 'arrow') {
        for (const [hx, hy] of arrowHead(x1, y1, x2, y2, it.width)) {
          svg.appendChild(svgEl('line', { x1: x2, y1: y2, x2: hx, y2: hy, stroke: it.color, 'stroke-width': it.width, 'stroke-linecap': 'round' }));
        }
      }
    } else if (it.type === 'text') {
      const g = textDisplayGeom(it, p);
      const t = svgEl('text', {
        'font-family': TEXT_FONT, 'font-size': it.size, 'font-weight': it.bold ? 700 : 400, fill: it.color,
        transform: `translate(${g.ax} ${g.ay}) rotate(${g.ang})`,
      });
      g.box.lines.forEach((line, k) => {
        const ts = svgEl('tspan', { x: 0, y: it.size * (TEXT_ASC + k * TEXT_LH) });
        ts.textContent = line;
        t.appendChild(ts);
      });
      svg.appendChild(t);
    }
  }
  return svg;
}

// 화살촉 두 끝점 (선 끝에서 뒤로 비스듬히)
function arrowHead(x1, y1, x2, y2, width) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const L = Math.max(8, width * 4);
  return [
    [x2 - ux * L - uy * L * 0.5, y2 - uy * L + ux * L * 0.5],
    [x2 - ux * L + uy * L * 0.5, y2 - uy * L - ux * L * 0.5],
  ];
}

// =====================================================================
// 편집 화면
// =====================================================================
const ed = {
  root: $('editor'), title: $('edTitle'), prev: $('edPrev'), next: $('edNext'), done: $('edDone'),
  stage: $('edStage'), sheet: $('edSheet'), canvas: $('edCanvas'), layer: $('edLayer'),
  delSel: $('edDelSel'), clear: $('edClear'), hint: $('edHint'),
  tools: $('edTools'), colors: $('edColors'), props: $('edProps'),
  pos: 0,              // 지금 보고 있는 페이지의 순서 (state.pages 안에서)
  sel: null,           // 선택한 것 { kind: 'mask' | 'item', i }
  changed: false,
  renderTask: null,
};

async function openEditorForSelection() {
  const pos = state.pages.findIndex((p) => selected.has(p.key));
  if (pos < 0) return;
  remember();            // 되돌리기를 위해 편집 전 상태 기록
  ed.changed = false;
  ed.root.hidden = false;
  document.body.style.overflow = 'hidden';
  renderToolUi();
  // 글씨를 정확히 재려면 글꼴이 먼저 준비되어야 한다 (처음 한 번만 내려받음, 같은 웹앱 폴더에서)
  try { await Promise.all([document.fonts.load(`400 16px ${TEXT_FONT}`), document.fonts.load(`700 16px ${TEXT_FONT}`)]); } catch { /* 글꼴이 없어도 계속 */ }
  showEditorPage(pos);
}

function closeEditor() {
  ed.root.hidden = true;
  document.body.style.overflow = '';
  if (!ed.changed) history.pop();   // 바뀐 것이 없으면 되돌리기 기록도 취소
  render();
}

async function showEditorPage(pos) {
  ed.pos = pos;
  ed.sel = null;
  const p = state.pages[pos];
  const file = state.files.find((f) => f.id === p.fileId);
  ed.title.textContent = `${pos + 1}쪽 / ${state.pages.length}쪽`;
  ed.prev.disabled = pos === 0;
  ed.next.disabled = pos === state.pages.length - 1;

  await ensureSize(p);
  // 화면에 꽉 차게 (가로·세로 중 먼저 닿는 쪽에 맞춤), 선명하게 기기 화소 밀도만큼 크게 그린다
  const page = await file.pdf.getPage(p.index + 1);
  const rotation = (page.rotate + p.rot) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  const box = ed.stage.getBoundingClientRect();
  const fit = Math.min((box.width - 16) / base.width, (box.height - 16) / base.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const view = page.getViewport({ scale: fit * dpr, rotation });

  ed.renderTask?.cancel();
  ed.canvas.width = Math.round(view.width);
  ed.canvas.height = Math.round(view.height);
  ed.canvas.style.width = Math.round(base.width * fit) + 'px';
  ed.canvas.style.height = Math.round(base.height * fit) + 'px';
  drawEditorLayer();
  ed.renderTask = page.render({ canvas: ed.canvas, viewport: view });
  try { await ed.renderTask.promise; } catch { /* 다른 쪽으로 넘어가며 취소된 경우 */ }
}

const selItem = () => (ed.sel?.kind === 'item' ? state.pages[ed.pos].items[ed.sel.i] : null);
const selMask = () => (ed.sel?.kind === 'mask' ? state.pages[ed.pos].masks[ed.sel.i] : null);

// 편집 화면의 겹쳐 그리기: 가림 상자(div) → 글씨·도형(SVG) → 선택용 상자와 손잡이
function drawEditorLayer() {
  const p = state.pages[ed.pos];
  ed.layer.innerHTML = '';
  p.masks.forEach((m, i) => {
    const el = maskEl(toDisplay(m, p.rot), m.color);
    el.dataset.kind = 'mask';
    el.dataset.i = i;
    if (ed.sel?.kind === 'mask' && ed.sel.i === i) addHandles(el, 'corners');
    ed.layer.appendChild(el);
  });
  ed.layer.appendChild(itemsSvg(p));
  p.items.forEach((it, i) => {
    const hit = document.createElement('div');
    hit.className = 'item-hit' + (it.type === 'text' ? ' text-hit' : '');
    hit.dataset.kind = 'item';
    hit.dataset.i = i;
    setBoxStyle(hit, itemDisplayBox(it, p));
    if (ed.sel?.kind === 'item' && ed.sel.i === i) {
      if (it.type === 'line' || it.type === 'arrow') addLineHandles(hit, it, p);
      else if (it.type === 'text') {
        // 글씨: 오른쪽 아래 손잡이 하나 → 끌면 글자 크기 조절
        hit.classList.add('sel');
        const handle = document.createElement('span');
        handle.className = 'handle se';
        handle.dataset.h = 'size';
        hit.appendChild(handle);
      }
      else addHandles(hit, 'corners');
    }
    ed.layer.appendChild(hit);
  });
  ed.delSel.disabled = !ed.sel;
  ed.clear.disabled = p.masks.length + p.items.length === 0;
  renderProps();
  updateHint();
}

function addHandles(el, kind) {
  el.classList.add('sel');
  for (const h of ['nw', 'ne', 'sw', 'se']) {
    const handle = document.createElement('span');
    handle.className = 'handle ' + h;
    handle.dataset.h = h;
    el.appendChild(handle);
  }
}

// 선·화살표: 두 끝점에 손잡이
function addLineHandles(hit, it, p) {
  hit.classList.add('sel', 'line-sel');
  const box = itemDisplayBox(it, p);
  for (const [name, x, y] of [['p1', it.x1, it.y1], ['p2', it.x2, it.y2]]) {
    const d = ptToDisplay(x, y, p.rot);
    const handle = document.createElement('span');
    handle.className = 'handle pt';
    handle.dataset.h = name;
    handle.style.left = ((d.x - box.x) / box.w) * 100 + '%';
    handle.style.top = ((d.y - box.y) / box.h) * 100 + '%';
    hit.appendChild(handle);
  }
}

function updateHint() {
  const t = toolState.tool;
  let msg;
  if (ed.sel) {
    const it = selItem();
    msg = it?.type === 'text'
      ? '끌어서 옮기기 · 오른쪽 아래 손잡이로 크기 조절 · 한 번 더 누르면 내용 고치기'
      : it && (it.type === 'line' || it.type === 'arrow')
        ? '선을 끌면 이동, 양 끝의 손잡이를 끌면 길이·방향을 바꿉니다.'
        : '가운데를 끌면 이동, 모서리 손잡이를 끌면 크기 조절. 빈 곳을 누르면 선택이 풀립니다.';
  } else if (t === 'text') {
    msg = '글씨를 넣을 곳을 누르세요.';
  } else if (t === 'line' || t === 'arrow') {
    msg = '시작점에서 끝점까지 끌어서 그리세요.';
  } else if (t === 'mask') {
    msg = '가릴 곳을 끌어서 상자를 그리세요. 저장할 때 아래 내용까지 실제로 지워집니다.';
  } else {
    msg = '끌어서 그리세요. 그린 것을 누르면 선택됩니다.';
  }
  ed.hint.textContent = msg;
}

// ---- 도구·색·속성 단추 ----
function renderToolUi() {
  ed.tools.innerHTML = '';
  for (const [key, tool] of Object.entries(TOOLS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool' + (toolState.tool === key ? ' on' : '') + (key === 'mask' ? ' tool-mask' : '');
    b.dataset.tool = key;
    b.textContent = tool.name;
    ed.tools.appendChild(b);
  }
  renderColorUi();
}

function renderColorUi() {
  const tool = TOOLS[toolState.tool];
  const current = toolState.color[toolState.tool];
  ed.colors.innerHTML = '<span>색</span>';
  for (const [hex, name] of tool.colors) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (hex === current ? ' on' : '');
    b.dataset.color = hex;
    const i = document.createElement('i');
    i.style.background = hex;
    b.append(i, name);
    ed.colors.appendChild(b);
  }
}

function renderProps() {
  const t = selItem()?.type || toolState.tool;
  ed.props.innerHTML = '';
  const add = (label, act, on = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'prop' + (on ? ' on' : '');
    b.dataset.act = act;
    b.textContent = label;
    ed.props.appendChild(b);
  };
  if (t === 'text') {
    const it = selItem();
    const size = it ? it.size : toolState.size;
    const bold = it ? it.bold : toolState.bold;
    add('가−', 'smaller');
    const s = document.createElement('span');
    s.className = 'prop-val';
    s.textContent = `${size}pt`;
    ed.props.appendChild(s);
    add('가+', 'bigger');
    add('굵게', 'bold', bold);
    if (it) add('내용 고치기', 'edit');
  } else if (t === 'rect' || t === 'ellipse' || t === 'line' || t === 'arrow') {
    const w = selItem()?.width ?? toolState.width;
    for (const [val, label] of WIDTHS) add(label, 'w' + val, Number(val) === w);
  }
  // 줄이 생겼다 없어졌다 하면 페이지가 위아래로 움직이므로, 자리는 늘 비워 두고 보이기만 바꾼다
  ed.props.classList.toggle('empty', ed.props.childElementCount === 0);
}

ed.tools.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tool]');
  if (!b) return;
  toolState.tool = b.dataset.tool;
  ed.sel = null;
  renderToolUi();
  drawEditorLayer();
});

ed.colors.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-color]');
  if (!b) return;
  toolState.color[toolState.tool] = b.dataset.color;
  // 선택한 것이 있으면 그 색도 바꾼다
  const target = selItem() || selMask();
  if (target) {
    target.color = b.dataset.color;
    ed.changed = true;
    drawEditorLayer();
  }
  renderColorUi();
});

ed.props.addEventListener('click', (e) => {
  const act = e.target.closest('button[data-act]')?.dataset.act;
  if (!act) return;
  const it = selItem();
  if (act === 'smaller' || act === 'bigger') {
    const step = act === 'bigger' ? 2 : -2;
    const next = (v) => Math.min(72, Math.max(6, v + step));
    if (it) { it.size = next(it.size); ed.changed = true; } else toolState.size = next(toolState.size);
  } else if (act === 'bold') {
    if (it) { it.bold = !it.bold; ed.changed = true; } else toolState.bold = !toolState.bold;
  } else if (act === 'edit' && it) {
    askText('글씨 고치기', it.text).then((text) => {
      if (text !== null && text.trim()) { it.text = text; ed.changed = true; }
      drawEditorLayer();
    });
    return;
  } else if (act.startsWith('w')) {
    const w = Number(act.slice(1));
    if (it) { it.width = w; ed.changed = true; }
    toolState.width = w;
  }
  drawEditorLayer();
});

// ---- 손가락(마우스) 동작: 그리기 / 이동 / 크기 조절 ----
let drag = null;
const MIN_W = 0.01, MIN_H = 0.005;   // 이보다 작은 상자는 만들지 않는다
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function layerPoint(e) {
  const r = ed.layer.getBoundingClientRect();
  return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
}

ed.layer.addEventListener('pointerdown', (e) => {
  const p = state.pages[ed.pos];
  const start = layerPoint(e);
  const handle = e.target.closest('.handle');
  const hit = e.target.closest('[data-kind]');
  ed.layer.setPointerCapture(e.pointerId);

  if (hit) {
    // 이미 있는 것: 선택하고, 이동 또는 크기 조절 준비
    const kind = hit.dataset.kind, i = Number(hit.dataset.i);
    const wasSelected = ed.sel?.kind === kind && ed.sel.i === i;
    if (!wasSelected) {
      ed.sel = { kind, i };
      const obj = kind === 'mask' ? p.masks[i] : p.items[i];
      toolState.tool = kind === 'mask' ? 'mask' : obj.type;   // 그 종류에 맞는 색 단추를 보여 준다
      toolState.color[toolState.tool] = obj.color;
      renderToolUi();
      drawEditorLayer();
    }
    const obj = kind === 'mask' ? p.masks[i] : p.items[i];
    drag = { mode: handle ? 'resize' : 'move', corner: handle?.dataset.h, start, orig: JSON.parse(JSON.stringify(obj)), kind, i, moved: false, wasSelected };
    if (kind === 'item' && obj.type === 'text') {
      // 글자 크기 조절의 기준점: 글씨 왼쪽 위 (화면 기준, pt 단위로 계산)
      const g = textDisplayGeom(obj, p);
      drag.anchorPt = { x: g.ax, y: g.ay };
      drag.dims = g.dims;
    }
    return;
  }

  const tool = toolState.tool;
  if (tool === 'text') {
    // 무언가 선택된 상태에서 빈 곳을 누르면 → 선택만 푼다 (입력 상자를 열지 않음)
    if (ed.sel) {
      ed.sel = null;
      drag = null;
      drawEditorLayer();
      return;
    }
    // 손가락을 뗄 때 입력 상자를 연다 (누르는 도중에 창을 띄우면 휴대폰에서 터치가 꼬인다)
    drag = { mode: 'tap', start };
    return;
  }
  ed.sel = null;
  // 빈 곳: 새로 그리기 시작
  drag = { mode: 'draw', tool, start, end: start };
  drawPreview();
});

ed.layer.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const pt = layerPoint(e);
  if (drag.mode === 'draw') {
    drag.end = pt;
    drawPreview();
    return;
  }
  const p = state.pages[ed.pos];
  const dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
  const obj = drag.kind === 'mask' ? p.masks[drag.i] : p.items[drag.i];
  const o = drag.orig;
  drag.moved = true;

  if (drag.kind === 'item' && (o.type === 'line' || o.type === 'arrow')) {
    const a = ptToDisplay(o.x1, o.y1, p.rot), b = ptToDisplay(o.x2, o.y2, p.rot);
    if (drag.mode === 'move') { a.x += dx; a.y += dy; b.x += dx; b.y += dy; }
    else if (drag.corner === 'p1') { a.x = clamp01(a.x + dx); a.y = clamp01(a.y + dy); }
    else { b.x = clamp01(b.x + dx); b.y = clamp01(b.y + dy); }
    const A = ptToBase(clamp01(a.x), clamp01(a.y), p.rot), B = ptToBase(clamp01(b.x), clamp01(b.y), p.rot);
    Object.assign(obj, { x1: A.x, y1: A.y, x2: B.x, y2: B.y });
  } else if (drag.kind === 'item' && o.type === 'text' && drag.mode === 'resize') {
    // 손잡이를 기준점에서 멀리 끌면 크게, 가까이 끌면 작게 (처음 거리 대비 비율)
    const dist = (q) => Math.hypot(q.x * drag.dims.w - drag.anchorPt.x, q.y * drag.dims.h - drag.anchorPt.y);
    const ratio = dist(pt) / Math.max(1, dist(drag.start));
    obj.size = Math.round(Math.min(96, Math.max(6, o.size * ratio)));
  } else if (drag.kind === 'item' && o.type === 'text') {
    const a = ptToDisplay(o.x, o.y, p.rot);
    const A = ptToBase(clamp01(a.x + dx), clamp01(a.y + dy), p.rot);
    Object.assign(obj, { x: A.x, y: A.y });
  } else {
    // 가림 상자·사각형·원·형광펜
    const r0 = toDisplay(o, p.rot);
    let r;
    if (drag.mode === 'move') {
      r = { x: Math.min(1 - r0.w, Math.max(0, r0.x + dx)), y: Math.min(1 - r0.h, Math.max(0, r0.y + dy)), w: r0.w, h: r0.h };
    } else {
      // 크기 조절: 잡은 모서리만 움직이고, 반대쪽 모서리는 고정
      let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h;
      if (drag.corner.includes('w')) x0 = Math.min(clamp01(x0 + dx), x1 - MIN_W);
      if (drag.corner.includes('e')) x1 = Math.max(clamp01(x1 + dx), x0 + MIN_W);
      if (drag.corner.includes('n')) y0 = Math.min(clamp01(y0 + dy), y1 - MIN_H);
      if (drag.corner.includes('s')) y1 = Math.max(clamp01(y1 + dy), y0 + MIN_H);
      r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    Object.assign(obj, toBase(r, p.rot));   // 색은 그대로 두고 위치만 바꾼다
  }
  drawEditorLayer();
});

// 그리는 중인 모양 미리 보여 주기
function drawPreview() {
  drawEditorLayer();
  const { tool, start, end } = drag;
  const p = state.pages[ed.pos];
  const tmp = { ...p, masks: [], items: [] };
  const color = toolState.color[tool];
  if (tool === 'line' || tool === 'arrow') {
    const A = ptToBase(start.x, start.y, p.rot), B = ptToBase(end.x, end.y, p.rot);
    tmp.items.push({ type: tool, x1: A.x, y1: A.y, x2: B.x, y2: B.y, color, width: toolState.width });
  } else {
    const r = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
    if (tool === 'mask') {
      const el = maskEl(r, color);
      el.classList.add('drawing');
      ed.layer.appendChild(el);
      return;
    }
    tmp.items.push({ type: tool, ...toBase(r, p.rot), color, width: toolState.width });
  }
  const svg = itemsSvg(tmp);
  svg.classList.add('drawing');
  ed.layer.appendChild(svg);
}

function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  const p = state.pages[ed.pos];

  if (d.mode === 'tap') {
    addTextAt(d.start);
    return;
  }
  if (d.mode === 'draw') {
    const { tool, start, end } = d;
    const color = toolState.color[tool];
    if (tool === 'line' || tool === 'arrow') {
      if (Math.hypot(end.x - start.x, end.y - start.y) > 0.015) {
        const A = ptToBase(start.x, start.y, p.rot), B = ptToBase(end.x, end.y, p.rot);
        p.items.push({ type: tool, x1: A.x, y1: A.y, x2: B.x, y2: B.y, color, width: toolState.width });
        ed.sel = { kind: 'item', i: p.items.length - 1 };
        ed.changed = true;
      }
    } else {
      const r = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
      if (r.w > MIN_W && r.h > MIN_H) {
        // 새로 그린 것은 바로 선택해 두어 곧바로 옮기거나 크기를 고칠 수 있게
        if (tool === 'mask') {
          p.masks.push({ ...toBase(r, p.rot), color });
          ed.sel = { kind: 'mask', i: p.masks.length - 1 };
        } else {
          p.items.push({ type: tool, ...toBase(r, p.rot), color, width: toolState.width });
          ed.sel = { kind: 'item', i: p.items.length - 1 };
        }
        ed.changed = true;
      }
    }
  } else if (d.moved) {
    ed.changed = true;
  } else if (d.wasSelected && d.mode === 'move' && d.kind === 'item' && p.items[d.i]?.type === 'text') {
    // 이미 선택된 글씨를 한 번 더 누름 → 내용 고치기
    const it = p.items[d.i];
    askText('글씨 고치기', it.text).then((text) => {
      if (text !== null && text.trim()) { it.text = text; ed.changed = true; }
      drawEditorLayer();
    });
    return;
  }
  drawEditorLayer();
}
ed.layer.addEventListener('pointerup', endDrag);
ed.layer.addEventListener('pointercancel', () => { if (drag?.mode === 'tap') drag = null; endDrag(); });

// 글씨 넣기: 누른 곳이 글씨 상자의 왼쪽 위가 된다
async function addTextAt(pt) {
  const text = await askText('글씨 넣기', '');
  if (text === null || !text.trim()) { drawEditorLayer(); return; }
  const p = state.pages[ed.pos];
  const A = ptToBase(pt.x, pt.y, p.rot);
  p.items.push({
    type: 'text', x: A.x, y: A.y, rot0: p.rot,
    size: toolState.size, color: toolState.color.text, bold: toolState.bold, text,
  });
  ed.sel = { kind: 'item', i: p.items.length - 1 };
  ed.changed = true;
  drawEditorLayer();
}

// ---- 글씨 입력 상자 (웹앱 안에 직접 만든 창) ----
//  브라우저 기본 입력 창(prompt) 대신 쓴다: 휴대폰에서 터치가 꼬이지 않고, 엔터로 줄을 바꿀 수 있다.
const textDlg = { root: $('edModal'), title: $('edModalTitle'), input: $('edText'), ok: $('edOk'), cancel: $('edCancel') };
function askText(title, initial) {
  return new Promise((resolve) => {
    textDlg.title.textContent = title;
    textDlg.input.value = initial;
    textDlg.ok.textContent = initial ? '고치기' : '넣기';
    textDlg.root.hidden = false;
    setTimeout(() => textDlg.input.focus(), 50);
    const finish = (value) => {
      textDlg.root.hidden = true;
      textDlg.ok.onclick = textDlg.cancel.onclick = null;
      resolve(value);
    };
    textDlg.ok.onclick = () => finish(textDlg.input.value.replace(/\s+$/, ''));
    textDlg.cancel.onclick = () => finish(null);
  });
}

// ---- 아래 버튼들 ----
ed.delSel.addEventListener('click', () => {
  if (!ed.sel) return;
  const p = state.pages[ed.pos];
  (ed.sel.kind === 'mask' ? p.masks : p.items).splice(ed.sel.i, 1);
  ed.sel = null;
  ed.changed = true;
  drawEditorLayer();
});
ed.clear.addEventListener('click', () => {
  const p = state.pages[ed.pos];
  if (!(p.masks.length + p.items.length) || !confirm('이 쪽의 가림 상자와 글씨·도형을 모두 지울까요?')) return;
  p.masks = [];
  p.items = [];
  ed.sel = null;
  ed.changed = true;
  drawEditorLayer();
});
ed.prev.addEventListener('click', () => ed.pos > 0 && showEditorPage(ed.pos - 1));
ed.next.addEventListener('click', () => ed.pos < state.pages.length - 1 && showEditorPage(ed.pos + 1));
ed.done.addEventListener('click', closeEditor);
document.addEventListener('keydown', (e) => {
  if (ed.root.hidden) return;
  if (!textDlg.root.hidden) {           // 입력 상자가 열려 있으면 상자만 다룬다
    if (e.key === 'Escape') textDlg.cancel.click();
    return;
  }
  if (e.key === 'Escape') closeEditor();
  if ((e.key === 'Delete' || e.key === 'Backspace') && ed.sel) ed.delSel.click();
});
// 휴대폰을 돌리거나 창 크기가 바뀌면 다시 맞춘다
window.addEventListener('resize', () => { if (!ed.root.hidden) showEditorPage(ed.pos); });

// =====================================================================
// 5-2. 저장 (1단계-⑤): 파일명 지정 → 새 PDF 만들기 → 내려받기
// =====================================================================

const TARGET_BYTES = 10_000_000;   // 공문 첨부 기준: 10MB 미만 (실제 바이트 수로 판정)
let nameTouched = false;           // 사용자가 파일 이름을 직접 고쳤는지

els.nameInput.addEventListener('input', () => { nameTouched = true; });
els.saveBtn.addEventListener('click', savePdf);

// 파일 이름 추천: 파일이 하나면 '원래이름_정리', 여러 개면 '첫파일이름_외N_병합'
function suggestName() {
  const base = (state.files[0]?.name || '문서').replace(/\.[^.]+$/, '');
  if (state.files.length === 1) return `${base}_정리`;
  return `${base}_외${state.files.length - 1}_병합`;
}

// 저장 카드 보이기 + (사용자가 고치지 않았다면) 추천 이름 채우기
function renderSave() {
  const has = state.pages.length > 0;
  els.saveCard.hidden = !has;
  if (!has) { nameTouched = false; return; }
  if (!nameTouched) els.nameInput.value = suggestName();
}

// 파일 이름 다듬기: 쓸 수 없는 글자 → _, 끝의 .pdf 중복 제거, 너무 길면 자르기
function cleanName(raw) {
  let name = raw.trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/(\.pdf)+$/i, '')
    .replace(/^\.+/, '')
    .trim();
  if (!name) name = suggestName();
  return name.slice(0, 100) + '.pdf';
}

// ---------------------------------------------------------------------
// 저장 흐름 (3단계: 10MB 미만 자동 압축)
//  ① 원본 그대로 만들어 본다 → 10MB 미만이면 끝
//  ② 아니면 사진·스캔이 있는 페이지만 단계적으로 화질을 낮춘다 (1단계 → 2단계)
//  ③ 그래도 안 되면 원인(용량 큰 쪽)과 대안(더 낮추기·나눠서 저장·그대로 저장)을 보여 준다
// ---------------------------------------------------------------------

// 압축 단계: dpi = 그림의 선명도, q = JPG 품질(0~1)
const LEVELS = [
  null,                                   // 0단계: 원본 그대로
  { dpi: 150, q: 0.80, name: '1단계' },   // 화질 차이 거의 없음
  { dpi: 120, q: 0.65, name: '2단계' },   // 확대하면 조금 흐림
  { dpi: 100, q: 0.50, name: '3단계' },   // 눈에 띄게 흐림 → 사용자 확인 후
];
const AUTO_MAX_LEVEL = 2;          // 자동으로는 2단계까지만
const HEAVY_BYTES = 120_000;       // 사진·스캔 그림이 이보다 크면 '압축 대상' 페이지
const RASTER_DEFAULT = { dpi: 150, q: 0.85 };   // 가린 쪽·편집 제한 쪽을 그림으로 바꿀 때

// 한 번 저장하는 동안 쓰는 임시 기억 장소 (저장이 끝나면 비운다)
let session = null;
function newSession(fileName, pages) {
  return {
    fileName,
    pages: pages.map(copyPage), // 저장 시점 모습 고정
    srcs: new Map(),     // 파일id → pdf-lib 문서 (편집 제한이면 null)
    imgBytes: new Map(), // 페이지 key → 그 페이지 속 그림 용량
    jpgs: new Map(),     // 그림으로 바꾼 결과 기억 (같은 설정이면 다시 그리지 않음)
    best: null,          // 지금까지 만든 결과 중 가장 작은 것
    firstSize: 0,        // 원본 그대로 만들었을 때 크기
  };
}

async function savePdf() {
  if (!state.pages.length) return;
  const fileName = cleanName(els.nameInput.value);
  els.nameInput.value = fileName.replace(/\.pdf$/, '');
  session = newSession(fileName, state.pages);
  hidePanel();
  showSaveMsg('');
  await busy(async () => {
    await tryLevels(0, AUTO_MAX_LEVEL);
  });
}

// from~to 단계를 차례로 시도하고, 10MB 미만이 되면 바로 내려받는다
async function tryLevels(from, to) {
  const s = session;
  for (let lv = from; lv <= to; lv++) {
    const label = lv === 0 ? 'PDF 만드는 중' : `용량 줄이는 중 (${LEVELS[lv].name})`;
    const res = await buildPdf(s.pages, s.fileName, lv, (done, total) => {
      els.saveBtn.textContent = `${label}… ${done}/${total}쪽`;
    });
    if (lv === 0) s.firstSize = res.bytes.length;
    if (!s.best || res.bytes.length < s.best.bytes.length) s.best = res;

    if (res.bytes.length < TARGET_BYTES) {
      await finishDownload(res, s.fileName);
      return;
    }
    // 이번 단계에서 바꿀 수 있는 페이지가 없으면 더 낮춰도 소용없다
    if (lv > 0 && res.compressedCount === 0 && !res.rasterCount) break;
  }
  showOptions();
}

// 가림 검증 → 내려받기 → 결과 안내
async function finishDownload(res, fileName) {
  const check = await checkRedaction(res);
  if (!check) return;
  download(res.bytes, fileName);
  const lines = [`저장했습니다: ${fileName} (${res.pageCount}쪽 · ${formatSize(res.bytes.length)})`];
  let type = 'good';
  if (res.bytes.length < TARGET_BYTES) {
    lines.push('공문 첨부 기준(10MB 미만)을 만족합니다.');
  } else {
    lines.push('※ 10MB를 넘는 상태로 저장했습니다. 공문 첨부 시 용량을 확인해 주세요.');
    type = 'warn';
  }
  if (res.level > 0) {
    lines.push(`용량 줄이기 ${LEVELS[res.level].name} 적용: ${formatSize(session.firstSize)} → ${formatSize(res.bytes.length)} (사진·스캔 ${res.compressedCount}쪽 화질 조정)`);
  }
  type = addCommonNotes(lines, res, check, type);
  hidePanel();
  showSaveMsg(lines.join('\n'), type);
}

// 가린 쪽이 있으면 내려받기 전에 실제로 지워졌는지 검사한다
async function checkRedaction(res) {
  if (!res.redacted.length) return { ok: true, elsewhere: [], none: true };
  els.saveBtn.textContent = '가린 내용이 지워졌는지 검사하는 중…';
  const check = await verifyRedaction(res.bytes, res.redacted);
  if (!check.ok) {
    // 이론상 일어나면 안 되는 상황: 파일을 내려주지 않는다
    showSaveMsg('가린 쪽에서 글자 정보가 발견되어 저장을 멈췄습니다. 안전을 위해 파일을 만들지 않았습니다.', 'bad');
    return null;
  }
  return check;
}

function addCommonNotes(lines, res, check, type) {
  if (check && !check.none) {
    lines.push(`✔ 개인정보 실제 제거 확인: 가린 ${res.redacted.length}쪽은 그림으로 바뀌어 가린 곳의 글자가 파일에 남아 있지 않습니다.`);
    for (const e of check.elsewhere.slice(0, 5)) {
      const shown = e.text.length > 30 ? e.text.slice(0, 30) + '…' : e.text;
      lines.push(`⚠ 가린 내용 "${shown}"이(가) ${e.pages.join(', ')}쪽에 그대로 남아 있습니다. 그 쪽도 가려야 하는지 확인해 주세요.`);
      type = 'warn';
    }
  }
  if (res.imagedFiles.length) {
    lines.push(`※ 편집 제한이 걸린 파일(${res.imagedFiles.join(', ')})은 페이지를 그림으로 바꿔 넣었습니다. 해당 페이지는 글자 선택·검색이 되지 않습니다.`);
  }
  if (res.compressedCount) {
    lines.push('※ 화질을 조정한 쪽은 그림이 되어 글자 선택·검색이 되지 않습니다.');
  }
  return type;
}

// 버튼을 '작업 중'으로 바꿔 두고 일을 한 뒤 되돌린다
async function busy(work) {
  els.saveBtn.disabled = true;
  for (const b of els.savePanel.querySelectorAll('button')) b.disabled = true;
  try {
    await work();
  } catch (err) {
    console.error(err);
    showSaveMsg(`PDF를 만드는 중 문제가 생겼습니다. (${err?.message || err})`, 'bad');
  } finally {
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = 'PDF로 저장';
    for (const b of els.savePanel.querySelectorAll('button')) b.disabled = false;
  }
}

// ---------------------------------------------------------------------
// 10MB 미만으로 줄이지 못했을 때: 원인과 대안 보여 주기
// ---------------------------------------------------------------------
function showOptions() {
  const s = session;
  const best = s.best;
  const big = best.pageSizes
    .map((size, i) => ({ no: i + 1, size }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 5)
    .filter((x) => x.size > 300_000);

  const lines = [
    `10MB 미만으로 줄이지 못했습니다.`,
    `원본 ${formatSize(s.firstSize)} → 현재 ${formatSize(best.bytes.length)}${best.level ? ` (${LEVELS[best.level].name})` : ''}`,
  ];
  if (big.length) {
    lines.push(`용량이 큰 쪽: ${big.map((x) => `${x.no}쪽 ${formatSize(x.size)}`).join(', ')}`);
    lines.push('사진이나 스캔한 페이지가 많으면 화질을 낮춰도 크게 줄지 않을 수 있습니다.');
  }
  showSaveMsg(lines.join('\n'), 'warn');

  // 화질을 낮출 수 있는 쪽(사진·스캔·그림으로 바꾼 쪽)이 있을 때만 '더 낮추기'를 보여 준다
  const canLower = best.level < 3 && (best.compressedCount > 0 || best.rasterCount > 0);
  els.savePanel.innerHTML = '';
  if (canLower) {
    addOption('화질 더 낮추기', '3단계 · 그림과 글자가 눈에 띄게 흐려질 수 있습니다', () =>
      busy(() => tryLevels(3, 3)));
  }
  addOption('나눠서 저장', '10MB 미만 파일 여러 개(1부, 2부…)로 나눕니다', () =>
    busy(splitAndOffer));
  addOption(`이대로 저장 (${formatSize(best.bytes.length)})`, '10MB를 넘지만 지금 상태로 저장합니다', () =>
    busy(() => finishDownload(best, s.fileName)));
  const tip = document.createElement('p');
  tip.className = 'hint';
  tip.textContent = '또는 위 페이지 정리에서 필요 없는 쪽을 지운 뒤 다시 저장해도 됩니다.';
  els.savePanel.appendChild(tip);
  els.savePanel.hidden = false;
}

function addOption(title, desc, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'option-btn';
  b.innerHTML = '<strong></strong><span></span>';
  b.querySelector('strong').textContent = title;
  b.querySelector('span').textContent = desc;
  b.addEventListener('click', onClick);
  els.savePanel.appendChild(b);
}

function hidePanel() {
  els.savePanel.hidden = true;
  els.savePanel.innerHTML = '';
}

// ---------------------------------------------------------------------
// 나눠서 저장: 페이지별 용량을 보고 10MB 미만이 되도록 묶은 뒤, 실제로 만들어 확인한다
// ---------------------------------------------------------------------
async function splitAndOffer() {
  const s = session;
  const best = s.best;
  const level = best.level;
  const budget = TARGET_BYTES * 0.85;   // 어림값이 빗나갈 수 있어 여유를 둔다

  // 1) 어림 용량으로 앞에서부터 묶기
  const groups = [];
  let cur = [], sum = 0;
  s.pages.forEach((p, i) => {
    const size = best.pageSizes[i];
    if (cur.length && sum + size > budget) { groups.push(cur); cur = []; sum = 0; }
    cur.push(i); sum += size;
  });
  if (cur.length) groups.push(cur);

  // 2) 실제로 만들어 보고, 그래도 크면 반으로 나눠 다시 만든다
  const parts = [];
  const queue = [...groups];
  while (queue.length) {
    const g = queue.shift();
    els.saveBtn.textContent = `나눠서 만드는 중… ${parts.length + 1}부`;
    const res = await buildPdf(g.map((i) => s.pages[i]), s.fileName, level);
    if (res.bytes.length >= TARGET_BYTES && g.length > 1) {
      const half = Math.ceil(g.length / 2);
      queue.unshift(g.slice(0, half), g.slice(half));
      continue;
    }
    if (!(await checkRedaction(res))) return;
    parts.push({ res, from: g[0] + 1, to: g[g.length - 1] + 1 });
  }

  // 3) 부분 파일마다 내려받기 버튼 (휴대폰은 여러 파일을 한꺼번에 내려받지 못하게 막을 수 있어서)
  const base = s.fileName.replace(/\.pdf$/, '');
  els.savePanel.innerHTML = '';
  parts.forEach((part, k) => {
    const name = `${base}_${k + 1}부.pdf`;
    const over = part.res.bytes.length >= TARGET_BYTES;
    addOption(
      `${k + 1}부 내려받기 (${part.from === part.to ? part.from : `${part.from}~${part.to}`}쪽 · ${formatSize(part.res.bytes.length)})`,
      over ? '이 쪽 하나만으로 10MB를 넘습니다' : name,
      () => download(part.res.bytes, name),
    );
  });
  const allOk = parts.every((p) => p.res.bytes.length < TARGET_BYTES);
  showSaveMsg(
    `${parts.length}개 파일로 나눴습니다. ${allOk ? '모두 10MB 미만입니다.' : '일부 파일은 한 쪽만으로 10MB를 넘습니다.'}\n아래 버튼을 하나씩 눌러 내려받으세요.`,
    allOk ? 'good' : 'warn',
  );
  els.savePanel.hidden = false;
}

// ---------------------------------------------------------------------
// PDF 만들기 (pdf-lib)
// ---------------------------------------------------------------------
async function buildPdf(pages, fileName, level = 0, onProgress = () => {}) {
  const { PDFDocument, degrees } = window.PDFLib;
  const s = session;
  const lv = LEVELS[level];
  const out = await PDFDocument.create();
  const imagedFiles = [];

  // 1) 원본 파일 읽기 (편집 제한 등으로 못 읽으면 null → 그림으로 바꿔 넣는다)
  for (const fileId of new Set(pages.map((p) => p.fileId))) {
    if (s.srcs.has(fileId)) continue;
    const file = state.files.find((f) => f.id === fileId);
    try {
      s.srcs.set(fileId, await PDFDocument.load(file.bytes));
    } catch (err) {
      console.warn(`${file.name}: 그대로 복사할 수 없어 그림으로 바꿉니다.`, err);
      s.srcs.set(fileId, null);
    }
  }
  for (const fileId of new Set(pages.map((p) => p.fileId))) {
    if (s.srcs.get(fileId) === null) imagedFiles.push(state.files.find((f) => f.id === fileId).name);
  }

  // 2) 페이지마다 '원본 복사' 또는 '그림으로 바꾸기'를 정한다
  //    - 가린 쪽 / 편집 제한 쪽 → 항상 그림 (가린 쪽은 원본을 절대 복사하지 않는다)
  //    - 압축 단계에서 그림 용량이 큰 쪽 → 그림으로 바꿔 보고, 실제로 작아질 때만 바꾼다
  const plans = [];
  let done = 0, compressedCount = 0, rasterCount = 0;
  for (const p of pages) {
    const file = state.files.find((f) => f.id === p.fileId);
    const src = s.srcs.get(p.fileId);
    let plan = { p, file, mode: 'copy' };
    if (p.masks.length || !src) {
      plan = { ...plan, mode: 'image', jpg: await pageJpg(file, p, lv || RASTER_DEFAULT) };
      rasterCount++;
    } else if (lv) {
      const imgBytes = imageBytesOf(s, src, p);
      if (imgBytes > HEAVY_BYTES) {
        const jpg = await pageJpg(file, p, lv);
        if (jpg.bytes.length < imgBytes * 0.9) {
          plan = { ...plan, mode: 'image', jpg };
          compressedCount++;
        }
      }
    }
    plans.push(plan);
    onProgress(++done, pages.length * 2);
  }

  // 3) 원본 복사할 쪽은 파일별로 한 번에 복사 (글꼴·그림 중복 복사 방지)
  //    ※ 그림으로 바꿀 쪽은 복사 목록에서 뺀다. 복사만 해 두고 안 써도 파일에 남기 때문.
  const copied = new Map();
  for (const [fileId, src] of s.srcs) {
    const list = plans.filter((x) => x.mode === 'copy' && x.p.fileId === fileId);
    if (!list.length || !src) continue;
    const got = await out.copyPages(src, list.map((x) => x.p.index));
    list.forEach((x, i) => copied.set(x.p.key, got[i]));
  }

  // 글씨가 있으면 한글 글꼴 준비
  const fonts = await embedFonts(out, pages);

  // 4) 화면 순서대로 붙이기 + 글씨·도형 그리기 + 회전
  const redacted = [];
  const pageSizes = [];
  for (const [i, x] of plans.entries()) {
    let page;
    if (x.mode === 'copy') {
      page = out.addPage(copied.get(x.p.key));
      pageSizes.push(imageBytesOf(s, s.srcs.get(x.p.fileId), x.p) + 20_000);
      if (x.p.items.length) {
        // 원본 페이지 좌표: PDF.js가 화면 위치 → PDF 좌표 변환을 해 준다 (원래 회전 R 포함)
        const pg = await x.file.pdf.getPage(x.p.index + 1);
        const vp = pg.getViewport({ scale: 1 });
        const g = (nx, ny) => vp.convertToPdfPoint(nx * vp.width, ny * vp.height);
        drawItemsPdf(page, x.p.items, g, vp.width, vp.height, pg.rotate, fonts);
      }
    } else {
      const img = await out.embedJpg(x.jpg.bytes);
      page = out.addPage([x.jpg.w, x.jpg.h]);
      page.drawImage(img, { x: 0, y: 0, width: x.jpg.w, height: x.jpg.h });
      pageSizes.push(x.jpg.bytes.length + 2_000);
      // 그림으로 바꾼 쪽: 왼쪽 아래가 (0,0)인 새 페이지
      const W = x.jpg.w, H = x.jpg.h;
      drawItemsPdf(page, x.p.items, (nx, ny) => [nx * W, H - ny * H], W, H, 0, fonts);
      if (x.p.masks.length) {
        redacted.push({
          outIndex: i,
          hidden: await hiddenTextsOf(x.file, x.p.index, x.p.masks),
          allowed: x.p.items.filter((t) => t.type === 'text').map((t) => t.text),   // 사용자가 넣은 글씨는 검사에서 뺀다
        });
      }
    }
    if (x.p.rot) page.setRotation(degrees((page.getRotation().angle + x.p.rot) % 360));
    onProgress(++done, pages.length * 2);
  }

  // 5) PDF 속성 정보 정리: 제목만 파일 이름으로, 나머지(작성자·프로그램 등)는 비운다
  out.setTitle(fileName.replace(/\.pdf$/, ''));
  out.setAuthor('');
  out.setSubject('');
  out.setKeywords([]);
  out.setCreator('');
  out.setProducer('');

  const bytes = await out.save({ useObjectStreams: true });
  return { bytes, level, imagedFiles, redacted, pageSizes, compressedCount, rasterCount, pageCount: pages.length };
}

// ---------------------------------------------------------------------
// 글씨·도형을 저장 파일에 넣기 (4단계-②)
//  - 원본을 복사한 쪽: PDF 안에 벡터로 그린다 → 확대해도 선명하고 글씨도 선택된다
//  - 그림으로 바꾼 쪽(가린 쪽 등): 그림 위에 같은 방법으로 그린다
// ---------------------------------------------------------------------
async function loadFontkit() {
  if (window.fontkit) return;
  await new Promise((ok, fail) => {
    const sc = document.createElement('script');
    sc.src = 'lib/fontkit/fontkit.umd.min.js';     // 같은 웹앱 폴더에서만 불러온다
    sc.onload = ok;
    sc.onerror = () => fail(new Error('글꼴 도구를 불러오지 못했습니다'));
    document.head.appendChild(sc);
  });
}

const fontFiles = {};
async function fontBytes(bold) {
  const name = bold ? 'NanumGothic-Bold.ttf' : 'NanumGothic-Regular.ttf';
  fontFiles[name] ||= new Uint8Array(await (await fetch('lib/fonts/' + name)).arrayBuffer());
  return fontFiles[name];
}

// 이 PDF에 필요한 글꼴을 넣는다.
//  ※ '쓴 글자만 골라 넣기(subset)'를 하면 나눔고딕의 한글이 빈칸으로 나와서(조합형 글자 조각이 빠짐)
//     글꼴 전체를 넣는다. 글씨가 있는 PDF는 약 0.75MB(굵게도 쓰면 +0.75MB) 커진다.
async function embedFonts(out, pages) {
  const texts = pages.flatMap((p) => p.items.filter((it) => it.type === 'text'));
  if (!texts.length) return null;
  await loadFontkit();
  out.registerFontkit(window.fontkit);
  const fonts = {};
  if (texts.some((t) => !t.bold)) fonts.regular = await out.embedFont(await fontBytes(false), { subset: false });
  if (texts.some((t) => t.bold)) fonts.bold = await out.embedFont(await fontBytes(true), { subset: false });
  return fonts;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return window.PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// g(비율x, 비율y) → PDF 좌표 [x, y],  W·H = 돌리기 전 페이지 크기(pt),  R = 원래 페이지 회전
function drawItemsPdf(page, items, g, W, H, R, fonts) {
  const { degrees, LineCapStyle } = window.PDFLib;
  for (const it of items) {
    const color = hexToRgb(it.color);
    if (it.type === 'rect' || it.type === 'ellipse' || it.type === 'highlight') {
      const [ax, ay] = g(it.x, it.y);
      const [bx, by] = g(it.x + it.w, it.y + it.h);
      const x = Math.min(ax, bx), y = Math.min(ay, by), w = Math.abs(ax - bx), h = Math.abs(ay - by);
      if (it.type === 'rect') {
        page.drawRectangle({ x, y, width: w, height: h, borderColor: color, borderWidth: it.width });
      } else if (it.type === 'ellipse') {
        page.drawEllipse({ x: x + w / 2, y: y + h / 2, xScale: w / 2, yScale: h / 2, borderColor: color, borderWidth: it.width });
      } else {
        page.drawRectangle({ x, y, width: w, height: h, color, opacity: HL_OPACITY, borderWidth: 0 });
      }
    } else if (it.type === 'line' || it.type === 'arrow') {
      const [x1, y1] = g(it.x1, it.y1);
      const [x2, y2] = g(it.x2, it.y2);
      const line = (sx, sy, ex, ey) => page.drawLine({
        start: { x: sx, y: sy }, end: { x: ex, y: ey }, thickness: it.width, color, lineCap: LineCapStyle.Round,
      });
      line(x1, y1, x2, y2);
      if (it.type === 'arrow') for (const [hx, hy] of arrowHead(x1, y1, x2, y2, it.width)) line(x2, y2, hx, hy);
    } else if (it.type === 'text' && fonts) {
      const font = it.bold ? fonts.bold : fonts.regular;
      // 돌리기 전 기준에서 글씨의 '아래쪽' 방향 (글씨를 넣을 때 화면에서 똑바로 보이도록 rot0만큼 기울어 있음)
      const th = (-it.rot0 * Math.PI) / 180;
      const downX = -Math.sin(th), downY = Math.cos(th);
      it.text.split('\n').forEach((lineText, k) => {
        const off = it.size * (TEXT_ASC + k * TEXT_LH);          // 줄의 기준선까지 거리(pt)
        const px = it.x * W + downX * off, py = it.y * H + downY * off;
        const [x, y] = g(px / W, py / H);
        page.drawText(lineText, { x, y, size: it.size, font, color, rotate: degrees(it.rot0 + R) });
      });
    }
  }
}

// 화면 기준 캔버스에 글씨·도형 그리기 (이미지로 저장할 때)
//  scale = 캔버스 픽셀 / pt
function drawItemsCanvas(ctx, p, scale) {
  const bs = baseSize(p);
  const dims = p.rot % 180 ? { w: bs.h, h: bs.w } : bs;
  const X = (v) => v * dims.w * scale, Y = (v) => v * dims.h * scale;
  for (const it of p.items) {
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = it.color;
    ctx.lineWidth = (it.width || 1) * scale;
    ctx.lineCap = 'round';
    if (it.type === 'rect' || it.type === 'ellipse' || it.type === 'highlight') {
      const r = toDisplay(it, p.rot);
      if (it.type === 'rect') ctx.strokeRect(X(r.x), Y(r.y), X(r.w), Y(r.h));
      else if (it.type === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(X(r.x + r.w / 2), Y(r.y + r.h / 2), X(r.w / 2), Y(r.h / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.globalAlpha = HL_OPACITY;
        ctx.fillRect(X(r.x), Y(r.y), X(r.w), Y(r.h));
      }
    } else if (it.type === 'line' || it.type === 'arrow') {
      const a = ptToDisplay(it.x1, it.y1, p.rot), b = ptToDisplay(it.x2, it.y2, p.rot);
      const segs = [[X(a.x), Y(a.y), X(b.x), Y(b.y)]];
      if (it.type === 'arrow') {
        for (const [hx, hy] of arrowHead(a.x * dims.w, a.y * dims.h, b.x * dims.w, b.y * dims.h, it.width)) {
          segs.push([X(b.x), Y(b.y), hx * scale, hy * scale]);
        }
      }
      ctx.beginPath();
      for (const [sx, sy, ex, ey] of segs) { ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); }
      ctx.stroke();
    } else if (it.type === 'text') {
      const gm = textDisplayGeom(it, p);
      ctx.translate(gm.ax * scale, gm.ay * scale);
      ctx.rotate((gm.ang * Math.PI) / 180);
      ctx.font = `${it.bold ? 700 : 400} ${it.size * scale}px ${TEXT_FONT}`;
      gm.box.lines.forEach((line, k) => ctx.fillText(line, 0, it.size * (TEXT_ASC + k * TEXT_LH) * scale));
    }
    ctx.restore();
  }
}

// 페이지 속 그림(사진·스캔)들의 용량 합계 (pdf-lib로 원본 구조를 들여다본다)
function imageBytesOf(s, src, p) {
  if (s.imgBytes.has(p.key)) return s.imgBytes.get(p.key);
  let total = 0;
  try {
    const res = src.getPage(p.index).node.Resources();
    total = res ? xobjectBytes(res, src.context, 0) : 0;
  } catch { total = 0; }
  s.imgBytes.set(p.key, total);
  return total;
}

function xobjectBytes(resources, context, depth) {
  const { PDFName, PDFDict } = window.PDFLib;
  const xo = resources.lookup(PDFName.of('XObject'));
  if (!(xo instanceof PDFDict)) return 0;
  let sum = 0;
  for (const [, ref] of xo.entries()) {
    const obj = context.lookup(ref);
    if (!obj || !obj.dict) continue;
    const sub = obj.dict.get(PDFName.of('Subtype'));
    if (sub === PDFName.of('Image')) {
      sum += obj.contents?.length || 0;
    } else if (sub === PDFName.of('Form') && depth < 3) {
      const inner = obj.dict.lookup(PDFName.of('Resources'));
      if (inner instanceof PDFDict) sum += xobjectBytes(inner, context, depth + 1);
    }
  }
  return sum;
}

// 페이지를 그림(JPG)으로 바꾼다. 가린 영역이 있으면 그 위에 칠한다.
//  - 화면에 보이는 모습 그대로 옮겨지지만, 글자는 그림이 되어 선택·검색이 안 된다.
async function pageJpg(file, p, { dpi, q }) {
  const cacheKey = `${p.key}|${dpi}|${q}|${JSON.stringify(p.masks)}`;
  if (session.jpgs.has(cacheKey)) return session.jpgs.get(cacheKey);

  const page = await file.pdf.getPage(p.index + 1);
  const sizeView = page.getViewport({ scale: 1 });        // 원래 페이지 크기(포인트)와 원래 회전
  const view = page.getViewport({ scale: dpi / 72 });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(view.width);
  canvas.height = Math.round(view.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport: view }).promise;

  // 가린 영역 칠하기 (그림 위에 직접 칠하므로 아래 내용은 사라진다)
  for (const m of p.masks) {
    ctx.fillStyle = m.color;
    // 경계가 흐릿하게 남지 않도록 1픽셀씩 넉넉하게 칠한다
    const x0 = Math.floor(m.x * canvas.width) - 1;
    const y0 = Math.floor(m.y * canvas.height) - 1;
    const x1 = Math.ceil((m.x + m.w) * canvas.width) + 1;
    const y1 = Math.ceil((m.y + m.h) * canvas.height) + 1;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', q));
  canvas.width = canvas.height = 0;   // 메모리 정리
  const result = { bytes: new Uint8Array(await blob.arrayBuffer()), w: sizeView.width, h: sizeView.height };
  session.jpgs.set(cacheKey, result);
  return result;
}

// =====================================================================
// 5-4. 실제 제거 검증 (2단계)
// =====================================================================
// 저장한 PDF를 처음부터 다시 열어서 확인한다.
//  ① 가린 페이지에 글자 정보가 하나도 없는가? (그림으로만 되어 있어야 한다)
//  ② 가린 곳에 있던 글자가 결과 파일의 다른 쪽에 남아 있지는 않은가?
//     (예: 2쪽의 이름을 가렸는데 5쪽에 같은 이름이 그대로 있는 경우 → 알려 준다)

// 원본 페이지에서 가린 영역과 겹치는 '낱말'들을 모은다
//  글자 덩어리(한 줄)를 낱말로 나누고, 글자 수 비율로 각 낱말의 위치를 어림잡아
//  가림 상자와 겹치는 낱말만 고른다. 예: "성명: 홍길동 전화: 010-…" 에서 이름만 가렸다면 → ["홍길동"]
async function hiddenTextsOf(file, index, masks) {
  const page = await file.pdf.getPage(index + 1);
  const vp = page.getViewport({ scale: 1 });   // 가림 좌표와 같은 기준(원래 회전만 반영)
  const content = await page.getTextContent();
  const found = [];
  for (const item of content.items) {
    const str = item.str || '';
    if (!str.trim()) continue;
    const t = pdfjsLib.Util.transform(vp.transform, item.transform);
    const len = Math.hypot(t[0], t[1]) || 1;
    const ux = t[0] / len, uy = t[1] / len;            // 글자가 이어지는 방향
    const w = item.width;
    for (const m of str.matchAll(/\S+/g)) {
      const a = (m.index / str.length) * w;             // 낱말 시작 위치
      const b = ((m.index + m[0].length) / str.length) * w; // 낱말 끝 위치
      const pts = [
        [t[4] + ux * a, t[5] + uy * a], [t[4] + ux * b, t[5] + uy * b],
        [t[4] + ux * a + t[2], t[5] + uy * a + t[3]], [t[4] + ux * b + t[2], t[5] + uy * b + t[3]],
      ];
      const xs = pts.map((q) => q[0] / vp.width), ys = pts.map((q) => q[1] / vp.height);
      const r = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      const hit = masks.some((k) => r.x0 < k.x + k.w && r.x1 > k.x && r.y0 < k.y + k.h && r.y1 > k.y);
      if (hit) found.push(m[0]);
    }
  }
  return [...new Set(found)];
}

const squash = (t) => t.replace(/\s+/g, '');

async function verifyRedaction(bytes, redacted) {
  const task = pdfjsLib.getDocument({ ...PDFJS_OPTIONS, data: bytes.slice() });
  const doc = await task.promise;
  try {
    // 결과 파일 모든 쪽의 글자를 모은다
    const texts = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      texts.push(tc.items.map((it) => it.str || '').join(''));
    }

    // ① 가린 쪽에 글자 정보가 남았는가
    const textLeft = redacted.filter((r) => {
      let left = squash(texts[r.outIndex]);
      for (const a of r.allowed || []) left = left.split(squash(a)).join('');   // 사용자가 직접 넣은 글씨는 제외
      return left.length > 0;
    });

    // ② 가린 글자가 다른 쪽에 남아 있는가 (두 글자 이상만 검사)
    const elsewhere = [];
    const hiddenAll = [...new Set(redacted.flatMap((r) => r.hidden))].map(squash).map((t) => t.replace(/[:：,.()\[\]]+$/g, '')).filter((t) => t.length >= 2);
    for (const h of hiddenAll) {
      const pages = texts.map((t, i) => (squash(t).includes(h) ? i + 1 : 0)).filter(Boolean);
      if (pages.length) elsewhere.push({ text: h, pages });
    }
    return { ok: textLeft.length === 0, textLeft, elsewhere, hiddenCount: hiddenAll.length };
  } finally {
    task.destroy();
  }
}

// 만든 PDF를 사용자 기기에 내려받게 한다 (서버를 거치지 않는다)
function download(bytes, fileName) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);   // 잠시 뒤 메모리 정리
}

function showSaveMsg(text, type = 'ok') {
  els.saveMsg.textContent = text;
  els.saveMsg.className = 'msg ' + type;
  els.saveMsg.hidden = !text;
}

// =====================================================================
// 5-5. 이미지로 저장 (4단계-①): 선택한 쪽(없으면 전체)을 PNG/JPG로
// =====================================================================
//  - 화면에 보이는 모습 그대로: 회전과 가린 영역(개인정보)을 모두 반영한다.
//  - 한 장이면 그림 파일 하나, 여러 장이면 ZIP 파일 하나로 묶어 내려받는다.

els.imgBtn.addEventListener('click', exportImages);

// 이미지로 저장할 쪽: 선택한 쪽, 없으면 전체 (화면 순서대로)
function exportTargets() {
  const chosen = state.pages.filter((p) => selected.has(p.key));
  return chosen.length ? chosen : state.pages;
}

function renderImgCard() {
  const has = state.pages.length > 0;
  els.imgCard.hidden = !has;
  if (!has) return;
  const n = selected.size;
  els.imgTarget.textContent = n
    ? `선택한 ${n}쪽을 그림 파일로 저장합니다.`
    : `선택한 쪽이 없어 전체 ${state.pages.length}쪽을 저장합니다. (위에서 쪽을 누르면 그 쪽만 저장)`;
  const total = n || state.pages.length;
  els.imgBtn.textContent = total === 1 ? '이미지로 저장 (1장)' : `이미지로 저장 (${total}장 → ZIP)`;
}

async function exportImages() {
  const targets = exportTargets();
  if (!targets.length) return;
  const fmt = document.querySelector('input[name="imgFmt"]:checked').value;   // png | jpg
  const dpi = Number(document.querySelector('input[name="imgDpi"]:checked').value);
  const base = cleanName(els.nameInput.value || suggestName()).replace(/\.pdf$/, '');

  els.imgBtn.disabled = true;
  showImgMsg('');
  try {
    const files = [];
    for (const [k, p] of targets.entries()) {
      els.imgBtn.textContent = `그림 만드는 중… ${k + 1}/${targets.length}`;
      const order = state.pages.indexOf(p) + 1;            // 화면에 표시된 쪽 번호
      const bytes = await pageImage(p, fmt, dpi);
      files.push({ name: `${base}_${order}쪽.${fmt}`, bytes });
    }
    const masked = targets.filter((p) => p.masks.length).length;
    if (files.length === 1) {
      downloadBlob(files[0].bytes, files[0].name, fmt === 'png' ? 'image/png' : 'image/jpeg');
      showImgMsg(`저장했습니다: ${files[0].name} (${formatSize(files[0].bytes.length)})`, 'good');
    } else {
      const zip = makeZip(files);
      const zipName = `${base}_이미지${files.length}장.zip`;
      downloadBlob(zip, zipName, 'application/zip');
      showImgMsg(`저장했습니다: ${zipName} (${files.length}장 · ${formatSize(zip.length)})`, 'good');
    }
    if (masked) {
      els.imgMsg.textContent += `\n✔ 가린 영역이 있는 ${masked}쪽은 가린 상태로 저장했습니다.`;
    }
  } catch (err) {
    console.error(err);
    showImgMsg(`그림을 만드는 중 문제가 생겼습니다. 선명도를 '보통'으로 낮춰 보세요. (${err?.message || err})`, 'bad');
  } finally {
    els.imgBtn.disabled = false;
    renderImgCard();
  }
}

// 한 쪽을 그림 파일로 (회전 + 가린 영역 반영)
async function pageImage(p, fmt, dpi) {
  const file = state.files.find((f) => f.id === p.fileId);
  const page = await file.pdf.getPage(p.index + 1);
  const rotation = (page.rotate + p.rot) % 360;
  const view = page.getViewport({ scale: dpi / 72, rotation });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(view.width);
  canvas.height = Math.round(view.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport: view }).promise;

  // 가린 영역은 화면 기준(돌린 뒤) 좌표로 바꿔서 칠한다
  for (const m of p.masks) {
    const r = toDisplay(m, p.rot);
    ctx.fillStyle = m.color;
    const x0 = Math.floor(r.x * canvas.width) - 1, y0 = Math.floor(r.y * canvas.height) - 1;
    const x1 = Math.ceil((r.x + r.w) * canvas.width) + 1, y1 = Math.ceil((r.y + r.h) * canvas.height) + 1;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  // 글씨·도형 그리기 (글꼴이 준비된 뒤에)
  if (p.items.length) {
    await ensureSize(p);
    try { await Promise.all([document.fonts.load(`400 16px ${TEXT_FONT}`), document.fonts.load(`700 16px ${TEXT_FONT}`)]); } catch { /* 계속 */ }
    drawItemsCanvas(ctx, p, dpi / 72);
  }

  const type = fmt === 'png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((ok) => canvas.toBlob(ok, type, 0.9));
  canvas.width = canvas.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

function downloadBlob(bytes, fileName, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function showImgMsg(text, type = 'ok') {
  els.imgMsg.textContent = text;
  els.imgMsg.className = 'msg ' + type;
  els.imgMsg.hidden = !text;
}

// ---------------------------------------------------------------------
// 간단한 ZIP 만들기 (압축 없이 묶기만 함)
//  PNG·JPG는 이미 압축된 형식이라 다시 압축해도 거의 줄지 않는다.
//  그래서 외부 라이브러리 없이 '묶기'만 하는 작은 코드로 충분하다.
// ---------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function makeZip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);      // 한글 파일 이름 (UTF-8 표시를 켠다)
    const crc = crc32(f.bytes);
    const size = f.bytes.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);  // 파일 머리 표시
    local.setUint16(4, 20, true);          // 필요한 버전
    local.setUint16(6, 0x0800, true);      // UTF-8 파일 이름
    local.setUint16(8, 0, true);           // 압축 안 함
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, f.bytes);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);    // 목차 항목 표시
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, dosTime, true);
    cen.setUint16(14, dosDate, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, size, true);
    cen.setUint32(24, size, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);       // 이 파일이 시작하는 위치
    central.push(new Uint8Array(cen.buffer), name);

    offset += 30 + name.length + size;
  }

  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);      // 목차 끝 표시
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);

  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let pos = 0;
  for (const c of all) { out.set(c, pos); pos += c.length; }
  return out;
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

// =====================================================================
// 7. 인터넷 없이 쓰기 (5단계): 프로그램 파일을 브라우저에 보관
// =====================================================================
//  - sw.js(서비스 워커)가 웹앱 프로그램 파일만 보관한다. 작업한 PDF는 보관하지 않는다.
//  - 안심 점검에 준비 상태를 보여 준다.
async function setupOffline() {
  const label = $('offlineLabel');
  const li = document.querySelector('#checks li[data-key="offline"]');
  if (!('serviceWorker' in navigator)) {
    label.textContent = '인터넷 없이 사용: 이 브라우저는 지원하지 않음';
    return;
  }
  try {
    await navigator.serviceWorker.register('sw.js');
    const reg = await navigator.serviceWorker.ready;
    let tries = 0;
    const ask = () => reg.active?.postMessage('status');
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type !== 'status') return;
      if (e.data.ready) {
        li.classList.remove('bad');
        li.classList.add('ok');
        label.textContent = '인터넷 없이 사용 준비 완료';
      } else if (++tries < 40) {
        label.textContent = '인터넷 없이 사용 준비 중… (필요한 파일 보관 중)';
        setTimeout(ask, 3000);
      } else {
        label.textContent = '인터넷 없이 사용: 아직 준비 중 (다음 접속 때 이어서)';
      }
    });
    ask();
  } catch {
    label.textContent = '인터넷 없이 사용: 준비하지 못함 (일반 사용은 문제없음)';
  }
}
setupOffline();
