// Radar du ciel — fonctions complémentaires :
// logos des compagnies, « où regarder », prochain passage, appareils rares,
// carnet du ciel, passages de l'ISS, météo et heure à l'arrivée.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import * as satellite from "satellite.js";
import tzlookupMod from "tz-lookup";
import { recordSighting, backfillStats } from "./collection.mjs";

const tzlookup = tzlookupMod.default || tzlookupMod;
const R_EARTH = 6371;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const UA = "trmnl-radar-ciel (github.com/nbbou81000)";

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------
export function km(lat1, lon1, lat2, lon2) {
  const h = Math.sin((lat2 - lat1) * D2R / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin((lon2 - lon1) * D2R / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const la1 = lat1 * D2R, la2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(la2), x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}
const DIRS = ["nord", "nord-nord-est", "nord-est", "est-nord-est", "est", "est-sud-est", "sud-est", "sud-sud-est",
  "sud", "sud-sud-ouest", "sud-ouest", "ouest-sud-ouest", "ouest", "ouest-nord-ouest", "nord-ouest", "nord-nord-ouest"];
const DIRS_SHORT = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
export const dirName = az => DIRS[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
export const dirShort = az => DIRS_SHORT[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
const thousands = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return d; } };

async function fetchBuf(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}
async function fetchJson(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function fetchText(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Logos des compagnies, convertis en noir pur pour l'e-ink
// ---------------------------------------------------------------------------
// Source principale : logos horizontaux 200×80 (code IATA) ; secours : icônes carrées (code OACI).
function inkify(buf) {
  let img;
  try { img = PNG.sync.read(buf); } catch { return null; }
  const { width: w, height: h, data } = img;
  const ink = new Uint8Array(w * h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, a = data[i + 3] / 255;
    // composé sur fond blanc, puis « encre » = composante la plus sombre
    const r = 255 - (255 - data[i]) * a, g = 255 - (255 - data[i + 1]) * a, b = 255 - (255 - data[i + 2]) * a;
    if (Math.min(r, g, b) < 215) { ink[y * w + x] = 1; count++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  if (count < 30 || count > w * h * 0.92) return null;   // vide ou bloc plein : logo inexploitable
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const out = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const o = (y * cw + x) * 4, on = ink[(y + y0) * w + (x + x0)];
    out.data[o] = out.data[o + 1] = out.data[o + 2] = 0;
    out.data[o + 3] = on ? 255 : 0;
  }
  return PNG.sync.write(out);
}

export function logoKey(airline) {
  return airline?.iata && /^[A-Z0-9]{2}$/.test(airline.iata) ? airline.iata : airline?.icao && /^[A-Z]{3}$/.test(airline.icao) ? airline.icao : null;
}

/** Télécharge et convertit les logos manquants (au plus `max` par passage). */
export async function ensureLogos(dataDir, airlines, max = 12) {
  const dir = join(dataDir, "logos");
  mkdirSync(dir, { recursive: true });
  const idxFile = join(dir, "index.json");
  const idx = readJson(idxFile, {});
  const now = Date.now();
  let done = 0;
  for (const a of airlines) {
    const key = logoKey(a);
    if (!key || done >= max) continue;
    const e = idx[key];
    if (e?.ok || (e && now - e.at < 30 * 86400e3)) continue;     // déjà là, ou échec récent
    done++;
    let png = null;
    if (a.iata && /^[A-Z0-9]{2}$/.test(a.iata)) {
      const b = await fetchBuf(`https://pics.avs.io/200/80/${a.iata}.png`);
      if (b) png = inkify(b);
    }
    if (!png && a.icao && /^[A-Z]{3}$/.test(a.icao)) {
      const b = await fetchBuf(`https://raw.githubusercontent.com/Jxck-S/airline-logos/main/flightaware_logos/${a.icao}.png`);
      if (b) png = inkify(b);
    }
    if (png) { writeFileSync(join(dir, `${key}.png`), png); idx[key] = { ok: true, at: now }; }
    else idx[key] = { ok: false, at: now };
  }
  writeFileSync(idxFile, JSON.stringify(idx));
  return idx;
}
export function logoUrl(base, idx, airline) {
  const key = logoKey(airline);
  return key && idx?.[key]?.ok ? `${base}/logos/${key}.png` : "";
}

// ---------------------------------------------------------------------------
// Où regarder : direction et hauteur au-dessus de l'horizon
// ---------------------------------------------------------------------------
export function lookAngles(home, lat, lon, altM) {
  const d = km(home.lat, home.lon, lat, lon);
  const h = (altM - (home.alt_m || 0)) / 1000;
  const el = Math.atan2(h - (d * d) / (2 * R_EARTH), Math.max(d, 0.01)) * R2D;
  const az = bearingDeg(home.lat, home.lon, lat, lon);
  return { az, el, d };
}
export function trendTxt(az, track) {
  if (!Number.isFinite(track)) return "";
  const c = Math.cos((track - az) * D2R);
  return c > 0.35 ? "s'éloigne" : c < -0.35 ? "se rapproche" : "passe de côté";
}
// Position sur la carte du ciel : centre = zénith, bord = horizon. Coordonnées dans [-1, 1].
export function skyXY(az, el) {
  const r = Math.max(0, Math.min(1, (90 - el) / 90));
  return { x: Math.sin(az * D2R) * r, y: -Math.cos(az * D2R) * r };
}

/** Prochain passage au plus près dans les `horizonMin` minutes (cap et vitesse supposés constants). */
export function nextPass(home, list, horizonMin = 12) {
  let best = null;
  for (const a of list) {
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon) || !Number.isFinite(a.alt_m) || a.on_ground) continue;
    if (!Number.isFinite(a.track_deg) || !Number.isFinite(a.speed_kmh) || a.speed_kmh < 60) continue;
    const v = a.speed_kmh / 60, vr = Number.isFinite(a.vr_ms) ? a.vr_ms * 60 : 0;
    const now = lookAngles(home, a.lat, a.lon, a.alt_m);
    let top = { el: -90, t: 0, az: 0 };
    for (let t = 0; t <= horizonMin; t += 0.25) {
      const dist = v * t, br = a.track_deg * D2R;
      const lat = a.lat + (dist * Math.cos(br)) / 111.2;
      const lon = a.lon + (dist * Math.sin(br)) / (111.2 * Math.cos(a.lat * D2R));
      const alt = Math.max(0, a.alt_m + vr * t);
      const la = lookAngles(home, lat, lon, alt);
      if (la.el > top.el) top = { el: la.el, t, az: la.az, alt };
    }
    if (top.t < 0.75 || top.el < Math.max(15, now.el + 3)) continue;   // déjà passé, ou trop bas
    if (!best || top.el > best.el) best = { a, ...top };
  }
  if (!best) return null;
  const m = Math.max(1, Math.round(best.t));
  return {
    flight: best.a.flight, airline: best.a.airline || "", type: best.a.type || "", logo: best.a.logo || "",
    in_min: m, in_txt: `dans ${m} min`,
    el_max: Math.round(best.el), dir_txt: dirName(best.az),
    zenith: best.el > 70,
    alt_txt: thousands(best.alt)
  };
}

// ---------------------------------------------------------------------------
// Appareils rares
// ---------------------------------------------------------------------------
export const RARE_TYPES = {
  A388: "Airbus A380", A3ST: "Airbus Beluga", A337: "Airbus BelugaXL", A400: "Airbus A400M Atlas",
  A124: "Antonov An-124", A225: "Antonov An-225", C17: "Boeing C-17 Globemaster", C5M: "Lockheed C-5 Galaxy",
  K35R: "Boeing KC-135", A332: null, MRTT: "Airbus A330 MRTT", B748: "Boeing 747-8", B744: "Boeing 747-400", B742: "Boeing 747-200",
  E3TF: "Boeing E-3 AWACS", E3CF: "Boeing E-3 AWACS", R135: "Boeing RC-135", B52: "Boeing B-52",
  RFAL: "Dassault Rafale", MIR2: "Dassault Mirage 2000", EUFI: "Eurofighter Typhoon", F16: "F-16", F35: "F-35", ALPH: "Alpha Jet",
  C130: "Lockheed C-130 Hercules", C30J: "Lockheed C-130J Hercules", CL2T: "Canadair CL-415", CL4T: "Canadair DHC-515",
  NH90: "NH90", TIGR: "Tigre", CONC: "Concorde", DC3: "Douglas DC-3", JU52: "Junkers Ju 52", SPIT: "Spitfire"
};
const RARE_CALLSIGNS = [[/^SAMU/, "Hélicoptère du SAMU"], [/^DRAGON/, "Hélicoptère de la Sécurité civile"],
  [/^GENDARM|^GEND/, "Gendarmerie"], [/^POLICE|^POLIC/, "Police"], [/^MILAN/, "Bombardier d'eau"], [/^PELICAN/, "Bombardier d'eau"],
  [/^CTM|^FAF|^COTAM/, "Armée de l'Air et de l'Espace"], [/^FNY/, "Marine nationale"]];
const SQUAWKS = { "7500": "Détournement (7500)", "7600": "Panne radio (7600)", "7700": "Urgence (7700)" };

export function rarity(raw, desc) {
  if (!raw) return null;
  const cs = (raw.flight || "").trim().toUpperCase();
  if (SQUAWKS[raw.squawk]) return { level: 3, why: SQUAWKS[raw.squawk] };
  if (raw.emergency && raw.emergency !== "none") return { level: 3, why: "Urgence déclarée" };
  const typeName = RARE_TYPES[raw.t];
  if (Number(raw.dbFlags) & 1) return { level: 2, why: typeName ? `${typeName} militaire` : "Appareil militaire" };
  for (const [re, label] of RARE_CALLSIGNS) if (re.test(cs)) return { level: 2, why: label };
  if (typeName) return { level: 1, why: typeName };
  return null;
}

// ---------------------------------------------------------------------------
// Carnet du ciel
// ---------------------------------------------------------------------------
const BIG = { A388: 95, B748: 90, B744: 88, A3ST: 99, A337: 99, A124: 99, A35K: 70, B77W: 70, B779: 72, B789: 66, B78X: 66,
  A359: 66, B788: 64, B772: 62, B77L: 62, A339: 62, A333: 60, A332: 58, A343: 60, A346: 62, B763: 55, B764: 55, B752: 50 };
export function dayKey(d, tz) {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function hourIn(d, tz) { return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(d)) % 24; }
const hmIn = (d, tz) => new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(d);

/**
 * Met à jour le carnet avec les avions vus pendant ce passage.
 * list : [{ hex, flight, type, type_code, airline, airline_icao, from_cc, from_country, from_city, to_city, route_km, alt_m, rare }]
 */
export function updateCarnet(carnet, list, now, tz, totalTypes) {
  carnet ||= {};
  carnet.since ||= now.toISOString();
  carnet.days ||= {};
  carnet.coll ||= { types: {}, airlines: {}, countries: {} };
  backfillStats(carnet);
  const key = dayKey(now, tz);
  const day = carnet.days[key] ||= { count: 0, hours: Array(24).fill(0), hexes: [], best: null, longest: null, news: [] };
  const seen = new Set(day.hexes);
  for (const a of list) {
    if (!a.hex || seen.has(a.hex)) continue;
    seen.add(a.hex); day.hexes.push(a.hex);
    day.count++; day.hours[hourIn(now, tz)]++;
    const addColl = (kind, k, name) => {
      if (!k || !name) return;
      const e = carnet.coll[kind][k];
      if (!e) { carnet.coll[kind][k] = { name, first: key, last: key, n: 1 }; day.news.push(name); }
      else { e.n = (e.n || 1) + 1; e.last = key; }
    };
    addColl("types", a.type_code, a.type || a.type_code);
    addColl("airlines", a.airline_icao, a.airline);
    if (a.airline_icao && a.airline_iata && carnet.coll.airlines[a.airline_icao]) carnet.coll.airlines[a.airline_icao].iata = a.airline_iata;
    addColl("countries", a.from_cc, a.from_country);
    const dow = (new Date(key + "T12:00:00Z").getUTCDay() + 6) % 7;
    recordSighting(carnet, a, { day: key, dow, hour: hourIn(now, tz) });
    // Prise du jour : rareté d'abord, puis gros porteurs, puis longueur de la route
    const score = a.rare ? 100 + a.rare.level : (BIG[a.type_code] || 0) + Math.min(40, (a.route_km || 0) / 200);
    if (!day.best || score > day.best.score) day.best = {
      score, label: [a.rare?.why || a.type, a.airline].filter(Boolean).join(" · "),
      sub: [a.from_city && a.to_city ? `${a.from_city} → ${a.to_city}` : "", Number.isFinite(a.alt_m) ? `à ${thousands(a.alt_m)} m` : "", hmIn(now, tz)].filter(Boolean).join(", ")
    };
    if (a.route_km && (!day.longest || a.route_km > day.longest.km)) day.longest = { km: Math.round(a.route_km), txt: `${a.from_city} → ${a.to_city}` };
  }
  // On ne garde que 35 jours
  const keys = Object.keys(carnet.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 35))) delete carnet.days[k];
  return summarizeCarnet(carnet, now, tz, totalTypes);
}

export function summarizeCarnet(carnet, now, tz, totalTypes) {
  if (!carnet?.days) return null;
  const key = dayKey(now, tz);
  const day = carnet.days[key] || { count: 0, hours: Array(24).fill(0), news: [] };
  const lastWeek = carnet.days[dayKey(new Date(now.getTime() - 7 * 86400e3), tz)];
  const delta = lastWeek && lastWeek.count > 0 ? Math.round((day.count - lastWeek.count) / lastWeek.count * 100) : null;
  const hmax = Math.max(1, ...day.hours);
  const peak = day.hours.indexOf(Math.max(...day.hours));
  const nType = Object.keys(carnet.coll.types).length;
  const fmtDate = s => new Intl.DateTimeFormat("fr-FR", { timeZone: tz, day: "numeric", month: "long" }).format(new Date(s));
  const week = (() => {
    const d = new Date(now); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dn = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dn + 3);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((t - y0) / 86400e3 - 3 + ((y0.getUTCDay() + 6) % 7)) / 7);
  })();
  return {
    date_txt: new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(now).replace(/^./, c => c.toUpperCase()),
    week, since_txt: fmtDate(carnet.since),
    today: day.count,
    delta_txt: delta === null ? "" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta)} % vs il y a une semaine`,
    types: nType, types_total: totalTypes, types_pct: Math.min(100, Math.round(nType / Math.max(1, totalTypes) * 100)),
    airlines: Object.keys(carnet.coll.airlines).length,
    countries: Object.keys(carnet.coll.countries).length,
    best: day.best ? { label: day.best.label, sub: day.best.sub } : null,
    longest: day.longest ? { txt: day.longest.txt, km_txt: thousands(day.longest.km) } : null,
    news: [...new Set(day.news)].slice(-5).reverse(),
    // Barres de l'histogramme : hauteur en pourcentage du maximum
    bars: day.hours.map((v, h) => ({ h, v, pct: Math.round(v / hmax * 100), now: h === hourIn(now, tz) })),
    peak_txt: day.count ? `pic ${peak} h` : ""
  };
}

// « de l'ouest », « du nord-est » ; « vers l'est », « vers le sud »
const deDir = d => /^[aeiou]/.test(d) ? `de l'${d}` : `du ${d}`;
const versDir = d => /^[aeiou]/.test(d) ? `vers l'${d}` : `vers le ${d}`;

