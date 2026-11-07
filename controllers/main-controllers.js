import User from "../models/user.js";
import dotenv from "dotenv";
import { fal } from "@fal-ai/client";
import sharp from "sharp";
import { saveGeneration } from "./generation-controllers.js";
import { buildStagingPrompt } from "../lib/stagingPrompt.js";
import {
  layoutScore,
  alignmentScore,
  LAYOUT_THRESHOLD,
  EDIT_ALIGNMENT_THRESHOLD,
} from "../lib/layoutCheck.js";

import OpenAI from "openai";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

fal.config({
  credentials: process.env.FAL_API_KEY,
});

// 4K output costs us double, so it uses two credits.
export const creditCost = (resolution) => (resolution === "4K" ? 2 : 1);

// Atomically takes the credits before generating and refunds them if
// generation fails, so parallel requests can't spend more than the user has.
const generateWithCredit = async (userId, cost, generate) => {
  const reserved = await User.findOneAndUpdate(
    { _id: userId, credits: { $gte: cost } },
    { $inc: { credits: -cost, usage: 1 } },
  );
  if (!reserved) return null;

  try {
    return await generate();
  } catch (err) {
    await User.updateOne({ _id: userId }, { $inc: { credits: cost, usage: -1 } });
    throw err;
  }
};

