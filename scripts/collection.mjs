// Radar du ciel — collection d'avions (photos par modèle) et statistiques avancées.
//
// Photos : vignette de l'article Wikipédia (anglais) de chaque modèle, hébergée par
// Wikimedia Commons. Elles sont recadrées et tramées en noir et blanc pour l'e-ink,
// puis publiées sur la branche data (photos/CODE-l.png et photos/CODE-s.png).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

const UA = "trmnl-radar-ciel/1.0 (github.com/nbbou81000/trmnl-radar-ciel)";
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return d; } };
const thousands = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

// Code OACI du type -> titre de l'article Wikipédia (anglais) qui porte la meilleure photo
export const WIKI = {
  A19N: "Airbus A319neo", A20N: "Airbus A320neo family", A21N: "Airbus A321neo",
  A318: "Airbus A318", A319: "Airbus A319", A320: "Airbus A320 family", A321: "Airbus A321",
  A332: "Airbus A330-200", A333: "Airbus A330", A338: "Airbus A330-800", A339: "Airbus A330neo",
  A342: "Airbus A340-200", A343: "Airbus A340", A346: "Airbus A340-600", A359: "Airbus A350", A35K: "Airbus A350-1000", A388: "Airbus A380",
  BCS1: "Airbus A220-100", BCS3: "Airbus A220", B712: "Boeing 717",
  B733: "Boeing 737-300", B734: "Boeing 737-400", B735: "Boeing 737-500", B736: "Boeing 737-600", B737: "Boeing 737-700", B738: "Boeing 737 Next Generation", B739: "Boeing 737-900",
  B37M: "Boeing 737 MAX 7", B38M: "Boeing 737 MAX", B39M: "Boeing 737 MAX 9", B3XM: "Boeing 737 MAX 10",
  B744: "Boeing 747-400", B748: "Boeing 747-8", B752: "Boeing 757", B753: "Boeing 757-300",
  B762: "Boeing 767-200", B763: "Boeing 767", B764: "Boeing 767-400ER",
  B772: "Boeing 777", B77L: "Boeing 777-200LR", B77W: "Boeing 777-300ER", B773: "Boeing 777-300", B778: "Boeing 777X", B779: "Boeing 777X",
  B788: "Boeing 787 Dreamliner", B789: "Boeing 787-9", B78X: "Boeing 787-10",
  AT43: "ATR 42", AT45: "ATR 42-500", AT46: "ATR 42-600", AT72: "ATR 72", AT75: "ATR 72-500", AT76: "ATR 72-600",
  CRJ2: "Bombardier CRJ200", CRJ7: "Bombardier CRJ700", CRJ9: "Bombardier CRJ900", CRJX: "Bombardier CRJ1000",
  E170: "Embraer E170", E75L: "Embraer E175", E75S: "Embraer E175", E190: "Embraer E190", E195: "Embraer E195",
  E290: "Embraer E190-E2", E295: "Embraer E195-E2", E145: "Embraer ERJ family", E135: "Embraer ERJ135",
  DH8D: "De Havilland Canada Dash 8", DH8C: "De Havilland Canada Dash 8", SF34: "Saab 340", SB20: "Saab 2000",
  F70: "Fokker 70", F100: "Fokker 100", RJ85: "British Aerospace 146", RJ1H: "British Aerospace 146",
  C25A: "Cessna CitationJet/M2", C25B: "Cessna CitationJet/M2", C25C: "Cessna CitationJet/M2", C525: "Cessna CitationJet/M2", C510: "Cessna Citation Mustang",
  C56X: "Cessna Citation Excel", C560: "Cessna Citation V", C680: "Cessna Citation Sovereign", C68A: "Cessna Citation Latitude", C700: "Cessna Citation Longitude", C750: "Cessna Citation X",
  E55P: "Embraer Phenom 300", E50P: "Embraer Phenom 100", E545: "Embraer Legacy 500", E550: "Embraer Praetor 600",
  F2TH: "Dassault Falcon 2000", F900: "Dassault Falcon 900", FA7X: "Dassault Falcon 7X", FA8X: "Dassault Falcon 8X", FA6X: "Dassault Falcon 6X", FA50: "Dassault Falcon 50",
  GLF4: "Gulfstream IV", GLF5: "Gulfstream V", GLF6: "Gulfstream G650", GL5T: "Bombardier Global 5000", GLEX: "Bombardier Global Express", GL7T: "Bombardier Global 7500",
  CL30: "Bombardier Challenger 300", CL35: "Bombardier Challenger 300", CL60: "Bombardier Challenger 600 series",
  LJ45: "Learjet 45", LJ60: "Learjet 60", LJ75: "Learjet 75", PC12: "Pilatus PC-12", PC24: "Pilatus PC-24",
  TBM7: "SOCATA TBM", TBM8: "SOCATA TBM", TBM9: "SOCATA TBM",
  BE20: "Beechcraft Super King Air", BE35: "Beechcraft Bonanza", BE36: "Beechcraft Bonanza", BE58: "Beechcraft Baron", BE9L: "Beechcraft King Air",
  C150: "Cessna 152", C152: "Cessna 152", C172: "Cessna 172", C182: "Cessna 182 Skylane", C206: "Cessna 206", C208: "Cessna 208 Caravan",
  P28A: "Piper PA-28 Cherokee", P28B: "Piper PA-28 Cherokee", PA34: "Piper PA-34 Seneca", PA46: "Piper PA-46", SR20: "Cirrus SR20", SR22: "Cirrus SR22",
  DR40: "Robin DR400", DR22: "Robin DR200", R200: "Robin HR200", CAP1: "Mudry CAP 10", DV20: "Diamond DV20 Katana", DA40: "Diamond DA40 Diamond Star", DA42: "Diamond DA42 Twin Star",
  SIRA: "APM 20 Lionceau", GLID: "Glider (sailplane)", ULAC: "Ultralight aviation",
  EC35: "Eurocopter EC135", EC45: "Eurocopter EC145", EC30: "Eurocopter EC130", EC20: "Eurocopter EC120 Colibri", EC55: "Eurocopter EC155", EC75: "Airbus Helicopters H175",
  AS50: "Eurocopter AS350 Écureuil", AS55: "Eurocopter AS355 Écureuil 2", AS65: "Eurocopter AS365 Dauphin",
  A139: "AgustaWestland AW139", A169: "AgustaWestland AW169", A109: "AgustaWestland AW109", R44: "Robinson R44", R22: "Robinson R22", H160: "Airbus Helicopters H160", NH90: "NHIndustries NH90",
  A400: "Airbus A400M Atlas", C130: "Lockheed C-130 Hercules", C30J: "Lockheed Martin C-130J Super Hercules", K35R: "Boeing KC-135 Stratotanker",
  A3ST: "Airbus Beluga", A337: "Airbus BelugaXL",
  RFAL: "Dassault Rafale", M2KC: "Dassault Mirage 2000", ALPH: "Dassault/Dornier Alpha Jet", PC21: "Pilatus PC-21", TUCA: "Embraer EMB 312 Tucano",
  CN35: "CASA/IPTN CN-235", C295: "EADS CASA C-295"
};

