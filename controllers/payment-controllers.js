import crypto from "crypto";
import HttpError from "../models/http-error.js";
import User from "../models/user.js";

const safeEqual = (a, b) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

// Dodo follows the Standard Webhooks spec: HMAC-SHA256 over
// "<webhook-id>.<webhook-timestamp>.<raw body>" with the base64 whsec_ secret.
const isValidDodoSignature = (req) => {
  const secret = process.env.DODO_WEBHOOK_SECRET;
  const id = req.get("webhook-id");
  const timestamp = req.get("webhook-timestamp");
  const signatureHeader = req.get("webhook-signature");
  if (!secret || !id || !timestamp || !signatureHeader || !req.rawBody) {
    return false;
  }

  // Reject replays older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${req.rawBody.toString("utf8")}`)
    .digest("base64");

  // Header is space-separated "v1,<sig>" entries
  return signatureHeader
    .split(" ")
    .some((entry) => safeEqual(entry.split(",")[1] || "", expected));
};

// Adds credits once per payment id, so webhook retries don't double-credit.
const addCreditsForPayment = async (email, paymentId, credits) => {
  const user = await User.findOneAndUpdate(
    { email, processedPayments: { $ne: paymentId } },
    {
      $inc: { credits },
      $set: { isPaid: true },
      $push: { processedPayments: paymentId },
    },
  );
  if (user) return "credited";
  return (await User.exists({ email })) ? "duplicate" : "no-user";
};

const respondToCredit = (res, outcome) => {
  if (outcome === "no-user") {
    return res.status(404).json({ message: "User not found" });
  }
  return res
    .status(200)
    .json({ success: true, message: "Payment captured successfully!" });
};

const DodoConfirmPayment = async (req, res, next) => {
  if (!isValidDodoSignature(req)) {
    console.error("Dodo webhook rejected: invalid or missing signature");
    return res.status(401).json({ message: "Invalid signature" });
  }

  const webhooktype = req.body.type;
  const bodydata = req.body.data;

  if (webhooktype !== "payment.succeeded") {
    return res.status(200).json({ success: true, message: "other webhhook!" });
  }

  const email = bodydata.customer.email;
  const productId = bodydata.product_cart[0].product_id;

  let tempCredits = 0;

  if (productId === "pdt_0NV7kgi3iSzx9VbU3e57e") tempCredits = 10;
  if (productId === "pdt_0NV7kzXCSOABy0llheHUo") tempCredits = 30;
  if (productId === "pdt_0NV7l8Hd10z0e6WHhCros") tempCredits = 100;

  try {
    const outcome = await addCreditsForPayment(
      email,
      `dodo_${bodydata.payment_id}`,
      tempCredits,
    );
    return respondToCredit(res, outcome);
  } catch (err) {
    const error = new HttpError("Something went wrong", 500);
    return next(error);
  }
};

export default {
  DodoConfirmPayment,
};
