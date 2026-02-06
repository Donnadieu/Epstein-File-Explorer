import * as fs from "fs";
import OpenAI from "openai";

const openrouter = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY,
});

async function main() {
  const doc = JSON.parse(fs.readFileSync("data/extracted/ds7/EFTA00009664.json", "utf-8"));
  console.log("Testing with", doc.fileName, "(", doc.text.length, "chars)");

  const response = await openrouter.chat.completions.create({
    model: "deepseek/deepseek-chat-v3-0324",
    messages: [
      {
        role: "system",
        content: `You are an expert analyst reviewing Epstein case documents from the DOJ. Extract structured data. Respond with valid JSON only (no markdown fences, no explanation). Schema: { "documentType": "string", "summary": "string", "persons": [{"name":"string","role":"string","category":"string","context":"string","mentionCount":number}], "connections": [{"person1":"string","person2":"string","relationshipType":"string","description":"string","strength":number}], "events": [{"date":"string","title":"string","description":"string","category":"string","significance":number,"personsInvolved":["string"]}], "locations": ["string"], "keyFacts": ["string"] }`,
      },
      { role: "user", content: "Analyze this document:\n\n" + doc.text },
    ],
    max_tokens: 4096,
    temperature: 0.1,
  });

  let content = response.choices[0]?.message?.content || "";
  console.log("Raw response length:", content.length);
  console.log("First 200 chars:", content.substring(0, 200));

  content = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      console.error("Could not parse JSON");
      console.log("Full response:", content);
      return;
    }
  }

  console.log("\n=== Results ===");
  console.log("Document type:", parsed.documentType);
  console.log("Summary:", parsed.summary?.substring(0, 300));
  console.log("\nPersons:", parsed.persons?.length);
  for (const p of parsed.persons || []) {
    console.log(`  - ${p.name} (${p.category}): ${p.context?.substring(0, 100)}`);
  }
  console.log("\nConnections:", parsed.connections?.length);
  for (const c of parsed.connections || []) {
    console.log(`  - ${c.person1} <-> ${c.person2} (${c.relationshipType}): ${c.description?.substring(0, 80)}`);
  }
  console.log("\nEvents:", parsed.events?.length);
  for (const e of parsed.events || []) {
    console.log(`  - [${e.date}] ${e.title}: ${e.description?.substring(0, 80)}`);
  }
  console.log("\nLocations:", parsed.locations);
  console.log("\nKey Facts:", parsed.keyFacts?.length);
  for (const f of parsed.keyFacts || []) {
    console.log(`  - ${f}`);
  }
}

main().catch(console.error);