// Constructeur affiché sur la carte de collection
const MAKERS = [[/^A(1[89]N|2[01]N|3\d\d|3[45]\w|38\d|400|3ST|337)$|^BCS/, "Airbus"], [/^B\d|^B3XM|^K35R/, "Boeing"], [/^AT\d/, "ATR"],
  [/^CRJ|^CL\d|^GL[5E7]|^GLEX|^BCS/, "Bombardier"], [/^E\d|^E[57]5|^E\d\dP|^TUCA/, "Embraer"], [/^DH8/, "De Havilland"], [/^SF34|^SB20/, "Saab"],
  [/^F70|^F100/, "Fokker"], [/^RJ/, "Avro"], [/^C\d{3}|^C\d\d[A-Z]|^C25/, "Cessna"], [/^F2TH|^F900|^FA|^RFAL|^M2K|^ALPH/, "Dassault"],
  [/^GLF/, "Gulfstream"], [/^LJ/, "Learjet"], [/^PC/, "Pilatus"], [/^TBM/, "Daher"], [/^BE/, "Beechcraft"], [/^P28|^PA/, "Piper"], [/^SR2/, "Cirrus"],
  [/^DR|^R200/, "Robin"], [/^CAP/, "Mudry"], [/^D[AV]\d/, "Diamond"], [/^EC|^AS|^H160/, "Airbus Helicopters"], [/^A1[036]9/, "Leonardo"],
  [/^R[24]\d?$/, "Robinson"], [/^NH90/, "NHIndustries"], [/^C130|^C30J/, "Lockheed"], [/^CN35|^C295/, "Airbus (CASA)"]];
