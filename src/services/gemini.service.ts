import puppeteer, { Browser, Page, ElementHandle } from "puppeteer";

const GEMINI_URL = "https://gemini.google.com/app/b61306bac4a2c500";

export class GeminiScraperService {

  private browser: Browser | null = null;
  private page: Page | null = null;

  // ---------------- INIT ----------------
  async init() {

    console.log("🔹 Initializing Chrome options");

    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1920,1080"
      ]
    });

    console.log("🚀 Browser launched");

    this.page = await this.browser.newPage();

    await this.page.setViewport({
      width: 1920,
      height: 1080
    });

    console.log("🌐 Opening Gemini page");

    await this.page.goto(GEMINI_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    console.log("✅ Gemini page loaded");
  }

  // ---------------- JSON EXTRACTION ----------------
  extractCompleteJson(text: string) {

    console.log("🔎 Extracting JSON from response");

    try {

      const start = text.indexOf("{");
      const end = text.lastIndexOf("}") + 1;

      if (start !== -1 && end !== -1) {

        const jsonString = text.substring(start, end);

        return JSON.parse(jsonString);
      }

    } catch (error) {

      console.warn("⚠️ Primary JSON parse failed");
    }

    // Regex for ```json blocks
    try {

      const pattern = /```(?:json)?\s*(\{.*?\})\s*```/gs;
      const matches = text.match(pattern);

      if (matches && matches.length > 0) {

        const cleaned = matches[0]
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim();

        return JSON.parse(cleaned);
      }

    } catch {

      console.warn("⚠️ JSON block regex failed");
    }

    // Weakness array fallback regex
    try {

      const weaknessPattern = /"weaknesses":\s*(\[.*?\])/s;
      const match = text.match(weaknessPattern);

      if (match) {
        console.log("⚠️ Weakness array detected via fallback regex");
      }

    } catch {}

    return null;
  }

  // ---------------- RESPONSE WAIT ----------------
  async waitForCompleteResponse(element: ElementHandle<Element>) {

    if (!this.page) throw new Error("Page not initialized");

    console.log("⏳ Waiting for Gemini streaming response");

    let prevText = "";

    for (let i = 0; i < 40; i++) {

      const currentText: string = await this.page.evaluate(
        el => (el.textContent || "").trim(),
        element
      );

      if (currentText === prevText && currentText.length > 50) {

        console.log("✅ Gemini response stabilized");

        return currentText;
      }

      prevText = currentText;

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.warn("⚠️ Response stabilization timeout");

    return prevText;
  }

  // ---------------- MAIN SERVICE ----------------
  async analyzeReviews(reviews: any[]) {

    const startTime = Date.now();

    if (!this.page) throw new Error("Page not initialized");

    console.log("📊 Starting review analysis");

    const question = `
Based on these movie reviews, provide JSON analysis with structure:

{
  "overallSentiment": "positive | neutral | negative",
  "score": number between 0 and 1,
  "positivePercentage": number,
  "neutralPercentage": number,
  "negativePercentage": number,
  "summary": "5-10 sentence summary",
  "strengths": ["point1", "point2"],
  "weaknesses": ["point1", "point2"],
  "emotionalTone": "tone"
}

Reviews:
${JSON.stringify(reviews, null, 2)}

Return ONLY JSON object.
`;

    try {

      console.log("🔍 Locating Gemini input field");

      await this.page.waitForSelector(
        "div[contenteditable='true']",
        { timeout: 30000 }
      );

      const inputField = await this.page.$("div[contenteditable='true']");

      if (!inputField) throw new Error("Input field not found");

      console.log("✅ Input field found");

      await inputField.click();

      console.log("✏️ Injecting prompt");

      await this.page.evaluate(
        (el, text) => {
          (el as HTMLElement).innerText = text;
        },
        inputField,
        question
      );

      console.log("📨 Submitting prompt");

      await inputField.press("Enter");

      console.log("⏳ Waiting for Gemini response element");

      await this.page.waitForSelector(
        "div.markdown.markdown-main-panel",
        { timeout: 60000 }
      );

      const responses = await this.page.$$(
        "div.markdown.markdown-main-panel"
      );

      const responseElement = responses[responses.length - 1];

      console.log("📥 Response element detected");

      const responseText =
        await this.waitForCompleteResponse(responseElement);

      console.log("📝 Gemini raw response:");
      console.log(responseText.substring(0, 500));

      const parsedJson = this.extractCompleteJson(responseText);

      if (parsedJson) {

        const elapsed =
          ((Date.now() - startTime) / 1000).toFixed(2);

        console.log(`🎉 Analysis completed in ${elapsed}s`);

        return parsedJson;
      }

      console.error("❌ JSON parsing failed");

      return {
        status: "error",
        message: "Could not parse Gemini response",
        raw: responseText
      };

    } catch (error) {

      console.error("❌ Gemini response timeout:", error);

      return {
        status: "error",
        message: "Gemini response timeout"
      };
    }
  }

  // ---------------- CLOSE ----------------
  async close() {

    try {

      if (this.browser) {

        console.log("🛑 Closing Chrome driver");

        await this.browser.close();
      }

    } catch (error) {

      console.error("⚠️ Error closing browser:", error);
    }
  }
}