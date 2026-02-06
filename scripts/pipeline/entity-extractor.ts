import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { ExtractedDocument } from "./pdf-processor";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const EXTRACTED_DIR = path.join(DATA_DIR, "extracted");
const ENTITIES_FILE = path.join(DATA_DIR, "entities.json");

export interface ExtractedEntity {
  name: string;
  type: "person" | "organization" | "location" | "date" | "document";
  mentions: number;
  contexts: string[];
  sourceFiles: string[];
  confidence: number;
}

export interface ExtractedRelationship {
  person1: string;
  person2: string;
  type: string;
  context: string;
  sourceFile: string;
}

export interface EntityExtractionResult {
  persons: ExtractedEntity[];
  organizations: ExtractedEntity[];
  locations: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  processedFiles: number;
  extractedAt: string;
}

const KNOWN_PERSONS = new Set([
  "jeffrey epstein", "ghislaine maxwell", "virginia giuffre", "virginia roberts",
  "prince andrew", "bill clinton", "donald trump", "alan dershowitz",
  "jean-luc brunel", "sarah kellen", "les wexner", "alexander acosta",
  "kevin spacey", "david copperfield", "nadia marcinkova", "johanna sjoberg",
  "bill richardson", "george mitchell", "adriana ross", "lesley groff",
  "steve bannon", "elon musk", "bill gates", "jeff bezos", "richard branson",
  "howard lutnick", "peter attia", "woody allen", "ehud barak", "noam chomsky",
  "katie couric", "martha stewart", "eva andersson-dubin", "larry summers",
  "peter mandelson", "sarah ferguson", "bret ratner", "dan ariely",
  "joscha bach", "leon black", "reid hoffman", "sergey brin", "mark zuckerberg",
  "naomi campbell", "chris tucker", "tom barrack", "lex wexner",
  "marvin minsky", "lawrence krauss", "stephen hawking", "leon botstein",
  "anil ambani", "jose maria aznar", "steve tisch", "glenn dubin",
]);

const TITLE_PATTERNS = [
  /(?:President|Senator|Governor|Secretary|Ambassador|Justice|Judge|Director|Professor|Dr\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g,
  /(?:Mr\.|Mrs\.|Ms\.|Miss)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g,
  /(?:Prince|Princess|King|Queen|Duke|Duchess|Lord|Lady)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
];

const NAME_PATTERN = /\b([A-Z][a-z]{1,20}(?:\s+(?:[A-Z]\.?\s+)?[A-Z][a-z]{1,20}){1,3})\b/g;

const FALSE_POSITIVES = new Set([
  "the united", "the department", "the court", "the state", "the southern",
  "the northern", "the eastern", "the western", "new york", "palm beach",
  "the federal", "the district", "united states", "the bureau", "the office",
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "data set", "page count", "file name", "the fbi", "the doj",
]);

function extractPersonNames(text: string, fileName: string): Map<string, ExtractedEntity> {
  const entities = new Map<string, ExtractedEntity>();

  for (const knownName of KNOWN_PERSONS) {
    const regex = new RegExp(`\\b${escapeRegex(knownName)}\\b`, "gi");
    const matches = text.match(regex);
    if (matches && matches.length > 0) {
      const key = knownName.toLowerCase();
      if (!entities.has(key)) {
        entities.set(key, {
          name: properCase(knownName),
          type: "person",
          mentions: 0,
          contexts: [],
          sourceFiles: [],
          confidence: 0.95,
        });
      }
      const entity = entities.get(key)!;
      entity.mentions += matches.length;
      if (!entity.sourceFiles.includes(fileName)) {
        entity.sourceFiles.push(fileName);
      }

      const contextMatches = text.matchAll(new RegExp(`.{0,100}${escapeRegex(knownName)}.{0,100}`, "gi"));
      for (const m of contextMatches) {
        if (entity.contexts.length < 5) {
          entity.contexts.push(m[0].trim());
        }
      }
    }
  }

  for (const pattern of TITLE_PATTERNS) {
    const titlePattern = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = titlePattern.exec(text)) !== null) {
      const name = match[1] || match[0];
      const key = name.toLowerCase();

      if (FALSE_POSITIVES.has(key) || name.length < 4) continue;

      if (!entities.has(key)) {
        entities.set(key, {
          name,
          type: "person",
          mentions: 0,
          contexts: [],
          sourceFiles: [],
          confidence: 0.8,
        });
      }
      const entity = entities.get(key)!;
      entity.mentions++;
      if (!entity.sourceFiles.includes(fileName)) {
        entity.sourceFiles.push(fileName);
      }
    }
  }

  let nameMatch;
  const nameRegex = new RegExp(NAME_PATTERN.source, NAME_PATTERN.flags);
  while ((nameMatch = nameRegex.exec(text)) !== null) {
    const name = nameMatch[1];
    const key = name.toLowerCase();

    if (FALSE_POSITIVES.has(key) || name.length < 5) continue;
    if (entities.has(key)) continue;

    const words = name.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;

    const isMostlyCapitalized = words.every(w => /^[A-Z]/.test(w));
    if (!isMostlyCapitalized) continue;

    const occurrences = (text.match(new RegExp(escapeRegex(name), "g")) || []).length;
    if (occurrences < 2) continue;

    entities.set(key, {
      name,
      type: "person",
      mentions: occurrences,
      contexts: [],
      sourceFiles: [fileName],
      confidence: 0.5 + Math.min(occurrences * 0.05, 0.3),
    });
  }

  return entities;
}

