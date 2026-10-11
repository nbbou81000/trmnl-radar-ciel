// Radar du ciel — collecte les avions autour de chez soi (adsb.lol)
// et les routes (adsbdb.com), puis écrit flights.json pour le TRMNL.
//
// Variables d'environnement :
//   DATA_DIR      dossier où lire/écrire flights.json, cache.json, track.json
//   ACTION        "actualiser" (défaut) | "suivre" | "arreter" | "oublier" | "zoom"
//   ZOOM          "+1", "-1" ou "auto" pour ACTION=zoom (s'applique à la carte du mode en cours)
//   TRACK_QUERY   vol à suivre (AF6125, AFR6125 ou F-HPNA) pour ACTION=suivre
//   TRACK_UNTIL   date de fin facultative (AAAA-MM-JJ) pour ACTION=suivre

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TYPES } from "./types.mjs";
import { overflown } from "./geo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8"));
const DATA_DIR = process.env.DATA_DIR || join(ROOT, "data");
const ACTION = (process.env.ACTION || "actualiser").toLowerCase();
const TZ = CONFIG.fuseau || "Europe/Paris";
const NOW = new Date();
const UA = "trmnl-radar-ciel (github.com/nbbou81000)";

const ROUTE_TTL_MS = 12 * 3600e3;        // une route est revérifiée toutes les 12 h
const TRACK_MAX_MS = 48 * 3600e3;        // un suivi sans date de fin s'arrête après 48 h
const LANDED_KEEP_MS = 45 * 60e3;        // on garde l'écran « atterri » 45 min
const FT_TO_M = 0.3048, KT_TO_KMH = 1.852, FPM_TO_MS = 0.00508, NM_TO_KM = 1.852;

mkdirSync(DATA_DIR, { recursive: true });
const readJson = (f, d) => { try { return JSON.parse(readFileSync(join(DATA_DIR, f), "utf8")); } catch { return d; } };
const writeJson = (f, o) => writeFileSync(join(DATA_DIR, f), JSON.stringify(o, null, 1) + "\n");

const cache = readJson("cache.json", { routes: {}, aircraft: {} });
cache.routes ||= {}; cache.aircraft ||= {};
let track = readJson("track.json", null);
let history = readJson("history.json", []);
// Réglage du zoom des cartes (télécommande) : décalage par rapport au cadrage automatique
const prefs = Object.assign({ zoom_zone: 0, zoom_suivi: 0 }, readJson("prefs.json", {}) || {});
if (!Array.isArray(history)) history = [];
const normQ = q => String(q || "").toUpperCase().replace(/[\s-]/g, "");