export const maker = code => (MAKERS.find(([re]) => re.test(code)) || [])[1] || "";

// Grandes familles pour les statistiques
const HELI = /^(EC\d\d|AS\d\d|A1[036]9|R22|R44|H160|NH90|EC75|B06|B407|S76|S92|AW\d+)$/;
const TURBOPROP = /^(AT\d\d|DH8\w|SF34|SB20|PC12|PC21|C208|BE20|BE9L|TBM\d|C130|C30J|A400|CN35|C295|TUCA|JS\d\d|D228|L410)$/;
const LIGHT = /^(C15\d|C172|C182|C206|P28\w|PA\d\d|SR2\d|DR\d\d|R200|CAP\d|DV20|DA4\d|BE3\d|BE58|SIRA|ULAC|GLID)$/;
const BIZJET = /^(C25\w|C5\d\d|C56X|C680|C68A|C700|C750|E55P|E50P|E545|E550|F2TH|F900|FA\w\w|GLF\d|GL5T|GLEX|GL7T|CL3\d|CL60|LJ\d\d|PC24)$/;
const REGIONAL = /^(CRJ\w|E1[3-9]\w|E17\d|E75\w|E29\d|F70|F100|RJ\w\w|BCS1)$/;
const WIDE = /^(A3[3-5]\w|A38\d|B7[4-8]\w|B77\w|B78\w|A3ST|A337|A124)$/;
export function family(code, mil) {
  if (mil) return "mil";
  if (!code) return "inconnu";
  if (HELI.test(code)) return "heli";
  if (LIGHT.test(code)) return "leger";
  if (BIZJET.test(code)) return "affaires";
  if (TURBOPROP.test(code)) return "turboprop";
  if (WIDE.test(code)) return "gros";
  if (REGIONAL.test(code)) return "regional";
  return "ligne";
}
const FAMILIES = [["ligne", "Moyen-courriers"], ["gros", "Gros porteurs"], ["regional", "Jets régionaux"], ["turboprop", "Turbopropulseurs"],
  ["affaires", "Jets d'affaires"], ["leger", "Aviation légère"], ["heli", "Hélicoptères"], ["mil", "Militaires"]];

// ---------------------------------------------------------------------------
// Traitement des photos : recadrage 2:1, niveaux automatiques, trame d'Atkinson
// ---------------------------------------------------------------------------
function decode(buf) {
  try {
    if (buf[0] === 0x89 && buf[1] === 0x50) {
      const p = PNG.sync.read(buf);
      return { w: p.width, h: p.height, rgba: p.data };
    }
    const j = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 256 });
    return { w: j.width, h: j.height, rgba: j.data };
  } catch { return null; }
}

function toGray({ w, h, rgba }) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const l = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
    g[i] = 255 - (255 - l) * a;
  }
  return g;
}

// Recadrage « cover » vers W×H puis réduction par moyenne de zone
function coverResize(g, w, h, W, H, cy = 0.5) {
  const scale = Math.max(W / w, H / h);
  const cw = W / scale, ch = H / scale;
  const ox = (w - cw) / 2, oy = Math.max(0, Math.min(h - ch, (h - ch) * cy));
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx0 = ox + x / scale, sx1 = ox + (x + 1) / scale, sy0 = oy + y / scale, sy1 = oy + (y + 1) / scale;
    let s = 0, n = 0;
    for (let yy = Math.floor(sy0); yy < Math.max(Math.floor(sy0) + 1, Math.ceil(sy1)); yy++)
      for (let xx = Math.floor(sx0); xx < Math.max(Math.floor(sx0) + 1, Math.ceil(sx1)); xx++) {
        const cx = Math.min(w - 1, Math.max(0, xx)), cyy = Math.min(h - 1, Math.max(0, yy));
        s += g[cyy * w + cx]; n++;
      }
    out[y * W + x] = s / n;
  }
  return out;
}

// Netteté légère : la trame adoucit les contours
function sharpen(g, W, H, k = 0.6) {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(H - 1, Math.max(0, y + dy));
      s += g[yy * W + xx]; n++;
    }
    out[y * W + x] = g[y * W + x] + k * (g[y * W + x] - s / n);
  }
  return out;
}

