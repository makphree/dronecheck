/* QuotaZone — mappa personale delle zone geografiche UAS (ED-269 / ED-318 / GeoJSON) */
(function () {
  'use strict';

  // ---------------------------------------------------------------- costanti
  const RESTR = {
    PROHIBITED:        { label: 'Vietato',              short: 'Vietato',      rank: 4,   cls: 'prohib', css: '--st-prohib' },
    REQ_AUTHORISATION: { label: 'Serve autorizzazione', short: 'Autorizz.',    rank: 3,   cls: 'auth',   css: '--st-auth' },
    UNKNOWN:           { label: 'Non classificato',     short: 'N.c.',         rank: 2.5, cls: 'unknown',css: '--st-unknown' },
    CONDITIONAL:       { label: 'Condizionato',         short: 'Condizionato', rank: 2,   cls: 'cond',   css: '--st-cond' },
    NO_RESTRICTION:    { label: 'Nessuna restrizione',  short: 'Libero',       rank: 1,   cls: 'free',   css: '--st-free' }
  };
  const RESTR_ORDER = ['PROHIBITED', 'REQ_AUTHORISATION', 'CONDITIONAL', 'NO_RESTRICTION', 'UNKNOWN'];
  const REASONS = {
    AIR_TRAFFIC: 'Traffico aereo', SENSITIVE: 'Area sensibile', PRIVACY: 'Privacy', POPULATION: 'Popolazione',
    NATURE: 'Natura', NOISE: 'Rumore', FOREIGN_TERRITORY: 'Territorio estero', EMERGENCY: 'Emergenza', OTHER: 'Altro'
  };
  const NEAR_RADIUS_M = 10000;

  // ---------------------------------------------------------------- utilità
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const fmtDist = m => m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',') + ' km';
  const fmtCoord = (lat, lng) => lat.toFixed(5) + ', ' + lng.toFixed(5);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const ls = {
    get(k, d) { try { const v = localStorage.getItem('qz.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('qz.' + k, JSON.stringify(v)); } catch (e) { /* ignora */ } }
  };

  // IndexedDB minimale (le zone possono pesare diversi MB)
  const idb = (() => {
    let dbp;
    function open() {
      if (!dbp) dbp = new Promise((res, rej) => {
        const r = indexedDB.open('quotazone', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return dbp;
    }
    function tx(mode, fn) {
      return open().then(db => new Promise((res, rej) => {
        const t = db.transaction('kv', mode); const st = t.objectStore('kv');
        const req = fn(st);
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
      }));
    }
    return {
      get: k => tx('readonly', s => s.get(k)).catch(() => undefined),
      set: (k, v) => tx('readwrite', s => s.put(v, k)),
      del: k => tx('readwrite', s => s.delete(k))
    };
  })();

  // ---------------------------------------------------------------- parsing
  function normRestriction(v) {
    if (!v) return 'UNKNOWN';
    const s = String(v).toUpperCase().replace(/[\s-]+/g, '_');
    if (/PROHIB|FORBID|NO_?FLY|VIETAT/.test(s)) return 'PROHIBITED';
    if (/AUTH|AUTORIZ/.test(s)) return 'REQ_AUTHORISATION';
    if (/NO_?RESTRICT|^NONE$|LIBER/.test(s)) return 'NO_RESTRICTION';
    if (/CONDITION|CONDIZ/.test(s)) return 'CONDITIONAL';
    return 'UNKNOWN';
  }
  function textOf(v) {
    if (v == null) return '';
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (Array.isArray(v)) {
      const it = v.find(x => x && /^it/i.test(x.lang || x.language || '')) || v[0];
      return textOf(it);
    }
    if (typeof v === 'object') return textOf(v.text || v.value || v.name || '');
    return '';
  }
  function listOf(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }

  function layerFrom(o) {
    if (!o) return null;
    const uom = o.uomDimensions || o.uom || o.unit || 'M';
    const lower = o.lowerLimit != null ? o.lowerLimit : o.lower;
    const upper = o.upperLimit != null ? o.upperLimit : o.upper;
    if (lower == null && upper == null) return null;
    return {
      lower: lower == null ? null : Number(lower),
      lowerRef: o.lowerVerticalReference || o.lowerReference || '',
      upper: upper == null ? null : Number(upper),
      upperRef: o.upperVerticalReference || o.upperReference || '',
      uom: String(uom).toUpperCase().startsWith('F') ? 'ft' : 'm'
    };
  }
  function circlePoly(lon, lat, radiusM) {
    return turf.circle([lon, lat], radiusM / 1000, { steps: 72, units: 'kilometers' }).geometry;
  }
  function applicabilityOf(p) {
    const a = listOf(p.applicability || p.limitedApplicability || p.timeApplicability);
    const out = [];
    a.forEach(x => {
      if (!x) return;
      const perm = String(x.permanent || '').toUpperCase();
      if (perm === 'YES' && !x.startDateTime && !x.endDateTime) return;
      if (x.startDateTime || x.endDateTime) out.push({ start: x.startDateTime || null, end: x.endDateTime || null });
    });
    return out;
  }
  function authorityOf(p) {
    const a = listOf(p.zoneAuthority || p.authority)[0];
    if (!a) return null;
    const v = x => { const t = textOf(x).trim(); return /^(n\.?a\.?|n\/a|-)?$/i.test(t) ? '' : t; };
    const o = { name: v(a.name), service: v(a.service), phone: v(a.phone), email: v(a.email), site: v(a.siteURL || a.siteUrl || a.website), purpose: a.purpose || '' };
    return (o.name || o.service || o.phone || o.email || o.site) ? o : null;
  }

  // testo semplice da HTML (i messaggi D-Flight contengono <p>, <ul>, <li>)
  function plain(html) {
    if (!html) return '';
    return String(html).replace(/<li[^>]*>/gi, '\n• ').replace(/<\/(p|div|ul|ol)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’')
      .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  }
  // "avio_6622_PRATELLO" -> "Pratello (avio 6622)"
  function prettyName(n) {
    const m = /^avio_(\w+?)_(.+)$/i.exec(n);
    if (m) return m[2].replace(/_/g, ' ').toLowerCase().replace(/(^|[\s'’-])\S/g, c => c.toUpperCase()) + ' (avio ' + m[1] + ')';
    return n.replace(/_/g, ' ');
  }
  function categoryOf(p, name, restriction) {
    if (/^NOTAM/i.test(name)) return 'NOTAM';
    const o = String(p.otherReasonInfo || '').toUpperCase();
    if (o === 'NFZ' || o === 'ATM09') return o;
    return restriction === 'PROHIBITED' ? 'NFZ' : 'ALTRO';
  }

  // Costruisce una zona normalizzata
  function makeZone(src, geom, layer, idx, raw) {
    const p = src;
    const reasons = listOf(p.reason).map(r => String(r).toUpperCase()).filter(Boolean);
    const rawName = textOf(p.name || p.Name || p.nome || p.title || p.identifier) || 'Zona senza nome';
    const restriction = normRestriction(p.restriction || p.Restriction || p.tipo || p.type_restriction);
    const fid = String(p.identifier || p.id || p.ID || ('Z' + idx));
    const z = {
      id: fid + (layer && layer._n ? '#' + layer._n : ''),
      fid,
      name: prettyName(rawName),
      restriction,
      category: categoryOf(p, rawName, restriction),
      reasons,
      reasonInfo: /^(ATM09|NFZ)$/i.test(textOf(p.otherReasonInfo)) ? '' : textOf(p.otherReasonInfo),
      message: plain(textOf(p.message)),
      conditions: listOf(p.restrictionConditions).map(textOf).filter(Boolean),
      layer: layer || null,
      times: applicabilityOf(p),
      authority: authorityOf(p),
      geometry: geom,
      raw
    };
    z.bbox = turf.bbox({ type: 'Feature', geometry: geom, properties: {} });
    return z;
  }

  // almeno un anello con 4 punti
  function validCoords(c) {
    let x = c, d = 0;
    while (Array.isArray(x) && x.length && Array.isArray(x[0])) { x = x[0]; d++; }
    return d >= 2 && Array.isArray(c) && c.length > 0 && (d === 2 ? c[0].length >= 4 : c[0][0] && c[0][0].length >= 4);
  }

  function parseED269(data) {
    const zones = []; let skipped = 0;
    data.features.forEach((f, i) => {
      listOf(f.geometry).forEach((g, j) => {
        try {
          const hp = g.horizontalProjection || g;
          let geom;
          if (/circle/i.test(hp.type)) {
            const c = hp.center || hp.coordinates;
            geom = circlePoly(Number(c[0]), Number(c[1]), Number(hp.radius));
          } else if ((hp.type === 'Polygon' || hp.type === 'MultiPolygon') && validCoords(hp.coordinates)) {
            geom = { type: hp.type, coordinates: hp.coordinates };
          } else { skipped++; return; }
          const lay = layerFrom(g) || {};
          if (listOf(f.geometry).length > 1) lay._n = j + 1;
          zones.push(makeZone(f, geom, lay, i, f));
        } catch (e) { skipped++; }
      });
    });
    return { zones, skipped, format: 'ED-269' };
  }

  function parseGeoJSON(data) {
    const zones = []; let skipped = 0; let ed318 = false;
    const feats = data.type === 'FeatureCollection' ? data.features : data.type === 'Feature' ? [data] : [];
    feats.forEach((f, i) => {
      const p = f.properties || {};
      if (p.restriction || p.zoneAuthority || p.reason) ed318 = true;
      const geoms = !f.geometry ? [] : f.geometry.type === 'GeometryCollection' ? f.geometry.geometries : [f.geometry];
      geoms.forEach((g, j) => {
        try {
          let geom;
          const radius = g.radius || (g.extent && g.extent.radius) || p.radius;
          if (g.type === 'Point' && radius) geom = circlePoly(g.coordinates[0], g.coordinates[1], Number(radius));
          else if ((g.type === 'Polygon' || g.type === 'MultiPolygon') && validCoords(g.coordinates)) geom = { type: g.type, coordinates: g.coordinates };
          else { skipped++; return; }
          const lay = layerFrom(g.layer || p.layer || g.extent || p) || {};
          if (geoms.length > 1) lay._n = j + 1;
          zones.push(makeZone(p, geom, lay, i, f));
        } catch (e) { skipped++; }
      });
    });
    return { zones, skipped, format: ed318 ? 'ED-318' : 'GeoJSON' };
  }

  function parseAny(data) {
    if (Array.isArray(data)) data = { features: data };
    if (data && Array.isArray(data.features) && data.features.length && Array.isArray(data.features[0].geometry)) return parseED269(data);
    if (data && Array.isArray(data.features) && data.features.length && data.features[0].geometry && data.features[0].geometry.horizontalProjection) return parseED269(data);
    if (data && (data.type === 'FeatureCollection' || data.type === 'Feature')) return parseGeoJSON(data);
    if (data && Array.isArray(data.features)) return parseED269(data);
    throw new Error('Formato non riconosciuto: mi aspettavo un file ED-269, ED-318 o GeoJSON con un elenco "features".');
  }

  // ---------------------------------------------------------------- dati di esempio (inventati)
  function demoDataset(lat, lng, label) {
    const off = (dLat, dLng) => [lng + dLng, lat + dLat];
    const rect = (a, b, c, d) => [[off(a, b), off(a, d), off(c, d), off(c, b), off(a, b)]];
    const geo = (type, coordinates) => ({ horizontalProjection: { type, coordinates } });
    return {
      title: 'Zone di esempio ' + label,
      description: 'Dati inventati per provare l’app. Non corrispondono a zone reali.',
      demo: true,
      features: [
        { identifier: 'ESEMPIO-A', name: 'Esempio A · area vietata', type: 'COMMON', restriction: 'PROHIBITED', reason: ['SENSITIVE'],
          message: 'Esempio: volo vietato a qualsiasi quota.', applicability: [{ permanent: 'YES' }],
          zoneAuthority: [{ name: 'Autorità di esempio', purpose: 'AUTHORIZATION' }],
          geometry: [{ uomDimensions: 'M', lowerLimit: 0, lowerVerticalReference: 'AGL', upperLimit: 0, upperVerticalReference: 'AGL',
            horizontalProjection: { type: 'Circle', center: off(0.012, -0.018), radius: 900 } }] },
        { identifier: 'ESEMPIO-B', name: 'Esempio B · avvicinamento', type: 'COMMON', restriction: 'REQ_AUTHORISATION', reason: ['AIR_TRAFFIC'],
          message: 'Esempio: oltre 25 m serve autorizzazione.',
          geometry: [Object.assign({ uomDimensions: 'M', lowerLimit: 25, lowerVerticalReference: 'AGL', upperLimit: 120, upperVerticalReference: 'AGL' },
            geo('Polygon', rect(-0.004, -0.03, 0.02, 0.006)))] },
        { identifier: 'ESEMPIO-C', name: 'Esempio C · quota limitata', type: 'COMMON', restriction: 'CONDITIONAL', reason: ['AIR_TRAFFIC'],
          message: 'Esempio: volo consentito fino a 45 m.',
          geometry: [Object.assign({ uomDimensions: 'M', lowerLimit: 0, lowerVerticalReference: 'AGL', upperLimit: 45, upperVerticalReference: 'AGL' },
            geo('Polygon', rect(-0.012, -0.004, 0.006, 0.026)))] },
        { identifier: 'ESEMPIO-D', name: 'Esempio D · parco naturale', type: 'CUSTOMIZED', restriction: 'CONDITIONAL', reason: ['NATURE', 'NOISE'],
          message: 'Esempio: rispettare la fauna, niente decolli nei mesi di nidificazione.',
          applicability: [{ permanent: 'NO', startDateTime: '2026-03-01T00:00:00Z', endDateTime: '2026-07-31T23:59:59Z' }],
          geometry: [Object.assign({ uomDimensions: 'M', lowerLimit: 0, lowerVerticalReference: 'AGL', upperLimit: 120, upperVerticalReference: 'AGL' },
            geo('Polygon', [[off(-0.03, -0.035), off(-0.018, -0.01), off(-0.026, 0.012), off(-0.04, -0.004), off(-0.03, -0.035)]]))] },
        { identifier: 'ESEMPIO-E', name: 'Esempio E · evento temporaneo', type: 'CUSTOMIZED', restriction: 'PROHIBITED', reason: ['EMERGENCY'],
          applicability: [{ permanent: 'NO', startDateTime: '2026-01-01T00:00:00Z', endDateTime: '2027-12-31T23:59:59Z' }],
          geometry: [{ uomDimensions: 'M', lowerLimit: 0, lowerVerticalReference: 'AGL', upperLimit: 0, upperVerticalReference: 'AGL',
            horizontalProjection: { type: 'Circle', center: off(-0.002, 0.034), radius: 450 } }] },
        { identifier: 'ESEMPIO-F', name: 'Esempio F · area informativa', type: 'COMMON', restriction: 'NO_RESTRICTION', reason: ['OTHER'],
          otherReasonInfo: 'Area di esempio con sola informazione.',
          geometry: [Object.assign({ uomDimensions: 'FT', lowerLimit: 0, lowerVerticalReference: 'AGL', upperLimit: 400, upperVerticalReference: 'AGL' },
            geo('Polygon', rect(0.024, 0.0, 0.04, 0.03)))] }
      ]
    };
  }

  // ---------------------------------------------------------------- stato
  const state = {
    zones: [],
    meta: null,
    me: null,              // {lat,lng,acc,alt,t}
    inspect: null,         // {lat,lng} punto toccato
    points: ls.get('points', []),
    filters: Object.assign({ cat: {}, band: {}, reason: {}, expired: false }, ls.get('filters', {})),
    colorMode: ls.get('colorMode', 'quota'),
    follow: ls.get('follow', true),
    lastRank: 0
  };

  function zoneTimeState(z, now) {
    if (!z.times.length) return 'permanent';
    now = now || Date.now();
    let future = false;
    for (const t of z.times) {
      const s = t.start ? Date.parse(t.start) : -Infinity;
      const e = t.end ? Date.parse(t.end) : Infinity;
      if (now >= s && now <= e) return 'active';
      if (now < s) future = true;
    }
    return future ? 'future' : 'expired';
  }
  const isActive = z => { const s = zoneTimeState(z); return s === 'permanent' || s === 'active'; };

  function toMeters(v, uom) { return v == null ? null : uom === 'ft' ? v * 0.3048 : v; }
  function fmtLayer(l) {
    if (!l || (l.lower == null && l.upper == null)) return '';
    const u = l.uom; const ref = r => r ? ' ' + r : '';
    const lo = l.lower == null ? '?' : l.lower; const hi = l.upper == null ? '?' : l.upper;
    if (l.lower === l.upper) return hi + ' ' + u + ref(l.upperRef);
    if (l.lowerRef === l.upperRef) return lo + '–' + hi + ' ' + u + ref(l.upperRef);
    return lo + ' ' + u + ref(l.lowerRef) + ' – ' + hi + ' ' + u + ref(l.upperRef);
  }
  // quota massima di volo libero indicata dalla zona (sintesi per l'annunciatore)
  function limitLabel(z) {
    const l = z.layer;
    if ((z.restriction === 'PROHIBITED' || z.restriction === 'REQ_AUTHORISATION') && (!l || !l.lower)) return '0 m';
    if (!l) return '—';
    // zona che inizia da una quota: sotto quella quota non si applica
    if (l.lower && l.lower > 0 && z.restriction !== 'NO_RESTRICTION') return l.lower + ' ' + l.uom + (l.lowerRef ? ' ' + l.lowerRef : '');
    if (l.upper != null) return l.upper + ' ' + l.uom + (l.upperRef ? ' ' + l.upperRef : '');
    return '—';
  }
  function limitMeters(z) {
    const l = z.layer;
    if ((z.restriction === 'PROHIBITED' || z.restriction === 'REQ_AUTHORISATION') && (!l || !l.lower)) return 0;
    if (!l) return Infinity;
    if (l.lower && l.lower > 0 && z.restriction !== 'NO_RESTRICTION') return toMeters(l.lower, l.uom);
    return l.upper == null ? Infinity : toMeters(l.upper, l.uom);
  }

  // ---------------------------------------------------------------- geometria
  function inBbox(b, lng, lat, padDeg) {
    padDeg = padDeg || 0;
    return lng >= b[0] - padDeg && lng <= b[2] + padDeg && lat >= b[1] - padDeg && lat <= b[3] + padDeg;
  }
  function zonesAt(lat, lng, includeInactive) {
    const pt = [lng, lat];
    return state.zones.filter(z => inBbox(z.bbox, lng, lat) && (includeInactive || isActive(z)) &&
      turf.booleanPointInPolygon(pt, { type: 'Feature', geometry: z.geometry, properties: {} }))
      .sort((a, b) => limitMeters(a) - limitMeters(b) || RESTR[b.restriction].rank - RESTR[a.restriction].rank)
      .filter((z, i, arr) => arr.findIndex(o => o.fid === z.fid) === i);
  }
  // fasce di quota come nella legenda D-Flight
  const BANDS = [
    { k: 'q0', max: 0, label: 'Max 0 m', css: '--q0' },
    { k: 'q25', max: 25, label: 'Max 25 m', css: '--q25' },
    { k: 'q45', max: 45, label: 'Max 45 m', css: '--q45' },
    { k: 'q60', max: 60, label: 'Max 60 m', css: '--q60' },
    { k: 'q120', max: Infinity, label: 'Max 120 m o più', css: '--q120' }
  ];
  const bandOf = z => { const m = limitMeters(z); return BANDS.find(b => m <= b.max) || BANDS[BANDS.length - 1]; };
  const CATS = {
    NFZ: 'No-fly zone (NFZ)', ATM09: 'Aerodromi e avio (ATM-09)', NOTAM: 'NOTAM temporanei', ALTRO: 'Altre zone'
  };
  // stato sintetico per l'annunciatore e i badge
  function statusOf(z) {
    const m = limitMeters(z);
    if (m === 0) return z.restriction === 'PROHIBITED' ? { cls: 'prohib', label: 'Vietato' } : z.restriction === 'REQ_AUTHORISATION' ? { cls: 'auth', label: 'Serve autorizzazione' } : { cls: RESTR[z.restriction].cls, label: RESTR[z.restriction].label };
    if (z.restriction === 'NO_RESTRICTION') return { cls: 'free', label: 'Nessuna restrizione' };
    if (isFinite(m)) return { cls: 'cond', label: 'Max ' + limitLabel(z).replace(/ AGL$/, '') };
    return { cls: RESTR[z.restriction].cls, label: RESTR[z.restriction].label };
  }
  function distToZone(z, lat, lng) {
    const pt = turf.point([lng, lat]);
    const polys = z.geometry.type === 'Polygon' ? [z.geometry.coordinates] : z.geometry.coordinates;
    let best = Infinity;
    polys.forEach(poly => poly.forEach(ring => {
      const d = turf.pointToLineDistance(pt, turf.lineString(ring), { units: 'meters' });
      if (d < best) best = d;
    }));
    return best;
  }
  function nearZones(lat, lng, exclude) {
    const pad = NEAR_RADIUS_M / 111000 * 1.6;
    const ex = new Set(exclude.map(z => z.fid));
    return state.zones.filter(z => !ex.has(z.fid) && isActive(z) && inBbox(z.bbox, lng, lat, pad))
      .map(z => ({ z, d: distToZone(z, lat, lng) }))
      .filter(o => o.d <= NEAR_RADIUS_M)
      .sort((a, b) => a.d - b.d)
      .filter((o, i, arr) => arr.findIndex(x => x.z.fid === o.z.fid) === i)
      .slice(0, 6);
  }

  // ---------------------------------------------------------------- mappa
  const map = L.map('map', { zoomControl: false, preferCanvas: true, worldCopyJump: true })
    .setView(ls.get('view', [43.7696, 11.2558]), ls.get('zoom', 12));
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
  }).addTo(map);
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, attribution: '© OpenStreetMap, SRTM · © OpenTopoMap (CC-BY-SA)'
  });
  L.control.layers({ 'Stradale': osm, 'Topografica': topo }, null, { position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  const renderer = L.canvas({ padding: 0.3 });
  const zoneLayer = L.layerGroup().addTo(map);
  const pointLayer = L.layerGroup().addTo(map);
  let meMarker = null, meCircle = null, inspectMarker = null;

  map.on('moveend', () => { ls.set('view', [map.getCenter().lat, map.getCenter().lng]); ls.set('zoom', map.getZoom()); });
  map.on('dragstart', () => { if (state.follow) setFollow(false); });

  function zoneVisible(z) {
    const f = state.filters;
    if (f.cat[z.category] === false) return false;
    if (f.band[bandOf(z).k] === false) return false;
    if (z.reasons.length && z.reasons.every(r => f.reason[r] === false)) return false;
    if (!f.expired && !isActive(z)) return false;
    return true;
  }
  // disegna solo le zone nell'area visibile; i poligoni Leaflet vengono creati una volta e riusati
  const polyCache = new Map();
  let drawQueued = false;
  function zoneColor(z) {
    return cssVar(state.colorMode === 'quota' ? bandOf(z).css : RESTR[z.restriction].css);
  }
  function polyFor(z) {
    let pl = polyCache.get(z.id);
    if (!pl) {
      const levels = z.geometry.type === 'Polygon' ? 1 : 2;
      pl = L.polygon(L.GeoJSON.coordsToLatLngs(z.geometry.coordinates, levels), { renderer, interactive: false });
      polyCache.set(z.id, pl);
    }
    const c = zoneColor(z), act = isActive(z);
    pl.setStyle({ color: c, weight: z.restriction === 'PROHIBITED' ? 2 : 1.2, fillColor: c,
      fillOpacity: act ? (z.restriction === 'NO_RESTRICTION' ? 0.08 : limitMeters(z) === 0 ? 0.24 : 0.14) : 0.05,
      dashArray: !act || z.category === 'NOTAM' ? '5 4' : null });
    return pl;
  }
  function drawZones() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      const b = map.getBounds().pad(0.25);
      const vb = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      const list = state.zones.filter(z => z.bbox[0] <= vb[2] && z.bbox[2] >= vb[0] && z.bbox[1] <= vb[3] && z.bbox[3] >= vb[1] && zoneVisible(z))
        // in basso le più permissive, in alto le più restrittive
        .sort((a, b2) => limitMeters(b2) - limitMeters(a) || RESTR[a.restriction].rank - RESTR[b2.restriction].rank);
      zoneLayer.clearLayers();
      list.forEach(z => zoneLayer.addLayer(polyFor(z)));
    });
  }
  map.on('moveend', drawZones);

  // tiene il punto fuori dalla zona coperta dal pannello (telefono)
  function sheetCover() { const sheet = document.getElementById('sheet'); return window.innerWidth >= 900 ? 0 : (sheet.classList.contains('collapsed') ? 0 : sheet.getBoundingClientRect().height - 56); }
  function panVisible(ll, force) {
    const cover = sheetCover();
    const p = map.latLngToContainerPoint(ll), h = map.getSize().y;
    if (!force && p.y > 40 && p.y < h - cover - 40) return;
    const c = map.project(ll).add([0, cover / 2]);
    map.panTo(map.unproject(c), { animate: true });
  }

  function drawPoints() {
    pointLayer.clearLayers();
    state.points.forEach(p => {
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: '<div class="pt-pin"></div>', iconSize: [22, 22], iconAnchor: [11, 22] }), title: p.name })
        .on('click', () => { inspectAt(p.lat, p.lng, p.name); })
        .addTo(pointLayer);
    });
  }

  // ---------------------------------------------------------------- render zone
  function zoneCard(z, extra) {
    const r = statusOf(z);
    const ts = zoneTimeState(z);
    const timeBadge = ts === 'permanent' ? '' : ts === 'active' ? '<span class="badge ghost">temporanea · attiva</span>'
      : ts === 'future' ? '<span class="badge ghost">non ancora attiva</span>' : '<span class="badge ghost">scaduta</span>';
    const reasons = z.reasons.map(x => REASONS[x] || x).join(', ');
    const dt = v => v ? new Date(v).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '…';
    const times = z.times.map(t => dt(t.start) + ' → ' + dt(t.end)).join('; ');
    const a = z.authority;
    const auth = a ? [a.name, a.service, a.phone, a.email].filter(Boolean).join(' · ') : '';
    return '<div class="zone">' +
      '<div class="zone-head"><span class="zone-name">' + esc(z.name) + '</span><span class="zone-alt">' + esc(fmtLayer(z.layer)) + '</span></div>' +
      '<div class="zone-badges"><span class="badge ' + r.cls + '">' + esc(r.label) + '</span><span class="badge ghost">' + esc(CATS[z.category] || z.category) + '</span>' + timeBadge + (extra || '') + '</div>' +
      (z.layer && z.layer.lower > 0 && z.restriction !== 'NO_RESTRICTION' ? '<div class="zone-meta">Fino a ' + esc(limitLabel(z)) + ' volo libero; sopra ' + (z.restriction === 'PROHIBITED' ? 'vietato' : 'serve autorizzazione') + '.</div>' : '') +
      (reasons ? '<div class="zone-meta">Motivo: ' + esc(reasons) + (z.reasonInfo ? ' — ' + esc(z.reasonInfo) : '') + '</div>' : '') +
      (z.message ? (z.message.length > 180
        ? '<details class="msg"><summary>' + esc(z.message.slice(0, 140).replace(/\n/g, ' ')) + '…</summary><div class="zone-meta msg-full">' + esc(z.message) + '</div></details>'
        : '<div class="zone-meta msg-full">' + esc(z.message) + '</div>') : '') +
      (z.conditions.length ? '<div class="zone-meta">Condizioni: ' + esc(z.conditions.join('; ')) + '</div>' : '') +
      (times ? '<div class="zone-meta">Periodo: ' + esc(times) + '</div>' : '') +
      (auth ? '<div class="zone-meta">Autorità: ' + esc(auth) + (a.site ? ' · <a href="' + esc(a.site) + '" target="_blank" rel="noopener">sito</a>' : '') + '</div>' : '') +
      '<details><summary>Dati originali · ' + esc(z.id) + '</summary><pre>' + esc(JSON.stringify(z.raw && z.raw.properties ? z.raw.properties : stripGeom(z.raw), null, 1)) + '</pre></details>' +
      '</div>';
  }
  function stripGeom(o) {
    if (!o || typeof o !== 'object') return o;
    const c = Object.assign({}, o);
    if (Array.isArray(c.geometry)) c.geometry = c.geometry.map(g => Object.assign({}, g, { horizontalProjection: g.horizontalProjection ? { type: g.horizontalProjection.type, '…': 'coordinate omesse' } : undefined }));
    return c;
  }

  function renderHere() {
    const t = state.inspect || state.me;
    const target = $('#hereTarget'), list = $('#hereList'), near = $('#nearList');
    if (!t) {
      updateWx(null);
      target.textContent = '';
      list.innerHTML = '<div class="empty">Attiva la posizione o tocca un punto della mappa.</div>';
      near.innerHTML = '';
      return;
    }
    const isMe = !state.inspect;
    updateWx(t, isMe);
    target.innerHTML = (isMe ? 'La tua posizione' : esc(state.inspect.label || 'Punto selezionato')) + ' · ' + fmtCoord(t.lat, t.lng) +
      (isMe && t.acc ? ' · ±' + Math.round(t.acc) + ' m' : '') +
      (!isMe ? ' · <button class="link-btn" id="backToMe">torna alla mia posizione</button>' : '');
    const bm = $('#backToMe'); if (bm) bm.onclick = () => { clearInspect(); };
    const inside = zonesAt(t.lat, t.lng, false);
    const insideInactive = zonesAt(t.lat, t.lng, true).filter(z => !isActive(z));
    if (!state.zones.length) list.innerHTML = '<div class="empty">Nessuna zona caricata. Importa un file nella scheda Dati.</div>';
    else if (!inside.length) list.innerHTML = '<div class="empty">Nessuna zona nota in questo punto.</div>';
    else list.innerHTML = inside.map(z => zoneCard(z)).join('');
    if (insideInactive.length) list.innerHTML += insideInactive.map(z => zoneCard(z)).join('');
    const nz = nearZones(t.lat, t.lng, inside);
    near.innerHTML = nz.length ? nz.map(o => '<div class="near"><span class="badge ' + statusOf(o.z).cls + '">' + esc(statusOf(o.z).label) + '</span><span class="near-name">' + esc(o.z.name) + '</span><span class="near-d">' + fmtDist(o.d) + '</span></div>').join('')
      : '<div class="empty">Nessuna zona entro ' + fmtDist(NEAR_RADIUS_M) + '.</div>';
  }

  function renderAnnunciator() {
    const ann = $('#annunciator'), lab = $('#annLabel'), sub = $('#annSub'), meta = $('#annMeta'), lb = $('#annLimitBox'), lv = $('#annLimit');
    // la banda segue il punto selezionato sulla mappa; senza selezione segue il GPS
    const pick = state.inspect;
    const me = pick ? { lat: pick.lat, lng: pick.lng, acc: null, alt: null } : state.me;
    ann.className = '';
    ann.classList.toggle('picked', !!pick);
    if (!me) {
      ann.classList.add('st-none');
      lab.textContent = gpsState === 'denied' ? 'Posizione negata' : gpsState === 'waiting' ? 'Cerco il GPS…' : 'Posizione non attiva';
      sub.textContent = gpsState === 'denied' ? 'Consenti la posizione nelle impostazioni del browser' : 'Tocca il pulsante mirino per attivarla';
      lb.hidden = true; meta.textContent = '';
      $('#annWxBox').hidden = true; $('#annWx').hidden = true;
      return;
    }
    const inside = zonesAt(me.lat, me.lng, false);
    meta.textContent = pick
      ? (pick.label ? pick.label + ' · ' : 'Punto selezionato · ') + fmtCoord(me.lat, me.lng) + '  ·  mirino = torna al GPS'
      : fmtCoord(me.lat, me.lng) + '  ±' + Math.round(me.acc) + ' m' + (me.alt != null ? '  alt ' + Math.round(me.alt) + ' m s.l.m.' : '');
    if (!navigator.onLine) meta.textContent += '  ·  senza rete';
    renderAnnWx();
    if (!state.zones.length) {
      ann.classList.add('st-none'); lab.textContent = 'Nessuna zona caricata'; sub.textContent = 'Importa i dati nella scheda Dati'; lb.hidden = true;
      return;
    }
    if (!inside.length) {
      const nz = nearZones(me.lat, me.lng, []);
      const close = nz.find(o => o.d <= Math.max(me.acc, 30));
      ann.classList.add('st-free');
      lab.textContent = 'Volo libero fino a 120 m';
      sub.textContent = close ? 'Attenzione: al confine di ' + nz[0].z.name + ' (' + fmtDist(nz[0].d) + ')'
        : nz.length ? 'Più vicina: ' + nz[0].z.name + ' a ' + fmtDist(nz[0].d) : 'Nessuna zona entro ' + fmtDist(NEAR_RADIUS_M);
      lb.hidden = false; lv.textContent = '120 m';
      if (!pick) vibrateOnChange(close ? 1.5 : 0);
      return;
    }
    // inside è già ordinato: prima la zona con la quota massima più bassa
    const top = inside[0], st = statusOf(top), lm = limitMeters(top);
    if (isFinite(lm) && lm >= 120 && top.restriction !== 'PROHIBITED') {
      // la zona inizia sopra i 120 m del limite di categoria Open: per un C0 è volo libero
      ann.classList.add('st-free'); lab.textContent = 'Volo libero fino a 120 m';
      sub.textContent = top.name + ' inizia a ' + limitLabel(top);
      lb.hidden = false; lv.textContent = '120 m';
      renderAnnWx(); return;
    }
    ann.classList.add('st-' + st.cls);
    lab.textContent = st.cls === 'cond' && top.restriction !== 'CONDITIONAL' ? 'Volo libero fino a ' + limitLabel(top).replace(/ AGL$/, '') : st.label;
    sub.textContent = top.name + (inside.length > 1 ? '  (+' + (inside.length - 1) + ' zone)' : '');
    const lbl = limitLabel(top);
    lb.hidden = lbl === '—'; lv.textContent = lbl;
    if (!pick) vibrateOnChange(SEVERITY[st.cls] || 2);
  }
  const SEVERITY = { prohib: 4, auth: 3, unknown: 2.5, cond: 2, free: 1 };
  function vibrateOnChange(rank) {
    if (rank > state.lastRank && state.lastRank !== 0 && navigator.vibrate) { try { navigator.vibrate([120, 60, 120]); } catch (e) {} }
    state.lastRank = rank || 0.1;
  }

  function renderAll() { renderAnnunciator(); renderHere(); }

  // ---------------------------------------------------------------- ispezione punto
  function inspectAt(lat, lng, label) {
    state.inspect = { lat, lng, label };
    if (inspectMarker) inspectMarker.remove();
    inspectMarker = L.marker([lat, lng], { interactive: false, icon: L.divIcon({ className: '', html: '<div class="inspect-pin"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(map);
    selectTab('here'); openSheet(true);
    renderHere(); renderAnnunciator();
    requestAnimationFrame(() => panVisible(L.latLng(lat, lng)));
  }
  function clearInspect() {
    state.inspect = null;
    if (inspectMarker) { inspectMarker.remove(); inspectMarker = null; }
    renderHere(); renderAnnunciator();
    if (state.me) panVisible(L.latLng(state.me.lat, state.me.lng), true);
  }
  map.on('click', e => inspectAt(e.latlng.lat, e.latlng.lng));
  map.on('contextmenu', e => openPointForm(e.latlng.lat, e.latlng.lng));

  // ---------------------------------------------------------------- GPS
  let gpsState = 'off', watchId = null, wakeLock = null;
  function startGps() {
    if (!('geolocation' in navigator)) { gpsState = 'denied'; renderAnnunciator(); return; }
    if (watchId != null) return;
    gpsState = 'waiting'; renderAnnunciator();
    watchId = navigator.geolocation.watchPosition(onPos, err => {
      if (err.code === 1) { gpsState = 'denied'; navigator.geolocation.clearWatch(watchId); watchId = null; }
      renderAnnunciator();
    }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
  }
  function onPos(p) {
    const first = !state.me;
    gpsState = 'on';
    state.me = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy || 0, alt: p.coords.altitude, t: p.timestamp };
    const ll = [state.me.lat, state.me.lng];
    if (!meMarker) {
      meCircle = L.circle(ll, { radius: state.me.acc, color: '#1a73e8', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(map);
      meMarker = L.marker(ll, { interactive: false, icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map);
    } else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(state.me.acc); }
    if (first) { map.setView(ll, Math.max(map.getZoom(), 14), { animate: false }); panVisible(L.latLng(ll), true); }
    else if (state.follow && !state.inspect) panVisible(L.latLng(ll), true);
    $('#btnGps').classList.add('active');
    renderAnnunciator();
    if (!state.inspect) renderHere();
  }
  function setFollow(v) { state.follow = v; ls.set('follow', v); $('#optFollow').checked = v; }
  $('#btnGps').addEventListener('click', () => {
    if (watchId == null) { startGps(); return; }
    setFollow(true);
    if (state.inspect) clearInspect();
    else if (state.me) { map.setView([state.me.lat, state.me.lng], Math.max(map.getZoom(), 15), { animate: false }); panVisible(L.latLng(state.me.lat, state.me.lng), true); }
  });
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(s => { if (s.state === 'granted') startGps(); }).catch(() => {});
  }

  async function setWake(on) {
    try {
      if (on && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); }
      else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { $('#optWake').checked = false; }
    ls.set('wake', !!on && !!wakeLock);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && $('#optWake').checked) setWake(true); });

  // ---------------------------------------------------------------- pannello
  const sheet = $('#sheet');
  function syncSheetH() { document.documentElement.style.setProperty('--sheet-h', (window.innerWidth >= 900 ? 0 : sheet.getBoundingClientRect().height - (parseFloat(getComputedStyle(sheet).paddingBottom) || 0)) + 'px'); }
  function openSheet(open) {
    sheet.classList.toggle('collapsed', !open);
    requestAnimationFrame(() => {
      syncSheetH();
      const t = state.inspect || (state.follow ? state.me : null);
      if (t) panVisible(L.latLng(t.lat, t.lng), !state.inspect);
    });
  }
  function selectTab(name) {
    $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    $$('.panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
    ls.set('tab', name);
  }
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    const already = t.getAttribute('aria-selected') === 'true';
    selectTab(t.dataset.tab);
    openSheet(already ? sheet.classList.contains('collapsed') : true);
  }));
  $('#sheetToggle').addEventListener('click', () => openSheet(sheet.classList.contains('collapsed')));
  window.addEventListener('resize', syncSheetH);
  if ('ResizeObserver' in window) new ResizeObserver(syncSheetH).observe(sheet);

  // ---------------------------------------------------------------- filtri
  function renderFilters() {
    const cc = {}, bc = {}, rcounts = {}, seen = new Set();
    state.zones.forEach(z => {
      if (seen.has(z.fid)) return; seen.add(z.fid);
      cc[z.category] = (cc[z.category] || 0) + 1;
      const bk = bandOf(z).k; bc[bk] = (bc[bk] || 0) + 1;
      z.reasons.forEach(r => rcounts[r] = (rcounts[r] || 0) + 1);
    });
    const chk = (attr, key, on, swatch, label, n) => '<label class="row-chk"><input type="checkbox" ' + attr + '="' + key + '"' + (on ? ' checked' : '') + '>' +
      (swatch ? '<span class="swatch" style="--b:var(' + swatch + ')"></span>' : '') + esc(label) + '<span class="cnt">' + (n || 0) + '</span></label>';
    $('#fltCat').innerHTML = Object.keys(CATS).filter(k => cc[k]).map(k => chk('data-cat', k, state.filters.cat[k] !== false, null, CATS[k], cc[k])).join('');
    $('#fltBand').innerHTML = BANDS.filter(b => bc[b.k]).map(b => chk('data-band', b.k, state.filters.band[b.k] !== false, b.css, b.label, bc[b.k])).join('');
    const rk = Object.keys(rcounts).sort((x, y) => rcounts[y] - rcounts[x]);
    $('#fltReason').innerHTML = rk.length ? rk.map(r => '<button class="chip" data-reason="' + esc(r) + '" aria-pressed="' + (state.filters.reason[r] === false ? 'false' : 'true') + '">' + esc(REASONS[r] || r) + ' · ' + rcounts[r] + '</button>').join('')
      : '<span class="empty">Nessun motivo indicato nei dati.</span>';
    $$('#fltCat input').forEach(i => i.addEventListener('change', () => { state.filters.cat[i.dataset.cat] = i.checked; saveFilters(); }));
    $$('#fltBand input').forEach(i => i.addEventListener('change', () => { state.filters.band[i.dataset.band] = i.checked; saveFilters(); }));
    $$('#fltReason .chip').forEach(btn => btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') !== 'true'; btn.setAttribute('aria-pressed', String(on));
      state.filters.reason[btn.dataset.reason] = on; saveFilters();
    }));
    $('#fltExpired').checked = !!state.filters.expired;
    $$('.seg button').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.colorMode)));
    renderLegend();
  }
  function renderLegend() {
    const items = state.colorMode === 'quota'
      ? BANDS.map(b => [b.css, b.label])
      : RESTR_ORDER.filter(k => state.zones.some(z => z.restriction === k)).map(k => [RESTR[k].css, RESTR[k].label]);
    $('#legend').innerHTML = items.map(i => '<span class="lg"><span class="swatch" style="--b:var(' + i[0] + ')"></span>' + esc(i[1]) + '</span>').join('');
  }
  $$('.seg button').forEach(btn => btn.addEventListener('click', () => {
    state.colorMode = btn.dataset.mode; ls.set('colorMode', state.colorMode);
    $$('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === btn)));
    renderLegend(); drawZones();
  }));
  function saveFilters() { ls.set('filters', state.filters); drawZones(); }
  $('#fltExpired').addEventListener('change', e => { state.filters.expired = e.target.checked; saveFilters(); });
  $('#optFollow').addEventListener('change', e => setFollow(e.target.checked));
  $('#optWake').addEventListener('change', e => setWake(e.target.checked));

  // ---------------------------------------------------------------- punti personali
  let pendingPt = null;
  function openPointForm(lat, lng) {
    pendingPt = { lat, lng };
    selectTab('points'); openSheet(true);
    $('#ptForm').hidden = false;
    $('#ptFormCoords').textContent = fmtCoord(lat, lng);
    $('#ptName').value = 'Punto ' + (state.points.length + 1);
    $('#ptNote').value = '';
    $('#ptName').focus(); $('#ptName').select();
  }
  $('#btnAddHere').addEventListener('click', () => {
    const t = state.inspect || state.me || { lat: map.getCenter().lat, lng: map.getCenter().lng };
    openPointForm(t.lat, t.lng);
  });
  $('#ptCancel').addEventListener('click', () => { $('#ptForm').hidden = true; pendingPt = null; });
  $('#ptForm').addEventListener('submit', e => {
    e.preventDefault();
    if (!pendingPt) return;
    state.points.unshift({ id: uid(), name: $('#ptName').value.trim() || 'Punto', note: $('#ptNote').value.trim(), lat: pendingPt.lat, lng: pendingPt.lng, created: new Date().toISOString() });
    savePoints(); $('#ptForm').hidden = true; pendingPt = null;
  });
  function savePoints() { ls.set('points', state.points); idb.set('points', state.points).catch(() => {}); drawPoints(); renderPoints(); }
  function renderPoints() {
    const el = $('#ptList');
    if (!state.points.length) { el.innerHTML = '<div class="empty">Nessun punto salvato. Tieni premuto sulla mappa o usa il pulsante segnaposto per salvare un punto di decollo.</div>'; return; }
    el.innerHTML = state.points.map(p => {
      const z = zonesAt(p.lat, p.lng, false)[0];
      const badge = z ? '<span class="badge ' + statusOf(z).cls + '">' + esc(statusOf(z).label) + '</span>' : '<span class="badge ghost">fuori zone</span>';
      return '<div class="pt" data-id="' + p.id + '"><span class="pt-name">' + esc(p.name) + '</span>' + badge +
        '<span class="pt-sub">' + (p.note ? esc(p.note) + ' · ' : '') + fmtCoord(p.lat, p.lng) + (z ? ' · ' + esc(z.name) : '') + '</span>' +
        '<span class="pt-actions"><button class="link-btn" data-act="go">Mostra</button><button class="link-btn danger" data-act="del">Elimina</button></span></div>';
    }).join('');
    $$('#ptList .pt').forEach(row => {
      const p = state.points.find(x => x.id === row.dataset.id);
      row.querySelector('[data-act="go"]').onclick = () => { setFollow(false); map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15)); inspectAt(p.lat, p.lng, p.name); };
      const del = row.querySelector('[data-act="del"]');
      del.onclick = () => {
        if (del.dataset.confirm) { state.points = state.points.filter(x => x.id !== p.id); savePoints(); }
        else { del.dataset.confirm = '1'; del.textContent = 'Conferma'; setTimeout(() => { if (del.isConnected) { del.textContent = 'Elimina'; delete del.dataset.confirm; } }, 3000); }
      };
    });
  }
  $('#ptExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'QuotaZone', exported: new Date().toISOString(), points: state.points }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'quotazone-punti.json';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  $('#ptImportFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      const pts = (d.points || d).filter(p => p && isFinite(p.lat) && isFinite(p.lng));
      const ids = new Set(state.points.map(p => p.id));
      pts.forEach(p => { if (!ids.has(p.id)) state.points.push({ id: p.id || uid(), name: p.name || 'Punto', note: p.note || '', lat: +p.lat, lng: +p.lng, created: p.created || new Date().toISOString() }); });
      savePoints();
    } catch (err) { alertMsg('File punti non valido.', true); }
    e.target.value = '';
  });

  // ---------------------------------------------------------------- dati zone
  function alertMsg(t, err) { const m = $('#dataMsg'); m.textContent = t; m.classList.toggle('err', !!err); }
  const STALE_DAYS = 3;
  function dataAgeDays() {
    const m = state.meta; if (!m || m.demo) return 0;
    const t = Date.parse(m.dataDate || m.imported);
    return isNaN(t) ? 0 : (Date.now() - t) / 86400000;
  }
  // "ITA ZoneVersion 10/10/2026 06:19:43" -> ISO
  function dateFromTitle(t) {
    const m = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/.exec(t || '');
    return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).toISOString() : null;
  }
  function renderDataInfo() {
    const el = $('#dataInfo'); const m = state.meta;
    const flag = $('#demoFlag'), age = dataAgeDays();
    if (m && m.demo) { flag.hidden = false; flag.textContent = 'Zone di esempio inventate · importa i dati reali in “Dati”'; }
    else if (age > STALE_DAYS) { flag.hidden = false; flag.textContent = 'Dati di ' + Math.floor(age) + ' giorni fa · riscarica il file da D-Flight'; }
    else flag.hidden = true;
    if (!m) { el.innerHTML = '<div class="empty">Nessun file zone caricato.</div>'; return; }
    const cc = {}, seen = new Set(); let nf = 0;
    state.zones.forEach(z => { if (seen.has(z.fid)) return; seen.add(z.fid); nf++; cc[z.category] = (cc[z.category] || 0) + 1; });
    const when = m.dataDate ? 'dati del ' + new Date(m.dataDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : 'importato il ' + new Date(m.imported).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    el.innerHTML = '<div class="data-title">' + esc(m.title) + '</div>' +
      '<div class="fine">' + esc(m.format) + ' · ' + nf + ' zone (' + state.zones.length + ' poligoni) · ' + when + (m.file ? ' · ' + esc(m.file) : '') + '</div>' +
      (age > STALE_DAYS ? '<div class="fine" style="color:var(--st-auth)">I dati hanno ' + Math.floor(age) + ' giorni: NOTAM e zone temporanee potrebbero essere cambiati.</div>' : '') +
      '<div class="data-stats">' + Object.keys(CATS).filter(k => cc[k]).map(k => '<span class="badge ghost">' + esc(CATS[k]) + ' ' + cc[k] + '</span>').join('') + '</div>' +
      (m.skipped ? '<div class="fine">' + m.skipped + ' geometrie ignorate perché vuote o non supportate.</div>' : '');
  }
  // legge .json o .json.gz (il file D-Flight è compresso)
  async function readZoneBlob(blob) {
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    let text;
    if (head[0] === 0x1f && head[1] === 0x8b) {
      if (!('DecompressionStream' in window)) throw new Error('Questo browser non sa aprire i file .gz. Aggiorna il sistema o decomprimi il file prima di importarlo.');
      text = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } else text = await blob.text();
    try { return JSON.parse(text); } catch (e) { throw new Error('Il file non è un JSON valido.'); }
  }
  async function loadDataset(data, fileName, blob, savedMeta, extra) {
    const res = parseAny(data);
    if (!res.zones.length) throw new Error('Il file non contiene zone leggibili.');
    const title = textOf(data.title || data.name) || fileName || 'Zone importate';
    state.zones = res.zones;
    polyCache.clear();
    state.meta = { title, format: res.format, skipped: res.skipped, imported: savedMeta ? savedMeta.imported : new Date().toISOString(),
      dataDate: dateFromTitle(title), file: fileName || '', demo: !!data.demo,
      source: (savedMeta || extra || {}).source || 'file', remoteSha: (savedMeta || extra || {}).remoteSha || null };
    if (!savedMeta) {
      const toSave = blob || new Blob([JSON.stringify(data)], { type: 'application/json' });
      await idb.set('dataset', { blob: toSave, fileName, meta: state.meta }).catch(() => alertMsg('Zone caricate, ma il telefono non ha spazio per salvarle offline.', true));
    }
    afterDataChange();
    return res;
  }
  function afterDataChange() {
    state.lastRank = 0;
    drawZones(); renderFilters(); renderDataInfo(); renderPoints(); renderAll();
  }
  $('#zoneFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    alertMsg('Leggo ' + f.name + '…');
    try {
      const t0 = performance.now();
      const data = await readZoneBlob(f);
      const res = await loadDataset(data, f.name, f);
      alertMsg('Caricate ' + res.zones.length + ' geometrie (' + res.format + ') in ' + ((performance.now() - t0) / 1000).toFixed(1).replace('.', ',') + ' s.');
      fitToZones();
    } catch (err) { alertMsg(err.message || 'File non leggibile.', true); }
    e.target.value = '';
  });
  function fitToZones() {
    if (!state.zones.length) return;
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    state.zones.forEach(z => { b = [Math.min(b[0], z.bbox[0]), Math.min(b[1], z.bbox[1]), Math.max(b[2], z.bbox[2]), Math.max(b[3], z.bbox[3])]; });
    if (!state.me) map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [20, 20] });
  }
  $('#btnDemo').addEventListener('click', () => { loadDataset(demoDataset(43.7696, 11.2558, 'su Firenze'), '').then(() => { setFollow(false); map.setView([43.7696, 11.2558], 13); alertMsg('Caricate zone di esempio su Firenze.'); }); });
  $('#btnDemoHere').addEventListener('click', () => {
    const c = state.me || { lat: map.getCenter().lat, lng: map.getCenter().lng };
    loadDataset(demoDataset(c.lat, c.lng, state.me ? 'intorno alla tua posizione' : 'al centro della mappa'), '').then(() => { map.setView([c.lat, c.lng], 13); alertMsg('Caricate zone di esempio ' + (state.me ? 'intorno a te.' : 'al centro della mappa.')); });
  });
  const btnClear = $('#btnClear');
  btnClear.addEventListener('click', async () => {
    if (!btnClear.dataset.confirm) { btnClear.dataset.confirm = '1'; btnClear.textContent = 'Tocca di nuovo per cancellare'; setTimeout(() => { delete btnClear.dataset.confirm; btnClear.textContent = 'Cancella zone'; }, 3000); return; }
    delete btnClear.dataset.confirm; btnClear.textContent = 'Cancella zone';
    state.zones = []; state.meta = null; await idb.del('dataset').catch(() => {});
    afterDataChange(); alertMsg('Zone cancellate.');
  });

  // ---------------------------------------------------------------- meteo (Open-Meteo + indice Kp NOAA)
  const WX_TTL = 30 * 60 * 1000, WX_MAX_AGE = 18 * 3600 * 1000;
  const WMO = c => c === 0 ? 'Sereno' : c <= 1 ? 'Poco nuvoloso' : c === 2 ? 'Parz. nuvoloso' : c === 3 ? 'Coperto'
    : c <= 48 ? 'Nebbia' : c <= 55 ? 'Pioviggine' : c <= 57 ? 'Pioviggine gelata' : c <= 65 ? 'Pioggia' : c <= 67 ? 'Pioggia gelata'
    : c <= 77 ? 'Neve' : c <= 82 ? 'Rovesci' : c <= 86 ? 'Rovesci di neve' : c === 95 ? 'Temporale' : 'Temporale con grandine';
  const LIM_DEF = { wind: 10, gust: 12, tmin: 0, tmax: 40 };
  const lim = Object.assign({}, LIM_DEF, ls.get('limits', {}));
  const wx = { key: null, data: null, kp: ls.get('kp', null), busy: false, err: null, forMe: null };
  const kmh = v => Math.round(v * 3.6);
  const dirName = d => ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(((d % 360) / 45)) % 8];
  const arrow = d => '<svg class="wx-arrow" viewBox="0 0 16 16" style="transform:rotate(' + (d + 180) + 'deg)" aria-hidden="true"><path d="M8 1l4 9H9v5H7v-5H4z" fill="currentColor"/></svg>';
  function wxKey(lat, lng) { return lat.toFixed(2) + ',' + lng.toFixed(2); }
  function wxCacheGet(k) { const c = ls.get('wx', {}); return c[k] || null; }
  function wxCachePut(k, v) {
    const c = ls.get('wx', {}); c[k] = v;
    const keys = Object.keys(c).sort((a, b) => c[b].t - c[a].t); keys.slice(8).forEach(x => delete c[x]);
    ls.set('wx', c);
  }
  async function fetchKp() {
    if (wx.kp && Date.now() - wx.kp.t < 3 * 3600 * 1000) return;
    try {
      const r = await fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json', { cache: 'no-cache' });
      const rows = (await r.json()).filter(x => x && x.time_tag && x.kp != null).map(x => ({ t: Date.parse(x.time_tag + 'Z'), kp: +x.kp }));
      wx.kp = { t: Date.now(), rows }; ls.set('kp', wx.kp);
    } catch (e) { /* l'indice Kp è un extra: se manca non blocca nulla */ }
  }
  function kpAt(ts) {
    if (!wx.kp || !wx.kp.rows) return null;
    let best = null;
    wx.kp.rows.forEach(r => { if (r.t <= ts && (!best || r.t > best.t)) best = r; });
    return best ? best.kp : null;
  }
  async function fetchWx(lat, lng) {
    const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(4) + '&longitude=' + lng.toFixed(4) +
      '&current=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,visibility,is_day,pressure_msl' +
      '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_speed_80m,wind_speed_120m,wind_gusts_10m,wind_direction_10m,visibility,pressure_msl' +
      '&daily=sunrise,sunset&wind_speed_unit=ms&timezone=auto&past_days=1&forecast_days=2';
    const r = await fetch(u, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  // valuta un'ora: ritorna {level: 0 ok | 1 cautela | 2 sconsigliato, reasons[]}
  // livelli: 0 verde · 1 giallo (attenzione) · 2 arancio (cautela) · 3 rosso (sconsigliato)
  function judge(o) {
    const rs = []; let lv = 0;
    const add = (l, t) => { rs.push({ l, t }); lv = Math.max(lv, l); };
    if (o.wind != null) { if (o.wind > lim.wind) add(3, 'Vento ' + o.wind.toFixed(1) + ' m/s oltre il limite di ' + lim.wind); else if (o.wind > lim.wind * 0.75) add(2, 'Vento ' + o.wind.toFixed(1) + ' m/s vicino al limite'); }
    if (o.gust != null) { if (o.gust > lim.gust) add(3, 'Raffiche ' + o.gust.toFixed(1) + ' m/s oltre il limite di ' + lim.gust); else if (o.gust > lim.gust * 0.8) add(2, 'Raffiche ' + o.gust.toFixed(1) + ' m/s'); }
    if (o.w120 != null && o.w120 > lim.wind) add(1, 'A 120 m il vento arriva a ' + o.w120.toFixed(1) + ' m/s: resta più basso');
    if (o.code != null) { if (o.code >= 95) add(3, 'Temporale'); else if (o.code >= 61 && o.code !== 80) add(3, WMO(o.code)); else if (o.code === 45 || o.code === 48) add(3, 'Nebbia'); else if (o.code >= 51) add(1, WMO(o.code)); }
    if (o.precip != null && o.precip >= 0.3 && !(o.code >= 61)) add(3, 'Pioggia in corso (' + o.precip.toFixed(1) + ' mm)');
    if (o.pp != null && o.pp >= 50) add(1, 'Probabilità di pioggia ' + o.pp + '%');
    if (o.vis != null) { if (o.vis < 1000) add(3, 'Visibilità ' + Math.round(o.vis) + ' m: impossibile il contatto visivo'); else if (o.vis < 3000) add(1, 'Visibilità ridotta (' + (o.vis / 1000).toFixed(1) + ' km)'); }
    if (o.temp != null) { if (o.temp < lim.tmin) add(2, 'Temperatura ' + Math.round(o.temp) + ' °C: batteria meno efficiente'); if (o.temp > lim.tmax) add(3, 'Temperatura ' + Math.round(o.temp) + ' °C oltre il limite'); }
    if (o.kp != null) { if (o.kp >= 7) add(3, 'Tempesta geomagnetica (Kp ' + o.kp.toFixed(1) + '): GPS e bussola inaffidabili'); else if (o.kp >= 5) add(2, 'Attività geomagnetica alta (Kp ' + o.kp.toFixed(1) + '): GPS meno preciso'); }
    if (o.dp != null) { if (o.dp <= -6) add(3, 'Pressione in crollo (' + o.dp.toFixed(1) + ' hPa in 3 h): rischio temporali e raffiche'); else if (o.dp <= -4) add(2, 'Pressione in calo rapido (' + o.dp.toFixed(1) + ' hPa in 3 h): probabile peggioramento'); else if (o.dp <= -2) add(1, 'Pressione in calo (' + o.dp.toFixed(1) + ' hPa in 3 h)'); }
    if (o.night) add(1, 'È buio: in volo notturno controlla luci e regole');
    return { level: lv, reasons: rs.sort((a, b) => b.l - a.l) };
  }
  const LV = [{ cls: 'go', label: 'Meteo adatto al volo', short: 'Meteo OK', band: 'OK', col: 'var(--st-free)' },
              { cls: 'watch', label: 'Meteo da tenere d’occhio', short: 'Attenzione', band: 'Attenzione', col: 'var(--st-cond)' },
              { cls: 'caution', label: 'Volo con cautela', short: 'Cautela', band: 'Cautela', col: 'var(--st-auth)' },
              { cls: 'nogo', label: 'Volo sconsigliato', short: 'Sconsigliato', band: 'No volo', col: 'var(--st-prohib)' }];
  function hourIndex(d) {
    const now = d.current ? d.current.time.slice(0, 13) : null;
    const i = d.hourly.time.findIndex(t => t.slice(0, 13) === now);
    return i < 0 ? 0 : i;
  }
  function isNight(d, iso) {
    const day = iso.slice(0, 10), i = d.daily.time.indexOf(day);
    if (i < 0) return false;
    return iso < d.daily.sunrise[i] || iso > d.daily.sunset[i];
  }
  function localHourKey(ts) {
    const d = new Date(ts), z = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + 'T' + z(d.getHours());
  }
  // pressure_msl: valore e variazione nelle 3 ore precedenti (hPa)
  function pressureAt(d, i) {
    const p = d.hourly.pressure_msl;
    if (!p || p[i] == null) return { p: null, dp: null };
    const prev = i >= 3 ? p[i - 3] : null;
    return { p: p[i], dp: prev != null ? p[i] - prev : null };
  }
  function wxNow(d, fetchedAt) {
    // dati vecchi (senza rete): usa la previsione dell'ora attuale invece della misura di allora
    if (fetchedAt && Date.now() - fetchedAt > 60 * 60 * 1000) {
      const i = d.hourly.time.findIndex(t => t.slice(0, 13) === localHourKey(Date.now()));
      if (i >= 0) { const o = wxHour(d, i); o.forecast = true; return o; }
    }
    const c = d.current, h = d.hourly, i = hourIndex(d);
    return { wind: c.wind_speed_10m, gust: c.wind_gusts_10m, dir: c.wind_direction_10m, w80: h.wind_speed_80m[i], w120: h.wind_speed_120m[i],
      temp: c.temperature_2m, code: c.weather_code, precip: c.precipitation, pp: h.precipitation_probability[i], vis: c.visibility != null ? c.visibility : h.visibility[i],
      cloud: c.cloud_cover, night: c.is_day === 0, kp: kpAt(Date.now()),
      press: c.pressure_msl != null ? c.pressure_msl : pressureAt(d, i).p, dp: pressureAt(d, i).dp };
  }
  function wxHour(d, i) {
    const h = d.hourly, t = h.time[i];
    return { time: t, wind: h.wind_speed_10m[i], gust: h.wind_gusts_10m[i], dir: h.wind_direction_10m[i], w120: h.wind_speed_120m[i], temp: h.temperature_2m[i],
      code: h.weather_code[i], precip: h.precipitation[i], pp: h.precipitation_probability[i], vis: h.visibility[i], night: isNight(d, t),
      kp: kpAt(Date.parse(t) || Date.now()), press: pressureAt(d, i).p, dp: pressureAt(d, i).dp };
  }
  function trendTxt(dp) {
    if (dp == null) return '';
    const v = (dp > 0 ? '+' : dp < 0 ? '−' : '±') + Math.abs(dp).toFixed(1);
    return (dp >= 1 ? '↗ in rialzo ' : dp <= -1 ? '↘ in calo ' : '→ stabile ') + v + ' in 3 h';
  }
  function renderWx() {
    const el = $('#wxCard'); if (!el) return;
    const e = wx.entry;
    if (!e) {
      el.innerHTML = '<div class="wx-head"><span class="wx-title">Meteo</span></div><div class="empty">' +
        (wx.busy ? 'Scarico le previsioni…' : wx.err ? 'Meteo non disponibile: ' + esc(wx.err) : 'Attiva la posizione o tocca un punto della mappa.') + '</div>';
      return;
    }
    const d = e.d, now = wxNow(d, e.t), j = judge(now), L = LV[j.level];
    const age = Date.now() - e.t, stale = age > 90 * 60 * 1000;
    const ageTxt = 'aggiornato ' + new Date(e.t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) + (stale ? ' · ' + Math.max(1, Math.round(age / 3600000)) + ' h fa' + (now.forecast ? ', valori previsti per quest’ora' : '') : '');
    const cls = (v, w, b) => v == null ? '' : v > b ? 'bad' : v > w ? 'warn' : '';
    const di = d.daily.time.indexOf(localHourKey(Date.now()).slice(0, 10));
    const sunset = di >= 0 ? d.daily.sunset[di].slice(11, 16) : '—', sunrise = di >= 0 ? d.daily.sunrise[di].slice(11, 16) : '—';
    const cell = (k, v, c) => '<div><div class="wx-k">' + k + '</div><div class="wx-v ' + (c || '') + '">' + v + '</div></div>';
    let html = '<div class="wx-head"><span class="wx-title">Meteo · ' + esc(WMO(now.code)) + '</span><span class="wx-age">' + ageTxt + '</span></div>' +
      '<div class="wx-verdict ' + L.cls + '">' + L.label + '</div>' +
      (j.reasons.length ? '<ul class="wx-reasons">' + j.reasons.map(r => '<li>' + esc(r.t) + '</li>').join('') + '</ul>' : '') +
      '<div class="wx-grid">' +
      cell('Vento', arrow(now.dir) + ' ' + now.wind.toFixed(1) + ' <small>m/s · ' + kmh(now.wind) + ' km/h ' + dirName(now.dir) + '</small>', cls(now.wind, lim.wind * 0.75, lim.wind)) +
      cell('Raffiche', now.gust.toFixed(1) + ' <small>m/s · ' + kmh(now.gust) + ' km/h</small>', cls(now.gust, lim.gust * 0.8, lim.gust)) +
      cell('A 120 m', (now.w120 != null ? now.w120.toFixed(1) : '—') + ' <small>m/s</small>', cls(now.w120, lim.wind * 0.75, lim.wind)) +
      cell('Temperatura', Math.round(now.temp) + ' <small>°C</small>', now.temp < lim.tmin ? 'warn' : now.temp > lim.tmax ? 'bad' : '') +
      cell('Pioggia', (now.pp != null ? now.pp + '<small>%</small>' : '—') + ' <small>' + (now.precip || 0).toFixed(1) + ' mm</small>', now.pp >= 50 ? 'warn' : '') +
      cell('Visibilità', now.vis != null ? (now.vis >= 10000 ? '10+' : (now.vis / 1000).toFixed(1)) + ' <small>km</small>' : '—', now.vis < 1000 ? 'bad' : now.vis < 3000 ? 'warn' : '') +
      cell('Pressione', now.press != null ? Math.round(now.press) + ' <small>hPa ' + trendTxt(now.dp) + '</small>' : '—', now.dp != null && now.dp <= -4 ? 'warn' : '') +
      cell('Kp', now.kp != null ? now.kp.toFixed(1) : '—', now.kp >= 7 ? 'bad' : now.kp >= 5 ? 'warn' : '') +
      cell('Alba', sunrise) + cell('Tramonto', sunset) +
      '</div>';
    // prossime ore
    let i0 = d.hourly.time.findIndex(t => t.slice(0, 13) === localHourKey(Date.now())); if (i0 < 0) i0 = hourIndex(d);
    const hrs = [];
    for (let i = i0 + 1; i < Math.min(d.hourly.time.length, i0 + 13); i++) hrs.push(wxHour(d, i));
    if (hrs.length) {
      const td = (v, c) => '<td class="' + (c || '') + '">' + v + '</td>';
      html += '<div class="wx-hours"><table><thead><tr><th></th>' + hrs.map(h => '<th>' + h.time.slice(11, 13) + '</th>').join('') + '</tr></thead><tbody>' +
        '<tr><td class="lbl">Volo</td>' + hrs.map(h => { const l = judge(h).level; return td('●', ['', '', 'warn', 'bad'][l]).replace('<td class="', '<td style="color:' + LV[l].col + '" class="'); }).join('') + '</tr>' +
        '<tr><td class="lbl">Vento</td>' + hrs.map(h => td(h.wind.toFixed(0), cls(h.wind, lim.wind * 0.75, lim.wind))).join('') + '</tr>' +
        '<tr><td class="lbl">Raffiche</td>' + hrs.map(h => td(h.gust.toFixed(0), cls(h.gust, lim.gust * 0.8, lim.gust))).join('') + '</tr>' +
        '<tr><td class="lbl">Pioggia %</td>' + hrs.map(h => td(h.pp != null ? h.pp : '—', h.pp >= 50 ? 'warn' : '')).join('') + '</tr>' +
        '<tr><td class="lbl">hPa</td>' + hrs.map(h => td(h.press != null ? Math.round(h.press) : '—', h.dp != null && h.dp <= -4 ? 'warn' : '')).join('') + '</tr>' +
        '<tr><td class="lbl">°C</td>' + hrs.map(h => td(Math.round(h.temp))).join('') + '</tr>' +
        '</tbody></table></div><p class="fine">Vento e raffiche in m/s a 10 m dal suolo; pressione al livello del mare, tendenza sulle 3 ore precedenti. Previsioni Open-Meteo, indice Kp NOAA.</p>';
    }
    el.innerHTML = html;
    renderAnnWx();
  }
  function renderAnnWx() {
    const el = $('#annWx'), box = $('#annWxBox'), ann = $('#annunciator'), e = wx.entry, t = state.inspect || state.me;
    if (!e || !t || wxKey(t.lat, t.lng) !== e.k) { el.hidden = true; box.hidden = true; ann.classList.remove('split'); return; }
    const now = wxNow(e.d, e.t), j = judge(now), L = LV[j.level];
    const vals = 'vento ' + now.wind.toFixed(0) + ' · raff. ' + now.gust.toFixed(0) + ' m/s';
    // banda divisa: 2/3 volo, 1/3 meteo (verde, giallo, arancio, rosso)
    el.hidden = true; box.hidden = false; ann.classList.add('split');
    box.className = 'ann-wxbox ' + L.cls;
    $('#annWxLabel').textContent = L.band;
    $('#annWxWhy').textContent = j.reasons[0] ? j.reasons[0].t.replace(/ \(.*?\)/, '') : WMO(now.code) + ', condizioni buone';
    $('#annWxVal').textContent = vals;
    const pr = $('#annWxPress');
    if (now.press != null) {
      const dp = now.dp, pl = dp == null ? 0 : dp <= -6 ? 3 : dp <= -4 ? 2 : dp <= -2 ? 1 : 0;
      const arrowCh = dp == null ? '' : dp >= 1 ? '↗' : dp <= -1 ? '↘' : '→';
      const word = dp == null ? '' : dp >= 1 ? 'in rialzo' : dp <= -1 ? 'in calo' : 'stabile';
      pr.hidden = false;
      pr.className = 'ann-wxbox-press p' + pl;
      pr.title = 'Pressione ' + word + (dp != null ? ' nelle ultime 3 ore' : '');
      pr.innerHTML = Math.round(now.press) + '<span class="u"> hPa</span> ' + arrowCh + (dp != null ? ' ' + (dp > 0 ? '+' : dp < 0 ? '−' : '±') + Math.abs(dp).toFixed(1).replace('.', ',') : '');
    } else pr.hidden = true;
  }
  let wxTimer = null;
  function updateWx(target, isMe) {
    clearTimeout(wxTimer);
    wxTimer = setTimeout(() => loadWx(target, isMe), 400);
  }
  async function loadWx(t, isMe) {
    if (!t) { wx.entry = null; renderWx(); return; }
    const k = wxKey(t.lat, t.lng);
    let e = wxCacheGet(k); if (e) e.k = k;
    const fresh = e && Date.now() - e.t < WX_TTL;
    wx.entry = e && Date.now() - e.t < WX_MAX_AGE ? e : null;
    if (isMe) wx.meEntry = wx.entry;
    renderWx(); if (isMe) renderAnnWx();
    if (fresh || wx.busy) return;
    wx.busy = true; wx.err = null; if (!wx.entry) renderWx();
    try {
      const [d] = await Promise.all([fetchWx(t.lat, t.lng), fetchKp()]);
      e = { t: Date.now(), d, k }; wxCachePut(k, e);
      // il punto potrebbe essere cambiato nel frattempo
      const cur = state.inspect || state.me;
      if (cur && wxKey(cur.lat, cur.lng) === k) wx.entry = e;
      if (state.me && wxKey(state.me.lat, state.me.lng) === k) wx.meEntry = e;
    } catch (err) {
      wx.err = navigator.onLine ? 'il servizio non risponde' : 'nessuna connessione';
    } finally { wx.busy = false; renderWx(); renderAnnWx(); }
  }
  // limiti modificabili
  [['limWind', 'wind'], ['limGust', 'gust'], ['limTmin', 'tmin'], ['limTmax', 'tmax']].forEach(([id, k]) => {
    const inp = $('#' + id); inp.value = lim[k];
    inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (isFinite(v)) { lim[k] = v; ls.set('limits', lim); renderWx(); renderAnnWx(); } else inp.value = lim[k]; });
  });

  // ---------------------------------------------------------------- mappa senza rete
  let baseLayer = osm;
  map.on('baselayerchange', e => { baseLayer = e.layer; });
  const MAX_TILES = 250; // limite d'uso delle tessere OpenStreetMap per lo scaricamento anticipato
  function tilesFor(bounds, z) {
    const n = Math.pow(2, z), clampY = v => Math.max(0, Math.min(n - 1, v));
    const x = lng => Math.floor((lng + 180) / 360 * n);
    const y = lat => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
    const out = [];
    for (let i = x(bounds.getWest()); i <= x(bounds.getEast()); i++)
      for (let j = clampY(y(bounds.getNorth())); j <= clampY(y(bounds.getSouth())); j++) out.push({ x: ((i % n) + n) % n, y: j, z });
    return out;
  }
  $('#btnTiles').addEventListener('click', async () => {
    const msg = $('#tilesMsg'), btn = $('#btnTiles');
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) { msg.textContent = 'Il salvataggio offline sarà disponibile dalla prossima apertura dell’app.'; return; }
    const b = map.getBounds(), z0 = map.getZoom(), maxZ = baseLayer.options.maxZoom || 19;
    let list = [];
    for (let z = Math.max(z0 - 2, 6); z <= Math.min(z0 + 2, maxZ, 17); z++) {
      const more = tilesFor(b, z);
      if (list.length + more.length > MAX_TILES) break;
      list = list.concat(more);
    }
    if (!list.length || tilesFor(b, z0).length > MAX_TILES) { msg.textContent = 'Area troppo grande: avvicina la mappa e riprova.'; return; }
    btn.disabled = true; let done = 0, fail = 0;
    const url = t => baseLayer.getTileUrl ? L.Util.template(baseLayer._url, Object.assign({ s: 'a', r: '' }, t)) : '';
    for (let k = 0; k < list.length; k += 4) {
      await Promise.all(list.slice(k, k + 4).map(t => fetch(url(t), { mode: 'no-cors' }).then(r => (r.ok || r.type === 'opaque') ? done++ : fail++, () => fail++)));
      msg.textContent = 'Salvo la mappa… ' + done + '/' + list.length;
    }
    btn.disabled = false;
    const zs = list.map(t => t.z); 
    msg.textContent = fail ? 'Salvate ' + done + ' tessere, ' + fail + ' non scaricate (rete?).' : 'Area salvata: ' + done + ' tessere, zoom da ' + Math.min(...zs) + ' a ' + Math.max(...zs) + '.';
  });
  // chiede al browser di non cancellare zone e mappe salvate quando manca spazio
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  function renderNet() {
    const off = !navigator.onLine;
    document.documentElement.classList.toggle('offline', off);
    const m = $('#annMeta'); if (m && off && !/senza rete/.test(m.textContent)) m.textContent = (m.textContent ? m.textContent + '  ·  ' : '') + 'senza rete';
  }
  window.addEventListener('online', () => { renderNet(); renderAll(); });
  window.addEventListener('offline', () => { renderNet(); });

  // ---------------------------------------------------------------- aggiornamento dal sito
  // Modo 1 (upload manuale su GitHub): carichi il file D-Flight così com'è nella cartella data/
  //   del repository; l'app trova il più recente tramite l'elenco pubblico dell'API di GitHub.
  // Modo 2 (script/Proxmox): data/zone.json descrive data/zones.json.gz.
  const MANIFEST_URL = 'data/zone.json', DATA_URL = 'data/zones.json.gz';
  const FILE_RE = /^dflight_geozones_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.json(\.gz)?$/;
  function ghRepo() {
    const m = /^([^.]+)\.github\.io$/i.exec(location.hostname);
    if (!m) return null;
    const first = location.pathname.split('/').filter(Boolean)[0];
    return { owner: m[1], repo: first && !/\.html?$/.test(first) ? first : m[1] + '.github.io' };
  }
  async function findRemote() {
    const gh = ghRepo();
    if (gh) {
      try {
        const r = await fetch('https://api.github.com/repos/' + gh.owner + '/' + gh.repo + '/contents/data', { cache: 'no-cache', headers: { Accept: 'application/vnd.github+json' } });
        if (r.ok) {
          const list = (await r.json()).filter(f => f.type === 'file' && FILE_RE.test(f.name)).sort((x, y) => x.name < y.name ? 1 : -1);
          if (list.length) {
            const f = list[0], m = FILE_RE.exec(f.name);
            return { file: f.name, url: 'data/' + encodeURIComponent(f.name), altUrl: f.download_url, sha256: 'git:' + f.sha,
              dataDate: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString(), older: list.length - 1 };
          }
        }
      } catch (e) { if (!navigator.onLine) throw e; }
    }
    const r = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const man = await r.json();
    return Object.assign({ url: DATA_URL + '?v=' + encodeURIComponent(String(man.sha256 || man.dataDate || '').slice(0, 16)) }, man);
  }
  const sync = { state: 'idle', man: null, checked: ls.get('lastCheck', 0), busy: false };
  function renderSync() {
    const el = $('#syncInfo'); if (!el) return;
    const t = sync.checked ? new Date(sync.checked).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : 'mai';
    const man = sync.man;
    const pub = man && man.dataDate ? new Date(man.dataDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '';
    const msg = {
      idle: 'Aggiornamento automatico dal sito.',
      checking: 'Controllo se ci sono zone nuove…',
      downloading: 'Scarico le zone del ' + pub + '…',
      ok: 'Zone aggiornate: sul sito ci sono i dati del ' + pub + '.',
      updated: 'Scaricate le zone nuove del ' + pub + '.',
      none: 'Nel repository non c’è ancora un file dflight_geozones_….json.gz nella cartella data.',
      offline: 'Nessuna connessione: uso le zone salvate sul telefono.',
      error: 'Non riesco a scaricare le zone dal sito. Riprovo alla prossima apertura.',
      localNewer: 'Hai importato a mano dati più recenti di quelli sul sito (' + pub + ').'
    }[sync.state] || '';
    el.textContent = msg + (sync.state === 'checking' || sync.state === 'downloading' ? '' : ' Ultimo controllo: ' + t + '.');
    el.classList.toggle('err', sync.state === 'error');
  }
  async function syncRemote(force) {
    if (sync.busy || location.protocol === 'file:') return false;
    sync.busy = true; sync.state = 'checking'; renderSync();
    try {
      let man;
      try { man = await findRemote(); }
      catch (e) { sync.state = navigator.onLine ? 'error' : 'offline'; return false; }
      if (!man) { sync.state = 'none'; sync.checked = Date.now(); return false; }
      sync.man = man; sync.checked = Date.now(); ls.set('lastCheck', sync.checked);
      const cur = state.meta;
      if (!force && cur && cur.remoteSha && cur.remoteSha === man.sha256) { sync.state = 'ok'; return false; }
      if (!force && cur && !cur.demo && cur.source === 'file' && cur.dataDate && man.dataDate && Date.parse(cur.dataDate) > Date.parse(man.dataDate)) { sync.state = 'localNewer'; return false; }
      sync.state = 'downloading'; renderSync();
      let d = await fetch(man.url, { cache: 'no-cache' }).catch(() => null);
      // appena caricato su GitHub il sito può metterci 1–2 minuti: nel frattempo uso il file grezzo
      if ((!d || !d.ok) && man.altUrl) d = await fetch(man.altUrl, { cache: 'no-cache' });
      if (!d || !d.ok) throw new Error('HTTP ' + (d ? d.status : '?'));
      const blob = await d.blob();
      const data = await readZoneBlob(blob);
      await loadDataset(data, man.file || 'zones.json.gz', blob, null, { source: 'sito', remoteSha: man.sha256 || null });
      sync.state = 'updated';
      return true;
    } catch (e) {
      sync.state = 'error'; return false;
    } finally { sync.busy = false; renderSync(); }
  }
  $('#btnSync').addEventListener('click', () => syncRemote(false));
  // l'app installata può restare aperta per giorni: ricontrolla quando torna in primo piano
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - sync.checked > 30 * 60 * 1000) syncRemote(false);
  });
  window.addEventListener('online', () => { if (Date.now() - sync.checked > 5 * 60 * 1000) syncRemote(false); });

  // ---------------------------------------------------------------- avvio
  async function boot() {
    $('#optFollow').checked = state.follow;
    if (ls.get('wake', false)) { $('#optWake').checked = true; setWake(true); }
    selectTab(ls.get('tab', 'here'));
    const saved = await idb.get('dataset');
    let ok = false;
    if (saved && (saved.blob || saved.data)) {
      try {
        const data = saved.blob ? await readZoneBlob(saved.blob) : saved.data;
        await loadDataset(data, saved.fileName, null, saved.meta || { imported: new Date().toISOString() });
        ok = true;
      } catch (e) { alertMsg('Non riesco a rileggere le zone salvate.', true); }
    }
    // prima apertura: prova subito il sito, altrimenti mostra l'esempio
    if (!ok) ok = await syncRemote(false);
    if (!ok && !state.meta) await loadDataset(demoDataset(43.7696, 11.2558, 'su Firenze'), '');
    else if (ok !== true || sync.state !== 'updated') syncRemote(false);
    renderSync();
    const p2 = await idb.get('points');
    if ((!state.points || !state.points.length) && p2 && p2.length) { state.points = p2; ls.set('points', p2); }
    drawPoints(); renderPoints();
    renderAll(); syncSheetH();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', drawZones);
  }
  boot();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // per i test
  window.QZ = { state, parseAny, zonesAt, nearZones, loadDataset, readZoneBlob, statusOf, syncRemote, sync };
})();
