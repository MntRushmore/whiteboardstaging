/**
 * The illustrator eval's corpus: what a director would ask the illustrator for in real lectures —
 * the owner's comic strip (the case that started free drawing: "four panels of a futuristic police
 * officer and his adversities"), science diagrams with labelled parts, history, business school,
 * geography, and a cat. Each is one request as the client sends it (`SketchRequestSchema`), at the
 * aspect the desk really asks for (measured on the planners): a panel of a four-panel strip is 0.81
 * (a little taller than wide), a single picture 1.57; the DNA at 1.05 (a panel of three) and the
 * solar system at 1.64 (a panel of two). Rounds 1 and 2 ran on guessed aspects (4:3, 1, 0.75, 0.6,
 * 1.8, 2), before the desk's were measured.
 */

export interface SketchCase {
  id: string;
  subject: string;
  prompt: string;
  cast?: string;
  panel?: { index: number; of: number };
  aspect: number;
  /** the comic this panel belongs to (panels are judged together for consistency) */
  comic?: string;
}

const POLICE_CAST =
  "Officer Vega: a tall futuristic police officer, rounded white helmet with a dark visor, long blue coat with a star badge, grey armoured boots. Pip: his small round grey hover-drone with one eye. A neon city at night.";

const POLICE_PANELS = [
  "Officer Vega stands on a rooftop at night looking over the futuristic city, Pip hovering beside him",
  "Officer Vega chases a masked thief across the rooftops, leaping the gap between two buildings",
  "A swarm of the thief's drones surrounds Officer Vega; he stands his ground, Pip hiding behind him",
  "At dawn, tired but smiling, Officer Vega hands a recovered glowing battery back to a grateful shopkeeper",
];

export const SKETCH_CASES: readonly SketchCase[] = [
  ...POLICE_PANELS.map((prompt, index) => ({ id: `comic-police-${index + 1}`, subject: "comic", prompt, cast: POLICE_CAST, panel: { index, of: 4 }, aspect: 0.81, comic: "comic-police" })),
  { id: "plant-cell", subject: "biology", prompt: "A plant cell with its parts labelled: cell wall, cell membrane, nucleus, chloroplasts, vacuole, mitochondria", aspect: 1.57 },
  { id: "heart", subject: "biology", prompt: "The human heart, with its four chambers and the main blood vessels", aspect: 1.57 },
  { id: "circuit", subject: "physics", prompt: "A simple electric circuit: a battery, an open switch and a light bulb joined by wires", aspect: 1.57 },
  { id: "volcano", subject: "geography", prompt: "A cross-section of a volcano, with the magma chamber, the vent and lava erupting from the crater", aspect: 1.57 },
  { id: "castle", subject: "history", prompt: "A medieval castle with towers, a drawbridge and flags", aspect: 1.57 },
  { id: "knight", subject: "history", prompt: "A knight in armour riding a horse and holding a lance", aspect: 1.57 },
  { id: "rocket", subject: "physics", prompt: "A rocket launching from its pad, with flames and smoke", aspect: 1.57 },
  { id: "handshake", subject: "business", prompt: "Two business people shaking hands over a deal, a signed contract on the table between them", aspect: 1.57 },
  { id: "storefront", subject: "business", prompt: "A small shop's storefront with a striped awning, a door, a window display and a sign that says OPEN", aspect: 1.57 },
  { id: "cold-call", subject: "business", prompt: "A salesperson at a desk wearing a headset, cold calling, with a laptop and a list of phone numbers", aspect: 1.57 },
  { id: "supply-chain", subject: "business", prompt: "A delivery truck driving from a warehouse full of boxes to a store", aspect: 1.57 },
  { id: "island", subject: "geography", prompt: "A map of a treasure island: its coastline, a mountain, palm trees, a river, and an X marking the treasure", aspect: 1.57 },
  { id: "dna", subject: "biology", prompt: "A DNA double helix, its two twisting strands and the base pairs between them", aspect: 1.05 },
  { id: "solar-system", subject: "physics", prompt: "The solar system: the sun and the eight planets in order, with Saturn's rings", aspect: 1.64 },
  { id: "cat", subject: "other", prompt: "A cat sitting and looking up", aspect: 1.57 },
];