// Le ciel (valeur dominante des bords) est éclairci pour détacher l'avion
function skyLift(g, W, H) {
  const border = [];
  for (let x = 0; x < W; x++) { border.push(g[x], g[(H - 1) * W + x]); }
  for (let y = 0; y < H; y++) { border.push(g[y * W], g[y * W + W - 1]); }
  border.sort((a, b) => a - b);
  const sky = border[Math.floor(border.length / 2)];
  for (let i = 0; i < g.length; i++) {
    const d = Math.abs(g[i] - sky);
    const t = Math.max(0, 1 - d / 40);            // 1 sur le ciel, 0 dès qu'on s'en écarte
    g[i] = g[i] + (255 - g[i]) * t * 0.85;
  }
  return g;
}

function levels(g) {
  const sorted = Float32Array.from(g).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)], hi = sorted[Math.floor(sorted.length * 0.99)];
  const span = Math.max(30, hi - lo);
  for (let i = 0; i < g.length; i++) {
    let v = (g[i] - lo) / span;
    v = Math.min(1, Math.max(0, v));
    g[i] = 255 * Math.pow(v, 0.85);     // un peu éclairci : la trame assombrit toujours
  }
  return g;
}

// Trame d'Atkinson : rendu net et lumineux, typique des écrans 1 bit
function atkinson(g, W, H) {
  const out = new Uint8Array(W * H);
  const e = Float32Array.from(g);
  const push = (x, y, v) => { if (x >= 0 && x < W && y < H) e[y * W + x] += v; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, old = e[i], nv = old < 128 ? 0 : 255;
    out[i] = nv ? 0 : 1;
    const err = (old - nv) / 8;
    push(x + 1, y, err); push(x + 2, y, err); push(x - 1, y + 1, err); push(x, y + 1, err); push(x + 1, y + 1, err); push(x, y + 2, err);
  }
  return out;
}

function pngBits(bits, W, H) {
  const buf = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) buf[i] = bits[i] ? 0 : 255;
  return PNG.sync.write({ width: W, height: H, data: buf }, { colorType: 0, inputColorType: 0, bitDepth: 8, inputHasAlpha: false });
}

export const PHOTO_SIZES = { l: [240, 120], s: [176, 88] };
export function processPhoto(buf) {
  const img = decode(buf);
  if (!img) return null;
  const g = toGray(img);
  const res = {};
  for (const [k, [W, H]] of Object.entries(PHOTO_SIZES)) {
    const r = skyLift(sharpen(levels(coverResize(g, img.w, img.h, W, H, 0.5)), W, H), W, H);
    res[k] = pngBits(atkinson(r, W, H), W, H);
  }
  return res;
}

async function fetchJson(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function fetchBuf(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  } catch { return null; }
}

/** Télécharge les photos manquantes (au plus `max` par passage, pour rester poli avec Wikimedia). */
export async function ensurePhotos(dataDir, codes, max = 4) {
  const dir = join(dataDir, "photos");
  mkdirSync(dir, { recursive: true });
  const idxFile = join(dir, "index.json");
  const idx = readJson(idxFile, {});
  const now = Date.now();
  // Pas de photo dans l'article : on réessaie dans 7 jours ; simple échec réseau : dans une heure
  const wait = e => (e.nophoto ? 7 * 86400e3 : 3600e3);
  const todo = [...new Set(codes)].filter(c => WIKI[c] && !idx[c]?.ok && !(idx[c] && now - idx[c].at < wait(idx[c]))).slice(0, max);
  if (todo.length) {
    const titles = todo.map(c => WIKI[c]);
    const j = await fetchJson("https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=thumbnail&pithumbsize=500&redirects=1&titles="
      + encodeURIComponent([...new Set(titles)].join("|")));
    const norm = {}; for (const n of j?.query?.normalized || []) norm[n.from] = n.to;
    const red = {}; for (const n of j?.query?.redirects || []) red[n.from] = n.to;
    const byTitle = {}; for (const p of Object.values(j?.query?.pages || {})) byTitle[p.title] = p;
    for (const c of todo) {
      let t = WIKI[c]; t = norm[t] || t; t = red[t] || t;
      const src = byTitle[t]?.thumbnail?.source;
      const buf = src ? await fetchBuf(src) : null;
      const ph = buf ? processPhoto(buf) : null;
      if (ph) {
        writeFileSync(join(dir, `${c}-l.png`), ph.l);
        writeFileSync(join(dir, `${c}-s.png`), ph.s);
        idx[c] = { ok: true, at: now, page: t };
      } else idx[c] = { ok: false, at: now, nophoto: !!j && !src };
      await new Promise(r => setTimeout(r, 400));
    }
  }
  writeFileSync(idxFile, JSON.stringify(idx));
  return idx;
}