// ---------- utilitaires ----------
async function getJson(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) { console.warn(`Échec ${url} : ${e.message}`); return undefined; }
      await new Promise(res => setTimeout(res, 1500));
    }
  }
}
const hm = d => (d instanceof Date && !isNaN(d)) ? new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d) : "";
const thousands = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const ascii = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, t = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * t / 2) ** 2 + Math.cos(lat1 * t) * Math.cos(lat2 * t) * Math.sin((lon2 - lon1) * t / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const cleanCity = s => String(s || "").split(/[\/,]/)[0].trim();
// Nom de ville court et lisible : « Frankfurt am Main » → « Frankfurt », « Lanzarote Island » → « Lanzarote »,
// « Palma De Mallorca » → « Palma de Mallorca »
const tidyCity = s => cleanCity(s)
  .replace(/\s+(am|an der|im|ob der|upon|on)\s+\S.*$/i, "")
  .replace(/\s+(Island|Islands|City)$/i, "")
  .replace(/(\S\s)(De|Del|Da|Do|Di|Dos|La|Le|Les|Du|Des|Of)(?=\s)/g, (m, a, b) => a + b.toLowerCase())
  .trim();

// ---------- routes et appareils (adsbdb, avec cache) ----------
async function lookupRoute(callsign) {
  if (!callsign) return null;
  const c = cache.routes[callsign];
  if (c && NOW - new Date(c.at) < ROUTE_TTL_MS) return c.route;
  const j = await getJson(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`);
  if (j === undefined) return c ? c.route : null;   // API en panne : on garde l'ancien
  const fr = j?.response?.flightroute;
  const route = fr ? {
    callsign_icao: fr.callsign_icao || fr.callsign,
    callsign_iata: fr.callsign_iata && fr.airline?.iata && fr.callsign_iata.startsWith(fr.airline.iata) ? fr.callsign_iata : null,
    airline: fr.airline?.name || null,
    from: fr.origin?.iata_code || fr.origin?.icao_code || null,
    from_city: cleanCity(fr.origin?.municipality) || fr.origin?.name || null,
    from_name: fr.origin?.name || null,
    from_icao: fr.origin?.icao_code || null, from_cc: fr.origin?.country_iso_name || null,
    to_icao: fr.destination?.icao_code || null, to_cc: fr.destination?.country_iso_name || null,
    airline_icao: fr.airline?.icao || null, airline_cc: fr.airline?.country_iso || null,
    from_lat: fr.origin?.latitude, from_lon: fr.origin?.longitude,
    to: fr.destination?.iata_code || fr.destination?.icao_code || null,
    to_city: cleanCity(fr.destination?.municipality) || fr.destination?.name || null,
    to_name: fr.destination?.name || null,
    to_lat: fr.destination?.latitude, to_lon: fr.destination?.longitude
  } : null;
  cache.routes[callsign] = { at: NOW.toISOString(), route };
  return route;
}
async function lookupAircraft(hex) {
  if (!hex || hex.startsWith("~")) return null;
  const c = cache.aircraft[hex];
  if (c === null || (c && c.v === 2)) return c;
  const j = await getJson(`https://api.adsbdb.com/v0/aircraft/${hex}`);
  if (j === undefined) return c || null;
  const a = j?.response?.aircraft;
  const info = a ? {
    v: 2, owner: a.registered_owner || null, maker: a.manufacturer || null, model: a.type || null,
    owner_cc: a.registered_owner_country_iso_name || null,
    photo: a.url_photo || null, photo_thumb: a.url_photo_thumbnail || null
  } : null;
  cache.aircraft[hex] = info;
  return info;
}

// ---------- libellés ----------
const regionFr = (() => { try { return new Intl.DisplayNames(["fr"], { type: "region" }); } catch { return null; } })();
const countryFr = cc => { if (!cc) return ""; try { return regionFr?.of(cc.toUpperCase()) || cc; } catch { return cc; } };
const CATEGORIES = { A1: "Avion léger", A2: "Petit avion", A3: "Avion de ligne moyen", A4: "Gros porteur (B757)", A5: "Gros porteur",
  A6: "Haute performance", A7: "Hélicoptère", B1: "Planeur", B2: "Ballon / dirigeable", B4: "ULM", B6: "Drone", C1: "Véhicule d'urgence", C2: "Véhicule de service" };
const SQUAWKS = { "7500": "détournement", "7600": "panne radio", "7700": "urgence" };
const dur = min => { if (!Number.isFinite(min) || min < 0) return ""; const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`; };
const cardinal = deg => ["N", "NE", "E", "SE", "S", "SO", "O", "NO"][Math.round(((deg % 360) + 360) % 360 / 45) % 8];

// ---------- mise en forme d'un avion ----------
async function describe(ac) {
  const callsign = (ac.flight || "").trim() || null;
  const route = callsign ? await lookupRoute(callsign) : null;
  const owner = await lookupAircraft(ac.hex);
  const onGround = ac.alt_baro === "ground";
  const altFt = onGround ? 0 : (typeof ac.alt_baro === "number" ? ac.alt_baro : ac.alt_geom);
  const alt = Number.isFinite(altFt) ? altFt * FT_TO_M : null;
  const spd = Number.isFinite(ac.gs) ? ac.gs * KT_TO_KMH : null;
  const rateFpm = Number.isFinite(ac.baro_rate) ? ac.baro_rate : ac.geom_rate;
  let vr = Number.isFinite(rateFpm) ? rateFpm * FPM_TO_MS : null;
  if (vr !== null && Math.abs(vr) < 1) vr = 0;                 // palier
  const isRegCallsign = callsign && ac.r && callsign === ac.r.replace(/-/g, "");
  const flight = route?.callsign_iata || (isRegCallsign ? ac.r : callsign) || ac.r || ac.hex.toUpperCase();
  const ownerName = owner?.owner && /^private$/i.test(owner.owner) ? "Privé" : owner?.owner;
  const typeCode = ac.t || "";
  const freshPos = Number.isFinite(ac.lat) && Number.isFinite(ac.lon);
  const lastPos = !freshPos && ac.lastPosition && Number.isFinite(ac.lastPosition.lat) && Number.isFinite(ac.lastPosition.lon) ? ac.lastPosition : null;
  const vrTxt = vr === null ? "-" : vr > 0 ? `+${Math.round(vr)}` : vr < 0 ? `${Math.round(vr)}` : "0";
  const o = {
    flight,
    callsign: callsign || "",
    reg: ac.r || "",
    airline: route?.airline || ownerName || (isRegCallsign ? "Privé" : ""),
    type: TYPES[typeCode] || typeCode || "",
    type_code: typeCode,
    from: route?.from || "", to: route?.to || "",
    from_city: tidyCity(route?.from_city), to_city: tidyCity(route?.to_city),
    has_route: !!(route?.from && route?.to),
    on_ground: onGround,
    alt_m: alt === null ? null : Math.round(alt),
    alt_txt: alt === null ? "-" : thousands(alt),
    speed_kmh: spd === null ? null : Math.round(spd),
    speed_txt: spd === null ? "-" : String(Math.round(spd)),
    track_deg: Number.isFinite(ac.track) ? Math.round(ac.track) % 360 : null,
    track_txt: Number.isFinite(ac.track) ? String(Math.round(ac.track) % 360).padStart(3, "0") : "-",
    vr_ms: vr === null ? null : Math.round(vr),
    vr_txt: vrTxt,
    vr_dir: vr === null ? "inconnu" : vr > 0 ? "montee" : vr < 0 ? "descente" : "palier",
    // Sans position récente, adsb.lol ne donne plus lat/lon mais une « lastPosition »
    lat: freshPos ? ac.lat : lastPos ? lastPos.lat : null,
    lon: freshPos ? ac.lon : lastPos ? lastPos.lon : null,
    pos_age_s: freshPos ? (Number(ac.seen_pos) || 0) : lastPos ? (Number(lastPos.seen_pos) || 0) : null,
    _route: route, _ac: ac, _owner: owner
  };
  return o;
}

// Ligne de 28 caractères pour le style flip-flap : VOL DE VERS ALT KMH CAP
function flapZone(f) {
  const fl = ascii(f.flight).slice(0, 6).padEnd(7);
  const from = ascii(f.from || "---").slice(0, 3).padEnd(3);
  const to = ascii(f.to || "---").slice(0, 3).padEnd(3);
  const alt = (f.alt_m === null ? "-" : String(f.alt_m)).slice(0, 5).padStart(5);
  const spd = (f.speed_kmh === null ? "-" : String(f.speed_kmh)).slice(0, 4).padStart(4);
  const cap = (f.track_deg === null ? "-" : String(f.track_deg).padStart(3, "0")).padStart(3);
  return `${fl}${from} ${to} ${alt}${spd} ${cap}`;
}
// Version courte (20 caractères) pour les vues étroites : VOL DE VERS ALT
const flapZoneShort = f => flapZone(f).slice(0, 20);
const flapLine = (s, w = 20) => ascii(s).slice(0, w).padEnd(w);
const fitWords = (s, w) => { const a = ascii(s); if (a.length <= w) return a; const cut = a.slice(0, w + 1).lastIndexOf(" "); return cut > 2 ? a.slice(0, cut) : a.slice(0, w); };

// ---------- mode zone ----------
async function zone() {
  const radiusNm = Math.max(1, Math.round(CONFIG.rayon_km / NM_TO_KM));
  const j = await getJson(`https://api.adsb.lol/v2/point/${CONFIG.latitude}/${CONFIG.longitude}/${radiusNm}`, 3);
  if (!j) return { ok: false };
  const list = (j.ac || [])
    .filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lon))
    .filter(a => CONFIG.inclure_au_sol || a.alt_baro !== "ground")
    .map(a => ({ a, d: haversine(CONFIG.latitude, CONFIG.longitude, a.lat, a.lon) }))
    .filter(x => x.d <= CONFIG.rayon_km)
    .sort((x, y) => x.d - y.d);
  const flights = [];
  for (const { a, d } of list.slice(0, CONFIG.vols_max)) {
    const f = await describe(a);
    f.dist_km = Math.round(d);
    f.flap = flapZone(f);
    f.flap_short = flapZoneShort(f);
    delete f._route; delete f._ac; delete f._owner;
    flights.push(f);
  }
  return { ok: true, total: list.length, flights };
}

