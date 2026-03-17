import { textToSpeechFree } from "./Text-to-Speech.ts";

async function main() {
  console.log("Bắt đầu chạy TTS...");

  try {
    const audioPath = await textToSpeechFree(
      "Some of the instruments produced within the Council of Europe have played a decisive role in the teaching of so-called “foreign” languages by promoting methodological innovations and new approaches to designing teaching programmes, notably the development of a communicative approach.",
      "test-audio",
    );

    console.log("Đã tạo file:", audioPath);
  } catch (error) {
    console.error("Lỗi tạo giọng nói:", error);
  }
}

main();