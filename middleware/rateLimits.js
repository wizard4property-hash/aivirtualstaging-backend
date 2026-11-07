import rateLimit from "express-rate-limit";

const tooMany = (error) => ({ success: false, error });

// Public, login-free description generator: limit each visitor...
export const descriptionPerIp = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: tooMany(
    "You've generated a lot of descriptions. Please wait a few minutes and try again."
  ),
});

// ...and cap total daily usage, so rotating IPs can't run up the OpenAI bill.
export const descriptionDailyCap = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 1000,
  keyGenerator: () => "global",
  standardHeaders: false,
  legacyHeaders: false,
  message: tooMany(
    "The free generator is at capacity for today. Please try again tomorrow."
  ),
});
