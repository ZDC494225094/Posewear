#!/usr/bin/env node
// Parse-check every JavaScript file in server/, scripts/, test/ and public/.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules" && entry.name !== "fonts") walk(full); }
    else if (entry.name.endsWith(".js")) files.push(full);
  }
};
for (const dir of ["server", "scripts", "test", "public"]) walk(path.join(root, dir));

let failed = 0;
for (const file of files) {
  try { execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }); }
  catch (err) { failed += 1; console.error(`✗ ${path.relative(root, file)}\n${err.stderr}`); }
}
console.log(`${files.length - failed}/${files.length} files OK`);
process.exit(failed ? 1 : 0);
