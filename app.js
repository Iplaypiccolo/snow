function initApp(){
  // 화면에 글자를 HTML 로 넣을 때는 항상 이 함수를 거칩니다(XSS 방지). 기관 이름은 서버의 변경 이력(신설 기관)에서도 오기 때문입니다.
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  // 안전장치: href="#" 형태의 빈 링크가 클릭될 때 상위 프레임으로 이동하는 것을 전역적으로 방지
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a');
    if(a && (a.getAttribute('href') === '#' || a.getAttribute('href') === '')){
      e.preventDefault();
    }
  }, true);

  // ---------- 탭 전환 ----------
  var rowRegistry = {};      // brKey -> {hqRow, brRow}
  var snowBadgeRegistry = {}; // brKey -> DOM element
  var stationRowRegistry = {}; // stationId -> DOM element (.st-snow span)

  function switchTab(name){
    document.querySelectorAll('.tab-btn').forEach(function(b){
      b.classList.toggle('active', b.dataset.tab === name);
    });
    document.getElementById('view-map').style.display = (name==='map') ? 'flex' : 'none';
    document.getElementById('view-snowtable').style.display = (name==='snowtable') ? 'flex' : 'none';
    document.getElementById('view-sources').style.display = (name==='sources') ? 'block' : 'none';
    var vj = document.getElementById('view-jurisdiction');
    if(vj){ vj.style.display = (name==='jurisdiction') ? 'flex' : 'none'; }
    if(name === 'jurisdiction' && window.JurisdictionUI){ JurisdictionUI.show(); }
    var vg = document.getElementById('view-grid');
    if(vg){ vg.style.display = (name==='grid') ? 'flex' : 'none'; }
    if(name === 'grid' && window.GridUI){ GridUI.show(); }
    var vf = document.getElementById('view-forecast');
    if(vf){ vf.style.display = (name==='forecast') ? 'flex' : 'none'; }
    if(name === 'forecast' && window.ForecastUI){ ForecastUI.show(); }
    if(name === 'map'){ setTimeout(function(){ map.invalidateSize(); }, 50); }
    if(name === 'snowtable'){ buildSnowTable(); }
    if(name === 'sources'){ buildSeasonsTable(); }
  }
  document.querySelectorAll('.tab-btn').forEach(function(btn){
    btn.addEventListener('click', function(){ switchTab(btn.dataset.tab); });
  });

  // ---------- 통계 ----------
  function updateStats(){
    var branchCount = HIERARCHY.hq.reduce(function(sum,h){return sum + h.branches.length;}, 0);
    var withinCount = HIERARCHY.hq.reduce(function(sum,h){return sum + h.count;}, 0);
    document.getElementById('statRoads').textContent = (new Set(ROADS_DATA.map(function(r){return r.name;}))).size;
    document.getElementById('statHQ').textContent = HIERARCHY.hq.length;
    document.getElementById('statBranch').textContent = branchCount;
    document.getElementById('statWithin').textContent = withinCount;
    document.getElementById('statUnclass').textContent = HIERARCHY.unclassified.length;
  }
  updateStats();

  // ---------- 지도 ----------
  var map = L.map('map', {zoomControl:true}).setView([36.4, 127.9], 7);
  map.createPane('stationsPane');
  map.getPane('stationsPane').style.zIndex = 450; // 기본 overlayPane(400)보다 위 = 노선 위에 관측소 표시
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  var legend = L.control({position:'bottomleft'});
  legend.onAdd = function(){
    var div = L.DomUtil.create('div','legend');
    div.innerHTML =
      // 2026-11-10 사용자: 범례를 두 줄로(노선 한 줄, 관측소 거리 한 줄)
      '<div class="row"><span class="line"></span> 고속도로 중심선</div>'+
      '<div class="row">관측소 거리 <span class="dot" style="background:#0b5d38"></span> 0~3 <span class="dot" style="background:#c97a2b"></span> 3~6 <span class="dot" style="background:#b5432f"></span> 6~8km</div>';
    return div;
  };
  legend.addTo(map);

  // 팝업 닫기(X) 버튼이 href="#" 링크라서 상위 프레임으로 잘못 이동하는 문제 방지
  map.on('popupopen', function(e){
    var btn = e.popup && e.popup._closeButton;
    if(btn){
      btn.removeAttribute('href');
      btn.style.cursor = 'pointer';
      L.DomEvent.off(btn, 'click');
      L.DomEvent.on(btn, 'click', function(ev){
        L.DomEvent.preventDefault(ev);
        L.DomEvent.stopPropagation(ev);
        map.closePopup(e.popup);
      });
    }
  });

  ROADS_DATA.forEach(function(r){
    var latlngs = r.coords.map(function(c){return [c[1], c[0]];});
    L.polyline(latlngs, {color:'#0b5d38', weight:2, opacity:0.75}).addTo(map)
      .bindTooltip(esc(r.name), {sticky:true, direction:'top'});
  });

  function bandColor(distKm){
    if(distKm <= 3) return '#0b5d38';
    if(distKm <= 6) return '#c97a2b';
    return '#b5432f';
  }

  var markerById = {};
  var allStationsFlat = [];
  var seenStationIds = {};
  function buildMarkers(){
  Object.keys(markerById).forEach(function(id){ map.removeLayer(markerById[id]); });      // 관할이 바뀌어 다시 만들 때 기존 마커 제거
  markerById = {}; allStationsFlat = []; seenStationIds = {};
  HIERARCHY.hq.forEach(function(hq){
    hq.branches.forEach(function(br){
      br.stations.forEach(function(s){
        if(!seenStationIds[s.id]){ seenStationIds[s.id] = true; allStationsFlat.push(s); }
      });
    });
  });
  HIERARCHY.unclassified.forEach(function(s){
    if(!seenStationIds[s.id]){ seenStationIds[s.id] = true; allStationsFlat.push(s); }
  });

  allStationsFlat.forEach(function(s){
    var baseColor = bandColor(s.dist_km);
    var marker = L.circleMarker([s.lat, s.lon], {
      pane: 'stationsPane',
      radius:5, color:'#fff', weight:1,
      fillColor: baseColor, fillOpacity:0.9
    }).addTo(map);
    marker._baseColor = baseColor;
    var addrLine = s.addr ? ('<div>'+esc(s.addr)+'</div>') : '';
    var basePopup =
      '<b>'+esc(s.name)+'</b> <span style="color:#6b6455">(지점 '+esc(s.id)+')</span>'+addrLine+
      '<div>최근접 노선: '+esc(s.road)+'</div>'+
      '<div>거리: <span class="popup-dist">'+s.dist_km.toFixed(3)+' km</span></div>';
    marker.bindPopup(basePopup);
    marker.on('popupopen', function(){
      var date = document.getElementById('dateSelect').value;
      var line = '';
      if(date){
        var v = SNOW_DATA.stationData[String(s.id)] ? SNOW_DATA.stationData[String(s.id)][date] : null;
        line = '<div style="margin-top:4px;border-top:1px solid #eee;padding-top:4px;">'+date+' 신적설: <b style="color:#1F51FF">'+(v!=null ? v.toFixed(1)+'cm' : '자료없음')+'</b></div>';
      }
      marker.setPopupContent(basePopup + line);
    });
    marker._baseRadius = 5;
    markerById[s.id] = marker;
  });
  }
  buildMarkers();

  // ---------- 강조(하이라이트) & 표시/숨김 ----------
  var highlightLayer = L.layerGroup().addTo(map);
  var snowLabelLayer = L.layerGroup().addTo(map);
  // 본부를 고르면 지사마다 다른 색: 관할·격자 탭과 같은 팔레트(JurisCore.BRANCH_PALETTE)를 씀
  var NEON_PALETTE = (window.JurisCore && JurisCore.BRANCH_PALETTE) || ['#39FF14','#00FFFF','#FF00FF','#FF3131','#1F51FF','#FF6EC7','#CCFF00','#FF9500','#9D00FF','#00FF7F','#FFFB00','#00B3FF'];
  var visibleStationIds = null; // null = 전체 표시

  function showSnowLabels(stationList){
    snowLabelLayer.clearLayers();
    var date = document.getElementById('dateSelect').value;
    if(!date) return;
    (stationList||[]).forEach(function(s){
      var rec = SNOW_DATA.stationData[String(s.id)];
      var v = rec ? rec[date] : null;
      if(v == null) return;
      L.marker([s.lat, s.lon], {opacity:0, interactive:false})
        .bindTooltip(v.toFixed(1)+'cm', {permanent:true, direction:'top', className:'snow-label', offset:[0,-6]})
        .addTo(snowLabelLayer);
    });
  }

  var GRAY_COLOR = '#c9c4b3';
  function grayOutExcept(idList){
    var idSet = {};
    (idList||[]).forEach(function(id){ idSet[id] = true; });
    Object.keys(markerById).forEach(function(idStr){
      var id = Number(idStr);
      var m = markerById[id];
      var keepColor = (idList === null) || idSet[id];
      m.setStyle({ fillColor: keepColor ? m._baseColor : GRAY_COLOR, fillOpacity: keepColor ? 0.9 : 0.45 });
    });
    visibleStationIds = idList;
  }

  function clearMapHighlight(){
    highlightLayer.clearLayers();
    snowLabelLayer.clearLayers();
    Object.keys(markerById).forEach(function(idStr){
      var m = markerById[idStr];
      m.setRadius(5); m.setStyle({weight:1});
    });
    grayOutExcept(null);
  }

  // 지사 선택: 관할 노선 전체를 노란색 하나로 강조, 해당 지사 관측소 외에는 회색 처리
  function highlightForBranch(stationList, routeSegments){
    highlightLayer.clearLayers();
    (routeSegments||[]).forEach(function(seg){
      var latlngs = seg.coords.map(function(c){return [c[1], c[0]];});
      L.polyline(latlngs, {color:'#FFE400', weight:6, opacity:0.95}).addTo(highlightLayer);
    });
    Object.keys(markerById).forEach(function(idStr){ markerById[idStr].setRadius(5); markerById[idStr].setStyle({weight:1}); });
    (stationList||[]).forEach(function(s){
      var m = markerById[s.id];
      if(m){ m.setRadius(8); m.setStyle({weight:2}); }
    });
    grayOutExcept((stationList||[]).map(function(s){return s.id;}));
    showSnowLabels(stationList);
  }

  // 본부 선택: 하위 지사별로 서로 다른 형광색, 본부 소속 외 관측소는 회색 처리
  function highlightForHQ(hq){
    highlightLayer.clearLayers();
    var allIds = [];
    var allStationsForLabels = [];
    hq.branches.forEach(function(br, idx){
      var color = NEON_PALETTE[idx % NEON_PALETTE.length];
      (br.routeSegments||[]).forEach(function(seg){
        var latlngs = seg.coords.map(function(c){return [c[1], c[0]];});
        L.polyline(latlngs, {color:color, weight:6, opacity:0.95}).addTo(highlightLayer);
      });
      br.stations.forEach(function(s){ allIds.push(s.id); allStationsForLabels.push(s); });
    });
    Object.keys(markerById).forEach(function(idStr){ markerById[idStr].setRadius(5); markerById[idStr].setStyle({weight:1}); });
    allIds.forEach(function(id){
      var m = markerById[id];
      if(m){ m.setRadius(8); m.setStyle({weight:2}); }
    });
    grayOutExcept(allIds);
    showSnowLabels(allStationsForLabels);
  }

  function clearHighlightRows(){
    document.querySelectorAll('.br-row.active,.st-row.active,.hq-row.active').forEach(function(el){
      el.classList.remove('active');
    });
  }

  function dimOtherSwatches(activeBrRow){
    document.querySelectorAll('.color-swatch').forEach(function(el){
      el.style.background = '#d8d5c8';
    });
    if(activeBrRow){
      var sw = activeBrRow.querySelector('.color-swatch');
      if(sw) sw.style.background = '#FFE400';
    }
  }

  function restoreSwatchColors(){
    document.querySelectorAll('.color-swatch').forEach(function(el){
      el.style.background = el.dataset.color;
    });
  }

  function zoomToLatLngs(latlngs, fallbackAnchor){
    if(latlngs && latlngs.length){
      map.fitBounds(L.latLngBounds(latlngs), {padding:[40,40], maxZoom:13});
    } else if(fallbackAnchor){
      map.setView([fallbackAnchor[0], fallbackAnchor[1]], 11);
    }
  }

  function routeLatLngs(routeSegments){
    var out = [];
    (routeSegments||[]).forEach(function(seg){
      seg.coords.forEach(function(c){ out.push([c[1], c[0]]); });
    });
    return out;
  }

  function flyToStation(s){
    map.flyTo([s.lat, s.lon], 14, {duration:0.6});
    var m = markerById[s.id];
    if(m) m.openPopup();
  }

  // ---------- 트리 렌더링 ----------
  var treeEl = document.getElementById('tree');
  var filterText = '';
  var openBranch = null; // { row, children } 현재 펼쳐진 지사 하나만 추적
  var openHQ = null; // { row, children } 현재 펼쳐진 본부 하나만 추적

  function matchesFilter(text){
    return !filterText || (text||'').toLowerCase().indexOf(filterText) !== -1;
  }
  function stationMatches(s){
    return matchesFilter(s.name) || matchesFilter(s.road) || matchesFilter(String(s.id));
  }

  function buildTree(){
    treeEl.innerHTML = '';
    openBranch = null;
    openHQ = null;
    rowRegistry = {};
    snowBadgeRegistry = {};
    stationRowRegistry = {};

    HIERARCHY.hq.forEach(function(hq){
      var hqBranchesVisible = hq.branches.filter(function(br){
        if(!filterText) return true;
        if(matchesFilter(hq.name) || matchesFilter(br.name)) return true;
        return br.stations.some(stationMatches);
      });
      if(filterText && hqBranchesVisible.length === 0) return;

      var hqRow = document.createElement('div');
      hqRow.className = 'hq-row';
      hqRow.innerHTML =
        '<span class="chev">▶</span><span class="hq-name">'+esc(hq.name)+' 본부</span>'+
        '<span class="count-badge'+(hq.count===0?' zero':'')+'">'+hq.count+'</span>';

      var hqChildren = document.createElement('div');
      hqChildren.className = 'hq-children';

      var branchesToRender = filterText ? hqBranchesVisible : hq.branches;
      branchesToRender.forEach(function(br){
        var colorIdx = hq.branches.indexOf(br);
        var swatchColor = NEON_PALETTE[colorIdx % NEON_PALETTE.length];
        var brRow = document.createElement('div');
        brRow.className = 'br-row';
        var brKey = hq.name + '|||' + br.name;
        var radiusTag = br.radiusKm && br.radiusKm !== 5 ? ' <span style="color:#c97a2b;font-size:10px;">('+br.radiusKm+'km)</span>' : '';
        brRow.innerHTML =
          '<span class="chev">▶</span>'+
          '<span class="color-swatch" data-color="'+swatchColor+'" style="background:'+swatchColor+'"></span>'+
          '<span class="br-name">'+esc(br.name)+' 지사'+radiusTag+'</span>'+
          '<span class="snow-badge none" style="display:none;"></span>'+
          '<span class="count-badge'+(br.count===0?' zero':'')+'">'+br.count+' 대</span>';
        rowRegistry[brKey] = {hqRow: hqRow, brRow: brRow, hq: hq, br: br};
        snowBadgeRegistry[brKey] = brRow.querySelector('.snow-badge');

        var brChildren = document.createElement('div');
        brChildren.className = 'br-children';

        var stationsToRender = filterText ? br.stations.filter(stationMatches) : br.stations;
        if(stationsToRender.length === 0){
          var empty = document.createElement('div');
          empty.className = 'empty-msg';
          empty.textContent = '반경 8km 이내에도 적설관측소 없음';
          brChildren.appendChild(empty);
        } else {
          stationsToRender.forEach(function(s){
            var stRow = document.createElement('div');
            stRow.className = 'st-row';
            stRow.dataset.id = s.id;
            var band = s.dist_km<=3?1:(s.dist_km<=6?2:3);
            stRow.innerHTML =
              '<span class="st-name">'+esc(s.name)+'<span class="id">#'+esc(s.id)+(s.addr?(' · '+esc(s.addr)):'')+' · '+esc(s.road)+'</span></span>'+
              '<span class="st-snow" style="font-family:var(--mono);font-weight:700;color:#1F51FF;margin-right:8px;"></span>'+
              '<span class="st-dist dist-band-'+band+'">'+s.dist_km.toFixed(3)+' km</span>';
            stationRowRegistry[brKey+'|||'+s.id] = stRow.querySelector('.st-snow');
            stRow.addEventListener('click', function(e){
              e.stopPropagation();
              clearHighlightRows();
              stRow.classList.add('active');
              flyToStation(s);
            });
            brChildren.appendChild(stRow);
          });
        }

        brRow.addEventListener('click', function(e){
          e.stopPropagation();
          var isOpen = brRow.classList.contains('open');
          if(isOpen){
            brRow.classList.remove('open');
            brChildren.classList.remove('expanded');
            openBranch = null;
            clearHighlightRows();
            clearMapHighlight();
            restoreSwatchColors();
            return;
          }
          // 다른 지사가 열려 있으면 먼저 접기
          if(openBranch && openBranch.row !== brRow){
            openBranch.row.classList.remove('open');
            openBranch.children.classList.remove('expanded');
          }
          brRow.classList.add('open');
          brChildren.classList.add('expanded');
          openBranch = { row: brRow, children: brChildren };
          clearHighlightRows();
          brRow.classList.add('active');
          dimOtherSwatches(brRow);
          highlightForBranch(br.stations, br.routeSegments);
          var latlngs = routeLatLngs(br.routeSegments);
          if(latlngs.length){
            zoomToLatLngs(latlngs, br.anchor);
          } else {
            zoomToLatLngs(br.stations.map(function(s){return [s.lat,s.lon];}), br.anchor);
          }
        });

        hqChildren.appendChild(brRow);
        hqChildren.appendChild(brChildren);
      });

      hqRow.addEventListener('click', function(){
        var isOpen = hqRow.classList.contains('open');
        if(isOpen){
          hqRow.classList.remove('open');
          hqChildren.classList.remove('expanded');
          openHQ = null;
          clearHighlightRows();
          clearMapHighlight();
          restoreSwatchColors();
          map.setView([36.4, 127.9], 7); // 전체 지도로 축소
          return;
        }
        // 다른 본부가 열려 있으면 먼저 접기
        if(openHQ && openHQ.row !== hqRow){
          openHQ.row.classList.remove('open');
          openHQ.children.classList.remove('expanded');
        }
        hqRow.classList.add('open');
        hqChildren.classList.add('expanded');
        openHQ = { row: hqRow, children: hqChildren };
        clearHighlightRows();
        hqRow.classList.add('active');
        restoreSwatchColors();
        var allStations = [];
        var allSegments = [];
        hq.branches.forEach(function(br){
          allStations = allStations.concat(br.stations);
          allSegments = allSegments.concat(br.routeSegments);
        });
        highlightForHQ(hq);
        var latlngs = routeLatLngs(allSegments);
        if(latlngs.length){
          zoomToLatLngs(latlngs, null);
        } else {
          zoomToLatLngs(allStations.map(function(s){return [s.lat,s.lon];}), null);
        }
      });

      if(filterText){
        hqRow.classList.add('open');
        hqChildren.classList.add('expanded');
      }

      treeEl.appendChild(hqRow);
      treeEl.appendChild(hqChildren);
    });

    if(HIERARCHY.unclassified.length && (!filterText || HIERARCHY.unclassified.some(stationMatches) || matchesFilter('미분류'))){
      var section = document.createElement('div');
      section.className = 'unclass-section';
      var header = document.createElement('div');
      header.className = 'unclass-header';
      header.textContent = '미분류 (' + HIERARCHY.unclassified.length + ') — 관할 지사 노선정보 모호로 자동배정 실패';
      section.appendChild(header);
      var list = filterText ? HIERARCHY.unclassified.filter(stationMatches) : HIERARCHY.unclassified;
      list.forEach(function(s){
        var stRow = document.createElement('div');
        stRow.className = 'st-row';
        stRow.style.paddingLeft = '12px';
        stRow.dataset.id = s.id;
        var band = s.dist_km<=3?1:(s.dist_km<=6?2:3);
        stRow.innerHTML =
          '<span class="st-name">'+esc(s.name)+'<span class="id">#'+esc(s.id)+' · '+esc(s.road)+'</span></span>'+
          '<span class="st-dist dist-band-'+band+'">'+s.dist_km.toFixed(3)+' km</span>';
        stRow.addEventListener('click', function(){
          clearHighlightRows();
          stRow.classList.add('active');
          flyToStation(s);
        });
        section.appendChild(stRow);
      });
      treeEl.appendChild(section);
    }
    updateAllSnowBadges();
  }

  document.getElementById('searchBox').addEventListener('input', function(e){
    filterText = e.target.value.trim().toLowerCase();
    buildTree();
  });

  // ================= 신적설 데이터 모듈 =================
  var ALL_BRANCH_KEYS = [];
  function recomputeBranchKeys(){
    ALL_BRANCH_KEYS = [];
    HIERARCHY.hq.forEach(function(hq){
      hq.branches.forEach(function(br){ ALL_BRANCH_KEYS.push(hq.name+'|||'+br.name); });
    });
  }
  recomputeBranchKeys();

  // 화면에서 고를 수 있는 시즌 = 최근 3시즌(SSSnow 가 정함). 그 이전 시즌은 [지난 시즌] 엑셀로만 받음
  function recentLabels(){ return (SNOW_DATA.recent || Object.keys(SNOW_DATA.seasons)).slice().sort(); }
  // 아직 안 받은 시즌을 서버에서 받아 지사별 값까지 계산(관할에 맞춰)
  function ensureSeason(label){
    if(SNOW_DATA.seasons[label]) return Promise.resolve();
    return SSSnow.loadSeason(SNOW_DATA, label).then(function(){
      if(window.JurisCore) JurisCore.rebuildAllSeries(HIERARCHY, SNOW_DATA);
      refreshDateOptions();
    });
  }
  window.SSEnsureAllSeasons = function(){                     // 관할 미리보기(전체 시즌 최대)용
    if(!window.SSSnow || !SNOW_DATA.index) return Promise.resolve();
    return SSSnow.loadAll(SNOW_DATA).then(function(){ if(window.JurisCore) JurisCore.rebuildAllSeries(HIERARCHY, SNOW_DATA); });
  };

  // 시즌 이름: 'YYYY-YY'(2026-10-30, 첫눈~마지막 눈) → '2025-26 시즌', 목록에서는 기간도 '(11.25~3.15)', 진행 중이면 '(11.25~진행 중)'. 예전 이름(11.15~3.15)은 그대로
  function seasonIx(label){ return (SNOW_DATA.index || []).filter(function(x){ return x.label === label; })[0] || null; }
  function seasonName(label){ return /^\d{4}-\d{2}$/.test(label) ? label + ' 시즌' : label; }
  function md(d){ return (+d.slice(4,6)) + '.' + (+d.slice(6,8)); }
  function seasonText(label){
    var ix = seasonIx(label);
    return (ix && ix.start && ix.end) ? seasonName(label) + ' (' + md(ix.start) + '~' + (ix.ongoing ? '진행 중' : md(ix.end)) + ')' : seasonName(label);
  }
  function refreshSeasonOptions(){
    var sel = document.getElementById('seasonSelect');
    var labels = recentLabels();
    var prev = sel.value;
    sel.innerHTML = labels.map(function(l){return '<option value="'+esc(l)+'">'+esc(seasonText(l))+'</option>';}).join('');
    if(labels.indexOf(prev) !== -1) sel.value = prev;
    else if(labels.length) sel.value = labels[labels.length-1];
    var older = (SNOW_DATA.older || []).slice().sort().reverse();
    var osel = document.getElementById('oldSeasonSelect');
    if(osel){
      osel.innerHTML = older.map(function(l){return '<option value="'+esc(l)+'">'+esc(seasonText(l))+'</option>';}).join('');
      document.getElementById('oldSeasonBox').hidden = !older.length;
    }
  }

  // ---------- 관측소 지도 날짜 고르기(달력, 2026-10-30) ----------
  // 고를 수 있는 날 = 시즌 기간(첫눈~마지막 눈) 안의 날. 그 밖의 날·달은 누를 수 없음. 처음엔 아무 날도 고르지 않음
  // 고르면 그날 값만 받음(받아 둔 시즌이면 그대로, 아니면 서버 원자료에서 하루치 — SSSnow.loadDate)
  var dateInput = document.getElementById('dateSelect'), dateBtn = document.getElementById('dateBtn'), datePop = document.getElementById('datePop');
  var datePick = dateBtn.parentNode, calRanges = [], calMonth = null, dateSeq = 0;      // calRanges = [[시작, 끝] YYYYMMDD], calMonth = 'YYYYMM'
  function fmtDate(d){ return d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8); }
  function calEnabled(ymd){ return calRanges.some(function(r){ return r[0] <= ymd && ymd <= r[1]; }); }
  function monthEnabled(ym){ return calRanges.some(function(r){ return r[0].slice(0,6) <= ym && ym <= r[1].slice(0,6); }); }
  function monthList(){                                       // 첫 시즌 첫 달 ~ 마지막 시즌 마지막 달
    if(!calRanges.length) return [];
    var last = calRanges.reduce(function(m, r){ return r[1] > m ? r[1] : m; }, '').slice(0,6), y = +calRanges[0][0].slice(0,4), m = +calRanges[0][0].slice(4,6), out = [];
    for(;;){ var ym = y + String(m).padStart(2,'0'); out.push(ym); if(ym >= last) break; if(++m > 12){ m = 1; y++; } }
    return out;
  }
  function refreshDateOptions(){
    var idx = (SNOW_DATA.index || []).filter(function(x){ return x.start && x.end; });
    calRanges = idx.length ? idx.map(function(x){ return [x.start, x.end]; })
      : Object.keys(SNOW_DATA.seasons).map(function(l){ var d = SNOW_DATA.seasons[l].dates; return d.length ? [d[0], d[d.length-1]] : null; }).filter(Boolean);   // 예전 모양: 받은 시즌의 날짜
    calRanges.sort(function(a, b){ return a[0] < b[0] ? -1 : 1; });
    if(dateInput.value && !calEnabled(dateInput.value)) setDate('');
    if(!datePop.hidden) drawCal();
  }
  function drawCal(){
    var months = monthList();
    if(!months.length){ datePop.innerHTML = '<div class="cal-empty">고를 수 있는 날짜가 없습니다</div>'; return; }
    if(!calMonth || months.indexOf(calMonth) === -1) calMonth = dateInput.value ? dateInput.value.slice(0,6) : months[months.length-1];
    var en = months.filter(monthEnabled), i = en.indexOf(calMonth);
    var y = +calMonth.slice(0,4), m = +calMonth.slice(4,6), first = new Date(y, m-1, 1).getDay(), n = new Date(y, m, 0).getDate();
    var h = '<div class="cal-head"><button type="button" class="cal-nav" data-go="-1"'+(i <= 0 ? ' disabled' : '')+' aria-label="이전 달">‹</button>'+
      '<select class="cal-month" aria-label="달 고르기">'+months.slice().reverse().map(function(ym){
        return '<option value="'+ym+'"'+(ym === calMonth ? ' selected' : '')+(monthEnabled(ym) ? '' : ' disabled')+'>'+ym.slice(0,4)+'년 '+(+ym.slice(4))+'월</option>';
      }).join('')+'</select>'+
      '<button type="button" class="cal-nav" data-go="1"'+(i >= en.length-1 ? ' disabled' : '')+' aria-label="다음 달">›</button></div><div class="cal-grid">'+
      ['일','월','화','수','목','금','토'].map(function(w){ return '<span class="cal-w">'+w+'</span>'; }).join('');
    for(var k = 0; k < first; k++) h += '<span></span>';
    for(var d = 1; d <= n; d++){
      var ymd = calMonth + String(d).padStart(2,'0');
      h += '<button type="button" class="cal-d'+(ymd === dateInput.value ? ' sel' : '')+'" data-d="'+ymd+'"'+(calEnabled(ymd) ? '' : ' disabled')+'>'+d+'</button>';
    }
    datePop.innerHTML = h + '</div><div class="cal-foot"><button type="button" class="cal-clear">선택 해제</button></div>';
  }
  function setDate(d){
    dateInput.value = d || '';
    if(d) calMonth = d.slice(0,6);
    dateBtn.textContent = d ? fmtDate(d) : '일자 선택(신적설)';
    var my = ++dateSeq;
    if(!d || !window.SSSnow){ dateChanged(); return Promise.resolve(); }
    dateBtn.classList.add('loading');
    return SSSnow.loadDate(SNOW_DATA, d).then(function(){ if(my === dateSeq) dateChanged(); },
      function(){ if(my === dateSeq){ dateBtn.textContent = fmtDate(d) + ' (불러오지 못함)'; dateChanged(); } })
      .then(function(){ if(my === dateSeq) dateBtn.classList.remove('loading'); });
  }
  dateBtn.addEventListener('click', function(){ datePop.hidden = !datePop.hidden; if(!datePop.hidden) drawCal(); });
  datePop.addEventListener('click', function(e){
    var t = e.target.closest('button'); if(!t || t.disabled) return;
    if(t.dataset.go){ var en = monthList().filter(monthEnabled), i = en.indexOf(calMonth) + Number(t.dataset.go); if(en[i]){ calMonth = en[i]; drawCal(); } return; }
    if(t.dataset.d){ datePop.hidden = true; setDate(t.dataset.d); return; }
    if(t.classList.contains('cal-clear')){ datePop.hidden = true; setDate(''); }
  });
  datePop.addEventListener('change', function(e){ if(e.target.classList.contains('cal-month')){ calMonth = e.target.value; drawCal(); } });
  document.addEventListener('click', function(e){ if(!datePop.hidden && e.composedPath().indexOf(datePick) === -1) datePop.hidden = true; });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && !datePop.hidden){ datePop.hidden = true; dateBtn.focus(); } });

  function computeBranchMax(hqName, brName, date){
    if(!date) return null;
    var hq = HIERARCHY.hq.filter(function(h){return h.name===hqName;})[0];
    if(!hq) return null;
    var br = hq.branches.filter(function(b){return b.name===brName;})[0];
    if(!br) return null;
    var max = null;
    br.stations.forEach(function(s){
      var rec = SNOW_DATA.stationData[String(s.id)];
      var v = rec ? rec[date] : null;
      if(v != null && (max===null || v > max)) max = v;
    });
    return max;
  }

  function updateAllSnowBadges(){
    var date = document.getElementById('dateSelect').value;
    Object.keys(rowRegistry).forEach(function(key){
      var parts = key.split('|||');
      var val = computeBranchMax(parts[0], parts[1], date);
      var badge = snowBadgeRegistry[key];
      if(badge){
        if(!date){ badge.style.display='none'; }
        else if(val != null){ badge.textContent = val.toFixed(1)+'cm'; badge.classList.remove('none'); badge.style.display='inline-block'; }
        else { badge.textContent = '0cm'; badge.classList.add('none'); badge.style.display='inline-block'; }
      }
    });
    Object.keys(stationRowRegistry).forEach(function(compositeKey){
      var el = stationRowRegistry[compositeKey];
      var stnId = compositeKey.split('|||').pop();
      var rec = SNOW_DATA.stationData[stnId];
      var v = (date && rec) ? rec[date] : null;
      el.textContent = (date && v != null) ? (v.toFixed(1)+'cm') : (date ? '-' : '');
    });
  }

  function dateChanged(){
    updateAllSnowBadges();
    // 현재 열려있는 지사가 있으면 지도 라벨도 갱신
    if(openBranch){
      var key = Object.keys(rowRegistry).filter(function(k){return rowRegistry[k].brRow===openBranch.row;})[0];
      if(key) showSnowLabels(rowRegistry[key].br.stations);
    } else if(openHQ){
      var hqKey = Object.keys(rowRegistry).filter(function(k){return rowRegistry[k].hqRow===openHQ.row;});
      var allSt = [];
      hqKey.forEach(function(k){ allSt = allSt.concat(rowRegistry[k].br.stations); });
      showSnowLabels(allSt);
    }
  }

  function openBranchByKey(key){
    var entry = rowRegistry[key];
    if(!entry) return;
    if(!entry.hqRow.classList.contains('open')) entry.hqRow.click();
    if(!entry.brRow.classList.contains('open')) entry.brRow.click();
  }

  // ---------- 연도별 신적설 표 ----------
  function buildSeasonsTable(){
    var tbody = document.querySelector('#seasonsTable tbody');
    if(!tbody) return;
    var index = SNOW_DATA.index || [];
    var labels = index.length ? index.map(function(x){ return x.label; }).sort() : Object.keys(SNOW_DATA.seasons).sort();
    if(labels.length === 0){
      tbody.innerHTML = '<tr><td colspan="4">보유 중인 시즌 없음</td></tr>';
      return;
    }
    tbody.innerHTML = labels.map(function(label){
      var season = SNOW_DATA.seasons[label];
      var ix = index.filter(function(x){ return x.label === label; })[0];
      if(ix && ix.data_days != null){                          // 서버 목록에 있는 값(시즌을 받지 않아도 보임)
        var span = ix.start && ix.end ? fmtDate(ix.start)+' ~ '+(ix.ongoing ? '진행 중('+fmtDate(ix.end)+'까지)' : fmtDate(ix.end)) : '-';
        return '<tr><td>'+esc(seasonName(label))+'</td><td class="mono-cell">'+esc(span)+'</td><td class="mono-cell">'+ix.days+'일</td><td class="mono-cell">'+ix.data_days+'일</td></tr>';
      }
      if(!season) return '';
      var branchKeys = Object.keys(season.branches);
      var daysWithData = 0;
      for(var i=0;i<season.dates.length;i++){
        for(var j=0;j<branchKeys.length;j++){
          if(season.branches[branchKeys[j]][i] != null){ daysWithData++; break; }
        }
      }
      var dd = season.dates;
      return '<tr><td>'+esc(seasonName(label))+'</td><td class="mono-cell">'+(dd.length ? fmtDate(dd[0])+' ~ '+fmtDate(dd[dd.length-1]) : '-')+'</td><td class="mono-cell">'+dd.length+'일</td><td class="mono-cell">'+daysWithData+'일</td></tr>';
    }).join('');
  }

  function buildSnowTable(){
    var label = document.getElementById('seasonSelect').value;
    var season = SNOW_DATA.seasons[label];
    var wrap = document.getElementById('snowTableWrap');
    if(!season && label && SNOW_DATA.index && window.SSSnow){                 // 아직 안 받은 시즌: 고를 때 받음
      wrap.innerHTML = '<div style="padding:20px;color:#888;">불러오는 중…</div>';
      ensureSeason(label).then(function(){ if(document.getElementById('seasonSelect').value === label) buildSnowTable(); },
        function(){ wrap.innerHTML = '<div style="padding:20px;color:#b5432f;">이 시즌 자료를 불러오지 못했습니다. 잠시 뒤 다시 고르세요.</div>'; });
      return;
    }
    if(!season){ wrap.innerHTML = '<div style="padding:20px;color:#888;">자료 없음</div>'; return; }
    var dates = season.dates, partial = (seasonIx(label) || {}).partial || [];     // 24시각을 다 못 받은 날(오늘 오전까지 '수집 중')

    var html = '<table class="snowtable"><thead><tr><th class="row-label row-label-head">본부 / 지사</th><th class="sum-col-head">지사:합계<br>본부:평균</th>';
    dates.forEach(function(d){
      html += '<th data-col-h="'+d+'">'+d.slice(4,6)+'/'+d.slice(6,8)+(partial.indexOf(d) !== -1 ? '<br><span class="partial-tag">수집 중</span>' : '')+'</th>';
    });
    html += '</tr></thead><tbody>';

    HIERARCHY.hq.forEach(function(hq){
      // 지사별 배열을 먼저 모아서 본부 평균 계산
      var branchArrs = hq.branches.map(function(br){
        var key = hq.name+'|||'+br.name;
        return season.branches[key] || dates.map(function(){return null;});
      });
      var hqAvgArr = dates.map(function(_, i){
        var vals = branchArrs.map(function(arr){return arr[i];}).filter(function(v){return v!=null;});
        return vals.length ? (vals.reduce(function(a,b){return a+b;},0) / vals.length) : null;
      });

      var branchSums = branchArrs.map(function(arr){ return arr.reduce(function(acc,v){ return acc + (v||0); }, 0); });
      var hqSeasonAvg = branchSums.length ? (branchSums.reduce(function(a,b){return a+b;},0) / branchSums.length) : null;
      html += '<tr class="hq-row-label"><td class="row-label">'+esc(hq.name)+' 본부(평균)</td><td class="sum-col">'+(hqSeasonAvg!=null?hqSeasonAvg.toFixed(2):'-')+'</td>';
      hqAvgArr.forEach(function(v){
        var disp = v==null ? '-' : v.toFixed(1);
        html += '<td>'+disp+'</td>';
      });
      html += '</tr>';

      hq.branches.forEach(function(br, bi){
        var key = hq.name+'|||'+br.name;
        var arr = branchArrs[bi];
        var sum = arr.reduce(function(acc,v){ return acc + (v||0); }, 0);
        html += '<tr data-branch-row="'+esc(key)+'"><td class="row-label" style="padding-left:20px;">'+esc(br.name)+'</td>';
        html += '<td class="sum-col">'+(sum>0 ? sum.toFixed(1) : '-')+'</td>';
        arr.forEach(function(v, i){
          var d = dates[i];
          var cls = v==null ? '' : (v>0 ? 'has-val' : 'zero-val');
          var disp = v==null ? '-' : v.toFixed(1);
          html += '<td class="snowcell '+cls+'" data-date="'+d+'" data-branch="'+esc(key)+'" data-col="'+i+'">'+disp+'</td>';
        });
        html += '</tr>';
      });
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;

    var cells = wrap.querySelectorAll('td.snowcell');
    cells.forEach(function(td){
      td.addEventListener('mouseenter', function(){
        var col = this.dataset.col;
        wrap.querySelectorAll('td[data-col="'+col+'"]').forEach(function(c){ c.classList.add('col-hl'); });
        var row = wrap.querySelector('tr[data-branch-row="'+CSS.escape(this.dataset.branch)+'"]');
        if(row) row.classList.add('row-hl');
      });
      td.addEventListener('mouseleave', function(){
        var col = this.dataset.col;
        wrap.querySelectorAll('td[data-col="'+col+'"]').forEach(function(c){ c.classList.remove('col-hl'); });
        wrap.querySelectorAll('tr.row-hl').forEach(function(r){ r.classList.remove('row-hl'); });
      });
      td.addEventListener('click', function(){
        var date = this.dataset.date;
        var key = this.dataset.branch;
        var parts = key.split('|||');
        switchTab('map');
        setDate(date);
        openBranchByKey(key);
      });
    });
  }

  document.getElementById('seasonSelect').addEventListener('change', buildSnowTable);

  // ---------- 엑셀(xlsx) 내보내기 ----------
  function exportSnowTableToXlsx(label){
    label = label || document.getElementById('seasonSelect').value;
    var season = SNOW_DATA.seasons[label];
    if(!season) return;
    var dates = season.dates;

    var header = ['본부/지사', '지사:합계 / 본부:평균'].concat(dates.map(function(d){
      return d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8);
    }));
    var rows = [header];

    HIERARCHY.hq.forEach(function(hq){
      var branchArrs = hq.branches.map(function(br){
        var key = hq.name+'|||'+br.name;
        return season.branches[key] || dates.map(function(){return null;});
      });
      var hqAvgArr = dates.map(function(_, i){
        var vals = branchArrs.map(function(arr){return arr[i];}).filter(function(v){return v!=null;});
        return vals.length ? (vals.reduce(function(a,b){return a+b;},0) / vals.length) : null;
      });
      var branchSums = branchArrs.map(function(arr){ return arr.reduce(function(acc,v){ return acc + (v||0); }, 0); });
      var hqSeasonAvg = branchSums.length ? (branchSums.reduce(function(a,b){return a+b;},0) / branchSums.length) : null;

      rows.push([hq.name+' 본부(평균)', hqSeasonAvg!=null?Number(hqSeasonAvg.toFixed(2)):null].concat(
        hqAvgArr.map(function(v){ return v!=null ? Number(v.toFixed(1)) : null; })
      ));

      hq.branches.forEach(function(br, bi){
        var arr = branchArrs[bi];
        var sum = arr.reduce(function(acc,v){ return acc + (v||0); }, 0);
        rows.push([br.name, Number(sum.toFixed(1))].concat(
          arr.map(function(v){ return v!=null ? Number(v.toFixed(1)) : null; })
        ));
      });
    });

    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:16},{wch:14}].concat(dates.map(function(){return {wch:9};}));
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, seasonName(label).slice(0,31));
    XLSX.writeFile(wb, '신적설_'+seasonName(label)+'.xlsx');
  }

  // 엑셀 라이브러리(약 300KB)는 첫 화면을 늦추지 않도록 [엑셀로 내보내기]를 처음 누를 때 불러옵니다.
  var XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', xlsxLoading = null;
  function loadXlsx(){
    if(window.XLSX) return Promise.resolve();
    if(!xlsxLoading) xlsxLoading = new Promise(function(ok, fail){
      var sc = document.createElement('script'); sc.src = XLSX_URL;
      sc.onload = function(){ window.XLSX ? ok() : fail(); };
      sc.onerror = function(){ xlsxLoading = null; sc.remove(); fail(); };
      document.head.appendChild(sc);
    });
    return xlsxLoading;
  }
  // label 이 없으면 지금 표의 시즌. 지난 시즌은 이때 서버에서 받아 계산한 뒤 엑셀로 만듦(화면 표에는 넣지 않음)
  function exportClick(btn, label){
    var txt = btn.textContent;
    btn.disabled = true; btn.textContent = '엑셀 준비 중…';
    var seasonReady = label ? ensureSeason(label).then(null, function(){ throw new Error('season'); }) : Promise.resolve();
    Promise.all([loadXlsx(), seasonReady]).then(function(){
      try { exportSnowTableToXlsx(label); } catch(e){ window.alert('엑셀 파일을 만들지 못했습니다: ' + (e && e.message || e)); }
    }, function(e){
      if(e && e.message === 'season') window.alert('이 시즌 자료를 불러오지 못했습니다. 잠시 뒤 다시 누르세요.');
      else window.alert('엑셀 라이브러리를 불러오지 못했습니다. 인터넷 연결(회사망에서는 cdnjs.cloudflare.com 접속)을 확인하세요.');
    }).then(function(){ btn.disabled = false; btn.textContent = txt; });
  }
  document.getElementById('exportXlsxBtn').addEventListener('click', function(){ exportClick(this); });
  var oldBtn = document.getElementById('oldSeasonXlsxBtn');
  if(oldBtn) oldBtn.addEventListener('click', function(){ var l = document.getElementById('oldSeasonSelect').value; if(l) exportClick(this, l); });

  refreshSeasonOptions();
  refreshDateOptions();
  buildSnowTable();

  buildTree();

  // 관할 변경을 저장했을 때 새로고침 없이 호출: 관할에 따라 달라지는 화면(통계·관측소 지도·지사 트리·표)을 새 HIERARCHY 로 다시 만든다.
  // 업로드해 둔 저장 안 된 신적설 자료(SNOW_DATA)와 선택한 날짜·시즌, 지도 위치는 그대로 유지된다.
  window.refreshHierarchyViews = function(){
    highlightLayer.clearLayers(); snowLabelLayer.clearLayers(); visibleStationIds = null;
    updateStats(); buildMarkers(); recomputeBranchKeys(); buildTree(); updateAllSnowBadges();
    var vs = document.getElementById('view-snowtable'); if(vs && vs.style.display !== 'none'){ buildSnowTable(); }
    var vo = document.getElementById('view-sources'); if(vo && vo.style.display !== 'none'){ buildSeasonsTable(); }
  };
}
