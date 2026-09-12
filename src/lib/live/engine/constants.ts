/**
 * Physical constants for the local engine.
 *
 * Two scopes:
 * - "instance": registered on the mathjs instance (names the LaTeX translator never treats as variables:
 *   hbar, k_B, N_A, epsilon_0, mu_0).
 * - "physics": single letters that are ordinary variables in algebra (g, c, h, G, R, e) — supplied as an
 *   evaluation scope only when a line carries units (a "physics line").
 *
 * Pure TypeScript; the mathjs instance is passed in.
 */
import type { MathJsInstance } from "mathjs";

export interface PhysicalConstant {
  name: string;
  latex: string;
  value: number;
  /** mathjs unit string, or null for a dimensionless constant */
  unit: string | null;
  description: string;
  scope: "instance" | "physics";
}

export const PHYSICAL_CONSTANTS: readonly PhysicalConstant[] = [
  { name: "g", latex: "g", value: 9.80665, unit: "m/s^2", description: "standard gravity", scope: "physics" },
  { name: "c", latex: "c", value: 299_792_458, unit: "m/s", description: "speed of light", scope: "physics" },
  { name: "h", latex: "h", value: 6.62607015e-34, unit: "J s", description: "Planck constant", scope: "physics" },
  { name: "hbar", latex: "\\hbar", value: 1.054571817e-34, unit: "J s", description: "reduced Planck constant", scope: "instance" },
  { name: "k_B", latex: "k_B", value: 1.380649e-23, unit: "J/K", description: "Boltzmann constant", scope: "instance" },
  { name: "N_A", latex: "N_A", value: 6.02214076e23, unit: "1/mol", description: "Avogadro constant", scope: "instance" },
  { name: "e", latex: "e", value: 1.602176634e-19, unit: "C", description: "elementary charge (physics lines only)", scope: "physics" },
  { name: "G", latex: "G", value: 6.6743e-11, unit: "m^3/(kg s^2)", description: "gravitational constant", scope: "physics" },
  { name: "R", latex: "R", value: 8.314462618, unit: "J/(mol K)", description: "gas constant", scope: "physics" },
  { name: "epsilon_0", latex: "\\epsilon_0", value: 8.8541878128e-12, unit: "F/m", description: "vacuum permittivity", scope: "instance" },
  { name: "mu_0", latex: "\\mu_0", value: 1.25663706212e-6, unit: "N/A^2", description: "vacuum permeability", scope: "instance" },
];

export const PHYSICS_SCOPE_NAMES: ReadonlySet<string> = new Set(
  PHYSICAL_CONSTANTS.filter((c) => c.scope === "physics").map((c) => c.name),
);

function constantValue(math: MathJsInstance, c: PhysicalConstant): unknown {
  if (c.unit === null) return c.value;
  return math.unit(c.value, c.unit);
}

/** Registers the instance-scope constants (hbar, k_B, N_A, epsilon_0, mu_0). Idempotent. */
export function registerConstants(math: MathJsInstance): void {
  const entries: Record<string, unknown> = {};
  for (const c of PHYSICAL_CONSTANTS) {
    if (c.scope !== "instance") continue;
    entries[c.name] = constantValue(math, c);
  }
  math.import(entries, { override: true });
}

/** Evaluation scope for lines that carry units: g, c, h, G, R and e as the elementary charge. */
export function physicsScope(math: MathJsInstance): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const c of PHYSICAL_CONSTANTS) {
    if (c.scope !== "physics") continue;
    scope[c.name] = constantValue(math, c);
  }
  return scope;
}

export function findConstant(name: string): PhysicalConstant | undefined {
  return PHYSICAL_CONSTANTS.find((c) => c.name === name);
}
