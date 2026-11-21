#!/usr/bin/env python3
"""
화면 파일 꼬리표 붙이기 — 올린 직후 사용자의 브라우저가 예전 js·css 를 캐시에서 쓰지 않게 합니다.

왜: GitHub Pages 는 파일을 브라우저에 최대 10분 저장해 두게 합니다(Cache-Control: max-age=600). 그래서 새 화면 코드를 올려도
    한동안 예전 파일(또는 예전·새 파일이 섞인 상태)로 동작할 수 있습니다.
하는 일: index.html · admin/index.html 의 이 사이트 js·css 주소 뒤에 `?v=<파일 내용 지문 8자리>` 를 붙입니다.
    파일 내용이 바뀔 때만 꼬리표가 바뀌므로, 바뀐 파일만 새로 받고 나머지는 캐시를 그대로 씁니다.
    화면 안에 띄우는 iframe(data-src)에도 꼬리표를 붙입니다(2026-10-05 장비 지원 화면 때문에 넣음, 2026-11-21 그 화면은 없앰).

사용(저장소 맨 위에서):
    python tools/stamp_assets.py          # 꼬리표 갱신 (js·css 를 고쳤으면 커밋 전에 실행)
    python tools/stamp_assets.py --check  # 갱신이 필요한지만 확인(필요하면 실패) — tests/test_asset_stamps.py 가 씀
"""
import hashlib, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ['admin/index.html', 'index.html']
PAT = re.compile(r'(<script src="|<link rel="stylesheet" href=")(?!https?:|//)([^"?]+\.(?:js|css))(?:\?v=[0-9a-f]*)?(")')
FRAME = re.compile(r'(<iframe [^>]*data-src=")(?!https?:|//)([^"?]+\.html)(?:\?v=[0-9a-f]*)?(")')


def stamp(page, check=False):
    p = ROOT / page
    html = p.read_text(encoding='utf-8')
    missing = []
    def rep(m):
        f = (p.parent / m.group(2)).resolve()
        if not f.exists():
            missing.append(m.group(2)); return m.group(0)
        h = hashlib.md5(f.read_bytes().replace(b'\r\n', b'\n')).hexdigest()[:8]   # 줄바꿈(CRLF/LF) 차이로 꼬리표가 바뀌지 않게
        return f'{m.group(1)}{m.group(2)}?v={h}{m.group(3)}'
    new = FRAME.sub(rep, PAT.sub(rep, html))
    if missing: raise SystemExit(f'{page}: 없는 파일 {missing}')
    if new != html and not check: p.write_bytes(new.encode('utf-8'))
    return new != html


def main():
    check = '--check' in sys.argv
    stale = [pg for pg in PAGES if stamp(pg, check)]
    if check:
        if stale:
            print('꼬리표 갱신 필요:', ', '.join(stale), '→ python tools/stamp_assets.py 실행 후 커밋'); sys.exit(1)
        print('꼬리표 최신'); return
    print('꼬리표 갱신:', ', '.join(stale) if stale else '바뀐 것 없음')


if __name__ == '__main__':
    main()
