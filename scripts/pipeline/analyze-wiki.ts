import * as cheerio from "cheerio";

async function analyze() {
  const response = await fetch("https://en.wikipedia.org/wiki/Prominent_individuals_mentioned_in_the_Epstein_files");
  const html = await response.text();
  const $ = cheerio.load(html);

  const tables = $("table.wikitable");
  console.log("Number of wikitables:", tables.length);

  tables.each((i, t) => {
    const rows = $(t).find("tr");
    console.log(`\nTable ${i} - total rows: ${rows.length}`);
    rows.slice(0, 5).each((j, r) => {
      const tds = $(r).find("td");
      const ths = $(r).find("th");
      console.log(`  Row ${j} - td: ${tds.length}, th: ${ths.length}`);
      if (tds.length >= 1) {
        const firstCellText = $(tds[0]).text().trim().substring(0, 80);
        console.log(`    Cell 0 text: "${firstCellText}"`);
        const links = $(tds[0]).find("a");
        links.each((k, a) => {
          console.log(`    Link ${k}: "${$(a).text().trim()}" -> ${$(a).attr("href")}`);
        });
      }
    });
  });

  const mainTable = tables.first();
  const allRows = mainTable.find("tr");
  console.log(`\n--- All rows in main table (${allRows.length} total) ---`);
  
  const names: string[] = [];
  allRows.each((i, row) => {
    const tds = $(row).find("td");
    if (tds.length >= 2) {
      const nameCell = $(tds[0]);
      const nameLinks = nameCell.find("a");
      let name = "";
      if (nameLinks.length > 0) {
        name = nameLinks.first().text().trim();
      }
      if (!name) {
        name = nameCell.text().trim().split("\n")[0];
      }
      name = name.replace(/\[.*?\]/g, "").trim();
      if (name && name.length > 2) {
        names.push(name);
      }
    }
  });

  console.log(`Found ${names.length} names from main table:`);
  names.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));

  const allTableData: string[] = [];
  $("table").each((i, t) => {
    $(t).find("tr").each((j, r) => {
      const tds = $(r).find("td");
      if (tds.length >= 2) {
        const first = $(tds[0]).find("a").first().text().trim() || $(tds[0]).text().trim().split("\n")[0];
        if (first && first.length > 2 && first.length < 60) {
          const clean = first.replace(/\[.*?\]/g, "").trim();
          if (!allTableData.includes(clean)) allTableData.push(clean);
        }
      }
    });
  });

  console.log(`\nAll unique names from all tables: ${allTableData.length}`);
}

analyze().catch(console.error);
