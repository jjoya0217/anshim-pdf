"""sw.js(오프라인 사용용 서비스 워커)를 만든다.

코드를 고친 뒤 올리기 전에 실행한다:  python3 tools/build_sw.py
 - 웹앱 파일 목록을 모아 sw.js 안에 적는다.
 - 파일 내용으로 버전을 계산하므로, 무엇이든 바뀌면 사용자 브라우저가 새 버전을 받는다.
"""
import hashlib, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

PAGES = ['index.html', 'guide.html', 'licenses.html']
SKIP_DIRS = {'.git', 'tools'}
SKIP_FILES = {'sw.js', 'README.md', '.nojekyll'}

# 1) 바로 저장할 핵심 파일 (화면 + 기능 코드 + PDF 도구)
core = ['./'] + PAGES + ['manifest.webmanifest', 'page.js', 'icons/icon-192.png', 'icons/favicon-32.png',
        'lib/pdf-lib/pdf-lib.min.js', 'lib/pdfjs/pdf.min.mjs', 'lib/pdfjs/pdf.worker.min.mjs']
# 페이지가 버전 표시(?v=)를 붙여 부르는 파일은 그 주소 그대로 저장한다
for page in PAGES:
    for url in re.findall(r'(?:href|src)="([^"]+\?v=\d+)"', open(page, encoding='utf-8').read()):
        if url not in core:
            core.append(url)

# 2) 나중에 이어서 저장할 나머지 파일 (글꼴, 한글 문서용 보조 자료 등)
rest = []
for d, dirs, files in os.walk('.'):
    dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
    for f in sorted(files):
        path = os.path.relpath(os.path.join(d, f), '.').replace(os.sep, '/')
        if f in SKIP_FILES or path in core or path.split('?')[0] in [c.split('?')[0] for c in core]:
            continue
        if f.endswith('.map'):
            continue
        rest.append(path)

h = hashlib.sha256()
for path in sorted(set(c.split('?')[0] for c in core if c != './') | set(rest)):
    h.update(path.encode())
    h.update(open(path, 'rb').read())
version = h.hexdigest()[:12]

tpl = open('tools/sw.template.js', encoding='utf-8').read()
out = (tpl.replace('__VERSION__', version)
          .replace('__CORE__', ',\n  '.join(f"'{u}'" for u in core))
          .replace('__REST__', ',\n  '.join(f"'{u}'" for u in rest)))
open('sw.js', 'w', encoding='utf-8').write(out)
print(f'sw.js 생성: 버전 {version}, 핵심 {len(core)}개, 나머지 {len(rest)}개')
