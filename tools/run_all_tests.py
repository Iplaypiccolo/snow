#!/usr/bin/env python3
"""
모든 자동 시험을 한 번에 실행하고 결과 표를 보여 줍니다. (저장소 맨 위 폴더에서)

    python tools/run_all_tests.py             # 전체 (화면 시험은 병렬로)
    python tools/run_all_tests.py --fast      # 화면(브라우저) 시험 제외 — 1분 안팎
    python tools/run_all_tests.py --only 관할   # 이름이나 파일명에 '관할' 이 들어간 시험만
    python tools/run_all_tests.py --list      # 시험 목록만 보기
    python tools/run_all_tests.py --jobs 2 --timeout 900

- 시험마다 따로 실행하고 출력은 `.test-logs/` 에 저장합니다. 실패하면 그 파일을 열어 보세요.
- 모든 시험이 통과하면 종료 코드 0, 하나라도 실패하면 1 입니다. (반영 전에 이 명령이 통과해야 합니다)
- 필요: Node 22, Python 3, `pip install playwright`, `playwright install chromium` (화면 시험용)
"""
import argparse, os, re, shutil, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOGS = ROOT / '.test-logs'

# (이름, 파일, 종류) — 종류: node(계산·서버 함수), py(자료 검사), ui(브라우저로 화면을 눌러 보는 시험)
SUITES = [
    ('계정 발급 함수', 'tests/test_account_admin.mjs', 'node'),
    ('비밀번호 규칙 화면·서버 일치', 'tests/test_admin_policy_parity.mjs', 'node'),
    ('기준정보 이전 함수', 'tests/test_import_reference.mjs', 'node'),
    ('특보 받기 함수', 'tests/test_collect_warnings.mjs', 'node'),
    ('예상 적설 받기 함수', 'tests/test_collect_forecast.mjs', 'node'),
    ('일별 예보 API 안전 점검', 'tests/test_daily_probe.mjs', 'node'),
    ('중기 예보 수집·완전성 검사', 'tests/test_collect_midterm.mjs', 'node'),
    ('일별 예보 대표지점 연결', 'tests/test_daily_regions.py', 'py'),
    ('일별 보강 수집·입력 검사', 'tests/test_collect_daily_aux.mjs', 'node'),
    ('일별 지역대표 날씨 수집', 'tests/test_collect_daily_weather.mjs', 'node'),
    ('일별 예보 표·원값 표시', 'tests/test_daily_view.js', 'node'),
    ('적설 자동 수집 함수', 'tests/test_collect_snow.mjs', 'node'),
    ('적설 요약본 → 화면 계산', 'tests/test_snow_snapshot.js', 'node'),
    ('적설 요약본 시즌별 받기', 'tests/test_snow_split.js', 'node'),
    ('관할 계산', 'tests/test_jurisdiction_core.js', 'node'),
    ('관할 새로고침 없는 재적용', 'tests/test_reapply.js', 'node'),
    ('예보3시간 연결 계산', 'tests/test_forecast_series.js', 'node'),
    ('격자 계산', 'tests/test_grid_core.js', 'node'),
    ('고속도로 2km 격자 생성', 'tests/test_section_grid_geometry.py', 'py'),
    ('본부·지사 순서 일치', 'tests/test_hierarchy_order.py', 'py'),
    ('구간 연속성·무결성', 'tests/test_sections_continuity.py', 'py'),
    ('화면 파일 꼬리표(캐시)', 'tests/test_asset_stamps.py', 'py'),
    # 긴 묶음을 먼저 시작하고 인트로는 초기 계산 시험의 부하가 지난 뒤 실행한다.
    ('관리 콘솔 화면', 'tests/test_admin_ui.py', 'ui'),
    ('로그인 잠금 화면', 'tests/test_login_gate.py', 'ui'),
    ('사용법 안내', 'tests/test_guide.py', 'ui'),
    ('로그인 인트로·새 로그인 화면', 'tests/test_login_intro.py', 'ui'),
    ('관할 화면', 'tests/test_jurisdiction_ui.py', 'ui'),
    ('구간 변경 요청 화면', 'tests/test_jurisdiction_requests.py', 'ui'),
    ('격자 편입 화면', 'tests/test_grid_ui.py', 'ui'),
    ('기관별 24시간 예보 화면', 'tests/test_forecast_ui.py', 'ui'),
]
RESULT_RE = re.compile(r'(\d+)\s*/\s*(\d+)\s*통과')


def command(path, kind):
    return ['node', path] if kind == 'node' else [sys.executable, path]


