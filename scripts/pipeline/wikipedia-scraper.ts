import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const PERSONS_FILE = path.join(DATA_DIR, "persons-raw.json");

const WIKIPEDIA_URL = "https://en.wikipedia.org/wiki/Prominent_individuals_mentioned_in_the_Epstein_files";
const EPSTEIN_FILES_URL = "https://en.wikipedia.org/wiki/Epstein_files";

export interface RawPerson {
  name: string;
  description: string;
  category: string;
  occupation: string;
  nationality: string;
  status: string;
  role: string;
  aliases: string[];
  source: string;
  wikiUrl?: string;
}

function categorizeByOccupation(text: string, name: string): { category: string; occupation: string } {
  const lower = text.toLowerCase();

  if (/president|prime minister|governor|senator|secretary|congressman|representative|parliament|chancellor|minister(?! of music)/i.test(lower)) {
    return { category: "political", occupation: extractOccupation(text, "Politician") };
  }
  if (/king|queen|prince|princess|duke|duchess|royal/i.test(lower)) {
    return { category: "political", occupation: extractOccupation(text, "Royalty") };
  }
  if (/attorney|lawyer|judge|prosecutor|legal counsel|law professor/i.test(lower)) {
    return { category: "legal", occupation: extractOccupation(text, "Attorney") };
  }
  if (/victim|accuser|survivor|traffick|recruit|minor|abuse/i.test(lower)) {
    return { category: "victim", occupation: extractOccupation(text, "Victim/Witness") };
  }
  if (/co-?conspirator|convicted|guilty|trafficking|procur/i.test(lower)) {
    return { category: "key figure", occupation: extractOccupation(text, "Co-conspirator") };
  }
  if (/financier|banker|investor|hedge fund|ceo|founder|business|billionaire|executive|entrepreneur/i.test(lower)) {
    return { category: "associate", occupation: extractOccupation(text, "Business Executive") };
  }
  if (/actor|actress|director|filmmaker|musician|singer|entertainer|magician|comedian|model|fashion/i.test(lower)) {
    return { category: "associate", occupation: extractOccupation(text, "Entertainment") };
  }
  if (/professor|scientist|researcher|academic|university|college|phd|doctor|physician|medical/i.test(lower)) {
    return { category: "associate", occupation: extractOccupation(text, "Academic/Scientist") };
  }
  if (/journalist|reporter|editor|media|publisher|news/i.test(lower)) {
    return { category: "associate", occupation: extractOccupation(text, "Media") };
  }
  if (/pilot|assistant|employee|staff|butler|maid|housekeeper/i.test(lower)) {
    return { category: "associate", occupation: extractOccupation(text, "Employee/Staff") };
  }

  return { category: "associate", occupation: extractOccupation(text, "Named Individual") };
}

function extractOccupation(text: string, fallback: string): string {
  const patterns = [
    /(?:is|was|the)\s+([\w\s]+?)\s+(?:and|who|that|,)/i,
    /(?:former|ex-)?\s*(president|prime minister|governor|senator|ceo|founder|director|professor|attorney|lawyer|actor|actress|journalist)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const occ = match[1].trim();
      if (occ.length > 3 && occ.length < 60) return occ;
    }
  }

  return fallback;
}

function determineStatus(text: string): string {
  const lower = text.toLowerCase();
  if (/deceased|found dead|died|death/i.test(lower)) return "deceased";
  if (/convicted|guilty|sentenced|prison/i.test(lower)) return "convicted";
  if (/victim|accuser|survivor/i.test(lower)) return "victim";
  if (/denied|denies/i.test(lower)) return "named";
  return "named";
}

function determineRole(text: string): string {
  const lower = text.toLowerCase();
  if (/co-?conspirator|convicted|trafficking/i.test(lower)) return "Co-conspirator";
  if (/victim|accuser|survivor|recruited|trafficked/i.test(lower)) return "Victim / Witness";
  if (/employee|assistant|staff|butler/i.test(lower)) return "Employee / Associate";
  if (/attorney|lawyer|legal counsel|defense team/i.test(lower)) return "Legal counsel";
  if (/business|financial|investor|client/i.test(lower)) return "Business associate";
  return "Named individual";
}

function extractNationality(text: string): string {
  const nationalities = [
    "American", "British", "French", "Israeli", "Indian", "Norwegian",
    "Spanish", "German", "Canadian", "Australian", "Swedish", "Dutch",
    "Italian", "Japanese", "Chinese", "Russian", "Brazilian", "Mexican",
    "Turkish", "Polish", "Slovakian", "Czech", "South African", "Irish",
    "Swiss", "Austrian", "Danish", "Belgian", "Finnish", "Portuguese",
    "Greek", "Lithuanian", "Emirati", "Saudi", "Qatari",
  ];

  for (const nat of nationalities) {
    if (text.includes(nat)) return nat;
  }
  return "Unknown";
}