// ---------------------------------------------------------------------------
// ISS : prochain passage visible à l'œil nu
// ---------------------------------------------------------------------------
function jd(date) { return date.getTime() / 86400000 + 2440587.5; }
function sunEci(date) {
  const d = jd(date) - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * D2R, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R, e = (23.439 - 0.00000036 * d) * D2R;
  const AU = 149597870.7;
  return { x: Math.cos(L) * AU, y: Math.cos(e) * Math.sin(L) * AU, z: Math.sin(e) * Math.sin(L) * AU };
}
function sunlit(p, s) {
  const sl = Math.hypot(s.x, s.y, s.z), ux = s.x / sl, uy = s.y / sl, uz = s.z / sl;
  const dot = p.x * ux + p.y * uy + p.z * uz;
  if (dot > 0) return true;
  const px = p.x - dot * ux, py = p.y - dot * uy, pz = p.z - dot * uz;
  return Math.hypot(px, py, pz) > 6378;
}

export async function issInfo(dataDir, home, now, tz) {
  const file = join(dataDir, "iss.json");
  let c = readJson(file, null);
  if (!c || !c.tle || now - new Date(c.at) > 12 * 3600e3) {
    // Plusieurs sources, car certaines refusent les serveurs de GitHub
    let tle = null;
    for (const url of ["https://live.ariss.org/iss.txt", "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE"]) {
      const txt = await fetchText(url);
      const lines = (txt || "").split(/\r?\n/).map(s => s.trim()).filter(l => /^[12] 25544/.test(l));
      if (lines.length >= 2) { tle = [lines[0], lines[1]]; break; }
    }
    if (!tle) {
      const j = await fetchJson("https://tle.ivanstanojevic.me/api/tle/25544") || await fetchJson("https://api.wheretheiss.at/v1/satellites/25544/tles");
      if (j?.line1 && j?.line2) tle = [j.line1, j.line2];
    }
    if (tle) { c = { at: now.toISOString(), tle }; writeFileSync(file, JSON.stringify(c)); }
  }
  if (!c?.tle) return null;
  const rec = satellite.twoline2satrec(c.tle[0], c.tle[1]);
  const obs = { latitude: home.lat * D2R, longitude: home.lon * D2R, height: (home.alt_m || 0) / 1000 };
  const look = t => {
    const pv = satellite.propagate(rec, t);
    if (!pv || !pv.position) return null;
    const gmst = satellite.gstime(t);
    const la = satellite.ecfToLookAngles(obs, satellite.eciToEcf(pv.position, gmst));
    const s = sunEci(t);
    const sunLa = satellite.ecfToLookAngles(obs, satellite.eciToEcf(s, gmst));
    return { el: la.elevation * R2D, az: la.azimuth * R2D, visible: sunlit(pv.position, s) && sunLa.elevation * R2D < -6 };
  };
  // Passage en cours ?
  const cur = look(now);
  const nowVis = cur && cur.el > 10 && cur.visible ? { az: cur.az, el: cur.el, ...skyXY(cur.az, cur.el) } : null;
  // Prochain passage visible sur 7 jours
  let pass = null, seg = null;
  for (let t = now.getTime(); t < now.getTime() + 7 * 86400e3; t += 30e3) {
    const p = look(new Date(t));
    const ok = p && p.el > 10 && p.visible;
    if (ok) {
      if (!seg) seg = { start: t, az0: p.az, max: p.el };
      seg.end = t; seg.az1 = p.az; seg.max = Math.max(seg.max, p.el);
    } else if (seg) {
      if (seg.end - seg.start >= 60e3) { pass = seg; break; }
      seg = null;
    }
  }
  if (!pass && seg && seg.end - seg.start >= 60e3) pass = seg;
  let next = null;
  if (pass) {
    const s = new Date(pass.start), e = new Date(pass.end);
    const today = dayKey(now, tz), dk = dayKey(s, tz), h = hourIn(s, tz);
    const tomorrow = dayKey(new Date(now.getTime() + 86400e3), tz);
    const part = h >= 17 ? "soir" : h < 7 ? "nuit" : "matin";
    const wd = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long" }).format(s);
    const when = dk === today ? (h >= 17 ? "ce soir" : h < 7 ? "cette nuit" : "ce matin")
      : dk === tomorrow ? (h < 7 ? "la nuit prochaine" : `demain ${part}`)
      : `${wd} ${part}`;
    next = {
      when, start_txt: hmIn(s, tz), end_txt: hmIn(e, tz), max_el: Math.round(pass.max),
      from_txt: dirName(pass.az0), to_txt: dirName(pass.az1),
      txt: `${hmIn(s, tz)} → ${hmIn(e, tz)}, ${deDir(dirName(pass.az0))} ${versDir(dirName(pass.az1))}, ${Math.round(pass.max)}° max`
    };
  }
  return { now: nowVis, next, none_txt: next ? "" : "Aucun passage visible ces 7 prochains jours" };
}

