import mongoose from "mongoose";

const { Schema } = mongoose;

// One saved result per successful generation, with its files in R2.
const generationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tool: {
      type: String,
      enum: ["staging", "furniture-removal", "day-to-dusk", "floor-plan-3d", "edit"],
      required: true,
    },
    settings: {
      roomType: String,
      style: String,
      instructions: String,
      resolution: String,
      labels: String,
    },
    inputKey: { type: String, required: true },
    outputKey: { type: String, required: true },
    thumbKey: { type: String, required: true },
    width: Number,
    height: Number,
  },
  { timestamps: true }
);

generationSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("Generation", generationSchema);