async function fetchWikipediaPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "EpsteinFilesExplorer/1.0 (research project; contact@example.com)",
      "Accept": "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Wikipedia: ${response.status}`);
  }

  return await response.text();
}

function parseWikipediaTable(html: string): RawPerson[] {
  const $ = cheerio.load(html);
  const persons: RawPerson[] = [];
  const seen = new Set<string>();

  $("table.wikitable tbody tr").each((_i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;

    const nameCell = $(cells[0]);
    const infoCell = $(cells[1]);

    let name = "";
    let wikiHref = "";
    const allLinks = nameCell.find("a");
    allLinks.each((_k, link) => {
      const linkText = $(link).text().trim();
      const href = $(link).attr("href") || "";
      if (linkText.length > 1 && href.startsWith("/wiki/") && !href.includes("File:")) {
        name = linkText;
        wikiHref = href;
      }
    });
    if (!name) {
      name = nameCell.text().trim().replace(/\n/g, " ").split(/\s{2,}/)[0].trim();
    }

    if (!name || name.length < 2) return;

    name = name.replace(/\[.*?\]/g, "").trim();

    if (seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());

    const description = infoCell.text().trim()
      .replace(/\[.*?\]/g, "")
      .replace(/\s+/g, " ")
      .substring(0, 1500);

    const wikiUrl = wikiHref && !wikiHref.includes("redlink")
      ? `https://en.wikipedia.org${wikiHref}`
      : undefined;

    const { category, occupation } = categorizeByOccupation(description, name);
    const status = determineStatus(description);
    const role = determineRole(description);
    const nationality = extractNationality(description);

    persons.push({
      name,
      description: description.substring(0, 800),
      category,
      occupation,
      nationality,
      status,
      role,
      aliases: [],
      source: "wikipedia",
      wikiUrl,
    });
  });

  return persons;
}

function parseWikipediaSections(html: string): RawPerson[] {
  const $ = cheerio.load(html);
  const persons: RawPerson[] = [];
  const seen = new Set<string>();

  $("h2, h3").each((_i, heading) => {
    const sectionTitle = $(heading).text().replace(/\[edit\]/g, "").trim();

    let el = $(heading).next();
    while (el.length && !el.is("h2") && !el.is("h3")) {
      if (el.is("ul, ol")) {
        el.find("li").each((_j, li) => {
          const text = $(li).text().trim();
          const link = $(li).find("a").first();
          const name = link.length ? link.text().trim() : "";

          if (name && name.length > 2 && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            const desc = text.replace(/\[.*?\]/g, "").replace(/\s+/g, " ");
            const { category, occupation } = categorizeByOccupation(desc, name);

            persons.push({
              name: name.replace(/\[.*?\]/g, "").trim(),
              description: desc.substring(0, 800),
              category,
              occupation,
              nationality: extractNationality(desc),
              status: determineStatus(desc),
              role: determineRole(desc),
              aliases: [],
              source: "wikipedia",
            });
          }
        });
      }
      el = el.next();
    }
  });

  return persons;
}

export async function scrapeWikipediaPersons(): Promise<RawPerson[]> {
  console.log("\n=== Wikipedia Epstein Files Person Scraper ===\n");

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log("Fetching Wikipedia: Prominent individuals mentioned in the Epstein files...");
  const html = await fetchWikipediaPage(WIKIPEDIA_URL);
  console.log(`  Fetched ${(html.length / 1024).toFixed(0)} KB of HTML`);

  console.log("Parsing individuals table...");
  const tablePersons = parseWikipediaTable(html);
  console.log(`  Found ${tablePersons.length} individuals from table`);

  const sectionPersons = parseWikipediaSections(html);
  console.log(`  Found ${sectionPersons.length} individuals from sections`);

  const allNames = new Set(tablePersons.map(p => p.name.toLowerCase()));
  const combined = [...tablePersons];
  for (const p of sectionPersons) {
    if (!allNames.has(p.name.toLowerCase())) {
      combined.push(p);
      allNames.add(p.name.toLowerCase());
    }
  }

  console.log(`\nTotal unique individuals: ${combined.length}`);

  const byCategory: Record<string, number> = {};
  for (const p of combined) {
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
  }
  console.log("By category:", byCategory);

  fs.writeFileSync(PERSONS_FILE, JSON.stringify(combined, null, 2));
  console.log(`\nSaved to ${PERSONS_FILE}`);

  return combined;
}

if (process.argv[1]?.includes(path.basename(__filename))) {
  scrapeWikipediaPersons().catch(console.error);
}
