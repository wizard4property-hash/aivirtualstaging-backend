import mongoose from "mongoose";
import sharp from "sharp";

import Generation from "../models/generation.js";
import { r2Enabled, putObject, signedUrl, deleteObjects } from "../lib/r2.js";

const PAGE_SIZE = 24;

// Copies a finished generation (input photo, result, and a small thumbnail)
// into R2 and records it in the user's history. Called without awaiting,
// after the result has already been sent, so it never slows a generation.
// Failures are logged; the user still has their result on screen.
export const saveGeneration = async ({
  userId,
  tool,
  file,
  outputUrl,
  outputBuffer,
  settings,
}) => {
  if (!r2Enabled || !file || !outputUrl) return;

  try {
    const id = new mongoose.Types.ObjectId();
    const prefix = `users/${userId}/${id}`;

    // Reuse the result if the caller already downloaded it
    let output = outputBuffer;
    if (!output) {
      const response = await fetch(outputUrl);
      if (!response.ok) throw new Error(`Fetching result failed: ${response.status}`);
      output = Buffer.from(await response.arrayBuffer());
    }

    const [input, thumb, meta] = await Promise.all([
      sharp(file.buffer).rotate().jpeg({ quality: 90 }).toBuffer(),
      sharp(output).resize({ width: 640 }).jpeg({ quality: 78 }).toBuffer(),
      sharp(output).metadata(),
    ]);

    const keys = {
      inputKey: `${prefix}/input.jpg`,
      outputKey: `${prefix}/output.jpg`,
      thumbKey: `${prefix}/thumb.jpg`,
    };

    await Promise.all([
      putObject(keys.inputKey, input),
      putObject(keys.outputKey, output),
      putObject(keys.thumbKey, thumb),
    ]);

    await Generation.create({
      _id: id,
      user: userId,
      tool,
      settings,
      ...keys,
      width: meta.width,
      height: meta.height,
    });
  } catch (err) {
    console.error("Saving generation failed:", err);
  }
};

// GET /api/generations?before=<ISO date>
// Newest first, one page at a time, with signed URLs valid for an hour.
export const listGenerations = async (req, res) => {
  if (!r2Enabled) return res.json({ enabled: false, items: [], nextCursor: null });

  try {
    const filter = { user: req.user.sub };
    const before = req.query.before ? new Date(req.query.before) : null;
    if (before && !Number.isNaN(before.getTime())) filter.createdAt = { $lt: before };

    const docs = await Generation.find(filter)
      .sort({ createdAt: -1 })
      .limit(PAGE_SIZE + 1)
      .lean();

    const page = docs.slice(0, PAGE_SIZE);
    const items = await Promise.all(
      page.map(async (doc) => ({
        id: doc._id,
        tool: doc.tool,
        settings: doc.settings || {},
        width: doc.width,
        height: doc.height,
        createdAt: doc.createdAt,
        thumbUrl: await signedUrl(doc.thumbKey),
        inputUrl: await signedUrl(doc.inputKey),
        outputUrl: await signedUrl(doc.outputKey),
      }))
    );

    res.json({
      enabled: true,
      items,
      nextCursor:
        docs.length > PAGE_SIZE ? page[page.length - 1].createdAt.toISOString() : null,
    });
  } catch (err) {
    console.error("Listing generations failed:", err);
    res.status(500).json({ success: false, error: "Couldn't load your images" });
  }
};

// DELETE /api/generations/:id
export const deleteGeneration = async (req, res) => {
  if (!r2Enabled) return res.status(404).json({ success: false });

  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, error: "Not found" });
    }

    const doc = await Generation.findOne({ _id: req.params.id, user: req.user.sub });
    if (!doc) return res.status(404).json({ success: false, error: "Not found" });

    await deleteObjects([doc.inputKey, doc.outputKey, doc.thumbKey]);
    await doc.deleteOne();
    res.json({ success: true });
  } catch (err) {
    console.error("Deleting generation failed:", err);
    res.status(500).json({ success: false, error: "Couldn't delete the image" });
  }
};
