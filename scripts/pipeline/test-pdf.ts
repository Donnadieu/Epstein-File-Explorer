import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import * as fs from "fs";

async function main() {
  const dir = "/home/runner/Downloads/epstein-disclosures/data-set-6/";
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".pdf"));
  const testFile = files[0];
  const buffer = fs.readFileSync(dir + testFile);
  const data = new Uint8Array(buffer);

  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true, disableAutoFetch: true, isEvalSupported: false }).promise;
  console.log("File:", testFile);
  console.log("Pages:", doc.numPages);

  let fullText = "";
  for (let i = 1; i <= Math.min(doc.numPages, 3); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item: any) => item.str).join(" ");
    fullText += text + "\n";
  }
  console.log("Text length:", fullText.length);
  console.log("First 500 chars:", fullText.substring(0, 500));
}

main().catch(console.error);
