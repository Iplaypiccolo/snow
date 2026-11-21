"""
화면 파일 꼬리표 시험 — js·css 를 고치고 꼬리표(?v=…)를 갱신하지 않은 채 올리면, 사용자의 브라우저가 최대 10분 동안
예전 파일을 쓸 수 있습니다. 그래서 꼬리표가 파일 내용과 맞는지 확인합니다.
실패하면: python tools/stamp_assets.py  실행 후 다시 시험하세요.
실행: python tests/test_asset_stamps.py   (저장소 맨 위 폴더에서)
"""
import re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
results = []
def test(name, fn):
    try: fn(); results.append((name, True, ''))
    except AssertionError as e: results.append((name, False, str(e)))

def t_stamps_up_to_date():
    r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'stamp_assets.py'), '--check'], capture_output=True, text=True, encoding='utf-8')
    assert r.returncode == 0, (r.stdout + r.stderr).strip()

def t_every_local_asset_has_stamp():
    for page in ['index.html', 'admin/index.html']:
        html = (ROOT / page).read_text(encoding='utf-8')
        bare = [m for m in re.findall(r'(?:<script src="|<link rel="stylesheet" href=")((?!https?:)[^"]+\.(?:js|css)[^"]*)"', html) if '?v=' not in m]
        assert not bare, f'{page}: 꼬리표 없는 파일 {bare}'

test('꼬리표가 파일 내용과 맞음(고친 뒤 갱신했는지)', t_stamps_up_to_date)
test('이 사이트의 js·css 에 모두 꼬리표가 있음', t_every_local_asset_has_stamp)
ok = sum(1 for _, o, _ in results if o)
for n, o, m in results: print(('PASS ' if o else 'FAIL ') + n + ('' if o else '  → ' + m))
print(f'\n{ok}/{len(results)} 통과'); sys.exit(0 if ok == len(results) else 1)
