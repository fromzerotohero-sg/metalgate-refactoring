const fs = require("fs");
const path = require("path");

const i18n = fs.readFileSync("src/lib/i18n.tsx", "utf8");
const blocks = {};
for (const loc of ["it", "en", "es"]) {
  const m = i18n.match(new RegExp(`const ${loc}: Dict = \\{([\\s\\S]*?)\\n\\};`));
  blocks[loc] = m ? [...m[1].matchAll(/"([^"]+)":/g)].map((x) => x[1]) : [];
}
console.log("chiavi: it=" + blocks.it.length, "en=" + blocks.en.length, "es=" + blocks.es.length);
const missEn = blocks.it.filter((k) => !blocks.en.includes(k));
const missEs = blocks.it.filter((k) => !blocks.es.includes(k));
console.log("mancano in en:", missEn.length ? missEn.join(", ") : "nessuna");
console.log("mancano in es:", missEs.length ? missEs.join(", ") : "nessuna");

// chiavi t() usate nel codice
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}
const used = new Set();
for (const file of [...walk("app"), ...walk("src")]) {
  if (file.endsWith("i18n.tsx") || file.endsWith("legal.tsx")) continue;
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/\bt\("([^"]+)"\)/g)) used.add(m[1]);
  // template keys tipo t(`platform.${k}.name`)
  for (const m of src.matchAll(/\bt\(`([^`]+)`\)/g)) {
    const tpl = m[1];
    if (tpl.includes("platform.${platform.key}")) {
      for (const p of ["efootball", "arena", "league"]) for (const suf of ["name", "desc", "tags"]) used.add(`platform.${p}.${suf}`);
    } else if (tpl.includes("home.step${step}")) {
      for (const s of [1, 2, 3]) { used.add(`home.step${s}t`); used.add(`home.step${s}d`); }
    } else if (tpl.includes("register.step${step}")) {
      for (const s of [1, 2, 3]) { used.add(`register.step${s}t`); used.add(`register.step${s}d`); }
    } else if (tpl.includes("section.${section}")) {
      for (const s of ["profile", "subscription", "security", "transactions"]) for (const suf of ["eyebrow", "title", "intro"]) used.add(`section.${s}.${suf}`);
    }
  }
}
const missing = [...used].filter((k) => !blocks.it.includes(k));
console.log("chiavi usate nel codice:", used.size);
console.log("usate ma mancanti nei dizionari:", missing.length ? missing.join(", ") : "nessuna");
const unused = blocks.it.filter((k) => !used.has(k));
console.log("definite ma mai usate:", unused.length ? unused.join(", ") : "nessuna");
