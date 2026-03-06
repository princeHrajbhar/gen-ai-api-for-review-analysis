import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";

import reviewRoutes from "./routes/review.route";

const app = express();

app.use(cors());
app.use(express.json());

// routes
app.use("/api/reviews", reviewRoutes);

// health route
app.get("/", (req, res) => {
  res.send("Gemini API running");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});