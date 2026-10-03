// Genera lib/engine/config.generated.json a partir de backend/config/radar.yaml (única fuente de verdad de umbrales y pesos).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../backend/config/radar.yaml");
const out = resolve(here, "../lib/engine/config.generated.json");
writeFileSync(out, JSON.stringify(parse(readFileSync(src, "utf8")), null, 2) + "\n");
console.log("config generada:", out);