// ---------------------------------------------------------------------------
// Statistiques cumulées (carnet.stats), mises à jour à chaque nouvel avion du jour
// ---------------------------------------------------------------------------
const SECTORS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const ALT_BANDS = [[0, 1500, "< 1,5"], [1500, 4000, "1,5 – 4"], [4000, 8000, "4 – 8"], [8000, 10500, "8 – 10,5"], [10500, 99999, "> 10,5"]];
const DOW = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

/** Première fois : on reconstitue ce qu'on peut à partir des journées déjà enregistrées. */
export function backfillStats(carnet) {
  if (carnet.stats || !carnet.days) return;
  const st = carnet.stats = { total: 0, daily: {}, dowh: Array.from({ length: 7 }, () => Array(24).fill(0)), heading: Array(8).fill(0),
    alt: Array(ALT_BANDS.length).fill(0), fam: {}, dest: {}, regs: {}, rec: {} };
  for (const [k, d] of Object.entries(carnet.days)) {
    st.total += d.count || 0;
    st.daily[k] = d.count || 0;
    const dow = (new Date(k + "T12:00:00Z").getUTCDay() + 6) % 7;
    (d.hours || []).forEach((v, h) => { st.dowh[dow][h] += v; });
    for (const hex of d.hexes || []) { const r = st.regs[hex] ||= { n: 0, type: "", airline: "" }; r.n++; r.last = k; }
  }
}

/** a : { hex, reg, flight, type, type_code, airline, airline_icao, to_city, to_cc, alt_m, speed_kmh, dist_km, track_deg, mil, route_km, from_city } */
export function recordSighting(carnet, a, ctx) {
  const st = carnet.stats ||= { total: 0, daily: {}, dowh: Array.from({ length: 7 }, () => Array(24).fill(0)), heading: Array(8).fill(0),
    alt: Array(ALT_BANDS.length).fill(0), fam: {}, dest: {}, regs: {}, rec: {} };
  st.total++;
  st.daily[ctx.day] = (st.daily[ctx.day] || 0) + 1;
  st.dowh[ctx.dow][ctx.hour]++;
  if (Number.isFinite(a.track_deg)) st.heading[Math.round(a.track_deg / 45) % 8]++;
  if (Number.isFinite(a.alt_m)) { const b = ALT_BANDS.findIndex(([lo, hi]) => a.alt_m >= lo && a.alt_m < hi); if (b >= 0) st.alt[b]++; }
  const f = family(a.type_code, a.mil);
  st.fam[f] = (st.fam[f] || 0) + 1;
  if (a.to_city) st.dest[a.to_city] = (st.dest[a.to_city] || 0) + 1;
  // Les « habitués » : appareils (immatriculations) qui repassent
  const id = a.hex;
  if (id) {
    const r = st.regs[id] ||= { n: 0 };
    r.n++; r.last = ctx.day;
    if (a.reg) r.reg = a.reg;
    if (a.type) r.type = a.type;
    if (a.airline) r.airline = a.airline;
    const ids = Object.keys(st.regs);
    if (ids.length > 6000) {      // on oublie les appareils vus une seule fois, les plus anciens d'abord
      for (const k of ids.filter(k => st.regs[k].n < 2).sort((x, y) => (st.regs[x].last || "").localeCompare(st.regs[y].last || "")).slice(0, 1500)) delete st.regs[k];
    }
  }
  // Records
  const label = [a.type, a.airline].filter(Boolean).join(" · ") || a.flight;
  const keep = (k, v, better, extra = {}) => {
    if (!Number.isFinite(v)) return;
    if (!st.rec[k] || better(v, st.rec[k].v)) st.rec[k] = { v, label, flight: a.flight, day: ctx.day, ...extra };
  };
  if (!a.on_ground) {
    keep("haut", a.alt_m, (x, y) => x > y);
    keep("rapide", a.speed_kmh, (x, y) => x > y);
    keep("pres", a.dist_km, (x, y) => x < y, { alt: a.alt_m });
    if (Number.isFinite(a.alt_m) && a.alt_m > 0) keep("bas", a.alt_m, (x, y) => x < y);
  }
  keep("loin", a.route_km, (x, y) => x > y, { txt: a.from_city && a.to_city ? `${a.from_city} → ${a.to_city}` : "" });
}

