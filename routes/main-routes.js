import express from "express";

import mainControllers from "../controllers/main-controllers.js";
import verifyToken from "../middleware/verifyToken.js";
import {
  listGenerations,
  deleteGeneration,
} from "../controllers/generation-controllers.js";
import { descriptionPerIp, descriptionDailyCap } from "../middleware/rateLimits.js";

import multer from "multer";

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

// Only "2K" and "4K" are offered. Anything else is treated as 2K, so the
// output resolution always matches the credits charged for it.
const normalizeResolution = (req, res, next) => {
  req.body.resolution = req.body.resolution === "4K" ? "4K" : "2K";
  next();
};

router.post(
  "/edit-image",
  verifyToken,
  normalizeResolution,
  mainControllers.editImage,
);

router.get("/generations", verifyToken, listGenerations);
router.delete("/generations/:id", verifyToken, deleteGeneration);

router.post(
  "/staged",
  verifyToken,
  upload.single("image"),
  normalizeResolution,
  mainControllers.generateStagedImage,
);

router.post(
  "/remove-furniture",
  verifyToken,
  upload.single("image"),
  normalizeResolution,
  mainControllers.furnitureRemoval,
);

router.post(
  "/day-to-dusk",
  verifyToken,
  upload.single("image"),
  normalizeResolution,
  mainControllers.dayToDusk,
);

router.post(
  "/3d-floor-plan",
  verifyToken,
  upload.single("image"),
  normalizeResolution,
  mainControllers.floorPlan3D,
);

// Internal-only feature (not linked anywhere in the public UI)
router.post(
  "/replace-texture",
  verifyToken,
  upload.fields([
    { name: "roomImage", maxCount: 1 },
    { name: "textureImage", maxCount: 1 },
  ]),
  normalizeResolution,
  mainControllers.replaceTexture,
);

// Internal-only feature (not linked anywhere in the public UI)
router.post(
  "/replace-object",
  verifyToken,
  upload.fields([
    { name: "roomImage", maxCount: 1 },
    { name: "referenceImage", maxCount: 1 },
  ]),
  normalizeResolution,
  mainControllers.replaceObject,
);

router.post(
  "/generate-property-description",
  descriptionPerIp,
  descriptionDailyCap,
  mainControllers.generateDescription,
);

export default router;
