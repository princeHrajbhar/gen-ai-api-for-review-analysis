import { Router, Request, Response } from "express";
import { GeminiScraperService } from "../services/gemini.service";

const router = Router();

router.post("/analyze", async (req: Request, res: Response) => {

  const scraper = new GeminiScraperService();

  try {

    const { reviews } = req.body;

    if (!reviews || !Array.isArray(reviews)) {
      return res.status(400).json({
        status: "error",
        message: "reviews array is required"
      });
    }

    await scraper.init();

    const result = await scraper.analyzeReviews(reviews);

    return res.json(result);

  } catch (error: any) {

    console.error("API Error:", error);

    return res.status(500).json({
      status: "error",
      message: error.message || "Internal Server Error"
    });

  } finally {

    try {
      await scraper.close();
    } catch {}
  }

});

export default router;