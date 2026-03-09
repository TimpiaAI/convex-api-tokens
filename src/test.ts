/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./component/schema.js";
const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register the component with a convex-test instance.
 * @param t - The test convex instance from calling `convexTest`.
 * @param name - The component name as registered in convex.config.ts.
 */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "apiTokens"
) {
  t.registerComponent(name, schema, modules);
}

export default { register, schema, modules };
