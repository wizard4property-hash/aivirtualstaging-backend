// Staging prompt and the style guides that tell the model what each style
// looks like. Without a guide the model guesses from the name alone, which
// made several styles look alike and furniture vary between rooms of the
// same listing.

// Keys match the `value` the dashboard sends. Guides describe furniture,
// colors, and materials only; lighting stays as photographed.
export const STYLE_GUIDES = {
  Transitional:
    "Timeless, broadly appealing mix of classic and modern. Warm neutral palette of greige, ivory, and taupe. Upholstered furniture with clean, classic silhouettes in linen or soft woven fabric. Mix of medium wood and brushed nickel finishes. Simple, subtly patterned rug. Balanced, uncluttered decor.",
  Modern:
    "Crisp and sleek. Black, white, and charcoal palette. Low-profile furniture with straight lines and flat surfaces. Matte black metal and glass accents. Minimal decor with one large abstract art piece. Solid or tonal rug.",
  Scandinavian:
    "Light and airy. Pale oak or birch wood, white, and soft gray. Simple furniture with rounded edges and slim tapered legs. Wool, sheepskin, and light linen textures. A few green plants. Very uncluttered.",
  Contemporary:
    "Current and design-forward. Soft curved and rounded furniture shapes. Warm neutrals with one muted accent color such as sage or terracotta. Mixed textures like boucle, velvet, and stone. Sculptural decor objects.",
  Midcentury:
    "1950s and 60s mid-century modern. Walnut and teak furniture with tapered legs and iconic organic shapes. Accents in mustard, burnt orange, and teal. Geometric patterns. Retro wall art.",
  Japandi:
    "Japanese and Scandinavian blend. Low-to-the-ground furniture. Contrast of light and dark wood. Linen in beige, clay, and charcoal. Handmade ceramics and a simple branch or bonsai arrangement. Calm, minimal, and natural.",
  Luxury:
    "High-end boutique hotel feel. Rich materials: velvet, marble, and brass or gold accents. Channel-tufted or tufted upholstery. Cream with deep jewel tones such as navy or emerald. Layered pillows and throws. Elegant but not cluttered.",
  Coastal:
    "Relaxed beach-house feel. White and sand palette with soft blue accents. Rattan, wicker, and whitewashed wood. Linen slipcovered upholstery. Natural fiber rug. Subtle coastal artwork.",
  Farmhouse:
    "Modern farmhouse. White and cream with black accents. Reclaimed and distressed wood. Plank-style headboards and benches. Woven baskets. Plaid or buffalo-check textiles. Galvanized metal details.",
  Industrial:
    "Urban loft look. Dark leather, black steel, and raw reclaimed wood. Cognac, charcoal, and rust tones. Metal-frame furniture with exposed hardware. Vintage-style distressed rug.",
  Minimalist:
    "Only the essential furniture pieces, with lots of open floor space. Monochrome white, beige, and light gray. Clean geometric forms. Almost no decor and no clutter.",
  Traditional:
    "Classic and elegant. Dark cherry or mahogany wood. Rolled-arm and wingback upholstery. Burgundy, navy, and cream palette. Persian-style or damask-pattern rug. Framed classic artwork. Symmetrical arrangement.",
};

// Older clients sent "Standard", which is now called Transitional
const ALIASES = { Standard: "Transitional" };

export const buildStagingPrompt = ({ roomType, style: requestedStyle, instructions }) => {
  const style = ALIASES[requestedStyle] || requestedStyle;
  const guide = STYLE_GUIDES[style];

  const basePrompt = `Use the provided ${roomType} image as the ONLY reference.
    Virtually stage the ${roomType} in a ${style} interior design style.

    STRICT RULES and this is a must:
    - The camera position, angle, lens perspective, and field of view MUST remain identical to the input image.
    - The room layout, walls, windows, doors, ceiling, floor, and architectural elements MUST NOT be altered.
    - Every window, door, doorway, closet, and opening MUST stay in exactly the same place and size, fully visible. Do NOT add, remove, move, resize, or cover any of them.
    - Do NOT add curtains, drapes, or blinds that cover windows, and do NOT add mirrors or artwork that could look like a new window or door.
    - Do NOT crop, zoom, rotate, widen, or reframe the image.
    - Do NOT generate a new viewpoint or alternate angle.
    - Preserve the original lighting, shadows, and reflections EXACTLY as in the input photo.
    - Do NOT add, remove, or modify any light sources.
    - Add furniture and decor ONLY where physically realistic within the existing space.
	- All furniture must be to real-world scale and correctly proportioned to the room dimensions.

    MLS COMPLIANCE:
    - No people, pets, text, watermarks, logos, or branding.
    - Furniture must be neutral, realistic, and proportional.
    - No dramatic effects, artistic lighting, or exaggerated decor.
    - Final image must look like a naturally photographed staged home.

    IMPORTANT:
    - Treat this as a furniture overlay on top of the original photograph.
    - The output must be a 1:1 geometric match with the input image.

    again do not change camera angle view, this is very important
    `;

    // The style guide comes after every rule, as furniture detail only, so
    // the camera and room rules above keep exactly the same weight as before.
    const styledPrompt = guide
      ? `${basePrompt}

STYLE DETAILS (furniture and decor only; every rule above still applies and the camera angle must not change):
${guide}`
      : basePrompt;

    const finalPrompt = instructions?.trim()
      ? `${styledPrompt}

USER EXTRA INSTRUCTIONS:
${instructions.trim()}`
      : styledPrompt;

    return finalPrompt;
};
