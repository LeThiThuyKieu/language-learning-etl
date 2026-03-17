import { TextToSpeechService } from "./text-to-Speech.ts";
import fs from "fs";

async function main() {
  console.log("🚀 Bắt đầu generate audio từ CSV...");

  try {
    const tts = new TextToSpeechService("audio");

    // 👉 đổi sang file CSV
    const inputFile = "data.csv";

    const results = await tts.processFile(inputFile);

    // lưu metadata (rất quan trọng cho KLTN)
    fs.writeFileSync(
      "metadata.json",
      JSON.stringify(results, null, 2)
    );

    console.log("✅ Hoàn thành!");
    console.log(`📊 Tổng file: ${results.length}`);

    // in thử vài file
    results.slice(0, 5).forEach((item, index) => {
      console.log(`${index + 1}.`, item.file);
    });

  } catch (error) {
    console.error("❌ Lỗi:", error);
  }
}

main();
main();