import axios from "axios";
import * as cheerio from "cheerio";
import * as fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateRealIPA } from "./utils/phonetic-helper.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function crawlAndGeneratePhonetic(startPage: number, endPage: number) {
  const allData: any[] = [];
  const seenSentences = new Set();

  for (let i = startPage; i <= endPage; i++) {
    try {
      const url = `https://www.manythings.org/sentences/audio/${i}.html`;
      const { data } = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          Referer: "https://www.manythings.org/sentences/audio/",
        },
      });
      const $ = cheerio.load(data);

      // Lấy văn bản thô trong thẻ <pre id="g"> vì ManyThings không render <li> khi dùng axios
      const rawText = $("#g").text();

      if (rawText) {
        const lines = rawText.split("\n");
        const validSentences: any[] = []; //thay
        lines.forEach((line) => {
          const trimmedLine = line.trim();
          if (!trimmedLine) return;

          const regex =
            /^([a-z]{3})\s+(\d+)\s+(\d+)\s+(.+?)\s+([a-zA-Z0-9_-]+)\s+(.+?)\s+([a-zA-Z0-9_-]+)\s+(\d+)$/;

          const match = trimmedLine.match(regex);
          if (match) {
            const audioId = match[3];
            const rawEnglish = match[6].trim();
            if (rawEnglish && audioId && !rawEnglish.includes("\t")) {
              const wordCount = rawEnglish.split(" ").length;

              // chỉ giữ câu 4-15 từ
              if (wordCount >= 4 && wordCount <= 15) {
                const normalized = rawEnglish
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, "")
                  .trim();

                if (!seenSentences.has(normalized)) {
                  validSentences.push({
                    sentence: rawEnglish,
                    audio_url: `https://audio.tatoeba.org/sentences/eng/${audioId}.mp3`,
                    phonetic: generateRealIPA(rawEnglish),
                    difficulty: "pending",
                    normalized,
                  });
                }
              }
            }
          }
        });

        // random lấy 1 câu/trang
        if (validSentences.length > 0) {
          const randomItem =
            validSentences[Math.floor(Math.random() * validSentences.length)];

          seenSentences.add(randomItem.normalized);

          allData.push({
            sentence: randomItem.sentence,
            audio_url: randomItem.audio_url,
            phonetic: randomItem.phonetic,
            difficulty: "pending",
          });
        }
      }
      console.log(`Đã xử lý xong trang ${i}...`);
    } catch (err) {
      console.error(`Lỗi trang ${i}:`, err);
    }
  }

  // 1. Xuất file cho Speaking (cào hết)
  const speakingHeader = "sentence,phonetic,audio_url,difficulty\n";
  const speakingRows = allData
    .map(
      (d) =>
        `"${d.sentence}","${d.phonetic}","${d.audio_url}","${d.difficulty}"`,
    )
    .join("\n");

  fs.writeFileSync(
    path.resolve(__dirname, "../data/raw/speaking_raw.csv"),
    speakingHeader + speakingRows,
  );
  console.log(
    `Đã tạo xong file Speaking với phiên âm cho ${allData.length} câu!`,
  );

  // 2. Xuất file cho Listening (cào chỉ lấy câu >= 3 từ)
  const filteredListening = allData.filter(
    (d) => d.sentence.split(" ").length >= 3,
  );
  const listeningHeader = "transcript,audio_url,difficulty\n";
  const listeningRows = filteredListening
    .map((d) => `"${d.sentence}","${d.audio_url}","${d.difficulty}"`)
    .join("\n");
  fs.writeFileSync(
    path.resolve(__dirname, "../data/raw/listening_raw.csv"),
    listeningHeader + listeningRows,
  );

  console.log(`\nHoàn thành cào dữ liệu từ trang ${startPage} đến ${endPage}:`);
  console.log(`- Speaking: ${allData.length} câu (Tổng số)`);
}

crawlAndGeneratePhonetic(1000, 1005); //thử từ 1-300 vì trang 300 có câu dài 3 từ, có thể listening lấy để đục lỗ (phải 3 từ trở lên mới đục lỗ làm bài được, còn speaking là cào hết, ko quan tâm số lượng từ)
