#!/usr/bin/env python3
"""행정동 경계 → 기상청 특보구역(끝 단계) 경계 → data/warning_areas.json (지도에 특보 색 칠하기용)

쓰는 자료(저장소에는 결과만 넣음)
  * 행정동 경계: vuski/admdongkor ver20261001 (통계청 SGIS 행정동 경계 가공, CC BY 4.0 · 공공누리 1유형 출처표시)
      https://github.com/vuski/admdongkor  →  HangJeongDong_ver20261001.geojson
  * 특보구역 목록: 서버 public.warning_zones 의 육지(L) 구역 [코드, 이름, 전체 이름, 상위 코드, 특성] JSON
  * 특보구역 ↔ 행정구역 표: 기상청 날씨누리 '특보구역' 안내 표(https://www.weather.go.kr/w/forecast/guide/wrn-area.do)
      [발표관서, 특보구역, 행정구역] JSON — 사용자 결정(2026-11-22)으로 지도 만드는 데 씀

규칙
  1. 행정동마다 끝 단계 특보구역 하나. 나뉜 시·군은 날씨누리 표의 읍·면·동 목록, '산지 제외 지역'은 나머지.
  2. 표가 법정동 이름으로 적은 곳·바뀐 이름은 ALIAS(행정동 이름)로 맞춤 — 근거는 각 줄 주석.
  3. 2026-07-01 인천 구 개편(중구·동구 → 제물포구·영종구, 서구 → 서해구·검단구)은 METRO 표에 새 구 이름으로.
  4. 뺌(사용자 결정 2026-11-22): 제주 전체, 섬 구역, 구례산간(구례군 전체를 구례평지로). EXCLUDE.
  5. 모든 행정동이 정확히 한 구역에 들어가는지, 모든 구역에 행정동이 있는지 확인하고 아니면 멈춤.

실행: python tools/build_warning_areas.py <행정동 geojson> <warning_zones json> <날씨누리 표 json>
"""
import json, re, sys
from collections import defaultdict
from pathlib import Path
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent

# 특보구역 시·도 코드 → 경계 자료의 시·도 이름(2026: 전남·광주 통합)
SIDO = {'L1010000': '경기도', 'L1020000': '강원특별자치도', 'L1030000': '충청남도', 'L1040000': '충청북도',
        'L1050000': '전남광주통합특별시', 'L1060000': '전북특별자치도', 'L1070000': '경상북도', 'L1080000': '경상남도'}

# 광역시 등: 구·군 단위로 정해진 구역(날씨누리 표). 값 = 구역 코드
METRO = {
    '서울특별시': {**{g: 'L1100100' for g in '강동구 송파구 강남구 서초구'.split()},
              **{g: 'L1100200' for g in '도봉구 노원구 강북구 성북구 동대문구 중랑구 성동구 광진구'.split()},
              **{g: 'L1100300' for g in '강서구 양천구 구로구 영등포구 동작구 관악구 금천구'.split()},
              **{g: 'L1100400' for g in '은평구 종로구 마포구 서대문구 중구 용산구'.split()}},
    '부산광역시': {**{g: 'L1082500' for g in '기장군 해운대구 수영구 남구'.split()},
              **{g: 'L1082600' for g in '금정구 북구 동래구 연제구 부산진구 사상구'.split()},
              **{g: 'L1082700' for g in '강서구 사하구 영도구 서구 동구 중구'.split()}},
    '울산광역시': {**{g: 'L1082800' for g in '북구 동구 중구 남구'.split()}, '울주군': 'L1082900'},
    # 인천: 표의 '영종동.영종1동.영종2동.운서동.용유동' = 영종구, '동구.미추홀구.연수구.남동구.중구(영종 제외)' → 제물포구(옛 중구 내륙+동구),
    #       '서구.부평구.계양구' → 서해구·검단구(옛 서구). 경계 자료의 동 이름으로 확인(제물포구 18동 = 옛 중구 내륙 7동 + 옛 동구 11동)
    '인천광역시': {'영종구': 'L1110110', **{g: 'L1110120' for g in '제물포구 미추홀구 연수구 남동구'.split()},
              **{g: 'L1110130' for g in '서해구 검단구 부평구 계양구'.split()}, '강화군': 'L1010900', '옹진군': 'L1013600'},
    '대전광역시': {g: 'L1030100' for g in '동구 중구 서구 유성구 대덕구'.split()},
    '대구광역시': {**{g: 'L1140100' for g in '중구 동구 서구 남구 북구 수성구 달서구'.split()}, '군위군': 'L1070200', '달성군': 'L1140200'},
    '세종특별자치시': {'세종시': 'L1170100'},
}
GWANGJU = {'광산구': 'L1130110', **{g: 'L1130120' for g in '동구 서구 남구 북구'.split()}}   # 전남광주통합특별시 안의 옛 광주광역시 구

