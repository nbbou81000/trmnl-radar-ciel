// Génère les quatre gabarits TRMNL à partir de body.liquid.
// Les fichiers générés sont déjà dans le dossier trmnl/ : rien à relancer tant que body.liquid ne change pas.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const body = readFileSync(join(here, "body.liquid"), "utf8");
const sizes = {
  full: { n: 5, narrow: false, short: false },
  half_horizontal: { n: 2, narrow: false, short: true },
  half_vertical: { n: 4, narrow: true, short: false },
  quadrant: { n: 1, narrow: true, short: true }
};
for (const [name, o] of Object.entries(sizes)) {
  const head = `{%- comment -%} Radar du ciel — vue ${name} (généré, ne pas modifier : voir trmnl/src) {%- endcomment -%}\n` +
    `{%- assign sz = "${name}" -%}{%- assign n = ${o.n} -%}{%- assign narrow = ${o.narrow} -%}{%- assign short = ${o.short} -%}\n`;
  writeFileSync(join(here, "..", `${name}.liquid`), head + body);
}
console.log("Gabarits générés :", Object.keys(sizes).join(", "));
