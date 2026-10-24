# 안심 PDF 도구

학교 업무용 PDF 웹앱입니다. PDF 병합·편집, 개인정보 가리기, 공문 첨부용 10MB 미만 압축 기능을 제공합니다.

## 안심 원칙

- 모든 작업은 사용자의 브라우저 안에서만 처리됩니다.
- 파일을 받는 서버가 없습니다. 파일은 어디에도 전송·저장되지 않고, AI 학습에도 쓰이지 않습니다.
- 외부 통신 차단 정책(CSP)으로 웹앱이 다른 사이트에 접속하는 것을 브라우저가 막습니다.
- 라이브러리는 모두 `lib` 폴더에 들어 있으며, 외부 CDN을 쓰지 않습니다.

## 직접 확인하는 방법

1. 웹앱을 연 뒤 인터넷 연결을 끊고 사용해 보세요. 그대로 동작합니다.
2. F12 → [네트워크] 탭을 열고 작업해 보세요. 파일 업로드 기록이 없습니다.

## 사용한 라이브러리

| 라이브러리 | 용도 | 라이선스 |
| --- | --- | --- |
| [PDF.js](https://github.com/mozilla/pdf.js) | PDF 미리보기 | Apache 2.0 (`lib/pdfjs/LICENSE`) |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | PDF 편집·저장 | MIT (`lib/pdf-lib/LICENSE.md`) |
| [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) | PDF에 한글 글꼴 넣기 | MIT (`lib/fontkit/LICENSE.txt`) |
| [나눔고딕](https://github.com/google/fonts/tree/main/ofl/nanumgothic) | 한글 글꼴 | SIL OFL 1.1 (`lib/fonts/OFL.txt`) |

## 개발 현황

- [x] 1단계-① 뼈대와 보안 점검
- [x] 1단계-② PDF 불러와 미리보기
- [x] 1단계-③ 이미지 → PDF 변환
- [x] 1단계-④ 페이지 삭제·순서 변경·회전
- [x] 1단계-⑤ 파일명 지정 후 저장
- [x] 2단계 개인정보 실제 제거 (흰색·회색·검은색, 저장 후 자동 검증)
- [x] 3단계 10MB 미만 자동 압축·분할 (사진·스캔 쪽만 단계별 화질 조정, 실패 시 대안)
- [x] 4단계-① PDF → 이미지 저장 (PNG/JPG, 여러 장은 ZIP, 가림·회전 반영)
- [x] 4단계-② 글씨·도형 추가 (글씨·사각형·원·선·화살표·형광펜)
