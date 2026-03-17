import fs from "fs";
import path from "path";
// @ts-ignore
import gTTS from "gtts";
import crypto from "crypto";
import pLimit from "p-limit";


type InputItem = {
  text: string;
  level: number;
};

type AudioResult = {
  file: string;
  text: string;
  level: number;
};

export class TextToSpeechService {
  private audioDir: string;

  constructor(audioDir: string = "audio") {
    this.audioDir = path.resolve(process.cwd(), audioDir);
    this.ensureAudioDir();
  }

  // tạo folder nếu chưa có
  private ensureAudioDir(): void {
    if (!fs.existsSync(this.audioDir)) {
      fs.mkdirSync(this.audioDir, { recursive: true });
    }
  }

  // format: LL_uuid.mp3
  private generateFileName(level: number): string {
    const levelStr = String(level).padStart(2, "0"); // đẹp hơn

    const uuid = crypto.randomUUID().slice(0, 10);

    return `${levelStr}_${uuid}.mp3`;
  }

  // tạo audio từ text
  private generateAudio(text: string, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const gtts = new gTTS(text, "en");

      gtts.save(filePath, (err: unknown) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  // đọc file .txt
  private loadData(filePath: string): InputItem[] {
    const raw = fs.readFileSync(filePath, "utf-8");

    const lines = raw
      .split("\n")
      .map(line => line.trim())
      .filter(line => line !== "");

    return lines
      .map(line => {
        const match = line.match(/(.+?)\s+(\d+)$/);

        if (!match) {
          console.warn("⚠️ Sai format:", line);
          return null;
        }

        const text = match[1].trim().replace(/\s+/g, " ");
        const level = Number(match[2]);

        return { text, level };
      })
      .filter((item): item is InputItem => item !== null);
  }

  // xử lý dataset (song song có giới hạn)
  async processFile(inputFilePath: string): Promise<AudioResult[]> {
    const data = this.loadData(inputFilePath);

    const limit = pLimit(5);

    let count = 0;

    const tasks: Promise<AudioResult | null>[] = data.map(item =>
      limit(async () => {
        const { text, level } = item;

        if (!text || !level) return null;

        const fileName = this.generateFileName(level);
        const filePath = path.join(this.audioDir, fileName);

        try {
          await this.generateAudio(text, filePath);

          count++;
          console.log(`✅ [${count}/${data.length}] ${fileName}`);

          return {
            file: fileName,
            text,
            level,
          };
        } catch (err) {
          console.error("❌ Error:", err);
          return null;
        }
      })
    );

    const results = await Promise.all(tasks);

    return results.filter(
      (item): item is AudioResult => item !== null
    );
  }
}