const fmtDay = (k, tz) => k ? new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(k + "T12:00:00Z")) : "";

export function buildStats(carnet, todayKey, logoIdxUrl) {
  const st = carnet?.stats;
  if (!st || !st.total) return null;
  const coll = carnet.coll || { types: {}, airlines: {}, countries: {} };
  const days = Object.keys(st.daily).sort();
  const nDays = Math.max(1, days.length);
  const bestDay = days.reduce((b, k) => (!b || st.daily[k] > st.daily[b] ? k : b), null);
  // Série de jours consécutifs avec au moins un survol (jusqu'à aujourd'hui)
  let streak = 0;
  for (let d = new Date(todayKey + "T12:00:00Z"); ; d.setUTCDate(d.getUTCDate() - 1)) {
    const k = d.toISOString().slice(0, 10);
    if (st.daily[k]) streak++; else if (k !== todayKey) break; else continue;
    if (streak > 3650) break;
  }
  const top = (obj, n, map) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(map);
  const airlinesN = Object.entries(coll.airlines).map(([k, v]) => [k, v.n || 1, v.name]).sort((a, b) => b[1] - a[1]);
  const typesN = Object.entries(coll.types).map(([k, v]) => [k, v.n || 1, v.name]).sort((a, b) => b[1] - a[1]);
  const maxA = Math.max(1, ...airlinesN.slice(0, 5).map(x => x[1]));
  const maxT = Math.max(1, ...typesN.slice(0, 5).map(x => x[1]));
  const destMax = Math.max(1, ...Object.values(st.dest));
  // Carte de chaleur jour de semaine × heure (cellules de 0 à 4)
  const hm = Math.max(1, ...st.dowh.flat());
  const heat = st.dowh.map((row, d) => ({ d: DOW[d], cells: row.map((v, h) => ({ h, v, l: v === 0 ? 0 : Math.min(4, 1 + Math.floor(v / hm * 3.999)) })) }));
  const busiest = (() => { let b = [0, 0, -1]; st.dowh.forEach((row, d) => row.forEach((v, h) => { if (v > b[2]) b = [d, h, v]; })); return b; })();
  const dowTot = st.dowh.map(r => r.reduce((s, v) => s + v, 0));
  const bestDow = dowTot.indexOf(Math.max(...dowTot));
  // Rose des caps (rayons en pourcentage du maximum)
  const hmax = Math.max(1, ...st.heading);
  const hsum = Math.max(1, st.heading.reduce((s, v) => s + v, 0));
  const rose = st.heading.map((v, i) => {
    const r = 8 + Math.round(v / hmax * 52), a = (i * 45 - 90) * Math.PI / 180, w = 18 * Math.PI / 180;
    const p = t => `${(70 + r * Math.cos(t)).toFixed(1)},${(70 + r * Math.sin(t)).toFixed(1)}`;
    return { dir: SECTORS[i], v, pct: Math.round(v / hsum * 100), path: `M70,70 L${p(a - w)} A${r},${r} 0 0,1 ${p(a + w)} Z` };
  });
  const topHead = rose.reduce((b, x) => (x.v > b.v ? x : b), rose[0]);
  const altMax = Math.max(1, ...st.alt);
  const altSum = Math.max(1, st.alt.reduce((s, v) => s + v, 0));
  const famSum = Math.max(1, Object.values(st.fam).reduce((s, v) => s + v, 0));
  const famMax = Math.max(1, ...Object.values(st.fam));
  const regs = Object.entries(st.regs).filter(([, r]) => r.n > 1).sort((a, b) => b[1].n - a[1].n);
  const rec = st.rec;
  const recTxt = [];
  if (rec.haut) recTxt.push({ k: "Le plus haut", v: `${thousands(rec.haut.v)} m`, sub: rec.haut.label, day: fmtDay(rec.haut.day) });
  if (rec.rapide) recTxt.push({ k: "Le plus rapide", v: `${thousands(rec.rapide.v)} km/h`, sub: rec.rapide.label, day: fmtDay(rec.rapide.day) });
  if (rec.pres) recTxt.push({ k: "Le plus proche", v: rec.pres.v < 1 ? `${Math.max(100, Math.round(rec.pres.v * 10) * 100)} m` : `${String(Math.round(rec.pres.v * 10) / 10).replace(".", ",")} km`, sub: rec.pres.label + (Number.isFinite(rec.pres.alt) ? ` à ${thousands(rec.pres.alt)} m` : ""), day: fmtDay(rec.pres.day) });
  if (rec.loin) recTxt.push({ k: "Le plus long trajet", v: `${thousands(rec.loin.v)} km`, sub: rec.loin.txt || rec.loin.label, day: fmtDay(rec.loin.day) });
  return {
    total: st.total, total_txt: thousands(st.total),
    days: nDays, avg_txt: String(Math.round(st.total / nDays * 10) / 10).replace(".", ","),
    best_day_n: bestDay ? st.daily[bestDay] : 0, best_day_txt: fmtDay(bestDay),
    streak,
    unique: Object.keys(st.regs).length, unique_txt: thousands(Object.keys(st.regs).length),
    regulars: regs.length,
    regular: regs[0] ? { id: regs[0][1].reg || regs[0][0].toUpperCase(), n: regs[0][1].n, sub: [regs[0][1].type, regs[0][1].airline].filter(Boolean).join(" · ") } : null,
    busiest_txt: busiest[2] > 0 ? `${["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"][busiest[0]]} vers ${busiest[1]} h` : "",
    best_dow_txt: dowTot[bestDow] ? ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"][bestDow] : "",
    records: recTxt,
    top_airlines: airlinesN.slice(0, 5).map(([k, n, name]) => ({ name, n, pct: Math.round(n / maxA * 100), logo: logoIdxUrl ? logoIdxUrl(k) : "" })),
    top_types: typesN.slice(0, 5).map(([k, n, name]) => ({ name, code: k, n, pct: Math.round(n / maxT * 100) })),
    top_dest: top(st.dest, 5, ([name, n]) => ({ name, n, pct: Math.round(n / destMax * 100) })),
    heat, heat_hours: [0, 6, 12, 18],
    dow: dowTot.map((n, d) => ({ d: DOW[d], n, pct: Math.round(n / Math.max(1, ...dowTot) * 100) })),
    since_txt: fmtDay(days[0]),
    rose, rose_top: topHead.v ? `${topHead.pct} % filent vers le ${topHead.dir}` : "",
    alt: ALT_BANDS.map(([, , label], i) => ({ label, n: st.alt[i], pct: Math.round(st.alt[i] / altMax * 100), share: Math.round(st.alt[i] / altSum * 100) })),
    fam: FAMILIES.filter(([k]) => st.fam[k]).map(([k, label]) => ({ k, label, n: st.fam[k], share: Math.round(st.fam[k] / famSum * 100), pct: Math.round(st.fam[k] / famMax * 100) })),
    collection_txt: `${typesN.length} modèles · ${airlinesN.length} compagnies · ${Object.keys(coll.countries).length} pays`
  };
}

