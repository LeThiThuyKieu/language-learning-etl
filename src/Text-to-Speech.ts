// @ts-ignore
import gTTS from "gtts";
import fs from "fs";
import path from "path";

export function textToSpeechFree(
  text: string,
  fileName: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const gtts = new gTTS(text, "en");

    const audioDir = path.resolve(process.cwd(), "audio");

    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    const filePath = path.join(audioDir, `${fileName}.mp3`);

    gtts.save(filePath, (err: unknown) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(filePath);
    });
  });
}