// ---------------------------------------------------------------------------
// Arrivée : heure locale et météo (METAR officiel)
// ---------------------------------------------------------------------------
function tzOffsetMin(tz, date) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(date).reduce((o, x) => (o[x.type] = x.value, o), {});
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  return Math.round((asUtc - date.getTime()) / 60000);
}
const WX = [["TS", "orage"], ["SN", "neige"], ["RA", "pluie"], ["DZ", "bruine"], ["GR", "grêle"], ["GS", "grésil"], ["FG", "brouillard"], ["BR", "brume"], ["HZ", "brume sèche"], ["SA", "sable"], ["DU", "poussière"], ["FU", "fumée"]];
function wxText(s) {
  if (!s) return "";
  const out = [];
  for (const tok of String(s).split(/\s+/)) {
    let t = tok, inten = "";
    if (t.startsWith("-")) { inten = " faible"; t = t.slice(1); } else if (t.startsWith("+")) { inten = " forte"; t = t.slice(1); }
    if (t.startsWith("VC")) continue;
    const sh = t.includes("SH");
    const hit = WX.find(([k]) => t.includes(k));
    if (hit) out.push((sh && hit[0] === "RA" ? "averses" : sh && hit[0] === "SN" ? "averses de neige" : hit[1]) + inten);
  }
  return [...new Set(out)].join(", ");
}
function skyText(clouds) {
  if (!Array.isArray(clouds) || !clouds.length) return "ciel dégagé";
  const order = { SKC: 0, CLR: 0, NSC: 0, CAVOK: 0, FEW: 1, SCT: 2, BKN: 3, OVC: 4, OVX: 4 };
  const top = clouds.reduce((m, c) => Math.max(m, order[c.cover] ?? 0), 0);
  return ["ciel dégagé", "peu nuageux", "nuageux", "très nuageux", "ciel couvert"][top];
}
const WMO_ICON = t => /orage/.test(t) ? "orage" : /neige|grésil|grêle/.test(t) ? "neige" : /pluie|bruine|averses/.test(t) ? "pluie" : /brouillard|brume/.test(t) ? "brouillard" : null;