def run_one(suite, timeout):
    name, path, kind = suite
    t0 = time.time()
    env = dict(os.environ, PYTHONUTF8='1', PYTHONIOENCODING='utf-8')          # Windows 콘솔에서도 한글이 깨지지 않게
    log = LOGS / (Path(path).stem + '.log')
    try:
        p = subprocess.run(command(path, kind), cwd=ROOT, env=env, capture_output=True, timeout=timeout)
        out = (p.stdout + b'\n' + p.stderr).decode('utf-8', errors='replace')
        code = p.returncode
    except subprocess.TimeoutExpired as e:
        out = ((e.stdout or b'') + b'\n' + (e.stderr or b'')).decode('utf-8', errors='replace') + '\n[시간 초과 %ds]' % timeout
        code = -1
    except FileNotFoundError as e:
        out, code = '실행 파일을 찾을 수 없습니다: %s' % e, -2
    log.write_text(out, encoding='utf-8')
    m = RESULT_RE.findall(out)
    passed, total = (int(m[-1][0]), int(m[-1][1])) if m else (0, 0)
    fails = [l.strip() for l in out.splitlines() if l.startswith('FAIL')][:3]
    hint = ''
    if "Executable doesn't exist" in out or 'playwright install' in out:
        hint = '브라우저가 설치되지 않았습니다 → playwright install chromium'
    elif 'ModuleNotFoundError' in out and 'playwright' in out:
        hint = 'playwright 가 없습니다 → pip install playwright'
    ok = code == 0 and total > 0 and passed == total
    return dict(name=name, path=path, kind=kind, ok=ok, passed=passed, total=total, secs=time.time() - t0, code=code, fails=fails, hint=hint, log=log)


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    ap = argparse.ArgumentParser(description='모든 자동 시험을 한 번에 실행')
    ap.add_argument('--fast', action='store_true', help='화면(브라우저) 시험 제외')
    ap.add_argument('--only', help='이름이나 파일명에 이 글자가 들어간 시험만')
    ap.add_argument('--jobs', type=int, default=min(4, os.cpu_count() or 2), help='동시에 돌릴 화면 시험 수')
    ap.add_argument('--timeout', type=int, default=900, help='시험 하나당 제한 시간(초)')
    ap.add_argument('--list', action='store_true')
    a = ap.parse_args()

    suites = [s for s in SUITES if not (a.fast and s[2] == 'ui') and (not a.only or a.only in s[0] or a.only in s[1])]
    if a.list:
        for n, p, k in SUITES:
            print('%-4s %-34s %s' % (k, n, p))
        return 0
    if not suites:
        print('조건에 맞는 시험이 없습니다.')
        return 1
    if not shutil.which('node'):
        print('Node.js 가 없습니다. Node 22 를 설치하세요 (https://nodejs.org).')
        return 1
    LOGS.mkdir(exist_ok=True)
    t0 = time.time()
    print('시험 %d개 실행 (화면 시험 동시 %d개, 제한시간 %ds)…' % (len(suites), a.jobs, a.timeout), flush=True)
    quick = [s for s in suites if s[2] != 'ui']
    slow = [s for s in suites if s[2] == 'ui']
    results = []
    with ThreadPoolExecutor(max_workers=max(1, len(quick))) as ex_quick:
        fq = [ex_quick.submit(run_one, s, a.timeout) for s in quick]
        with ThreadPoolExecutor(max_workers=max(1, a.jobs)) as ex_slow:
            fs = [ex_slow.submit(run_one, s, a.timeout) for s in slow]
            for f in fq + fs:
                r = f.result()
                results.append(r)
                print('  %s %-30s %s%s' % ('✔' if r['ok'] else '✘', r['name'], '%d/%d' % (r['passed'], r['total']) if r['total'] else '결과 없음', '  (%.0f초)' % r['secs']), flush=True)

    order = {s[1]: i for i, s in enumerate(SUITES)}
    results.sort(key=lambda r: order[r['path']])
    bad = [r for r in results if not r['ok']]
    print('\n' + '=' * 64)
    print('%-34s %-10s %s' % ('시험', '통과/전체', '시간'))
    for r in results:
        print('%-34s %-10s %5.0f초 %s' % (r['name'][:32], ('%d/%d' % (r['passed'], r['total'])) if r['total'] else '-', r['secs'], '' if r['ok'] else '← 실패'))
    tp, tt = sum(r['passed'] for r in results), sum(r['total'] for r in results)
    print('=' * 64)
    print('합계: %d개 항목 중 %d개 통과 · 시험 %d개 중 실패 %d개 · 걸린 시간 %.0f초' % (tt, tp, len(results), len(bad), time.time() - t0))
    for r in bad:
        print('\n[실패] %s  (%s)\n  자세한 출력: %s' % (r['name'], r['path'], r['log'].relative_to(ROOT)))
        for l in r['fails']:
            print('  ' + l[:200])
        if r['hint']:
            print('  힌트: ' + r['hint'])
        if r['code'] == -1:
            print('  제한 시간을 넘었습니다. --timeout 을 늘리거나 컴퓨터가 느린지 확인하세요.')
    print('\n' + ('모든 시험을 통과했습니다. 반영해도 됩니다.' if not bad else '실패한 시험이 있습니다. 고친 뒤 다시 실행하세요.'))
    return 0 if not bad else 1


if __name__ == '__main__':
    sys.exit(main())