# 표의 이름 → 경계 자료(행정동) 이름. (시·군, 표 이름): 행정동 이름
ALIAS = {
    ('동해시', '신흥동'): '삼화동', ('동해시', '비천동'): '삼화동', ('동해시', '이로동'): '삼화동',   # 법정동 → 행정동 삼화동
    ('동해시', '달방동'): '삼화동', ('동해시', '이기동'): '삼화동',
    ('속초시', '도문동'): '대포동', ('속초시', '설악동'): '대포동',     # 1998 통폐합: 대포·도문·설악 → 행정동 대포동(한국민족문화대백과 '속초시')
    ('달성군', '구지면'): '구지읍',                                      # 2023 읍 승격
    ('용인시', '양지면'): '양지읍',                                      # 2026-01-02 읍 승격(용인시 발표, 헤럴드경제 2025-09-24)
    ('하동군', '옥정면'): '옥종면',                                      # 표의 오자: 하동군에는 옥종면만 있음
    ('파주시', '군내면'): '장단면', ('파주시', '진서면'): '장단면',      # 민통선·비무장지대 면 — 장단면 행정복지센터가 맡음(파주시 연혁), 경계 자료엔 장단면에 포함
    ('파주시', '진동면'): '장단면',
    ('세종시', '행정동'): '*동',                                         # 세종남부 '행정동' = 신도시 동 지역
}
IGNORE_TOK = {('고성군', '수동면')}        # 휴전선 북쪽 미수복 면(행정동 없음) — 고성산지 = 간성읍
SKIP_SGG = {('전남광주통합특별시', '신안군'), ('경상북도', '울릉군')}      # 통째로 뺀 섬 군(구역 이름이 시·군 이름과 달라 따로)
METRO_SPLIT = {'L1110100', 'L1130100'}     # 인천·광주는 METRO/GWANGJU 표로 바로 끝 구역 → 날씨누리 표 목록 검사 안 함
# 표의 행정구역 글이 시·군 이름을 틀리게 적은 곳(표: '양평시', '영광시')은 구역 상위 이름(양평군·영광군)을 씀 → 상위 구역으로 찾으므로 영향 없음

# 뺄 구역(사용자 결정 2026-11-22): 섬 구역(다리로 이어진 섬 군 포함), 구례산간. 제주(L109…)는 목록에 없음
EXCLUDE = {'L1010900': '강화', 'L1013600': '옹진', 'L1014200': '백령도.대청도', 'L1014300': '연평도.우도', 'L1031920': '보령도서',
           'L1052200': '신안', 'L1052300': '진도', 'L1052500': '흑산도.홍도', 'L1052600': '거문도.초도', 'L1052720': '영광낙월면',
           'L1053310': '완도', 'L1053320': '완도여서도', 'L1061520': '부안위도면', 'L1061620': '군산옥도면', 'L1061630': '군산어청도',
           'L1072100': '울릉도.독도', 'L1082200': '거제', 'L1082400': '남해', 'L1053020': '구례산간'}
# 섬 구역 행정동(나뉜 시·군 안): 표 목록에 있지만 섬이라 뺌
ISLAND_DONG = {('군산시', '옥도면'), ('부안군', '위도면'), ('영광군', '낙월면')}
SIMPLIFY_DEG, ROUND = 0.0012, 3          # 약 120 m 로 줄이고 소수 셋째 자리(약 100 m)
MIN_PART_KM2 = 15                        # 이보다 작은 조각(작은 섬 등)은 그리지 않음 — 사용자 "섬은 다 빼"


