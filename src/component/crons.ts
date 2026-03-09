import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

// Built-in daily cleanup of expired and revoked tokens
crons.daily(
  "cleanup expired tokens",
  { hourUTC: 3, minuteUTC: 0 },
  internal.public.cleanupCron
);

export default crons;
