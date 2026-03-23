import { PDFParse } from "pdf-parse";
import * as fs from "fs";

const parser = new PDFParse({
  data: new Uint8Array(fs.readFileSync("data/destination_input/38. Destination B2.pdf")),
});

(async () => {
  const info = await parser.getInfo();
  
  console.log("=== PAGE 22 (where match starts) - RAW TEXT ===");
  let extracted = await parser.getText({ partial: [22] });
  const text = extracted.text || "";
  console.log(JSON.stringify(text.slice(2500, 3500), null, 2));
  
  console.log("\n=== SEARCHING FOR 'Match to make' ===");
  const idx = text.indexOf("Match to make");
  if (idx >= 0) {
    console.log(JSON.stringify(text.slice(idx, idx + 1000), null, 2));
  } else {
    console.log("NOT FOUND in page 22");
  }
  
  await parser.destroy();
})();
