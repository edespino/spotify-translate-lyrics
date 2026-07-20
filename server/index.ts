import "dotenv/config";
import path from "node:path";
import { createApp } from "./app";
import { GeminiProvider } from "./translator";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const port = Number(process.env.SERVER_PORT || 8087);
const dataDir = path.resolve(process.cwd(), "data");
const app = createApp(new GeminiProvider(apiKey), dataDir);

app.listen(port, "127.0.0.1", () => {
  console.log(`Translation server listening on http://127.0.0.1:${port}`);
});
