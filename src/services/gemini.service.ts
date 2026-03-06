import puppeteer, { Browser, Page, ElementHandle } from "puppeteer";

const GEMINI_URL = "https://gemini.google.com/app/b61306bac4a2c500";

export class GeminiScraperService {

  private browser: Browser | null = null;
  private page: Page | null = null;

  // ---------------- INIT ----------------
  async init() {

    console.log("🔹 Initializing Chrome options");

    this.browser = await puppeteer.launch({
      headless: false, // Change to false for debugging
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
      waitUntil: "networkidle2", // Changed from domcontentloaded
      timeout: 60000
    });

    // Wait for page to fully load
    await this.page.waitForTimeout(5000);
    
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

    return null;
  }

  // ---------------- RESPONSE WAIT ----------------
  async waitForCompleteResponse() {

    if (!this.page) throw new Error("Page not initialized");

    console.log("⏳ Waiting for Gemini streaming response");

    // Try multiple selectors for response
    const responseSelectors = [
      "div.markdown.markdown-main-panel",
      "message-content .markdown",
      ".response-content .markdown",
      "div[data-test-id='response-content']"
    ];

    let responseElement: ElementHandle<Element> | null = null;
    
    // Find response element with any selector
    for (const selector of responseSelectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: 5000 });
        responseElement = await this.page.$(selector);
        if (responseElement) {
          console.log(`✅ Found response with selector: ${selector}`);
          break;
        }
      } catch {
        console.log(`⚠️ Selector not found: ${selector}`);
      }
    }

    if (!responseElement) {
      // Try to find any element that might contain the response
      console.log("🔍 Searching for any element with response content...");
      
      responseElement = await this.page.$("div[class*='markdown'], div[class*='response'], message-content");
    }

    if (!responseElement) {
      throw new Error("Could not find response element");
    }

    // Wait for content to appear
    let prevText = "";
    let emptyCount = 0;
    
    for (let i = 0; i < 60; i++) { // Increased timeout

      const currentText: string = await this.page.evaluate(
        el => (el.textContent || "").trim(),
        responseElement
      );

      if (currentText.length === 0) {
        emptyCount++;
        if (emptyCount > 10) {
          console.log("⚠️ Response element is empty, checking if response is elsewhere...");
          // Try to find if response moved to a different element
          const allText = await this.page.evaluate(() => document.body.innerText);
          if (allText.includes("overallSentiment") || allText.includes("strengths")) {
            console.log("✅ Found JSON in page body");
            return allText;
          }
        }
      }

      if (currentText.length > 0 && currentText !== prevText) {
        console.log(`📝 Response length: ${currentText.length} characters`);
        prevText = currentText;
      }

      if (currentText === prevText && currentText.length > 100) {
        console.log("✅ Gemini response stabilized");
        return currentText;
      }

      await this.page.waitForTimeout(1000);
    }

    console.warn("⚠️ Response stabilization timeout");
    
    // Final attempt to get any text
    const finalText = await this.page.evaluate(() => {
      const elements = document.querySelectorAll('.markdown, message-content, [class*="response"]');
      return Array.from(elements).map(el => el.textContent).join(' ');
    });
    
    return finalText || prevText;
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

      // Multiple input selectors
      const inputSelectors = [
        "rich-textarea div[contenteditable='true']",
        "[data-placeholder='Ask Gemini 3']",
        "[data-placeholder='Ask Gemini']",
        "div[contenteditable='true']",
        ".ql-editor[contenteditable='true']"
      ];

      let inputField: ElementHandle<Element> | null = null;
      
      for (const selector of inputSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 5000 });
          inputField = await this.page.$(selector);
          if (inputField) {
            console.log(`✅ Input field found with selector: ${selector}`);
            break;
          }
        } catch {
          console.log(`⚠️ Input selector not found: ${selector}`);
        }
      }

      if (!inputField) {
        throw new Error("Input field not found with any selector");
      }

      // Clear any existing text
      await inputField.click({ clickCount: 3 }); // Select all
      await inputField.press("Backspace");
      
      // Type the question
      console.log("✏️ Typing prompt");
      await inputField.type(question, { delay: 10 });
      
      // Wait a bit before submitting
      await this.page.waitForTimeout(2000);
      
      // Try multiple submission methods
      console.log("📨 Submitting prompt");
      
      // Method 1: Enter key
      await inputField.press("Enter");
      
      // Method 2: Look for send button (if Enter doesn't work)
      await this.page.waitForTimeout(1000);
      
      const sendButton = await this.page.$("button[aria-label='Send message'], .send-button");
      if (sendButton) {
        const isDisabled = await this.page.evaluate(btn => (btn as HTMLButtonElement).disabled, sendButton);
        if (!isDisabled) {
          console.log("📨 Clicking send button");
          await sendButton.click();
        }
      }

      console.log("⏳ Waiting for Gemini response...");
      
      // Wait for response to start generating
      await this.page.waitForTimeout(3000);

      // Get the response text
      const responseText = await this.waitForCompleteResponse();

      console.log("📝 Gemini raw response:");
      console.log(responseText.substring(0, 500) + "...");

      if (!responseText || responseText.length < 10) {
        console.log("⚠️ Response is empty, checking page content...");
        
        // Debug: Get all text from the page
        const pageText = await this.page.evaluate(() => document.body.innerText);
        console.log("📄 Page text length:", pageText.length);
        
        if (pageText.includes("overallSentiment") || pageText.includes("strengths")) {
          console.log("✅ Found JSON in page text");
          const parsedJson = this.extractCompleteJson(pageText);
          if (parsedJson) {
            return parsedJson;
          }
        }
      }

      const parsedJson = this.extractCompleteJson(responseText);

      if (parsedJson) {

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`🎉 Analysis completed in ${elapsed}s`);

        return parsedJson;
      }

      console.error("❌ JSON parsing failed");

      // Take screenshot for debugging
      await this.page.screenshot({ path: 'debug-screenshot.png' });
      console.log("📸 Debug screenshot saved as debug-screenshot.png");

      return {
        status: "error",
        message: "Could not parse Gemini response",
        raw: responseText.substring(0, 1000)
      };

    } catch (error) {

      console.error("❌ Error:", error);
      
      // Take screenshot on error
      if (this.page) {
        await this.page.screenshot({ path: 'error-screenshot.png' });
        console.log("📸 Error screenshot saved as error-screenshot.png");
      }

      return {
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error"
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