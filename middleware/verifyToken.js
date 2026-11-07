import { jwtVerify } from "jose";
import dotenv from "dotenv";

dotenv.config();

export const SESSION_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// Verifies the session token we issue at Google sign-in.
// req.user.sub is the user's Mongo _id.
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(authHeader.split(" ")[1], SESSION_SECRET, {
      algorithms: ["HS256"],
    });
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
};

export default verifyToken;