def city_of(sido, sgg):
    """경계 자료의 시·군·구 → 시·군 이름(고양시덕양구 → 고양시)"""
    m = re.match(r'^(.+?[시군])(.+구)?$', sgg)
    return m.group(1) if m and sido not in METRO and not (sido == '전남광주통합특별시' and sgg in GWANGJU) else sgg


def load(zpath, tpath):
    zl = json.load(open(zpath, encoding='utf-8'))
    z = {c: {'name': n, 'full': f, 'up': u, 'sp': s} for c, n, f, u, s in zl}
    kids = defaultdict(list)
    for c, v in z.items():
        kids[v['up']].append(c)
    table = json.load(open(tpath, encoding='utf-8'))
    return z, kids, table


def top_sido(code, z):
    while code in z and code not in SIDO:
        code = z[code]['up']
    return code if code in SIDO else None


def rules(z, kids, table):
    """나뉜 시·군: 상위 구역 코드 → [(끝 구역 코드, 행정동 이름 집합 또는 None=나머지)]"""
    by_name = defaultdict(list)
    for office, name, area in table:
        by_name[name].append(area)
    split = {}
    for up, ks in kids.items():
        if up not in z or z[up]['sp'][-2:] != '03':
            continue
        city = z[up]['full']
        lst = []
        for k in sorted(ks):
            areas = [a for a in by_name.get(z[k]['name'], [])]
            if not areas:
                raise SystemExit(f'날씨누리 표에 없는 구역: {k} {z[k]["name"]}')
            a = areas[0]
            if '제외 지역' in a or '중 300m 미만' in a or a.startswith(z[up]['name'] + '(') or '(도서제외)' in z[k]['name'] or '(위도면 제외)' in z[k]['name'] \
               or '(옥도면 제외)' in z[k]['name'] or '(낙월면 제외)' in z[k]['name'] or '(여서도 제외)' in z[k]['name']:
                lst.append((k, None)); continue
            a = re.sub(r'^' + re.escape(city) + r'\s*', '', a).replace('(제주시중산간 제외)', '')
            toks = [t.strip() for t in a.split('.') if t.strip()]
            lst.append((k, toks))
        split[up] = lst
    return split


def assign(feats, z, kids, table):
    split = rules(z, kids, table)
    whole = {}                      # (시·도 이름, 시·군 이름) → 끝 구역 코드
    split_by_city = {}
    for c, v in z.items():
        sd = top_sido(c, z)
        if sd is None or v['sp'][-2:] not in ('03', '13'):
            continue
        if v['sp'][-2:] == '03':
            split_by_city[(SIDO[sd], v['full'])] = c
        elif v['up'] == sd:
            whole[(SIDO[sd], v['full'])] = c
    out, problems, used_tok = {}, [], set()
    for i, f in enumerate(feats):
        p = f['properties']; sido, sgg = p['sidonm'], p['sggnm']; dong = p['adm_nm'].split()[-1]
        if sido == '제주특별자치도' or (sido, sgg) in SKIP_SGG:
            continue
        if sido in METRO or (sido == '전남광주통합특별시' and sgg in GWANGJU):
            code = (GWANGJU if sido == '전남광주통합특별시' else METRO[sido]).get(sgg)
            if code is None:
                problems.append(('구역 없는 구·군', sido, sgg, dong)); continue
        else:
            city = city_of(sido, sgg)
            code = split_by_city.get((sido, city)) or whole.get((sido, city))
            if code is None:
                problems.append(('구역 없는 시·군', sido, sgg, dong)); continue
        if code in split_by_city.values() or z[code]['sp'][-2:] == '03':
            city = city_of(sido, sgg)
            hit, rest = [], None
            for k, toks in split[code]:
                if toks is None:
                    rest = k if rest is None or k not in EXCLUDE else rest; continue
                for t in toks:
                    t2 = ALIAS.get((city, t), t)
                    t2 = re.sub(r'^\S+구\s+(?=\S+[읍면동]$)', '', t2)      # '상당구 낭성면' → 낭성면
                    gu = re.match(r'^(\S+구)\s*동\s?지역$', t2)
                    ok = (t2 == dong or (t2 == '*동' and dong.endswith('동'))
                          or (t2.endswith('구') and sgg.endswith(t2))
                          or (gu and sgg.endswith(gu.group(1)) and dong.endswith('동'))
                          or (re.match(r'^(\S+[시군]\s*)?동\s?지역', t2) and dong.endswith('동')))
                    if ok:
                        hit.append(k); used_tok.add((k, t))
            if (city, dong) in ISLAND_DONG:
                continue
            hit = sorted(set(hit))
            if len(hit) > 1:
                problems.append(('두 구역에 걸침', sido, sgg, dong, hit)); continue
            code = hit[0] if hit else rest
            if code is None:
                problems.append(('나뉜 시·군에서 못 찾음', sido, sgg, dong)); continue
        if code in EXCLUDE:
            if code == 'L1053020':
                code = 'L1053010'
            else:
                continue
        out[i] = code
    # 표의 이름이 모두 쓰였는지
    for up, lst in split.items():
        for k, toks in lst:
            for t in toks or []:
                if (k, t) not in used_tok and k not in EXCLUDE and up not in METRO_SPLIT and (z[up]['full'], t) not in IGNORE_TOK:
                    problems.append(('표 이름을 경계에서 못 찾음', z[k]['name'], t))
    leaves = {c for c, v in z.items() if v['sp'][-2:] in ('13', '14') and not kids.get(c)} - set(EXCLUDE)
    for c in sorted(leaves - set(out.values())):
        problems.append(('행정동이 하나도 없는 구역', c, z[c]['name']))
    return out, problems


