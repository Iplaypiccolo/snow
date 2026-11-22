"""고속도로 구간(data/sections.json) → 기상청 특보구역(끝 단계) 미리 계산 → data/section_zones.json

2026-11-22 바꿈: 2013 시·군·구 경계 대신 tools/build_warning_areas.py 와 같은 특보구역 경계(2026-10-01 행정동 경계 × 날씨누리 특보구역 표)를 씀.
  예전엔 평지/산지·동부/서부로 나뉜 시·군을 지나면 나뉜 구역을 모두 넣었으나, 이제 실제로 지나는 구역만 들어감.

쓰는 자료(저장소에는 결과만 넣음): build_warning_areas.py 와 같은 세 파일(행정동 경계 geojson, warning_zones json, 날씨누리 표 json)

규칙
  1. 구간 좌표를 약 200 m 간격으로 나눠 각 조각이 어느 특보구역 안인지 봄(바다 위 다리 등 밖이면 2 km 안의 가장 가까운 구역)
  2. 뺀 구역(섬·제주·구례산간, build_warning_areas.EXCLUDE)은 넣지 않음
  3. 한 구간에서 0.3 km 미만으로 스치는 구역은 버림(그 구간의 유일한 구역이면 남김)

실행: python tools/build_section_zones.py <행정동 geojson> <warning_zones json> <날씨누리 표 json>
"""
import json, math, sys
from collections import defaultdict
from pathlib import Path
from shapely.geometry import shape, Point
from shapely.ops import unary_union
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_warning_areas as W

ROOT = Path(__file__).resolve().parent.parent
STEP_KM, MIN_KM, NEAR_DEG = 0.2, 0.3, 0.02


def km(a, b):
    dx = (b[0] - a[0]) * 111.32 * math.cos(math.radians((a[1] + b[1]) / 2)); dy = (b[1] - a[1]) * 110.57
    return math.hypot(dx, dy)


def main(geo, zpath, tpath):
    feats = json.load(open(geo, encoding='utf-8'))['features']
    z, kids, table = W.load(zpath, tpath)
    out_assign, problems = W.assign(feats, z, kids, table)
    if problems:
        raise SystemExit(f'특보구역 경계 문제 {len(problems)}개 — build_warning_areas.py 로 먼저 확인')
    groups = defaultdict(list)
    for i, code in out_assign.items():
        groups[code].append(shape(feats[i]['geometry']).buffer(0))
    codes = sorted(groups)
    polys = [unary_union(groups[c]) for c in codes]
    tree = STRtree(polys)

    def where(pt):
        p = Point(pt)
        for i in tree.query(p):
            if polys[i].covers(p):
                return int(i)
        near = tree.query(p.buffer(NEAR_DEG))
        return int(min(near, key=lambda i: polys[i].distance(p))) if len(near) else None

    sections = json.load(open(ROOT / 'data' / 'sections.json', encoding='utf-8'))['sections']
    out, nowhere = {}, []
    for s in sections:
        acc = defaultdict(float)
        cs = s['coords']
        for a, b in zip(cs, cs[1:]):
            d = km(a, b); n = max(1, math.ceil(d / STEP_KM))
            for k in range(n):
                t = (k + 0.5) / n
                i = where((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
                if i is not None:
                    acc[codes[i]] += d / n
        if not acc:
            nowhere.append(s['id']); continue
        keep = {zc: v for zc, v in acc.items() if v >= MIN_KM} or {max(acc, key=acc.get): max(acc.values())}
        out[s['id']] = [[zc, round(v, 2)] for zc, v in sorted(keep.items())]
    if nowhere:
        print('어느 특보구역에도 안 걸친 구간:', nowhere)
    dst = ROOT / 'data' / 'section_zones.json'
    dst.write_text(json.dumps({'version': 2, 'source': '특보구역 경계(행정동 2026-10-01 × 날씨누리 특보구역 표) — tools/build_section_zones.py',
                               'sections': out}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(out)}개 구간 → {dst.relative_to(ROOT)} (구역 {len({zc for v in out.values() for zc, _ in v})}개, 줄 {sum(len(v) for v in out.values())})')


if __name__ == '__main__':
    main(*sys.argv[1:4])
