import { defineApp } from "convex/server";
import apiTokens from "../../src/component/convex.config.js";

const app = defineApp();
app.use(apiTokens);

export default app;
