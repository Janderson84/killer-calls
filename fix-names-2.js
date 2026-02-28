#!/usr/bin/env node
require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const AE_NAMES = [
  "Pedro Cavagnari", "Edgar Arana", "Marc James Beauchamp",
  "Zachary Obando", "Alfred Du", "Vanessa Fortune",
  "Marysol Ortega", "Gleidson Rocha", "David Morawietz",
];

// Also match partial / variant names
const AE_VARIANTS = {
  "Gleidson Rocha Da Silva": "Gleidson Rocha",
  "Gleidson Rocha da Silva": "Gleidson Rocha",
};

async function fix() {
  const { rows } = await pool.query(
    "SELECT id, rep_name, company_name FROM scorecards WHERE rep_name NOT IN ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    AE_NAMES
  );
  console.log("Fixing", rows.length, "remaining records...\n");
  let fixed = 0;

  for (const row of rows) {
    const combined = row.company_name || "";

    // Find which AE name appears in the company_name field
    let foundRep = null;
    for (const name of AE_NAMES) {
      if (combined.toLowerCase().includes(name.toLowerCase())) {
        foundRep = name;
        break;
      }
    }
    if (!foundRep) {
      for (const [variant, canonical] of Object.entries(AE_VARIANTS)) {
        if (combined.toLowerCase().includes(variant.toLowerCase())) {
          foundRep = canonical;
          break;
        }
      }
    }

    if (!foundRep) {
      console.log("  SKIP (no AE found):", row.rep_name, "|", row.company_name);
      continue;
    }

    // Extract prospect by removing AE name
    const parts = combined.split(/\s+and\s+/i);
    let prospect = combined;
    if (parts.length === 2) {
      const a = parts[0].trim();
      const b = parts[1].trim();
      const aIsRep = a.toLowerCase().includes(foundRep.split(" ")[0].toLowerCase());
      prospect = aIsRep ? b : a;
    }

    await pool.query("UPDATE scorecards SET rep_name = $1, company_name = $2 WHERE id = $3", [foundRep, prospect, row.id]);
    console.log(`  ${row.rep_name} => ${foundRep}  |  ${row.company_name} => ${prospect}`);
    fixed++;
  }

  console.log("\nFixed", fixed, "of", rows.length);
  await pool.end();
}

fix();
