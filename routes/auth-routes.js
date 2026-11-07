import express from "express";

import authControllers from "../controllers/auth-controllers.js";
import verifyToken from "../middleware/verifyToken.js";

const router = express.Router();

router.post("/auth/google", authControllers.googleLogin);

router.get("/me", verifyToken, authControllers.getMe);

export default router;