// ---------- mode suivi ----------
async function findTracked(query) {
  const q = query.toUpperCase().replace(/\s+/g, "");
  const tryAc = async url => { const r = await getJson(url); return r?.ac?.[0] || null; };
  let route = null, ac = null;
  const looksReg = q.includes("-") || /^N\d/.test(q);
  if (looksReg) ac = await tryAc(`https://api.adsb.lol/v2/reg/${encodeURIComponent(q)}`);
  if (!ac) {
    route = await lookupRoute(q);
    const cs = route?.callsign_icao || q;
    ac = await tryAc(`https://api.adsb.lol/v2/callsign/${encodeURIComponent(cs)}`);
    if (!ac && cs !== q) ac = await tryAc(`https://api.adsb.lol/v2/callsign/${encodeURIComponent(q)}`);
  }
  if (!ac && !looksReg) ac = await tryAc(`https://api.adsb.lol/v2/reg/${encodeURIComponent(q)}`);
  return { ac, route };
}

// Arc de grand cercle entre deux points, en [lon, lat] (longitudes « déroulées » pour MapLibre)
function greatCircle(a, b, n = 40) {
  const t = Math.PI / 180, R2D = 180 / Math.PI;
  const [lat1, lon1, lat2, lon2] = [a.lat * t, a.lon * t, b.lat * t, b.lon * t];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2));
  if (!(d > 1e-6)) return [[a.lon, a.lat], [b.lon, b.lat]];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([Math.atan2(y, x) * R2D, Math.atan2(z, Math.sqrt(x * x + y * y)) * R2D]);
  }
  return pts;
}
function unwrap(pts) {
  const out = [];
  for (const [x, y] of pts) {
    let lon = x;
    const prev = out[out.length - 1];
    if (prev) while (lon - prev[0] > 180) lon -= 360;
    if (prev) while (prev[0] - lon > 180) lon += 360;
    out.push([Math.round(lon * 1000) / 1000, Math.round(y * 1000) / 1000]);
  }
  return out;
}
const js = v => JSON.stringify(v);
function gcPoint(a, b, frac) {
  if (frac <= 0) return { lat: a.lat, lon: a.lon };
  const t = Math.PI / 180, R2D = 180 / Math.PI;
  const [lat1, lon1, lat2, lon2] = [a.lat * t, a.lon * t, b.lat * t, b.lon * t];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2));
  if (!(d > 1e-9)) return { lat: a.lat, lon: a.lon };
  const f = Math.min(1, frac), A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  return { lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * R2D, lon: Math.atan2(y, x) * R2D };
}
function bearing(a, b) {
  const t = Math.PI / 180, la1 = a.lat * t, la2 = b.lat * t, dl = (b.lon - a.lon) * t;
  const y = Math.sin(dl) * Math.cos(la2), x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  return Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360);
}
const okPt = p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