function extractRelationships(text: string, persons: Map<string, ExtractedEntity>, fileName: string): ExtractedRelationship[] {
  const relationships: ExtractedRelationship[] = [];
  const personNames = Array.from(persons.keys());
  const RELATIONSHIP_PATTERNS = [
    { pattern: /(\w+)\s+(?:and|with|&)\s+(\w+)/gi, type: "associated" },
    { pattern: /(\w+)\s+(?:met|visited|dined|traveled)\s+(?:with\s+)?(\w+)/gi, type: "social contact" },
    { pattern: /(\w+)\s+(?:employed|hired|worked for|assisted)\s+(\w+)/gi, type: "employment" },
    { pattern: /(\w+)\s+(?:represented|defended|counseled)\s+(\w+)/gi, type: "legal" },
    { pattern: /(\w+)\s+(?:flew|traveled|accompanied)\s+(\w+)/gi, type: "travel" },
  ];

  const sentences = text.split(/[.!?]+/).filter(s => s.length > 20);

  for (const sentence of sentences) {
    const namesInSentence: string[] = [];
    for (const name of personNames) {
      if (sentence.toLowerCase().includes(name)) {
        namesInSentence.push(name);
      }
    }

    if (namesInSentence.length >= 2) {
      for (let i = 0; i < namesInSentence.length - 1; i++) {
        for (let j = i + 1; j < namesInSentence.length; j++) {
          const type = inferRelationshipType(sentence);
          relationships.push({
            person1: properCase(namesInSentence[i]),
            person2: properCase(namesInSentence[j]),
            type,
            context: sentence.trim().substring(0, 300),
            sourceFile: fileName,
          });
        }
      }
    }
  }

  return relationships;
}

function inferRelationshipType(sentence: string): string {
  const lower = sentence.toLowerCase();
  if (/employ|assistant|work\s+for|staff|hired/i.test(lower)) return "employment";
  if (/attorney|lawyer|counsel|defense|represent/i.test(lower)) return "legal counsel";
  if (/flew|flight|travel|passenger|aircraft|plane/i.test(lower)) return "travel";
  if (/email|wrote|message|correspond|letter/i.test(lower)) return "correspondence";
  if (/photo|image|picture|pictured/i.test(lower)) return "photographed together";
  if (/victim|accuse|assault|abuse|traffick/i.test(lower)) return "victim testimony";
  if (/business|invest|financ|fund|money|payment/i.test(lower)) return "financial";
  if (/dinner|party|social|event|gathering|visit/i.test(lower)) return "social connection";
  return "associated";
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function properCase(str: string): string {
  return str.split(/\s+/).map(w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(" ");
}

export async function extractEntities(options: {
  inputDir?: string;
  minMentions?: number;
  minConfidence?: number;
}): Promise<EntityExtractionResult> {
  console.log("\n=== Entity Extractor ===\n");

  const {
    inputDir = EXTRACTED_DIR,
    minMentions = 2,
    minConfidence = 0.5,
  } = options;

  const allPersons = new Map<string, ExtractedEntity>();
  const allRelationships: ExtractedRelationship[] = [];
  let processedFiles = 0;

  function processDir(dir: string) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        processDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        try {
          const doc: ExtractedDocument = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
          if (!doc.text || doc.text.length < 50) continue;

          const persons = extractPersonNames(doc.text, doc.fileName);
          const relationships = extractRelationships(doc.text, persons, doc.fileName);

          for (const [key, entity] of persons) {
            if (allPersons.has(key)) {
              const existing = allPersons.get(key)!;
              existing.mentions += entity.mentions;
              existing.sourceFiles = [...new Set([...existing.sourceFiles, ...entity.sourceFiles])];
              existing.contexts = [...existing.contexts, ...entity.contexts].slice(0, 10);
              existing.confidence = Math.max(existing.confidence, entity.confidence);
            } else {
              allPersons.set(key, entity);
            }
          }

          allRelationships.push(...relationships);
          processedFiles++;

          if (processedFiles % 100 === 0) {
            console.log(`  Processed ${processedFiles} files, found ${allPersons.size} unique persons`);
          }
        } catch {
          /* skip invalid json */
        }
      }
    }
  }

  processDir(inputDir);

  const filteredPersons = Array.from(allPersons.values())
    .filter(p => p.mentions >= minMentions && p.confidence >= minConfidence)
    .sort((a, b) => b.mentions - a.mentions);

  const uniqueRelationships = dedupeRelationships(allRelationships);

  const result: EntityExtractionResult = {
    persons: filteredPersons,
    organizations: [],
    locations: [],
    relationships: uniqueRelationships,
    processedFiles,
    extractedAt: new Date().toISOString(),
  };

  fs.writeFileSync(ENTITIES_FILE, JSON.stringify(result, null, 2));

  console.log("\n=== Extraction Summary ===");
  console.log(`Files processed: ${processedFiles}`);
  console.log(`Unique persons found: ${filteredPersons.length}`);
  console.log(`Relationships found: ${uniqueRelationships.length}`);
  console.log(`Output: ${ENTITIES_FILE}`);

  return result;
}

function dedupeRelationships(rels: ExtractedRelationship[]): ExtractedRelationship[] {
  const seen = new Set<string>();
  const unique: ExtractedRelationship[] = [];

  for (const rel of rels) {
    const key = [rel.person1, rel.person2].sort().join("|") + "|" + rel.type;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(rel);
    }
  }

  return unique;
}

if (process.argv[1]?.includes(path.basename(__filename))) {
  const args = process.argv.slice(2);
  const options: Parameters<typeof extractEntities>[0] = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) {
      options.inputDir = args[++i];
    } else if (args[i] === "--min-mentions" && args[i + 1]) {
      options.minMentions = parseInt(args[++i], 10);
    } else if (args[i] === "--min-confidence" && args[i + 1]) {
      options.minConfidence = parseFloat(args[++i]);
    }
  }

  extractEntities(options).catch(console.error);
}