def ring_enc(coords):
    """경위도 → 0.001도 정수 차분(첫 점은 절대값)"""
    pts = [(round(x * 10 ** ROUND), round(y * 10 ** ROUND)) for x, y in coords]
    dedup = [pts[0]] + [p for a, p in zip(pts, pts[1:]) if p != a]
    if len(dedup) < 4:
        return None
    flat, px, py = [], 0, 0
    for x, y in dedup:
        flat += [x - px, y - py]; px, py = x, y
    return flat


def main(geo, zpath, tpath):
    feats = json.load(open(geo, encoding='utf-8'))['features']
    z, kids, table = load(zpath, tpath)
    out, problems = assign(feats, z, kids, table)
    if problems:
        for p in problems:
            print('문제:', *p)
        raise SystemExit(f'{len(problems)}개 문제 — 멈춤')
    groups = defaultdict(list)
    for i, code in out.items():
        groups[code].append(shape(feats[i]['geometry']).buffer(0))
    zones, npts = {}, 0
    for code in sorted(groups):
        g = unary_union(groups[code]).simplify(SIMPLIFY_DEG, preserve_topology=True)
        parts = list(g.geoms) if g.geom_type == 'MultiPolygon' else [g]
        km2 = lambda q: q.area * 111 * 111 * 0.8
        keep = [q for q in parts if km2(q) >= MIN_PART_KM2] or [max(parts, key=lambda q: q.area)]
        polys = []
        for q in keep:
            rings = [ring_enc(q.exterior.coords)] + [ring_enc(h.coords) for h in q.interiors if km2(type(q)(h)) >= MIN_PART_KM2]
            rings = [r for r in rings if r]
            if rings:
                polys.append(rings); npts += sum(len(r) for r in rings) // 2
        zones[code] = {'n': z[code]['name'], 'p': polys}
    dst = ROOT / 'data' / 'warning_areas.json'
    dst.write_text(json.dumps({'version': 1, 'scale': 10 ** ROUND,
                               'source': '경계: 통계청 SGIS 행정동 경계(vuski/admdongkor ver20261001, CC BY 4.0) · 구역: 기상청 특보구역(날씨누리 안내 표) — tools/build_warning_areas.py',
                               'excluded': EXCLUDE, 'zones': zones}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(zones)}개 구역, 점 {npts}개, {dst.stat().st_size // 1024} KB → {dst.relative_to(ROOT)}')
    return out


if __name__ == '__main__':
    main(*sys.argv[1:4])