async function trackScreen() {
  const { ac, route: r0 } = await findTracked(track.query);
  let f = null, route = r0;
  if (ac) {
    f = await describe(ac);
    route = f._route || route;
    delete f._route;
  }
  const t = {
    query: track.query.toUpperCase(),
    flight: f?.flight || route?.callsign_iata || track.query.toUpperCase(),
    airline: f?.airline || route?.airline || "",
    type: f?.type || track.last?.type || "", reg: f?.reg || track.last?.reg || "",
    from: route?.from || "", to: route?.to || "",
    from_city: tidyCity(route?.from_city), to_city: tidyCity(route?.to_city),
    has_route: !!(route?.from && route?.to),
    until: track.until || ""
  };

  // La trace ne garde que des points valides (corrige les traits vers 0°/0°)
  track.trail = (track.trail || []).filter(okPt);
  const okRoute = t.has_route && [route.from_lat, route.from_lon, route.to_lat, route.to_lon].every(Number.isFinite);
  const A = okRoute ? { lat: route.from_lat, lon: route.from_lon } : null;
  const B = okRoute ? { lat: route.to_lat, lon: route.to_lon } : null;
  const hasFix = !!f && Number.isFinite(f.lat) && Number.isFinite(f.lon);
  const freshFix = hasFix && (f.pos_age_s ?? 0) <= 120;

  let status;
  if (f && !f.on_ground) { status = freshFix ? "en_vol" : "signal_perdu"; track.seen_airborne = true; track.landed_at = null; }
  else if (f && f.on_ground) status = track.seen_airborne ? "atterri" : "au_sol";
  else status = track.seen_airborne ? "signal_perdu" : "attente";

  // Dernière position réelle connue (même ancienne), et dernière vitesse fiable
  if (hasFix && !f.on_ground) {
    const at = new Date(NOW.getTime() - (f.pos_age_s || 0) * 1000);
    if (!track.fix || at > new Date(track.fix.at)) track.fix = { lat: f.lat, lon: f.lon, at: at.toISOString() };
  }
  if (!track.fix && track.last && Number.isFinite(track.last.lat) && Number.isFinite(track.last.lon) && track.last.seen)
    track.fix = { lat: track.last.lat, lon: track.last.lon, at: track.last.seen };
  if (f && !f.on_ground && Number.isFinite(f.speed_kmh) && f.speed_kmh > 150) track.speed_kmh = f.speed_kmh;
  if (f && !f.on_ground && Number.isFinite(f.alt_m) && f.alt_m > 0) track.alt_m = f.alt_m;

  // Progression
  let pos = freshFix ? { lat: f.lat, lon: f.lon } : (f && f.on_ground && hasFix) ? { lat: f.lat, lon: f.lon } : track.fix ? { lat: track.fix.lat, lon: track.fix.lon } : null;
  let estimated = false;
  // Signal perdu (océan, zone sans récepteur) : on estime la position sur la route,
  // à partir de la dernière position réelle, de la dernière vitesse et du temps écoulé.
  if (status === "signal_perdu" && track.fix && B) {
    const remLast = haversine(track.fix.lat, track.fix.lon, B.lat, B.lon);
    const sp = track.speed_kmh || 820;
    const hours = Math.max(0, (NOW - new Date(track.fix.at)) / 3600e3);
    if (remLast < 40) status = "atterri";
    else if (sp * hours < remLast - 25) {
      pos = gcPoint(track.fix, B, (sp * hours) / remLast); estimated = true; status = "estime";
    } else {
      const landingAt = new Date(track.fix.at).getTime() + (remLast / sp) * 3600e3 + 10 * 60e3;
      if (NOW.getTime() > landingAt + 20 * 60e3) { status = "arrivee_probable"; pos = { lat: B.lat, lon: B.lon }; }
      else { pos = gcPoint(track.fix, B, (remLast - 25) / remLast); estimated = true; status = "estime"; }
    }
  }
  let pct = null, remaining = null, eta = null;
  if (okRoute && pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lon)) {
    const done = haversine(route.from_lat, route.from_lon, pos.lat, pos.lon);
    const rem = haversine(pos.lat, pos.lon, route.to_lat, route.to_lon);
    pct = Math.max(0, Math.min(100, Math.round(100 * done / (done + rem || 1))));
    remaining = Math.round(rem);
    // Route connue mais avion loin du trajet direct : la route d'adsbdb est sans doute périmée
    const total = haversine(route.from_lat, route.from_lon, route.to_lat, route.to_lon);
    t.route_doubt = status === "en_vol" && done + rem > total * 1.35 + 150;
    if (status === "signal_perdu" && rem < 40) status = "atterri";
    if (status === "en_vol" && f.speed_kmh > 150) eta = hm(new Date(NOW.getTime() + (rem / f.speed_kmh) * 3600e3 + 8 * 60e3));
    if (status === "estime") eta = hm(new Date(NOW.getTime() + (rem / (track.speed_kmh || 820)) * 3600e3 + 8 * 60e3));
  }
  if (status === "atterri" || status === "arrivee_probable") { pct = 100; remaining = 0; track.landed_at ||= NOW.toISOString(); }
  if (status === "au_sol" && pct === null) pct = 0;

  const labels = { en_vol: "En vol", au_sol: "Au sol", atterri: "Atterri", signal_perdu: "Signal perdu", attente: "Pas encore détecté",
    estime: "Position estimée", arrivee_probable: "Arrivée probable" };
  const flapStatus = { en_vol: "EN VOL", au_sol: "AU SOL", atterri: "ATTERRI", signal_perdu: "SANS SIGNAL", attente: "EN ATTENTE", estime: "ESTIME", arrivee_probable: "ARRIVE" };
  Object.assign(t, {
    status, status_txt: labels[status],
    progress_pct: pct, progress_txt: pct === null ? "-" : `${pct} %`,
    remaining_km: remaining, remaining_txt: remaining === null ? "-" : thousands(remaining),
    eta_txt: eta || "",
    alt_txt: f && !f.on_ground && Number.isFinite(f.alt_m) ? f.alt_txt : (status === "estime" && track.alt_m ? `≈ ${thousands(track.alt_m)}` : "-"),
    speed_txt: f && Number.isFinite(f.speed_kmh) ? f.speed_txt : (status === "estime" && track.speed_kmh ? `≈ ${Math.round(track.speed_kmh)}` : "-"),
    track_txt: f ? f.track_txt : "-", vr_txt: f && !f.on_ground ? f.vr_txt : "-", vr_dir: f ? f.vr_dir : "inconnu",
    last_seen_txt: freshFix ? hm(NOW) : track.fix ? hm(new Date(track.fix.at)) : "",
    pos_estimated: estimated,
    fix_txt: track.fix ? hm(new Date(track.fix.at)) : "",
    // segments pour la barre en points (style LED) : 30 pas
    progress_steps: pct === null ? 0 : Math.round(pct * 30 / 100)
  });
  // Ce que l'avion survole (seulement en vol ou au dernier point connu)
  const over = (status === "en_vol" || status === "signal_perdu" || status === "estime") && pos ? overflown(pos.lat, pos.lon) : { kind: "inconnu", txt: "" };
  t.over_txt = over.txt || "";
  t.over_kind = over.kind;

  t.flap = [
    flapLine(`${t.flight} ${flapStatus[status] || ""}`),
    flapLine(`DE   ${t.from || "---"} ${fitWords(t.from_city, 11)}`),
    flapLine(`VERS ${t.to || "---"} ${fitWords(t.to_city, 11)}`),
    flapLine(t.over_txt ? `SUR ${fitWords(t.over_txt.replace(/^Près de /, "").replace(/,.*$/, ""), 16)}` : ""),
    flapLine((status === "en_vol" || (status === "estime" && f && Number.isFinite(f.alt_m))) ? `ALT ${f.alt_m}M ${f.speed_kmh}KMH` : t.type || ""),
    flapLine(pct === null ? "" : `${pct}% RESTE ${remaining}KM`),
    flapLine(eta ? `ARRIVEE VERS ${eta}` : status === "atterri" ? "BIENVENUE" : "")
  ];

  // Trace réellement parcourue (un point par actualisation)
  track.trail ||= [];
  if (freshFix && !f.on_ground) {
    const p = [Math.round(f.lon * 1000) / 1000, Math.round(f.lat * 1000) / 1000];
    const q = track.trail[track.trail.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) track.trail.push(p);
    if (track.trail.length > 400) track.trail = track.trail.filter((_, i) => i % 2 === 0);
  }

  // Données de la carte
  let done = [], est = [], todo = [];
  const trail = track.trail.map(([lon, lat]) => [lon, lat]);
  if (status === "attente" || status === "au_sol") {
    if (A && B) todo = greatCircle(A, B, 60);
  } else {
    const realEnd = estimated ? track.fix : pos;
    const first = trail[0] ? { lon: trail[0][0], lat: trail[0][1] } : realEnd;
    if (A && first) done = greatCircle(A, first, 20).concat(trail.slice(1));
    else done = trail.slice();
    if (realEnd && done.length) done.push([realEnd.lon, realEnd.lat]);
    if (estimated) est = greatCircle(track.fix, pos, 16);
    if (B && pos && status !== "atterri" && status !== "arrivee_probable") todo = greatCircle(pos, B, 40);
  }
  const all = unwrap(done.concat(est, todo)).filter(okPt);
  const nD = done.length, nE = est.length;
  const doneU = all.slice(0, nD), estU = nE ? all.slice(Math.max(0, nD - 1), nD + nE) : [], todoU = all.slice(Math.max(0, nD + nE - 1));
  t.map_done_js = js(doneU.length > 1 ? doneU : []);
  t.map_est_js = js(estU.length > 1 ? estU : []);
  t.map_todo_js = js(todoU.length > 1 ? (nD + nE ? todoU : all) : []);
  t.map_estimated = estimated;
  const posU = pos && status !== "attente" && status !== "au_sol"
    ? (estimated ? (estU[estU.length - 1] || [pos.lon, pos.lat]) : status === "arrivee_probable" ? (all[all.length - 1] || [pos.lon, pos.lat]) : (doneU[doneU.length - 1] || [pos.lon, pos.lat]))
    : null;
  t.map_pos_js = js(posU);
  const fromU = A ? (all[0] || [A.lon, A.lat]) : null;
  const toU = B ? (all[all.length - 1] || [B.lon, B.lat]) : null;
  t.map_from_js = js(fromU);
  t.map_to_js = js(toU);
  t.map_heading = !estimated && f && Number.isFinite(f.track_deg) ? f.track_deg : (pos && B ? bearing(pos, B) : (f && Number.isFinite(f.track_deg) ? f.track_deg : 0));
  t.has_map = !!(posU || (fromU && toU));

  // Cadrage : près d'un aéroport (montée après décollage, approche, au sol),
  // la carte zoome sur l'avion et l'aéroport au lieu de montrer tout le trajet.
  const altM = f && !f.on_ground ? f.alt_m : null;
  const dFrom = A && pos ? haversine(A.lat, A.lon, pos.lat, pos.lon) : Infinity;
  const dTo = B && pos ? haversine(B.lat, B.lon, pos.lat, pos.lon) : Infinity;
  let focus = "trajet", focusPts = null;
  if ((status === "atterri" || status === "arrivee_probable") && toU) { focus = "arrivee"; focusPts = [toU]; }
  else if (status === "au_sol" && fromU) { focus = "depart"; focusPts = [fromU]; }
  else if (posU && (status === "en_vol" || status === "estime")) {
    const low = altM !== null && altM < 3500;
    if (dTo < 120 || (low && dTo <= dFrom)) { focus = "arrivee"; focusPts = toU ? [posU, toU] : [posU]; }
    else if (dFrom < 100 || (low && dFrom < dTo)) { focus = "depart"; focusPts = fromU ? [posU, fromU] : [posU]; }
  }
  t.map_focus = focus;
  t.map_focus_js = js(focusPts);
  t.map_focus_txt = focus === "arrivee" ? (status === "atterri" || status === "arrivee_probable" ? "À l'arrivée" : estimated ? "En approche (estimée)" : "En approche") : focus === "depart" ? (status === "au_sol" ? "Au départ" : "Après le décollage") : "";

  // Fiche détaillée
  // Heure de décollage estimée : à la première détection en vol, on retranche
  // le temps qu'il a fallu pour parcourir la distance déjà faite.
  if (status === "en_vol" && !track.airborne_since) {
    const doneKm = A && pos ? haversine(A.lat, A.lon, pos.lat, pos.lon) : 0;
    const back = doneKm > 30 ? (doneKm / Math.max(f.speed_kmh || 0, 400)) * 60 + 10 : 0;
    track.airborne_since = new Date(NOW.getTime() - back * 60e3).toISOString();
  }
  const raw = f?._ac || null, own = f?._owner || track.last?.owner || null;
  const dTotal = A && B ? haversine(A.lat, A.lon, B.lat, B.lon) : null;
  const elapsed = track.airborne_since ? (NOW - new Date(track.airborne_since)) / 60e3 : null;
  const spNow = status === "en_vol" ? f.speed_kmh : status === "estime" ? (track.speed_kmh || 820) : null;
  const remainMin = spNow > 150 && remaining !== null ? remaining / spNow * 60 + 8 : null;
  let wind = "", windEffect = "";
  if (raw && Number.isFinite(raw.wd) && Number.isFinite(raw.ws) && Number.isFinite(raw.track)) {
    const wsK = Math.round(raw.ws * KT_TO_KMH);
    wind = `${wsK} km/h du ${cardinal(raw.wd)}`;
    const comp = Math.round(-raw.ws * KT_TO_KMH * Math.cos((raw.wd - raw.track) * Math.PI / 180));
    windEffect = comp > 5 ? `vent arrière ${comp} km/h` : comp < -5 ? `vent de face ${-comp} km/h` : "vent de travers";
  }
  const squawk = raw?.squawk || "";
  t.d = {
    airline: t.airline, airline_country: countryFr(route?.airline_cc),
    flight_iata: route?.callsign_iata || "", callsign: f?.callsign || route?.callsign_icao || "",
    from_name: route?.from_name || "", from_country: countryFr(route?.from_cc), from_icao: route?.from_icao || "",
    to_name: route?.to_name || "", to_country: countryFr(route?.to_cc), to_icao: route?.to_icao || "",
    dist_total_txt: dTotal ? thousands(dTotal) : "",
    elapsed_txt: status === "en_vol" || status === "signal_perdu" || status === "estime" ? dur(Math.max(elapsed, 1)) : "",
    takeoff_txt: track.airborne_since ? hm(new Date(track.airborne_since)) : "",
    remaining_time_txt: remainMin ? dur(remainMin) : "",
    model: own?.maker && own?.model ? `${own.maker} ${own.model}` : (t.type || ""),
    type_name: t.type, type_code: f?.type_code || "",
    reg: t.reg, hex: raw?.hex ? raw.hex.toUpperCase() : "",
    owner: own?.owner && !/^private$/i.test(own.owner) ? own.owner : (own?.owner ? "Privé" : ""),
    owner_country: countryFr(own?.owner_cc),
    category: raw?.category ? (CATEGORIES[raw.category] || raw.category) : "",
    photo: own?.photo || own?.photo_thumb || "",
    tas_txt: Number.isFinite(raw?.tas) ? String(Math.round(raw.tas * KT_TO_KMH)) : "",
    mach_txt: Number.isFinite(raw?.mach) ? raw.mach.toFixed(2).replace(".", ",") : "",
    oat_txt: Number.isFinite(raw?.oat) ? `${Math.round(raw.oat)} °C` : "",
    wind_txt: wind, wind_effect_txt: windEffect,
    alt_sel_txt: Number.isFinite(raw?.nav_altitude_mcp) ? thousands(raw.nav_altitude_mcp * FT_TO_M) : "",
    squawk_txt: squawk ? `${squawk}${SQUAWKS[squawk] ? ` (${SQUAWKS[squawk]})` : ""}` : "",
    emergency: !!(SQUAWKS[squawk] || (raw?.emergency && raw.emergency !== "none"))
  };
  if (f) { delete f._ac; delete f._owner; }

  track.summary = { flight: t.flight, from: t.from, to: t.to, from_city: t.from_city, to_city: t.to_city, status_txt: t.status_txt };
  if (f) track.last = { lat: hasFix ? f.lat : track.last?.lat ?? null, lon: hasFix ? f.lon : track.last?.lon ?? null, seen: NOW.toISOString(), type: f.type, reg: f.reg, owner: own };
  return t;
}