/** Cartes de la collection, triées par nombre de survols (les 60 premières). */
export function buildCollection(carnet, todayKey, photoIdx, base, rareTypes, totalTypes) {
  const types = carnet?.coll?.types || {};
  const list = Object.entries(types).map(([code, v]) => ({
    code, name: v.name || code, maker: maker(code), n: v.n || 1,
    first_txt: fmtDay(v.first), last_txt: fmtDay(v.last || v.first),
    is_new: v.first === todayKey, rare: !!rareTypes[code],
    photo_l: photoIdx?.[code]?.ok ? `${base}/photos/${code}-l.png` : "",
    photo_s: photoIdx?.[code]?.ok ? `${base}/photos/${code}-s.png` : ""
  })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const total = list.reduce((s, c) => s + c.n, 0);
  list.forEach((c, i) => { c.rank = i + 1; c.share = Math.max(1, Math.round(c.n / Math.max(1, total) * 100)); });
  const newest = Object.entries(types).sort((a, b) => (b[1].first || "").localeCompare(a[1].first || ""))[0];
  return {
    count: list.length, total_types: totalTypes, pct: Math.min(100, Math.round(list.length / Math.max(1, totalTypes) * 100)),
    sightings: total, sightings_txt: thousands(total),
    newest: newest ? { name: newest[1].name, day: fmtDay(newest[1].first) } : null,
    cards: list.slice(0, 60)
  };
}
