// Géocodage inverse hors ligne : « qu'est-ce que l'avion survole ? »
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GEO = join(dirname(fileURLToPath(import.meta.url)), "..", "geo");
let C, S, V;
function load() {
  if (C) return;
  C = JSON.parse(readFileSync(join(GEO, "countries.json"), "utf8"));
  S = JSON.parse(readFileSync(join(GEO, "seas.json"), "utf8"));
  V = JSON.parse(readFileSync(join(GEO, "cities.json"), "utf8"));
  for (const f of [...C, ...S]) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const poly of f.p) for (const [x, y] of poly[0]) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
    f.bb = [a, b, c, d];
    f.area = (c - a) * (d - b);
  }
}
function inRing(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inFeature(x, y, f) {
  const [a, b, c, d] = f.bb;
  if (x < a || x > c || y < b || y > d) return false;
  for (const poly of f.p) {
    if (!inRing(x, y, poly[0])) continue;
    if (poly.slice(1).some(h => inRing(x, y, h))) continue;
    return true;
  }
  return false;
}
function km(lat1, lon1, lat2, lon2) {
  const R = 6371, t = Math.PI / 180;
  const h = Math.sin((lat2 - lat1) * t / 2) ** 2 + Math.cos(lat1 * t) * Math.cos(lat2 * t) * Math.sin((lon2 - lon1) * t / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Renvoie { kind: "terre" | "mer" | "inconnu", place, country, txt } */
export function overflown(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { kind: "inconnu", txt: "" };
  try { load(); } catch { return { kind: "inconnu", txt: "" }; }
  const country = C.find(f => inFeature(lon, lat, f));
  if (country) {
    let best = null, bd = Infinity;
    for (const v of V) {
      if (Math.abs(v[1] - lat) > 0.7 || Math.abs(v[2] - lon) > 1) continue;
      const d = km(lat, lon, v[1], v[2]);
      // une grande ville proche l'emporte sur un village à peine plus près
      const score = d - Math.min(8, Math.log10(Math.max(v[3], 1000)) * 2);
      if (score < bd) { bd = score; best = { v, d }; }
    }
    if (best && best.d <= 15) return { kind: "terre", place: best.v[0], country: country.n, txt: `${best.v[0]}, ${country.n}` };
    if (best && best.d <= 45) return { kind: "terre", place: best.v[0], country: country.n, txt: `Près de ${best.v[0]}, ${country.n}` };
    return { kind: "terre", country: country.n, txt: country.n };
  }
  const seas = S.filter(f => inFeature(lon, lat, f)).sort((a, b) => a.area - b.area);
  if (seas.length) return { kind: "mer", place: seas[0].n, txt: seas[0].n };
  // Hors des polygones nommés : la mer nommée la plus proche (sommets à moins de ~400 km)
  let near = null, nd = Infinity;
  for (const f of S) for (const poly of f.p) for (const [x, y] of poly[0]) {
    if (Math.abs(y - lat) > 4 || Math.abs(x - lon) > 6) continue;
    const d = km(lat, lon, y, x);
    if (d < nd) { nd = d; near = f; }
  }
  if (near && nd < 400) return { kind: "mer", place: near.n, txt: near.n };
  return { kind: "mer", txt: "Haute mer" };
}
