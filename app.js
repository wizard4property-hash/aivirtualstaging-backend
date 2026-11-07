import fs from "fs";
import path from "path";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";

import HttpError from "./models/http-error.js";
import { ensureUserIndexes } from "./models/user.js";
import authRoutes from "./routes/auth-routes.js";
import mainRoutes from "./routes/main-routes.js";
import paymentRoutes from "./routes/payment-routes.js";

dotenv.config();

for (const key of ["MONGODB_URI", "JWT_SECRET", "GOOGLE_CLIENT_ID"]) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const app = express();

// Behind Railway's proxy: trust one hop so req.ip is the real client IP
// (otherwise every visitor shares one rate-limit bucket).
app.set("trust proxy", 1);

const allowedOrigins = [
  "https://www.aivirtualstaging.net",
  "https://aivirtualstaging.net",
];

// Set up CORS options
const corsOptions = {
  origin: function (origin, callback) {
    // Check if the origin is in the list of allowed origins
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true); // Allow the request
    } else {
      callback("Not allowed by CORS"); // Deny the request
    }
  },
};

// Keep the raw body so payment webhooks can verify their signatures he
app.use(
  bodyParser.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(cors());

app.use("/api", authRoutes);
app.use("/api", mainRoutes);
app.use("/api", paymentRoutes);

app.use((req, res, next) => {
  //   const error = new HttpError("Could not find this route.", 404);
  res
    .status(400)
    .json({ success: false, message: "Could not find this route" });
});

mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(async () => {
    await ensureUserIndexes();
    app.listen(process.env.PORT || 5001);
    console.log("connected to db");
    // console.log("Running Node version:", process.version);
  })
  .catch((err) => {
    console.log(err);
  });