function isExpired(tr) {
  if (!tr) return false;
  if (tr.until) {
    const end = new Date(`${tr.until}T23:59:59`);
    if (NOW > end) return true;
  } else if (NOW - new Date(tr.started_at) > TRACK_MAX_MS) return true;
  if (tr.landed_at && NOW - new Date(tr.landed_at) > LANDED_KEEP_MS) return true;
  return false;
}
const trackExpired = () => isExpired(track);
// Met de côté un suivi interrompu avant son terme, pour pouvoir le reprendre
function shelve(tr) {
  if (!tr || tr.landed_at) return;
  history = history.filter(h => normQ(h.query) !== normQ(tr.query));
  history.unshift(tr);
  history = history.slice(0, 8);
}

// ---------- programme principal ----------
if (ACTION === "suivre") {
  const q = (process.env.TRACK_QUERY || "").trim();
  if (!q) { console.error("Indique un vol à suivre."); process.exit(1); }
  const until = (process.env.TRACK_UNTIL || "").trim();
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) { console.error("Date de fin au format AAAA-MM-JJ."); process.exit(1); }
  if (track && normQ(track.query) !== normQ(q)) shelve(track);
  const saved = history.find(h => normQ(h.query) === normQ(q));
  history = history.filter(h => normQ(h.query) !== normQ(q));
  if (track && normQ(track.query) === normQ(q)) { if (until) track.until = until; }
  else if (saved) { track = saved; if (until) track.until = until; }
  else { track = { query: q, until: until || null, started_at: NOW.toISOString(), seen_airborne: false, landed_at: null, last: null, trail: [] }; prefs.zoom_suivi = 0; }
  console.log(`Suivi ${saved ? "repris" : "démarré"} : ${q}${track.until ? ` jusqu'au ${track.until}` : ""}`);
} else if (ACTION === "arreter") {
  shelve(track);
  track = null;
  console.log("Suivi arrêté (gardé dans l'historique s'il n'est pas terminé).");
} else if (ACTION === "zoom") {
  const z = String(process.env.ZOOM || "auto").trim().toLowerCase();
  const key = track ? "zoom_suivi" : "zoom_zone";
  if (z === "auto" || z === "0") prefs[key] = 0;
  else if (/^[+-]\d+$/.test(z)) prefs[key] = Math.max(-5, Math.min(6, (prefs[key] || 0) + parseInt(z, 10)));
  console.log(`Zoom ${track ? "du suivi" : "au-dessus de chez moi"} : ${prefs[key] === 0 ? "automatique" : (prefs[key] > 0 ? "+" : "") + prefs[key]}`);
} else if (ACTION === "oublier") {
  const q = (process.env.TRACK_QUERY || "").trim();
  history = history.filter(h => normQ(h.query) !== normQ(q));
  console.log(`Retiré de l'historique : ${q}`);
}
history = history.filter(h => !isExpired(h) && !h.landed_at);
if (trackExpired()) { console.log(`Fin du suivi de ${track.query}.`); track = null; }

