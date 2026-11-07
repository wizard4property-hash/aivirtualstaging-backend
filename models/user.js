import mongoose from "mongoose";

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    googleId: { type: String, unique: true, sparse: true },
    // Legacy id from when sign-in went through Supabase; kept for old records
    supabaseId: { type: String, unique: true, sparse: true },
    email: { type: String, required: true },
    credits: { type: Number, default: 1 }, // 1 free credit on sign-up
    isPaid: { type: Boolean, default: false },
    synced: { type: Boolean, default: false },
    usage: { type: Number, default: 0 },
    processedPayments: { type: [String], default: [] },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model("User", userSchema);

// The original supabaseId index was unique but not sparse, which would reject
// every new Google-only user after the first (they all count as null).
// Rebuild it as sparse once; afterwards this is a no-op.
export const ensureUserIndexes = async () => {
  const indexes = await User.collection.indexes();
  const legacy = indexes.find((i) => i.name === "supabaseId_1");
  if (legacy && !legacy.sparse) {
    await User.collection.dropIndex("supabaseId_1");
    console.log("Dropped non-sparse supabaseId index");
  }
  await User.syncIndexes();
};

export default User;