export async function arrivalInfo(dataDir, dest, etaDate, homeTz, now) {
  if (!dest || !Number.isFinite(dest.lat) || !Number.isFinite(dest.lon)) return null;
  let tz = null;
  try { tz = tzlookup(dest.lat, dest.lon); } catch { tz = null; }
  const out = { city: dest.city || "", code: dest.code || "" };
  if (tz) {
    const diff = Math.round((tzOffsetMin(tz, now) - tzOffsetMin(homeTz, now)) / 60 * 2) / 2;
    out.time_txt = hmIn(now, tz);
    out.offset_txt = diff === 0 ? "même heure qu'à la maison" : `${diff > 0 ? "+" : "−"}${String(Math.abs(diff)).replace(".", ",")} h par rapport à la maison`;
    out.eta_local_txt = etaDate ? hmIn(etaDate, tz) : "";
  }
  if (dest.icao) {
    const file = join(dataDir, "metar.json");
    const cache = readJson(file, {});
    let m = cache[dest.icao];
    if (!m || now - new Date(m.at) > 20 * 60e3) {
      const j = await fetchJson(`https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(dest.icao)}&format=json`);
      if (Array.isArray(j) && j[0]) { m = { at: now.toISOString(), d: j[0] }; cache[dest.icao] = m; writeFileSync(file, JSON.stringify(cache)); }
    }
    const d = m?.d;
    if (d) {
      const wx = wxText(d.wxString), sky = skyText(d.clouds);
      out.temp_txt = Number.isFinite(d.temp) ? `${Math.round(d.temp)} °C` : "";
      out.wx_txt = wx || sky;
      out.sky_txt = wx ? sky : "";
      const ws = Number(d.wspd);
      out.wind_txt = Number.isFinite(ws) ? (ws < 3 ? "vent calme" : `vent ${Math.round(ws * 1.852)} km/h${Number.isFinite(Number(d.wdir)) && Number(d.wspd) ? ` ${deDir(dirName(Number(d.wdir)))}` : ""}`) : "";
      const v = String(d.visib ?? "");
      out.vis_txt = v === "10+" || v === "6+" ? "visibilité > 10 km" : Number.isFinite(parseFloat(v)) ? `visibilité ${Math.round(parseFloat(v) * 1.609)} km` : "";
      out.icon = WMO_ICON(out.wx_txt) || (/couvert|très nuageux/.test(sky) ? "nuages" : /nuageux/.test(sky) ? "eclaircies" : "soleil");
      out.obs_txt = d.obsTime ? `observé à ${hmIn(new Date(d.obsTime * 1000), tz || homeTz)} (heure locale)` : "";
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Profil d'altitude (repère 1000 × 200, y vers le bas)
// ---------------------------------------------------------------------------
export function altitudeProfile(trail, A, B, pos, estimated, status) {
  if (!A || !B) return null;
  const total = km(A.lat, A.lon, B.lat, B.lon);
  if (!(total > 50)) return null;
  const X = (lat, lon) => {
    const a = km(A.lat, A.lon, lat, lon), b = km(lat, lon, B.lat, B.lon);
    return Math.max(0, Math.min(1, a / (a + b || 1))) * 1000;
  };
  const Y = alt => 190 - Math.max(0, Math.min(1, alt / 13000)) * 165;
  const pts = (trail || []).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]))
    .map(p => [X(p[1], p[0]), Y(p[2]), p[2]]);
  if (!pts.length && status !== "attente" && status !== "au_sol") return null;
  const done = [[0, 190]];
  // Suivi commencé en cours de vol : montée supposée sur ~150 km jusqu'au premier point connu
  const climb = Math.min(0.3, 150 / total) * 1000;
  if (pts.length && pts[0][0] > climb + 20) done.push([climb, pts[0][1]]);
  for (const p of pts) if (p[0] >= done[done.length - 1][0] - 5) done.push([p[0], p[1]]);
  const last = done[done.length - 1];
  let cur = last;
  if (estimated && pos) cur = [X(pos.lat, pos.lon), last[1]];
  const descent = Math.min(0.35, 180 / total) * 1000;
  const fut = [];
  if (status !== "atterri" && status !== "arrivee_probable") {
    if (estimated) fut.push(last);
    fut.push(cur);
    if (cur[0] < 1000 - descent) fut.push([1000 - descent, cur[1]]);
    fut.push([1000, 190]);
  } else done.push([1000, 190]);
  const s = arr => arr.map(p => `${Math.round(p[0])},${Math.round(p[1])}`).join(" ");
  const maxAlt = pts.length ? Math.max(...pts.map(p => p[2])) : 0;
  return { done: s(done), todo: s(fut), cx: Math.round(cur[0]), cy: Math.round(cur[1]), max_txt: maxAlt ? thousands(maxAlt) : "" };
}
