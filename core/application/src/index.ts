/**
 * @yaoyao/application — YaoYao Core application layer.
 *
 * Use cases orchestrate domain aggregates through ports; this layer owns
 * authorization checks and transaction boundaries. It may depend on
 * @yaoyao/domain only — never on infrastructure, http, or apps.
 */
export * from "./ports/persistence/index.js";
export {
  initializeYaoYao,
  type InitializeYaoYaoInput,
  type InitializationResult,
} from "./usecases/initialize.js";
