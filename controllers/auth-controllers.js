import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";

import User from "../models/user.js";
import { SESSION_SECRET } from "../middleware/verifyToken.js";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

const publicUser = (user) => ({
  email: user.email,
  credits: user.credits,
  isPaid: user.isPaid,
  usage: user.usage,
});

// Finds the user for a Google account, linking pre-existing accounts
// (created via Supabase Google sign-in) by their verified email.
const findOrCreateUser = async (googleId, email) => {
  const existing = await User.findOne({ googleId });
  if (existing) return existing;

  const linked = await User.findOneAndUpdate(
    { email, googleId: { $exists: false } },
    { $set: { googleId } },
    { new: true, sort: { credits: -1 } }
  );
  if (linked) return linked;

  try {
    return await User.create({ googleId, email });
  } catch (err) {
    // Two sign-ins raced; the other one created the record
    if (err.code === 11000) return User.findOne({ googleId });
    throw err;
  }
};

const googleLogin = async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: "Missing credential" });

  let payload;
  try {
    ({ payload } = await jwtVerify(credential, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: process.env.GOOGLE_CLIENT_ID,
    }));
  } catch {
    return res.status(401).json({ error: "Invalid Google credential" });
  }

  if (!payload.email || !payload.email_verified) {
    return res.status(401).json({ error: "Google account email is not verified" });
  }

  try {
    const email = payload.email.toLowerCase();
    const user = await findOrCreateUser(payload.sub, email);

    const token = await new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(String(user._id))
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(SESSION_SECRET);

    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error("Google login failed:", err);
    res.status(500).json({ error: "Server error" });
  }
};

const getMe = async (req, res) => {
  const user = await User.findById(req.user.sub);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(publicUser(user));
};

export default {
  googleLogin,
  getMe,
};
