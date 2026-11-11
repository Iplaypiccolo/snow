"""기준일자별 인원 선택과 첫 지원일의 붙여넣기용 엑셀 다운로드."""
import json,sys,zipfile,xml.etree.ElementTree as ET
from pathlib import Path
import test_equipment as T
from playwright.sync_api import sync_playwright

def picker(p):
    T.tab(p,'fleet');p.locator('[data-crew="V001"]').first.click()
    T.check(p.locator('[data-crewcode]').count()==26,'운전원 a~z 26개')
    p.locator('[data-crewcode="a"]').check();p.locator('[data-crewtab="mechanic"]').click()
    T.check(p.locator('[data-crewcode]').count()==14,'정비원 가~하 14개')
    p.locator('[data-crewcode="마"]').check()
    T.check(p.locator('[data-crewcode="가"]').is_disabled(),'합계 두 명이면 다른 코드 차단')
    p.locator('[data-crewtab="driver"]').click();T.check(p.locator('[data-crewcode="a"]').is_checked(),'탭 변경 뒤 선택 유지')
    p.locator('[data-crewapply]').click()
    T.check(T.ev(p,"stOf(S.round,'V001').crew")==['a','마'] and T.ev(p,'fleetDirty()'),'코드 두 줄·확정 전 변경')
    p.click('#fleetDownload');T.check('먼저 확정' in T.toast(p),'미확정 배정은 엑셀에 넣지 않음')
    T.confirm_fleet(p);T.check(T.ev(p,"stOf(S.round,'V001').crew")==['a','마'] and not T.ev(p,'fleetDirty()'),'서버(샘플) 저장')
    T.check(p.locator('#fleetDownload').is_enabled(),'확정 직후 저장하기 다시 활성화')
    with p.expect_download() as dl:p.click('#fleetDownload')
    with zipfile.ZipFile(dl.value.path()) as z:T.check(z.testzip() is None,'새로고침 없이 확정 직후 다운로드')
    p.locator('[data-crew="V001"]').first.click();p.locator('[data-crewclear]').click();p.locator('[data-crewapply]').click()
    p.click('#save-fleet [data-revert]');T.check(T.ev(p,"stOf(S.round,'V001').crew")==['a','마'],'되돌리기는 저장된 인원 복원')

def carry(p):
    T.tab(p,'fleet')
    T.ev(p,"(setStat('V001',{crew:['a','나']}),refresh())");T.confirm_fleet(p)
    old=T.ev(p,'S.round');result=T.ev(p,"Api.createRound(addDays(S.rounds[0].start_date,1))")
    T.check(result['ok'],'새 기준일자 생성')
    new=result['round']['id'] if 'round' in result else result.get('id')
    if new is None:new=T.ev(p,'Api.load().then(r=>r.rounds.slice().sort((a,b)=>b.start_date.localeCompare(a.start_date))[0].id)')
    rows=T.ev(p,f'Api.statuses([{new}]).then(r=>r.rows)');item=next(x for x in rows if x['vehicle_id']=='V001')
    T.check(item.get('crew')==['a','나'],'이전 기준일자에서 복사')
    changed=T.ev(p,f"Api.saveFleet([],[],{new},[{{vehicle_id:'V001',status:'',off_from:null,crew:['z','하']}}])")
    T.check(changed['ok'],'새 기준일자에서 다른 코드 허용')
    rows=T.ev(p,f'Api.statuses([{old},{new}]).then(r=>r.rows)')
    T.check(next(x for x in rows if x['round_id']==old and x['vehicle_id']=='V001').get('crew')==['a','나'],'이전 기준일자 값 독립 유지')

def download(p):
    result=T.ev(p,"""(async()=>{const round=curRound(),date=round.start_date,b=S.branches[0].id;
      const v=S.vehicles.find(v=>!isPool(v)&&v.type==='제설차');
      const out=await Api.saveFleet([],[{date,vehicle_id:v.id,stops:[b],times:null,revised:false}],round.id,[{vehicle_id:v.id,status:'O',off_from:null,crew:['c','하']}]);
      await reloadAll();curRound().day1_equip=addDays(date,2);renderFleet();return {ok:out.ok,date,number:plateNum(v),org:v.org};})()""")
    T.check(result['ok'],'첫날 지원 배정 준비');T.tab(p,'fleet')
    with p.expect_download() as dl:p.click('#fleetDownload')
    file=dl.value;T.check(result['date'] in file.suggested_filename,'표시 중인 날짜 대신 기준일자 첫날 파일명')
    with zipfile.ZipFile(file.path()) as z:
        T.check(z.testzip() is None,'유효한 ZIP/CRC')
        ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        sheet=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
        rows=[[ ''.join(c.itertext()) for c in row.findall('s:c/s:is',ns)] for row in sheet.findall('s:sheetData/s:row',ns)]
        T.check(rows[0]==['지원처','','도공번호','지원기관','운전원1','운전원2'] and rows[1][:2]==['기관','장비'],'첨부 서식의 A:F/두 줄 머리글')
        hits=[r for r in rows[2:] if r[0]==result['org'] and r[2]==result['number']]
        T.check(len(hits)==1 and hits[0][4:]==['c','하'],'기관·번호 키와 두 코드 보존')
        T.check(all(len(r)==6 and r[0]!='지역본부' and r[3] for r in rows[2:]),'첫날 실제 배정된 기계화부 지원 장비만')
    dest=Path(__file__).resolve().parents[3]/'outputs/79_download_test.xlsx';file.save_as(str(dest))

def permissions(p):
    T.as_user(p,'viewer');T.tab(p,'fleet')
    T.check(p.locator('[data-crew]').count()==0,'보기 전용은 운전원 변경 불가')

TESTS=[picker,carry,download,permissions]
if __name__=='__main__':
    with sync_playwright() as pw:
        b=pw.chromium.launch()
        for fn in TESTS:T.run(fn.__name__,fn,b)
        b.close()
    T.server.shutdown()
    for name,ok,msg in T.results:print(('PASS ' if ok else 'FAIL ')+name+('' if ok else ' '+msg))
    count=sum(ok for _,ok,_ in T.results);print(f'{count}/{len(T.results)} 통과')
    if T.errors:print(T.errors)
    sys.exit(0 if count==len(T.results) and not T.errors else 1)
