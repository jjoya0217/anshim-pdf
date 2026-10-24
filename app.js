// 안심 PDF 도구 - 메인 코드
// 1단계-①: 뼈대와 보안 점검
//
// 이 파일이 하는 일
//  1. 웹앱 폴더 안의 PDF.js(미리보기 도구)를 불러온다.
//  2. pdf-lib(편집 도구)가 준비됐는지 확인한다.
//  3. 외부 통신 차단 정책(CSP)이 실제로 작동하는지 시험한다.

import * as pdfjsLib from './lib/pdfjs/pdf.min.mjs';

// PDF.js는 무거운 작업을 '워커'라는 별도 일꾼에게 맡긴다. 워커 파일도 웹앱 폴더 안에 있다.
pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdfjs/pdf.worker.min.mjs';

// 점검 결과를 화면의 점(●) 색으로 표시하는 함수
function mark(key, ok) {
  const li = document.querySelector(`#checks li[data-key="${key}"]`);
  li.classList.add(ok ? 'ok' : 'bad');
  return ok;
}

// 외부 통신 차단 시험:
// 일부러 바깥 주소로 요청을 보내 보고, 브라우저가 막는지 확인한다.
// 정책이 작동하면 요청은 네트워크로 나가기 전에 차단된다.
function testCsp() {
  return new Promise((resolve) => {
    let blocked = false;
    const onViolation = (e) => {
      if (e.violatedDirective.startsWith('connect-src')) blocked = true;
    };
    document.addEventListener('securitypolicyviolation', onViolation);

    fetch('https://example.invalid/csp-test')
      .catch(() => {})                      // 차단되면 오류가 나는 것이 정상
      .finally(() => {
        setTimeout(() => {                  // 차단 알림 이벤트가 도착할 시간을 잠깐 준다
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

  const summary = document.getElementById('summary');
  if (results.every(Boolean)) {
    summary.textContent = '모든 준비가 끝났습니다. 외부 통신은 차단된 상태입니다.';
    summary.className = 'hint ok';
  } else {
    summary.textContent = '일부 항목이 준비되지 않았습니다. 빨간 점 항목을 확인해 주세요.';
    summary.className = 'hint bad';
  }
}

runChecks();
