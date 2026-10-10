// Prépare les données géographiques hors ligne utilisées pour « Survole … » :
//   geo/countries.json  pays (Natural Earth 1:50m, noms français)
//   geo/seas.json       mers et océans (Natural Earth 1:50m, noms français)
//   geo/cities.json     villes (GeoNames : > 5 000 hab. dans le monde, > 1 000 hab. en France)
// À relancer seulement pour rafraîchir ces données (workflow « Préparer les données géographiques »).

import { writeFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "geo");
mkdirSync(OUT, { recursive: true });
const TMP = mkdtempSync(join(tmpdir(), "geo-"));
const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";

async function download(url, file) {
  const r = await fetch(url, { headers: { "User-Agent": "trmnl-radar-ciel" } });
  if (!r.ok) throw new Error(`${url} : HTTP ${r.status}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}
const r3 = x => Math.round(x * 1000) / 1000;
function ring(coords) {
  const out = [];
  for (const [x, y] of coords) {
    const p = [r3(x), r3(y)];
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  return out;
}
function polys(geom) {
  if (!geom) return [];
  const list = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  return list.map(p => p.map(ring));
}
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// Pays
const countries = JSON.parse(readFileSync(await download(`${NE}/ne_50m_admin_0_countries.geojson`, join(TMP, "c.json")), "utf8"));
const C = countries.features.map(f => ({
  n: cap(f.properties.NAME_FR || f.properties.NAME),
  cc: f.properties.ISO_A2_EH || f.properties.ISO_A2,
  p: polys(f.geometry)
}));
writeFileSync(join(OUT, "countries.json"), JSON.stringify(C));

// Mers et océans
const seas = JSON.parse(readFileSync(await download(`${NE}/ne_50m_geography_marine_polys.geojson`, join(TMP, "s.json")), "utf8"));
const S = seas.features.map(f => ({ n: cap(f.properties.name_fr || f.properties.name), p: polys(f.geometry) }));
writeFileSync(join(OUT, "seas.json"), JSON.stringify(S));

// Villes
function readCities(zipName, keep) {
  const zip = join(TMP, zipName);
  execFileSync("unzip", ["-o", "-q", zip, "-d", TMP]);
  const txt = readFileSync(join(TMP, zipName.replace(".zip", ".txt")), "utf8");
  const rows = [];
  for (const line of txt.split("\n")) {
    const c = line.split("\t");
    if (c.length < 15) continue;
    if (!keep(c)) continue;
    rows.push([c[1], r3(+c[4]), r3(+c[5]), +c[14] || 0, c[8]]);
  }
  return rows;
}
await download("https://download.geonames.org/export/dump/cities5000.zip", join(TMP, "cities5000.zip"));
await download("https://download.geonames.org/export/dump/cities1000.zip", join(TMP, "cities1000.zip"));
const world = readCities("cities5000.zip", () => true);
const france = readCities("cities1000.zip", c => c[8] === "FR" && (+c[14] || 0) < 5000);
const cities = world.concat(france);
writeFileSync(join(OUT, "cities.json"), JSON.stringify(cities));

console.log(`Pays : ${C.length} · mers : ${S.length} · villes : ${cities.length}`);
