import sharp from "sharp";

// Checks that a staged image kept the original room: same camera, and the
// same windows, doors, closets, and wall lines. Staging adds furniture in
// front of the room but shouldn't erase its structure, so we take the
// strongest lines in the original photo and check that each region of the
// result still has them. A moved camera, a removed closet, or a new wall
// wipes out the lines in at least one region.
//
// Calibrated on hand-checked results: kept rooms scored 0.93+, changed
// rooms 0.55 or lower.
export const LAYOUT_THRESHOLD = 0.75;

const WIDTH = 160; // analysis width in pixels
const TOP_SHARE = 0.65; // upper part of the frame: walls, windows, doors
const EDGE_PERCENTILE = 0.9; // only the strongest 10% of lines count
const COLS = 6;
const ROWS = 4;
const MIN_EDGES = 25; // ignore regions with almost no structure (blank wall)

const grayscale = (buffer, height) =>
  sharp(buffer)
    .rotate()
    .resize(WIDTH, height, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();

const edgeMap = (data, height) => {
  const out = new Float64Array(WIDTH * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < WIDTH - 1; x += 1) {
      const i = y * WIDTH + x;
      out[i] = Math.hypot(data[i + 1] - data[i - 1], data[i + WIDTH] - data[i - WIDTH]);
    }
  }
  return out;
};

// Returns 0–1: the share of the original's strong lines still present in the
// worst-matching region of the result.
export const layoutScore = async (inputBuffer, outputBuffer) => {
  const meta = await sharp(inputBuffer).rotate().metadata();
  const height = Math.max(16, Math.round((WIDTH * meta.height) / meta.width));

  const [a, b] = (
    await Promise.all([grayscale(inputBuffer, height), grayscale(outputBuffer, height)])
  ).map((data) => edgeMap(data, height));

  const rows = Math.round(height * TOP_SHARE);
  const values = Array.from(a.subarray(0, WIDTH * rows)).sort((p, q) => p - q);
  const threshold = Math.max(values[Math.floor(values.length * EDGE_PERCENTILE)], 12);

  const total = new Array(COLS * ROWS).fill(0);
  const kept = new Array(COLS * ROWS).fill(0);

  for (let y = 1; y < rows; y += 1) {
    for (let x = 1; x < WIDTH - 1; x += 1) {
      if (a[y * WIDTH + x] < threshold) continue;

      const tile =
        Math.min(ROWS - 1, Math.floor((y / rows) * ROWS)) * COLS +
        Math.min(COLS - 1, Math.floor((x / WIDTH) * COLS));
      total[tile] += 1;

      // Allow one pixel of slack around each line
      let strongest = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          strongest = Math.max(strongest, b[(y + dy) * WIDTH + (x + dx)]);
        }
      }
      if (strongest >= threshold * 0.5) kept[tile] += 1;
    }
  }

  let worst = 1;
  for (let t = 0; t < total.length; t += 1) {
    if (total[t] >= MIN_EDGES) worst = Math.min(worst, kept[t] / total[t]);
  }
  return worst;
};

// Whole-image alignment (-1 to 1) between an image and an edited version of
// it. An edit changes one object, so nearly everything still lines up; a
// moved camera shifts everything. Used for edits instead of layoutScore,
// which would flag the very objects an edit is asked to remove.
//
// Calibrated on real edits (0.92–0.99, all kept the room) and simulated
// camera moves of 3–6% zoom, pan, or tilt (0.50–0.82).
export const EDIT_ALIGNMENT_THRESHOLD = 0.85;

export const alignmentScore = async (beforeBuffer, afterBuffer) => {
  const width = 128;
  const meta = await sharp(beforeBuffer).rotate().metadata();
  const height = Math.max(16, Math.round((width * meta.height) / meta.width));

  const edges = async (buffer) => {
    const data = await sharp(buffer)
      .rotate()
      .resize(width, height, { fit: "fill" })
      .grayscale()
      .blur(0.8)
      .raw()
      .toBuffer();
    const out = new Float64Array(width * height);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x;
        out[i] = Math.hypot(data[i + 1] - data[i - 1], data[i + width] - data[i - width]);
      }
    }
    return out;
  };

  const [a, b] = await Promise.all([edges(beforeBuffer), edges(afterBuffer)]);
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < a.length; i += 1) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= a.length;
  meanB /= b.length;

  let num = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    varA += da * da;
    varB += db * db;
  }
  return num / Math.sqrt(varA * varB + 1e-9);
};