const dateFr = iso => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const out = {
  history: history.map(h => ({
    query: h.query, flight: h.summary?.flight || h.query.toUpperCase(),
    from: h.summary?.from || "", to: h.summary?.to || "", from_city: h.summary?.from_city || "", to_city: h.summary?.to_city || "",
    status_txt: h.summary?.status_txt || "", started_txt: dateFr(h.started_at), until: h.until || ""
  })),
  updated_at: NOW.toISOString(),
  updated_txt: hm(NOW),
  place: CONFIG.lieu, place_short: CONFIG.lieu_court || CONFIG.lieu,
  radius_km: CONFIG.rayon_km,
  home_lat: CONFIG.latitude, home_lon: CONFIG.longitude,
  mode: track ? "suivi" : "zone",
  map_zoom: track ? (prefs.zoom_suivi || 0) : (prefs.zoom_zone || 0)
};

if (track) {
  out.track = await trackScreen();
} else {
  const z = await zone();
  if (!z.ok) {
    // adsb.lol injoignable : on garde l'écran précédent plutôt qu'un écran vide
    const prev = readJson("flights.json", null);
    if (prev && prev.mode === "zone") {
      prev.stale = true;
      writeJson("flights.json", prev);
      console.log("adsb.lol injoignable : écran précédent conservé.");
      process.exit(0);
    }
    out.flights = []; out.total = 0; out.error = "Données indisponibles";
  } else {
    out.flights = z.flights; out.total = z.total;
  }
  out.count = out.flights.length;
  out.nearest = out.flights[0] || null;
  // Données de la carte du mode zone
  out.map_flights_js = js(out.flights.map((f, i) => [Math.round(f.lon * 1e4) / 1e4, Math.round(f.lat * 1e4) / 1e4, f.track_deg || 0, i + 1]));
  const circle = [];
  for (let i = 0; i <= 72; i++) {
    const b = i * 5 * Math.PI / 180, d = CONFIG.rayon_km / 6371, la = CONFIG.latitude * Math.PI / 180, lo = CONFIG.longitude * Math.PI / 180;
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    circle.push([Math.round(lo2 * 180 / Math.PI * 1e4) / 1e4, Math.round(la2 * 180 / Math.PI * 1e4) / 1e4]);
  }
  out.map_circle_js = js(circle);
}

// Nettoyage du cache (routes vues il y a plus de 3 jours)
for (const [k, v] of Object.entries(cache.routes)) if (NOW - new Date(v.at) > 3 * 86400e3) delete cache.routes[k];
const hexes = Object.keys(cache.aircraft);
if (hexes.length > 5000) for (const h of hexes.slice(0, hexes.length - 5000)) delete cache.aircraft[h];

writeJson("flights.json", out);
writeJson("cache.json", cache);
if (track) writeJson("track.json", track); else writeJson("track.json", null);
writeJson("history.json", history);
writeJson("prefs.json", prefs);
console.log(out.mode === "suivi"
  ? `Suivi ${out.track.flight} : ${out.track.status_txt} (${out.track.progress_txt})`
  : `${out.count} vol(s) affiché(s) sur ${out.total} dans ${CONFIG.rayon_km} km`);