const generateStagedImage = async (req, res) => {
  try {
    const userId = req.user.sub;
    let existingUser = await User.findById(userId);

    const { roomType, style, instructions, resolution = "2K" } = req.body;

    if (!existingUser || existingUser.credits < creditCost(resolution)) {
      return res
        .status(403)
        .json({ success: false, message: "Not Sufficient Credits!" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    // Convert buffer to Data URI
    const base64ImageInput = req.file.buffer.toString("base64");
    const dataUri = `data:${req.file.mimetype};base64,${base64ImageInput}`;

    const finalPrompt = buildStagingPrompt({ roomType, style, instructions });

    // Nano Banana Pro Request, checked against the original room
    const stageOnce = async () => {
      const response = await fal.subscribe("fal-ai/nano-banana-pro/edit", {
        input: {
          image_urls: [dataUri],
          prompt: finalPrompt,
          num_images: 1,
          aspect_ratio: "auto",
          output_format: "jpeg",
          resolution: resolution,
        },
      });
      const url = response.data.images[0].url;

      // If the check itself can't run, don't hold the result back
      try {
        const output = Buffer.from(await (await fetch(url)).arrayBuffer());
        return { url, output, score: await layoutScore(req.file.buffer, output) };
      } catch (checkErr) {
        console.error("Layout check skipped:", checkErr.message);
        return { url, output: null, score: 1 };
      }
    };

    // The model occasionally moves the camera or changes windows, doors, or
    // closets. When the check catches that, regenerate once (same credit)
    // and keep whichever result matches the room best.
    const result = await generateWithCredit(userId, creditCost(resolution), async () => {
      let best = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const take = await stageOnce();
        if (!best || take.score > best.score) best = take;
        if (take.score >= LAYOUT_THRESHOLD) break;
        console.warn(`Staging layout check failed (attempt ${attempt}, score ${take.score.toFixed(2)})`);
      }
      return best;
    });

    if (!result) {
      return res
        .status(403)
        .json({ success: false, message: "Not Sufficient Credits!" });
    }

    res.json({
      success: true,
      imageUrl: result.url,
    });

    // Keep a copy in the user's history (runs after the response is sent)
    saveGeneration({
      userId,
      tool: "staging",
      file: req.file,
      outputUrl: result.url,
      outputBuffer: result.output,
      settings: { roomType, style, instructions, resolution },
    });
  } catch (err) {
    console.error("Fal Generation Error:", err);
    res
      .status(500)
      .json({ success: false, error: err.message || "Generation failed" });
  }
};

const furnitureRemoval = async (req, res) => {
  try {
    const userId = req.user.sub;
    let existingUser = await User.findById(userId);

    const { resolution = "2K" } = req.body;

    if (!existingUser || existingUser.credits < creditCost(resolution)) {
      return res
        .status(403)
        .json({ success: false, message: "Not Sufficient Credits!" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    // Convert buffer to Data URI
    const base64ImageInput = req.file.buffer.toString("base64");
    const dataUri = `data:${req.file.mimetype};base64,${base64ImageInput}`;

    const basePrompt = `Use the provided real estate image as the only reference.
Remove all existing furniture, décor, and movable objects from the room to create a clean, empty space.

Strict rules (must follow):

The camera position, angle, lens perspective, and field of view must remain identical to the original image.

Do NOT change the room layout, walls, ceiling, floor, windows, doors, or architectural elements.

Do NOT crop, zoom, rotate, widen, or distort the image.

Keep the same lighting conditions, shadows, and natural light direction as the original photo.

Maintain realistic textures on floors, walls, and surfaces after furniture removal.

Do not add any new objects, décor, or furniture.

Output requirements:

The room should look naturally empty, clean, and realistic.

No artifacts, blurry areas, or unnatural patches where furniture was removed.

The final image should look like a professionally photographed vacant property.
`;

    // Nano Banana Pro Request
    const result = await generateWithCredit(userId, creditCost(resolution), () =>
      fal.subscribe("fal-ai/nano-banana-pro/edit", {
        input: {
          image_urls: [dataUri],
          prompt: basePrompt,
          num_images: 1,
          aspect_ratio: "auto",
          output_format: "jpeg",
          resolution: resolution,
        },
      }),
    );

    if (!result) {
      return res
        .status(403)
        .json({ success: false, message: "Not Sufficient Credits!" });
    }

    res.json({
      success: true,
      imageUrl: result.data.images[0].url,
    });

    // Keep a copy in the user's history (runs after the response is sent)
    saveGeneration({
      userId,
      tool: "furniture-removal",
      file: req.file,
      outputUrl: result.data.images[0].url,
      settings: { resolution },
    });
  } catch (err) {
    console.error("Fal Generation Error:", err);
    res
      .status(500)
      .json({ success: false, error: err.message || "Generation failed" });
  }
};

const dayToDusk = async (req, res) => {
  try {
    const userId = req.user.sub;
    let existingUser = await User.findById(userId);

    const { resolution = "2K" } = req.body;

    if (!existingUser || existingUser.credits < creditCost(resolution)) {
      return res
        .status(403)
        .json({ success: false, message: "Not Sufficient Credits!" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    // Convert buffer to Data URI
    const base64ImageInput = req.file.buffer.toString("base64");
    const dataUri = `data:${req.file.mimetype};base64,${base64ImageInput}`;

    const basePrompt = `
Convert the provided daytime real estate exterior photo into a realistic dusk (twilight) scene.

Strict rules:

- Keep the camera angle, composition, perspective, and framing exactly the same.

- Do NOT change the building structure, layout, landscaping, windows, doors, roof, or surroundings.

Dusk transformation details:

- Replace the daytime sky with a natural twilight sky featuring a soft blue-hour gradient with subtle warm sunset tones near the horizon.

- Turn on interior lights with a warm yellow glow visible through the windows, balanced and realistic (not overexposed).

- Turn on exterior lights such as porch lights, garage lights, pathway lights, and landscape lighting if present, with soft natural light falloff.

- Maintain realistic reflections on windows and glass surfaces.

- Ensure shadows, highlights, and light direction remain consistent with the original photo.

Quality requirements:

- Photorealistic, natural colors

- No oversaturation, no halos, no artificial glow

- Clean edges around rooflines, trees, and windows

- Professional, high-end real estate photography style

The final image should look as if it was genuinely photographed at dusk, suitable for MLS and luxury real estate marketing.
`;

    // Nano Banana Pro Request
    const result = await generateWithCredit(userId, creditCost(resolution), () =>
      fal.subscribe("fal-ai/nano-banana-pro/edit", {
        input: {
          image_urls: [dataUri],
          prompt: basePrompt,
          num_images: 1,
          aspect_ratio: "auto",
          output_format: "jpeg",
          resolution: resolution,
        },
      }),
    );

    if (!result) {
      return res
        .status(403)
        .json({ success: false, message: "Not Sufficient Credits!" });
    }

    res.json({
      success: true,
      imageUrl: result.data.images[0].url,
    });

    // Keep a copy in the user's history (runs after the response is sent)
    saveGeneration({
      userId,
      tool: "day-to-dusk",
      file: req.file,
      outputUrl: result.data.images[0].url,
      settings: { resolution },
    });
  } catch (err) {
    console.error("Fal Generation Error:", err);
    res
      .status(500)
      .json({ success: false, error: err.message || "Generation failed" });
  }
};

// Floor plans often sit in a wide white page. Trim that margin (keeping a
// small border) so the house fills the frame and gets more of the output
// resolution. Falls back to the original if there's nothing to trim.
const trimFloorPlan = async (buffer) => {
  const flat = await sharp(buffer)
    .rotate()
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 95 })
    .toBuffer();
  try {
    const { data, info } = await sharp(flat)
      .trim({ background: "#ffffff", threshold: 40 })
      .toBuffer({ resolveWithObject: true });
    const margin = Math.round(Math.max(info.width, info.height) * 0.04);
    const framed = await sharp(data)
      .extend({ top: margin, bottom: margin, left: margin, right: margin, background: "#ffffff" })
      .toBuffer();
    // Small scans make room sizes a few pixels tall; enlarging them lets the
    // model read the labels instead of guessing digits
    return await sharp(framed)
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: false, kernel: "lanczos3" })
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch {
    return flat;
  }
};

const floorPlan3D = async (req, res) => {
  try {
    const userId = req.user.sub;
    let existingUser = await User.findById(userId);

    const { instructions, resolution = "2K" } = req.body;
    const keepLabels = req.body.labels !== "none";

    if (!existingUser || existingUser.credits < creditCost(resolution)) {
      return res
        .status(403)
        .json({ success: false, message: "Not Sufficient Credits!" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    // Crop away the empty margin so the plan fills the output frame
    const plan = await trimFloorPlan(req.file.buffer);
    const dataUri = `data:image/jpeg;base64,${plan.toString("base64")}`;

    const labelRule = keepLabels
      ? "- Keep every room name and dimension label from the original plan, copied character for character in the same position. Do NOT add any other text, borders, or watermarks."
      : "- Remove all text, room names, and dimension labels. No borders or watermarks.";

    let prompt = `
Use the provided 2D floor plan image as the ONLY reference.

Convert this floor plan into a realistic, high-quality 3D floor plan rendering viewed from a top-down perspective.

====================
STRICT REQUIREMENTS (NON-NEGOTIABLE):
====================
- The room layout, wall positions, room sizes, proportions, and circulation MUST match the original floor plan exactly.
- Do NOT modify, add, remove, or shift any walls, doors, windows, or structural elements.
- Maintain the same orientation and overall footprint of the floor plan.
- Do NOT rotate, mirror, crop, or distort the layout.
- Do NOT infer or guess missing architectural elements.

====================
3D VISUAL STYLE:
====================
- Create a fully furnished 3D floor plan suitable for real estate marketing.
- Use modern, neutral furniture with realistic scale.
- Apply natural flooring materials, clean wall colors, and realistic textures.
- Add appropriate fixtures such as beds, sofas, dining table, kitchen appliances, bathroom fittings, and storage.
- Keep styling minimal, clean, and universally appealing.

====================
BACKGROUND & LIGHTING (MANDATORY):
====================
- Background MUST be pure white (#FFFFFF).
- No gradients, no patterns, no colors, no environment scenes.
- The floor plan must appear cleanly isolated on the white background.
- Use soft, natural lighting with subtle shadows for depth.

====================
CAMERA & RENDERING:
====================
- Top-down orthographic view (no perspective distortion).
- Clean, bright, and professional real estate presentation.
- Ultra-sharp, high-resolution output.
${labelRule}

====================
IMPORTANT:
====================
- This is a visualization only; the architectural layout must remain unchanged.
- User instructions must NEVER override layout accuracy, orientation, structure, or background color.
`;

    if (instructions) {
      // add user instructions safely
      prompt += `
====================
USER INSTRUCTIONS (APPLY ONLY IF COMPATIBLE WITH ABOVE RULES):
====================
${instructions}
`;
    }

    // Nano Banana Pro Request
    const result = await generateWithCredit(userId, creditCost(resolution), () =>
      fal.subscribe("fal-ai/nano-banana-pro/edit", {
        input: {
          image_urls: [dataUri],
          prompt: prompt,
          num_images: 1,
          aspect_ratio: "auto",
          output_format: "jpeg",
          resolution: resolution,
        },
      }),
    );

    if (!result) {
      return res
        .status(403)
        .json({ success: false, message: "Not Sufficient Credits!" });
    }

    // The trimmed plan, so the before/after slider lines up with the result
    const preview = await sharp(plan)
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    res.json({
      success: true,
      imageUrl: result.data.images[0].url,
      inputImage: `data:image/jpeg;base64,${preview.toString("base64")}`,
    });

    // Keep a copy in the user's history (runs after the response is sent)
    saveGeneration({
      userId,
      tool: "floor-plan-3d",
      file: { buffer: plan },
      outputUrl: result.data.images[0].url,
      settings: { instructions, resolution, labels: keepLabels ? "keep" : "none" },
    });
  } catch (err) {
    console.error("Fal Generation Error:", err);
    res
      .status(500)
      .json({ success: false, error: err.message || "Generation failed" });
  }
};

// 🔒 Internal-only feature (no public route link). Replaces the material/texture
// of a specific object in a room photo with an uploaded texture swatch.
const replaceTexture = async (req, res) => {
  try {
    const userId = req.user.sub;
    let existingUser = await User.findById(userId);

    const {
      objectName,
      instructions = "",
      resolution = "2K",
    } = req.body;

    const finishType = req.body.finishType?.trim() || "as shown";

    if (!existingUser || existingUser.credits < creditCost(resolution)) {
      return res
        .status(403)
        .json({ success: false, message: "Not Sufficient Credits!" });
    }

    const roomFile = req.files?.roomImage?.[0];
    const textureFile = req.files?.textureImage?.[0];

    if (!roomFile) {
      return res.status(400).json({ error: "No room image uploaded" });
    }
    if (!textureFile) {
      return res.status(400).json({ error: "No texture image uploaded" });
    }
    if (!objectName || !objectName.trim()) {
      return res
        .status(400)
        .json({ error: "Please specify the object to retexture" });
    }

    const target = objectName.trim();

    // Convert both buffers to Data URIs
    const roomDataUri = `data:${roomFile.mimetype};base64,${roomFile.buffer.toString(
      "base64"
    )}`;
    const textureDataUri = `data:${
      textureFile.mimetype
    };base64,${textureFile.buffer.toString("base64")}`;

    const basePrompt = `You are given two images.
- IMAGE 1 is a photograph of a room/interior.
- IMAGE 2 is a material/texture swatch.

TASK: In IMAGE 1, replace ONLY the surface material/texture of the "${target}" with the material shown in IMAGE 2. Apply a ${finishType} finish to that surface.

STRICT RULES (must follow):
- Change ONLY the material/texture of the ${target}. Do NOT modify any other object, surface, wall, floor, ceiling, or background.
- Keep the exact shape, size, edges, thickness, and position of the ${target} unchanged.
- The camera position, angle, lens, perspective, and field of view MUST remain identical to IMAGE 1.
- Do NOT crop, zoom, rotate, widen, or reframe the image.
- The new material must follow the object's geometry, perspective, seams, and curvature realistically.
- Preserve the original lighting, shadows, highlights, and reflections, and make the new material react to that lighting so it looks photorealistic and naturally integrated.
- A ${finishType} finish: match the appropriate level of reflectivity, sheen, and specular highlights for that finish.
- No people, pets, text, watermarks, logos, or branding.

The final image must look like a naturally photographed real-world room where only the ${target}'s material was changed.`;

    const finalPrompt = instructions?.trim()
      ? `${basePrompt}

USER EXTRA INSTRUCTIONS:
${instructions.trim()}`
      : basePrompt;

    // Nano Banana 2 Request — IMAGE 1 = room, IMAGE 2 = texture swatch
    const result = await generateWithCredit(userId, creditCost(resolution), () =>
      fal.subscribe("fal-ai/nano-banana-2/edit", {
        input: {
          image_urls: [roomDataUri, textureDataUri],
          prompt: finalPrompt,
          num_images: 1,
          aspect_ratio: "auto",
          output_format: "jpeg",
          resolution: resolution,
        },
      }),
    );

    if (!result) {
      return res
        .status(403)
        .json({ success: false, message: "Not Sufficient Credits!" });
    }

    res.json({
      success: true,
      imageUrl: result.data.images[0].url,
    });
  } catch (err) {
    console.error("Fal Generation Error:", err);
    res
      .status(500)
      .json({ success: false, error: err.message || "Generation failed" });
  }
};

// 🔒 Internal-only feature (no public route link). Swaps a specific object in a
// room photo for an alternative, described by text and/or a reference image.
const replaceObject = async (req, res) => {
  try {
    const userId = req.user.sub;
    let existingUser = await User.findById(userId);

    const {
      objectName,
      replacementDescription = "",
      instructions = "",
      resolution = "2K",
    } = req.body;

    if (!existingUser || existingUser.credits < creditCost(resolution)) {
      return res
        .status(403)
        .json({ success: false, message: "Not Sufficient Credits!" });
    }

    const roomFile = req.files?.roomImage?.[0];
    const referenceFile = req.files?.referenceImage?.[0];

    if (!roomFile) {
      return res.status(400).json({ error: "No room image uploaded" });
    }
    if (!objectName || !objectName.trim()) {
      return res
        .status(400)
        .json({ error: "Please specify the object to replace" });
    }

    const hasReference = !!referenceFile;
    const description = replacementDescription.trim();

    if (!hasReference && !description) {
      return res.status(400).json({
        error:
          "Please provide a replacement reference image and/or a description",
      });
    }

    const target = objectName.trim();

    // Convert room buffer to a Data URI
    const roomDataUri = `data:${roomFile.mimetype};base64,${roomFile.buffer.toString(
      "base64"
    )}`;

    // Build the image_urls list: room first, optional reference second
    const imageUrls = [roomDataUri];
    if (hasReference) {
      const referenceDataUri = `data:${
        referenceFile.mimetype
      };base64,${referenceFile.buffer.toString("base64")}`;
      imageUrls.push(referenceDataUri);
    }

    const referenceClause = hasReference
      ? `Use the object shown in IMAGE 2 (a reference photo of the replacement ${target}) as the design to place into the room.`
      : "";

    const descriptionClause = description
      ? `The replacement ${target} should match this description: ${description}.`
      : "";

    const basePrompt = `${
      hasReference
        ? `You are given two images.
- IMAGE 1 is a photograph of a room/interior.
- IMAGE 2 is a reference photo of a replacement ${target}.`
        : `You are given a photograph of a room/interior.`
    }

TASK: In ${
      hasReference ? "IMAGE 1" : "the room photo"
    }, remove the existing ${target} and replace it with an alternative ${target}.
${referenceClause}
${descriptionClause}

STRICT RULES (must follow):
- Replace ONLY the ${target}. Do NOT modify any other object, surface, wall, floor, ceiling, window, or background.
- Place the new ${target} in the SAME position and footprint as the original, at realistic real-world scale and correct proportions for the room.
- The camera position, angle, lens, perspective, and field of view MUST remain identical to the input photo.
- Do NOT crop, zoom, rotate, widen, or reframe the image.
- Preserve the original lighting, shadows, highlights, and reflections, and make the new ${target} cast and receive shadows consistent with that lighting so it looks photorealistic and naturally integrated.
- Cleanly fill any area revealed by removing the original ${target} so there are no artifacts, ghosting, or blurry patches.
- No people, pets, text, watermarks, logos, or branding.

The final image must look like a naturally photographed real-world room where only the ${target} was swapped for an alternative.`;

    const finalPrompt = instructions?.trim()
      ? `${basePrompt}

USER EXTRA INSTRUCTIONS:
${instructions.trim()}`
      : basePrompt;

    // Nano Banana 2 Request — IMAGE 1 = room, IMAGE 2 (optional) = replacement reference
    const result = await generateWithCredit(userId, creditCost(resolution), () =>
      fal.subscribe("fal-ai/nano-banana-2/edit", {
        input: {
          image_urls: imageUrls,
          prompt: finalPrompt,
          num_images: 1,
          aspect_ratio: "auto",
          output_format: "jpeg",
          resolution: resolution,
        },
      }),
    );

    if (!result) {
      return res
        .status(403)
        .json({ success: false, message: "Not Sufficient Credits!" });
    }

    res.json({
      success: true,
      imageUrl: result.data.images[0].url,
    });
  } catch (err) {
    console.error("Fal Generation Error:", err);
    res
      .status(500)
      .json({ success: false, error: err.message || "Generation failed" });
  }
};

const generateDescription = async (req, res) => {
  try {
    const {
      propertyDetails,
      cityState,
      listingType,
      tone = "Professional",
      length = 180,
    } = req.body;

    if (!propertyDetails || !cityState || !listingType) {
      return res.status(400).json({
        success: false,
        error: "propertyDetails, cityState, and listingType are required.",
      });
    }

    if (
      String(cityState).length > 100 ||
      String(listingType).length > 50 ||
      String(tone).length > 50 ||
      !(Number(length) > 0 && Number(length) <= 400)
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid input.",
      });
    }

    if (propertyDetails.length > 800) {
      return res.status(400).json({
        success: false,
        error: "Property details too long.",
      });
    }

    const cleanDetails = propertyDetails.trim().replace(/\s+/g, " ");

    const prompt = `
You are a professional real estate copywriter.

Write a natural, engaging property description based on the details below.
Focus on lifestyle benefits. Avoid robotic language.
No headings or bullet points. End with a soft call-to-action.

Details: ${cleanDetails}
Location: ${cityState}
Listing Type: ${listingType}
Tone: ${tone}
Length: ${length} words
`;

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      max_output_tokens: 500,
    });

    return res.json({
      success: true,
      description: response.output_text,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Something went wrong.",
    });
  }
};

// Hosts an edit's source image may come from: fal's CDN (fresh results) and
// our own R2 bucket (signed links from the user's history). Anything else is
// refused, so the endpoint can't be used to fetch arbitrary URLs.
const isAllowedSourceUrl = (value) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname;
    if (host === "fal.media" || host.endsWith(".fal.media")) return true;

    // Signed R2 links put the bucket in front: <bucket>.<account>.r2.cloudflarestorage.com
    const { R2_ACCOUNT_ID, R2_BUCKET } = process.env;
    if (!R2_ACCOUNT_ID) return false;
    const r2Host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    return host === r2Host || (Boolean(R2_BUCKET) && host === `${R2_BUCKET}.${r2Host}`);
  } catch {
    return false;
  }
};

const MAX_EDIT_LENGTH = 500;

// POST /api/edit-image { imageUrl, instruction, resolution }
// Makes one described change to a generated image and keeps everything else.
const editImage = async (req, res) => {
  try {
    const userId = req.user.sub;
    const { imageUrl, resolution } = req.body;
    const instruction = String(req.body.instruction || "").trim();

    if (!instruction) {
      return res.status(400).json({ success: false, error: "Describe the change you want." });
    }
    if (instruction.length > MAX_EDIT_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `Keep the description under ${MAX_EDIT_LENGTH} characters.`,
      });
    }
    if (!isAllowedSourceUrl(imageUrl)) {
      let host = "invalid URL";
      try {
        host = new URL(imageUrl).hostname;
      } catch {}
      console.warn(`Edit refused: image host not allowed (${host})`);
      return res.status(400).json({ success: false, error: "This image can't be edited." });
    }

    const existingUser = await User.findById(userId);
    if (!existingUser || existingUser.credits < creditCost(resolution)) {
      return res
        .status(403)
        .json({ success: false, message: "Not Sufficient Credits!" });
    }

    // Our copy of the source: needed for the layout check and the history
    const sourceResponse = await fetch(imageUrl);
    if (!sourceResponse.ok) {
      return res.status(400).json({
        success: false,
        error: "The image link has expired. Reopen the image and try again.",
      });
    }
    const source = Buffer.from(await sourceResponse.arrayBuffer());
    const dataUri = `data:image/jpeg;base64,${source.toString("base64")}`;

    const prompt = `Edit the provided real estate photo. Make ONLY this change:
${instruction}

STRICT RULES and this is a must:
- Change nothing except what the instruction above asks for. Every other piece of furniture, decor item, wall, window, door, floor, and ceiling must stay exactly as it is.
- The camera position, angle, lens perspective, and field of view MUST remain identical to the input image.
- Do NOT crop, zoom, rotate, widen, or reframe the image.
- Every window, door, doorway, closet, and opening MUST stay in exactly the same place and size, fully visible.
- Preserve the original lighting, shadows, and reflections, adjusted only where the edited object requires it.
- Anything added must be realistic and to real-world scale.
- No people, pets, text, watermarks, logos, or branding.
- The result must look like the same naturally photographed room.`;

    const editOnce = async () => {
      const response = await fal.subscribe("fal-ai/nano-banana-pro/edit", {
        input: {
          image_urls: [dataUri],
          prompt,
          num_images: 1,
          aspect_ratio: "auto",
          output_format: "jpeg",
          resolution,
        },
      });
      const url = response.data.images[0].url;
      try {
        const output = Buffer.from(await (await fetch(url)).arrayBuffer());
        return { url, output, score: await alignmentScore(source, output) };
      } catch (checkErr) {
        console.error("Edit check skipped:", checkErr.message);
        return { url, output: null, score: 1 };
      }
    };

    // If the whole image no longer lines up with the source (camera moved or
    // room reframed), retry once on the same credit and keep the better one.
    const result = await generateWithCredit(userId, creditCost(resolution), async () => {
      let best = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const take = await editOnce();
        if (!best || take.score > best.score) best = take;
        if (take.score >= EDIT_ALIGNMENT_THRESHOLD) break;
        console.warn(`Edit alignment check failed (attempt ${attempt}, score ${take.score.toFixed(2)})`);
      }
      return best;
    });

    if (!result) {
      return res
        .status(403)
        .json({ success: false, message: "Not Sufficient Credits!" });
    }

    res.json({ success: true, imageUrl: result.url });

    saveGeneration({
      userId,
      tool: "edit",
      file: { buffer: source },
      outputUrl: result.url,
      outputBuffer: result.output,
      settings: { instructions: instruction, resolution },
    });
  } catch (err) {
    console.error("Edit Error:", err);
    res.status(500).json({ success: false, error: err.message || "Edit failed" });
  }
};

export default {
  editImage,
  generateStagedImage,
  furnitureRemoval,
  dayToDusk,
  floorPlan3D,
  replaceTexture,
  replaceObject,
  generateDescription,
};
