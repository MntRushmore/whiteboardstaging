/**
 * GEOMETRY PROOFS on the scoreboard (Common Core G-CO.9–10, G-SRT.5): two-column proofs as a
 * student writes them — a Given line, a Prove line, a figure, then rows of `statement | reason` —
 * one LaTeX string per statement and per reason, as Mathpix returns them.
 *
 * Each problem carries its figure the way the tutor reads one (`FigureRead`: every labelled point
 * roughly where it is, x right and y down, and every straight line drawn through the labelled
 * points on it), and a full correct proof. `npm run eval:proofs` (src/__eval__/proofs.test.ts)
 * checks every row of every proof, seeds errors into them, and has the planner finish each proof
 * from every prefix. The report is `docs/eval/proofs.md`.
 */
import type { FigureRead } from "@/lib/live/proof/figure";

export type ProofTopic =
  | "sss"
  | "sas"
  | "asa"
  | "aas"
  | "hl"
  | "cpctc"
  | "vertical"
  | "midpoint"
  | "bisector"
  | "parallel"
  | "isosceles"
  | "reflexive"
  | "transitive"
  | "multi-step";

export interface ProofCase {
  id: string;
  topics: readonly ProofTopic[];
  /** the Given line after `Given:` (LaTeX) */
  given: string;
  /** the Prove line after `Prove:` (LaTeX) */
  prove: string;
  figure: FigureRead;
  /** the proof: [statement, reason] per row, as a student writes them */
  rows: ReadonlyArray<readonly [string, string]>;
  note: string;
}

/** A kite A–B–C–D with its diagonal BD. */
const KITE: FigureRead = { points: { A: [0, 50], B: [50, 0], C: [100, 50], D: [50, 110] }, lines: ["AB", "BC", "CD", "DA", "BD"] };
/** AD and BC crossing at E, their midpoint: A top-left, D bottom-right, B bottom-left, C top-right. */
const CROSS: FigureRead = { points: { A: [0, 0], B: [0, 100], C: [100, 0], D: [100, 100], E: [50, 50] }, lines: ["AED", "BEC", "AB", "CD"] };
/** A parallelogram ABCD with its diagonal BD. */
const PARALLELOGRAM: FigureRead = { points: { A: [0, 0], B: [100, 0], C: [130, 80], D: [30, 80] }, lines: ["AB", "BC", "CD", "DA", "BD"] };
/** AB ∥ CD, AD and BC crossing at E (the middle of both). */
const BOWTIE: FigureRead = { points: { A: [0, 0], B: [80, 0], C: [20, 100], D: [100, 100], E: [50, 50] }, lines: ["AED", "BEC", "AB", "CD"] };
/** An isosceles triangle ABC (apex A) with D the foot of the altitude / the midpoint of BC. */
const ISOSCELES_ALTITUDE: FigureRead = { points: { A: [50, 0], B: [0, 100], C: [100, 100], D: [50, 100] }, lines: ["BDC", "AB", "AC", "AD"] };
/** B above the middle D of AC, BD the altitude. */
const ALTITUDE_B: FigureRead = { points: { A: [0, 100], B: [50, 0], C: [100, 100], D: [50, 100] }, lines: ["ADC", "AB", "BC", "BD"] };
/** C above the middle M of AB. */
const PERP_BISECTOR: FigureRead = { points: { A: [0, 100], B: [100, 100], M: [50, 100], C: [50, 0] }, lines: ["AMB", "CM", "AC", "BC"] };

export const GEOMETRY_PROOFS: readonly ProofCase[] = [
  {
    id: "gp-01",
    topics: ["sss", "reflexive"],
    given: "\\overline{AB} \\cong \\overline{CB}, \\ \\overline{AD} \\cong \\overline{CD}",
    prove: "\\triangle ABD \\cong \\triangle CBD",
    figure: KITE,
    rows: [
      ["\\overline{AB} \\cong \\overline{CB}", "\\text{Given}"],
      ["\\overline{AD} \\cong \\overline{CD}", "\\text{Given}"],
      ["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}"],
      ["\\triangle ABD \\cong \\triangle CBD", "\\text{SSS}"],
    ],
    note: "a kite: SSS with the shared diagonal",
  },
  {
    id: "gp-02",
    topics: ["sas", "midpoint", "vertical"],
    given: "E \\text{ is the midpoint of } \\overline{AD}, \\ E \\text{ is the midpoint of } \\overline{BC}",
    prove: "\\triangle ABE \\cong \\triangle DCE",
    figure: CROSS,
    rows: [
      ["E \\text{ is the midpoint of } \\overline{AD}", "\\text{Given}"],
      ["\\overline{AE} \\cong \\overline{ED}", "\\text{Def. of midpoint}"],
      ["E \\text{ is the midpoint of } \\overline{BC}", "\\text{Given}"],
      ["\\overline{BE} \\cong \\overline{EC}", "\\text{Def. of midpoint}"],
      ["\\angle AEB \\cong \\angle DEC", "\\text{Vertical } \\angle s"],
      ["\\triangle ABE \\cong \\triangle DCE", "\\text{SAS}"],
    ],
    note: "two segments bisecting each other: SAS with vertical angles",
  },
  {
    id: "gp-03",
    topics: ["asa", "parallel", "reflexive"],
    given: "\\overline{AB} \\parallel \\overline{DC}, \\ \\overline{AD} \\parallel \\overline{BC}",
    prove: "\\triangle ABD \\cong \\triangle CDB",
    figure: PARALLELOGRAM,
    rows: [
      ["\\overline{AB} \\parallel \\overline{DC}", "\\text{Given}"],
      ["\\angle ABD \\cong \\angle CDB", "\\text{Alt. int. } \\angle s"],
      ["\\overline{AD} \\parallel \\overline{BC}", "\\text{Given}"],
      ["\\angle ADB \\cong \\angle CBD", "\\text{Alt. int. } \\angle s"],
      ["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}"],
      ["\\triangle ABD \\cong \\triangle CDB", "\\text{ASA}"],
    ],
    note: "a parallelogram's diagonal: ASA from two pairs of alternate interior angles",
  },
  {
    id: "gp-04",
    topics: ["aas", "reflexive"],
    given: "\\angle A \\cong \\angle C, \\ \\angle ABD \\cong \\angle CBD",
    prove: "\\triangle ABD \\cong \\triangle CBD",
    figure: KITE,
    rows: [
      ["\\angle A \\cong \\angle C", "\\text{Given}"],
      ["\\angle ABD \\cong \\angle CBD", "\\text{Given}"],
      ["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}"],
      ["\\triangle ABD \\cong \\triangle CBD", "\\text{AAS}"],
    ],
    note: "AAS: the shared side is not between the two angles",
  },
  {
    id: "gp-05",
    topics: ["hl", "reflexive"],
    given: "\\overline{BD} \\perp \\overline{AC}, \\ \\overline{AB} \\cong \\overline{CB}",
    prove: "\\triangle ABD \\cong \\triangle CBD",
    figure: ALTITUDE_B,
    rows: [
      ["\\overline{BD} \\perp \\overline{AC}", "\\text{Given}"],
      ["\\angle ADB \\text{ and } \\angle CDB \\text{ are right angles}", "\\text{Def. of } \\perp"],
      ["\\overline{AB} \\cong \\overline{CB}", "\\text{Given}"],
      ["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}"],
      ["\\triangle ABD \\cong \\triangle CBD", "\\text{HL}"],
    ],
    note: "HL: right angles from the perpendicular",
  },
  {
    id: "gp-06",
    topics: ["sas", "bisector", "cpctc"],
    given: "\\overline{AB} \\cong \\overline{CB}, \\ \\overline{BD} \\text{ bisects } \\angle ABC",
    prove: "\\angle A \\cong \\angle C",
    figure: KITE,
    rows: [
      ["\\overline{AB} \\cong \\overline{CB}", "\\text{Given}"],
      ["\\overline{BD} \\text{ bisects } \\angle ABC", "\\text{Given}"],
      ["\\angle ABD \\cong \\angle CBD", "\\text{Def. of } \\angle \\text{ bisector}"],
      ["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}"],
      ["\\triangle ABD \\cong \\triangle CBD", "\\text{SAS}"],
      ["\\angle A \\cong \\angle C", "\\text{CPCTC}"],
    ],
    note: "an angle bisector, SAS, then CPCTC",
  },
  {
    id: "gp-07",
    topics: ["sas", "midpoint", "cpctc"],
    given: "M \\text{ is the midpoint of } \\overline{AB}, \\ \\overline{CM} \\perp \\overline{AB}",
    prove: "\\overline{AC} \\cong \\overline{BC}",
    figure: PERP_BISECTOR,
    rows: [
      ["M \\text{ is the midpoint of } \\overline{AB}", "\\text{Given}"],
      ["\\overline{AM} \\cong \\overline{MB}", "\\text{Def. of midpoint}"],
      ["\\overline{CM} \\perp \\overline{AB}", "\\text{Given}"],
      ["\\angle CMA \\text{ and } \\angle CMB \\text{ are right angles}", "\\text{Def. of } \\perp"],
      ["\\angle CMA \\cong \\angle CMB", "\\text{Rt. } \\angle s \\cong"],
      ["\\overline{CM} \\cong \\overline{CM}", "\\text{Reflexive}"],
      ["\\triangle CMA \\cong \\triangle CMB", "\\text{SAS}"],
      ["\\overline{AC} \\cong \\overline{BC}", "\\text{CPCTC}"],
    ],
    note: "a point on the perpendicular bisector is equidistant from the ends",
  },
  {
    id: "gp-08",
    topics: ["sss", "midpoint", "cpctc", "isosceles"],
    given: "\\overline{AB} \\cong \\overline{AC}, \\ D \\text{ is the midpoint of } \\overline{BC}",
    prove: "\\angle B \\cong \\angle C",
    figure: ISOSCELES_ALTITUDE,
    rows: [
      ["\\overline{AB} \\cong \\overline{AC}", "\\text{Given}"],
      ["D \\text{ is the midpoint of } \\overline{BC}", "\\text{Given}"],
      ["\\overline{BD} \\cong \\overline{DC}", "\\text{Def. of midpoint}"],
      ["\\overline{AD} \\cong \\overline{AD}", "\\text{Reflexive}"],
      ["\\triangle ABD \\cong \\triangle ACD", "\\text{SSS}"],
      ["\\angle B \\cong \\angle C", "\\text{CPCTC}"],
    ],
    note: "the base angles of an isosceles triangle, by congruent halves",
  },
  {
    id: "gp-09",
    topics: ["isosceles"],
    given: "\\overline{AB} \\cong \\overline{AC}",
    prove: "\\angle B \\cong \\angle C",
    figure: { points: { A: [50, 0], B: [0, 100], C: [100, 100] }, lines: ["AB", "AC", "BC"] },
    rows: [
      ["\\overline{AB} \\cong \\overline{AC}", "\\text{Given}"],
      ["\\angle B \\cong \\angle C", "\\text{Isos. } \\triangle \\text{ thm}"],
    ],
    note: "the isosceles triangle theorem",
  },
  {
    id: "gp-10",
    topics: ["isosceles"],
    given: "\\angle B \\cong \\angle C",
    prove: "\\overline{AB} \\cong \\overline{AC}",
    figure: { points: { A: [50, 0], B: [0, 100], C: [100, 100] }, lines: ["AB", "AC", "BC"] },
    rows: [
      ["\\angle B \\cong \\angle C", "\\text{Given}"],
      ["\\overline{AB} \\cong \\overline{AC}", "\\text{Conv. isos. } \\triangle \\text{ thm}"],
    ],
    note: "its converse",
  },
  {
    id: "gp-11",
    topics: ["vertical", "transitive"],
    given: "\\angle 2 \\cong \\angle 3",
    prove: "\\angle 1 \\cong \\angle 4",
    figure: {
      points: { A: [0, 0], E: [50, 0], B: [100, 0], C: [30, -40], G: [80, 60], D: [95, 90], F: [0, 60], H: [160, 60] },
      lines: ["AEB", "CEGD", "FGH"],
      angles: { "1": "AEC", "2": "BEG", "3": "HGD", "4": "FGE" },
    },
    rows: [
      ["\\angle 2 \\cong \\angle 3", "\\text{Given}"],
      ["\\angle 1 \\cong \\angle 2", "\\text{Vertical } \\angle s"],
      ["\\angle 3 \\cong \\angle 4", "\\text{Vertical } \\angle s"],
      ["\\angle 1 \\cong \\angle 4", "\\text{Transitive}"],
    ],
    note: "numbered angles: two pairs of vertical angles, then transitive",
  },
  {
    id: "gp-12",
    topics: ["sss", "cpctc", "parallel"],
    given: "\\overline{AB} \\cong \\overline{CD}, \\ \\overline{AD} \\cong \\overline{CB}",
    prove: "\\overline{AB} \\parallel \\overline{DC}",
    figure: PARALLELOGRAM,
    rows: [
      ["\\overline{AB} \\cong \\overline{CD}", "\\text{Given}"],
      ["\\overline{AD} \\cong \\overline{CB}", "\\text{Given}"],
      ["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}"],
      ["\\triangle ABD \\cong \\triangle CDB", "\\text{SSS}"],
      ["\\angle ABD \\cong \\angle CDB", "\\text{CPCTC}"],
      ["\\overline{AB} \\parallel \\overline{DC}", "\\text{Conv. alt. int. } \\angle s"],
    ],
    note: "opposite sides congruent make a parallelogram: the converse of alternate interior angles",
  },
  {
    id: "gp-13",
    topics: ["sas", "parallel"],
    given: "\\overline{AB} \\parallel \\overline{DE}, \\ \\overline{AB} \\cong \\overline{DE}, \\ \\overline{BC} \\cong \\overline{EF}",
    prove: "\\triangle ABC \\cong \\triangle DEF",
    figure: { points: { B: [0, 100], E: [40, 100], C: [100, 100], F: [140, 100], A: [20, 0], D: [60, 0] }, lines: ["BECF", "AB", "AC", "DE", "DF"] },
    rows: [
      ["\\overline{AB} \\parallel \\overline{DE}", "\\text{Given}"],
      ["\\angle ABC \\cong \\angle DEF", "\\text{Corr. } \\angle s"],
      ["\\overline{AB} \\cong \\overline{DE}", "\\text{Given}"],
      ["\\overline{BC} \\cong \\overline{EF}", "\\text{Given}"],
      ["\\triangle ABC \\cong \\triangle DEF", "\\text{SAS}"],
    ],
    note: "corresponding angles along a shared line, then SAS",
  },
  {
    id: "gp-14",
    topics: ["asa", "parallel", "midpoint", "vertical"],
    given: "\\overline{AB} \\parallel \\overline{CD}, \\ E \\text{ is the midpoint of } \\overline{BC}",
    prove: "\\triangle ABE \\cong \\triangle DCE",
    figure: BOWTIE,
    rows: [
      ["\\overline{AB} \\parallel \\overline{CD}", "\\text{Given}"],
      ["\\angle ABE \\cong \\angle DCE", "\\text{Alt. int. } \\angle s"],
      ["E \\text{ is the midpoint of } \\overline{BC}", "\\text{Given}"],
      ["\\overline{BE} \\cong \\overline{EC}", "\\text{Def. of midpoint}"],
      ["\\angle AEB \\cong \\angle DEC", "\\text{Vertical } \\angle s"],
      ["\\triangle ABE \\cong \\triangle DCE", "\\text{ASA}"],
    ],
    note: "alternate interior angles, a midpoint and vertical angles: ASA",
  },
  {
    id: "gp-15",
    topics: ["aas", "vertical"],
    given: "\\angle ABE \\cong \\angle DCE, \\ \\overline{AB} \\cong \\overline{DC}",
    prove: "\\triangle ABE \\cong \\triangle DCE",
    figure: BOWTIE,
    rows: [
      ["\\angle ABE \\cong \\angle DCE", "\\text{Given}"],
      ["\\angle AEB \\cong \\angle DEC", "\\text{Vertical } \\angle s"],
      ["\\overline{AB} \\cong \\overline{DC}", "\\text{Given}"],
      ["\\triangle ABE \\cong \\triangle DCE", "\\text{AAS}"],
    ],
    note: "AAS with vertical angles",
  },
  {
    id: "gp-16",
    topics: ["hl", "reflexive"],
    given: "\\angle ABC \\text{ and } \\angle ADC \\text{ are right angles}, \\ \\overline{AB} \\cong \\overline{AD}",
    prove: "\\triangle ABC \\cong \\triangle ADC",
    figure: { points: { A: [0, 0], B: [50, -50], C: [100, 0], D: [50, 50] }, lines: ["AB", "BC", "CD", "DA", "AC"] },
    rows: [
      ["\\angle ABC \\text{ and } \\angle ADC \\text{ are right angles}", "\\text{Given}"],
      ["\\overline{AB} \\cong \\overline{AD}", "\\text{Given}"],
      ["\\overline{AC} \\cong \\overline{AC}", "\\text{Reflexive}"],
      ["\\triangle ABC \\cong \\triangle ADC", "\\text{HL}"],
    ],
    note: "HL with a shared hypotenuse",
  },
  {
    id: "gp-17",
    topics: ["sss", "cpctc", "reflexive"],
    given: "\\overline{AB} \\cong \\overline{AD}, \\ \\overline{BC} \\cong \\overline{DC}",
    prove: "\\angle BAC \\cong \\angle DAC",
    figure: { points: { A: [0, 50], B: [60, 0], C: [150, 50], D: [60, 100] }, lines: ["AB", "BC", "CD", "DA", "AC"] },
    rows: [
      ["\\overline{AB} \\cong \\overline{AD}", "\\text{Given}"],
      ["\\overline{BC} \\cong \\overline{DC}", "\\text{Given}"],
      ["\\overline{AC} \\cong \\overline{AC}", "\\text{Reflexive}"],
      ["\\triangle ABC \\cong \\triangle ADC", "\\text{SSS}"],
      ["\\angle BAC \\cong \\angle DAC", "\\text{CPCTC}"],
    ],
    note: "a kite's diagonal bisects the angle (as congruent halves)",
  },
  {
    id: "gp-18",
    topics: ["multi-step", "sss", "sas", "cpctc", "reflexive"],
    given: "\\overline{AB} \\cong \\overline{CB}, \\ \\overline{AD} \\cong \\overline{CD}",
    prove: "\\overline{AE} \\cong \\overline{CE}",
    figure: { points: { A: [0, 50], B: [50, 0], C: [100, 50], D: [50, 120], E: [50, 50] }, lines: ["AB", "BC", "CD", "DA", "BED", "AEC"] },
    rows: [
      ["\\overline{AB} \\cong \\overline{CB}", "\\text{Given}"],
      ["\\overline{AD} \\cong \\overline{CD}", "\\text{Given}"],
      ["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}"],
      ["\\triangle ABD \\cong \\triangle CBD", "\\text{SSS}"],
      ["\\angle ABD \\cong \\angle CBD", "\\text{CPCTC}"],
      ["\\overline{BE} \\cong \\overline{BE}", "\\text{Reflexive}"],
      ["\\triangle ABE \\cong \\triangle CBE", "\\text{SAS}"],
      ["\\overline{AE} \\cong \\overline{CE}", "\\text{CPCTC}"],
    ],
    note: "two congruences: a kite's diagonals — SSS, CPCTC, then SAS and CPCTC again",
  },
  {
    id: "gp-19",
    topics: ["multi-step", "sas", "midpoint", "vertical", "cpctc", "parallel"],
    given: "E \\text{ is the midpoint of } \\overline{AD}, \\ E \\text{ is the midpoint of } \\overline{BC}",
    prove: "\\overline{AB} \\parallel \\overline{DC}",
    figure: CROSS,
    rows: [
      ["E \\text{ is the midpoint of } \\overline{AD}", "\\text{Given}"],
      ["\\overline{AE} \\cong \\overline{ED}", "\\text{Def. of midpoint}"],
      ["E \\text{ is the midpoint of } \\overline{BC}", "\\text{Given}"],
      ["\\overline{BE} \\cong \\overline{EC}", "\\text{Def. of midpoint}"],
      ["\\angle AEB \\cong \\angle DEC", "\\text{Vertical } \\angle s"],
      ["\\triangle ABE \\cong \\triangle DCE", "\\text{SAS}"],
      ["\\angle BAE \\cong \\angle CDE", "\\text{CPCTC}"],
      ["\\overline{AB} \\parallel \\overline{DC}", "\\text{Conv. alt. int. } \\angle s"],
    ],
    note: "diagonals bisecting each other make parallel sides",
  },
  {
    id: "gp-20",
    topics: ["asa", "bisector", "reflexive"],
    given: "\\overline{BD} \\perp \\overline{AC}, \\ \\overline{BD} \\text{ bisects } \\angle ABC",
    prove: "\\triangle ABD \\cong \\triangle CBD",
    figure: ALTITUDE_B,
    rows: [
      ["\\overline{BD} \\perp \\overline{AC}", "\\text{Given}"],
      ["\\angle ADB \\text{ and } \\angle CDB \\text{ are right angles}", "\\text{Def. of } \\perp"],
      ["\\angle ADB \\cong \\angle CDB", "\\text{Rt. } \\angle s \\cong"],
      ["\\overline{BD} \\text{ bisects } \\angle ABC", "\\text{Given}"],
      ["\\angle ABD \\cong \\angle CBD", "\\text{Def. of } \\angle \\text{ bisector}"],
      ["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}"],
      ["\\triangle ABD \\cong \\triangle CBD", "\\text{ASA}"],
    ],
    note: "a perpendicular angle bisector: ASA",
  },
  {
    id: "gp-21",
    topics: ["sas", "reflexive"],
    given: "\\overline{AB} \\cong \\overline{AC}, \\ \\overline{AD} \\cong \\overline{AE}",
    prove: "\\triangle ABE \\cong \\triangle ACD",
    figure: { points: { A: [50, 0], B: [0, 100], C: [100, 100], D: [25, 50], E: [75, 50] }, lines: ["ADB", "AEC", "BE", "CD"] },
    rows: [
      ["\\overline{AB} \\cong \\overline{AC}", "\\text{Given}"],
      ["\\overline{AD} \\cong \\overline{AE}", "\\text{Given}"],
      ["\\angle A \\cong \\angle A", "\\text{Reflexive}"],
      ["\\triangle ABE \\cong \\triangle ACD", "\\text{SAS}"],
    ],
    note: "overlapping triangles sharing an angle",
  },
  {
    id: "gp-22",
    topics: ["sas", "bisector", "cpctc"],
    given: "\\overline{AB} \\cong \\overline{DB}, \\ \\overline{BC} \\text{ bisects } \\angle ABD",
    prove: "\\overline{AC} \\cong \\overline{DC}",
    figure: { points: { B: [0, 50], A: [80, 0], D: [80, 100], C: [120, 50] }, lines: ["BA", "BD", "BC", "AC", "DC"] },
    rows: [
      ["\\overline{AB} \\cong \\overline{DB}", "\\text{Given}"],
      ["\\overline{BC} \\text{ bisects } \\angle ABD", "\\text{Given}"],
      ["\\angle ABC \\cong \\angle DBC", "\\text{Def. of } \\angle \\text{ bisector}"],
      ["\\overline{BC} \\cong \\overline{BC}", "\\text{Reflexive}"],
      ["\\triangle ABC \\cong \\triangle DBC", "\\text{SAS}"],
      ["\\overline{AC} \\cong \\overline{DC}", "\\text{CPCTC}"],
    ],
    note: "an angle bisector, SAS, CPCTC",
  },
  {
    id: "gp-23",
    topics: ["asa", "parallel"],
    given: "\\overline{AB} \\parallel \\overline{CD}, \\ \\overline{AB} \\cong \\overline{CD}",
    prove: "\\triangle ABE \\cong \\triangle DCE",
    figure: BOWTIE,
    rows: [
      ["\\overline{AB} \\parallel \\overline{CD}", "\\text{Given}"],
      ["\\angle ABE \\cong \\angle DCE", "\\text{Alt. int. } \\angle s"],
      ["\\angle BAE \\cong \\angle CDE", "\\text{Alt. int. } \\angle s"],
      ["\\overline{AB} \\cong \\overline{CD}", "\\text{Given}"],
      ["\\triangle ABE \\cong \\triangle DCE", "\\text{ASA}"],
    ],
    note: "two pairs of alternate interior angles and the side between them",
  },
  {
    id: "gp-24",
    topics: ["sas"],
    given: "m\\angle ABC = 90^{\\circ}, \\ m\\angle DEF = 90^{\\circ}, \\ \\overline{AB} \\cong \\overline{DE}, \\ \\overline{BC} \\cong \\overline{EF}",
    prove: "\\triangle ABC \\cong \\triangle DEF",
    figure: { points: { A: [0, 0], B: [0, 80], C: [60, 80], D: [150, 0], E: [150, 80], F: [210, 80] }, lines: ["AB", "BC", "AC", "DE", "EF", "DF"] },
    rows: [
      ["m\\angle ABC = 90^{\\circ}", "\\text{Given}"],
      ["m\\angle DEF = 90^{\\circ}", "\\text{Given}"],
      ["\\angle ABC \\cong \\angle DEF", "\\text{Rt. } \\angle s \\cong"],
      ["\\overline{AB} \\cong \\overline{DE}", "\\text{Given}"],
      ["\\overline{BC} \\cong \\overline{EF}", "\\text{Given}"],
      ["\\triangle ABC \\cong \\triangle DEF", "\\text{SAS}"],
    ],
    note: "right angles are congruent, then SAS (the legs)",
  },
  {
    id: "gp-25",
    topics: ["transitive"],
    given: "\\overline{AB} \\cong \\overline{BC}, \\ \\overline{BC} \\cong \\overline{CD}",
    prove: "\\overline{AB} \\cong \\overline{CD}",
    figure: { points: { A: [0, 0], B: [50, 0], C: [100, 0], D: [150, 0] }, lines: ["ABCD"] },
    rows: [
      ["\\overline{AB} \\cong \\overline{BC}", "\\text{Given}"],
      ["\\overline{BC} \\cong \\overline{CD}", "\\text{Given}"],
      ["\\overline{AB} \\cong \\overline{CD}", "\\text{Transitive}"],
    ],
    note: "the transitive property of congruence",
  },
  {
    id: "gp-26",
    topics: ["transitive"],
    given: "m\\angle 1 = 40^{\\circ}, \\ m\\angle 2 = 40^{\\circ}",
    prove: "\\angle 1 \\cong \\angle 2",
    figure: {
      points: { B: [0, 100], A: [60, 40], C: [100, 100], E: [200, 100], D: [260, 40], F: [300, 100] },
      lines: ["BA", "BC", "ED", "EF"],
      angles: { "1": "ABC", "2": "DEF" },
    },
    rows: [
      ["m\\angle 1 = 40^{\\circ}", "\\text{Given}"],
      ["m\\angle 2 = 40^{\\circ}", "\\text{Given}"],
      ["\\angle 1 \\cong \\angle 2", "\\text{Substitution}"],
    ],
    note: "equal measures: substitution",
  },
  {
    id: "gp-27",
    topics: ["hl", "cpctc", "reflexive"],
    given: "\\overline{AD} \\perp \\overline{BC}, \\ \\overline{AB} \\cong \\overline{AC}",
    prove: "\\overline{BD} \\cong \\overline{CD}",
    figure: ISOSCELES_ALTITUDE,
    rows: [
      ["\\overline{AD} \\perp \\overline{BC}", "\\text{Given}"],
      ["\\angle ADB \\text{ and } \\angle ADC \\text{ are right angles}", "\\text{Def. of } \\perp"],
      ["\\overline{AB} \\cong \\overline{AC}", "\\text{Given}"],
      ["\\overline{AD} \\cong \\overline{AD}", "\\text{Reflexive}"],
      ["\\triangle ADB \\cong \\triangle ADC", "\\text{HL}"],
      ["\\overline{BD} \\cong \\overline{CD}", "\\text{CPCTC}"],
    ],
    note: "the altitude of an isosceles triangle bisects the base",
  },
  {
    id: "gp-28",
    topics: ["multi-step", "sas", "bisector", "cpctc"],
    given: "\\overline{CD} \\text{ bisects } \\overline{AB} \\text{ at } M, \\ \\overline{CD} \\perp \\overline{AB}",
    prove: "\\overline{AC} \\cong \\overline{BC}",
    figure: { points: { A: [0, 100], B: [100, 100], M: [50, 100], C: [50, 0], D: [50, 160] }, lines: ["AMB", "CMD", "AC", "BC"] },
    rows: [
      ["\\overline{CD} \\text{ bisects } \\overline{AB} \\text{ at } M", "\\text{Given}"],
      ["\\overline{AM} \\cong \\overline{MB}", "\\text{Def. of seg. bisector}"],
      ["\\overline{CD} \\perp \\overline{AB}", "\\text{Given}"],
      ["\\angle CMA \\text{ and } \\angle CMB \\text{ are right angles}", "\\text{Def. of } \\perp"],
      ["\\angle CMA \\cong \\angle CMB", "\\text{Rt. } \\angle s \\cong"],
      ["\\overline{CM} \\cong \\overline{CM}", "\\text{Reflexive}"],
      ["\\triangle CMA \\cong \\triangle CMB", "\\text{SAS}"],
      ["\\overline{AC} \\cong \\overline{BC}", "\\text{CPCTC}"],
    ],
    note: "the perpendicular bisector, stated with a segment bisector",
  },
];

/**
 * Hand-written wrong proofs the automatic seeding cannot make: SSA and AAA, which need givens of
 * that shape. Each has one row that must be ringed (`wrongRow`, 0-based).
 */
export interface SeededCase {
  id: string;
  kind: "ssa" | "aaa" | "correspondence" | "cpctc-early" | "wrong-reason" | "missing" | "not-given" | "does-not-follow";
  given: string;
  prove: string;
  figure: FigureRead;
  rows: ReadonlyArray<readonly [string, string]>;
  wrongRow: number;
  note: string;
}

const TWO_TRIANGLES: FigureRead = { points: { A: [0, 0], B: [0, 80], C: [70, 80], D: [150, 0], E: [150, 80], F: [220, 80] }, lines: ["AB", "BC", "AC", "DE", "EF", "DF"] };

export const HAND_SEEDED: readonly SeededCase[] = [
  {
    id: "ssa-1",
    kind: "ssa",
    given: "\\overline{AB} \\cong \\overline{DE}, \\ \\overline{BC} \\cong \\overline{EF}, \\ \\angle A \\cong \\angle D",
    prove: "\\triangle ABC \\cong \\triangle DEF",
    figure: TWO_TRIANGLES,
    rows: [
      ["\\overline{AB} \\cong \\overline{DE}", "\\text{Given}"],
      ["\\overline{BC} \\cong \\overline{EF}", "\\text{Given}"],
      ["\\angle A \\cong \\angle D", "\\text{Given}"],
      ["\\triangle ABC \\cong \\triangle DEF", "\\text{SAS}"],
    ],
    wrongRow: 3,
    note: "the angle is not between the two sides: SSA written as SAS",
  },
  {
    id: "ssa-2",
    kind: "ssa",
    given: "\\overline{AB} \\cong \\overline{DE}, \\ \\overline{BC} \\cong \\overline{EF}, \\ \\angle A \\cong \\angle D",
    prove: "\\triangle ABC \\cong \\triangle DEF",
    figure: TWO_TRIANGLES,
    rows: [
      ["\\overline{AB} \\cong \\overline{DE}", "\\text{Given}"],
      ["\\overline{BC} \\cong \\overline{EF}", "\\text{Given}"],
      ["\\angle A \\cong \\angle D", "\\text{Given}"],
      ["\\triangle ABC \\cong \\triangle DEF", "\\text{SSA}"],
    ],
    wrongRow: 3,
    note: "SSA is not a postulate",
  },
  {
    id: "ssa-3",
    kind: "ssa",
    given: "\\overline{AB} \\cong \\overline{CB}, \\ \\angle A \\cong \\angle C",
    prove: "\\triangle ABD \\cong \\triangle CBD",
    figure: KITE,
    rows: [
      ["\\overline{AB} \\cong \\overline{CB}", "\\text{Given}"],
      ["\\angle A \\cong \\angle C", "\\text{Given}"],
      ["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}"],
      ["\\triangle ABD \\cong \\triangle CBD", "\\text{SAS}"],
    ],
    wrongRow: 3,
    note: "a kite with the wrong angle: side, side, and the angle not between them",
  },
  {
    id: "ssa-4",
    kind: "ssa",
    given: "\\overline{BC} \\cong \\overline{EF}, \\ \\overline{AC} \\cong \\overline{DF}, \\ \\angle A \\cong \\angle D",
    prove: "\\triangle ABC \\cong \\triangle DEF",
    figure: TWO_TRIANGLES,
    rows: [
      ["\\overline{BC} \\cong \\overline{EF}", "\\text{Given}"],
      ["\\overline{AC} \\cong \\overline{DF}", "\\text{Given}"],
      ["\\angle A \\cong \\angle D", "\\text{Given}"],
      ["\\triangle ABC \\cong \\triangle DEF", "\\text{S A S}"],
    ],
    wrongRow: 3,
    note: "SSA again, the reason read as spaced letters",
  },
  {
    id: "aaa-1",
    kind: "aaa",
    given: "\\angle A \\cong \\angle D, \\ \\angle B \\cong \\angle E, \\ \\angle C \\cong \\angle F",
    prove: "\\triangle ABC \\cong \\triangle DEF",
    figure: TWO_TRIANGLES,
    rows: [
      ["\\angle A \\cong \\angle D", "\\text{Given}"],
      ["\\angle B \\cong \\angle E", "\\text{Given}"],
      ["\\angle C \\cong \\angle F", "\\text{Given}"],
      ["\\triangle ABC \\cong \\triangle DEF", "\\text{AAA}"],
    ],
    wrongRow: 3,
    note: "AAA proves similarity, not congruence",
  },
  {
    id: "aaa-2",
    kind: "wrong-reason",
    given: "\\angle A \\cong \\angle D, \\ \\angle B \\cong \\angle E, \\ \\angle C \\cong \\angle F",
    prove: "\\triangle ABC \\cong \\triangle DEF",
    figure: TWO_TRIANGLES,
    rows: [
      ["\\angle A \\cong \\angle D", "\\text{Given}"],
      ["\\angle B \\cong \\angle E", "\\text{Given}"],
      ["\\angle C \\cong \\angle F", "\\text{Given}"],
      ["\\triangle ABC \\cong \\triangle DEF", "\\text{ASA}"],
    ],
    wrongRow: 3,
    note: "three angles and no side, called ASA",
  },
  {
    id: "vert-1",
    kind: "does-not-follow",
    given: "\\angle ABE \\cong \\angle DCE, \\ \\overline{AB} \\cong \\overline{DC}",
    prove: "\\triangle ABE \\cong \\triangle DCE",
    figure: BOWTIE,
    rows: [
      ["\\angle ABE \\cong \\angle DCE", "\\text{Given}"],
      ["\\angle BAE \\cong \\angle CDE", "\\text{Vertical } \\angle s"],
    ],
    wrongRow: 1,
    note: "angles at two different vertices are not vertical angles",
  },
  {
    id: "alt-1",
    kind: "missing",
    given: "\\angle ABE \\cong \\angle DCE, \\ \\overline{AB} \\cong \\overline{DC}",
    prove: "\\triangle ABE \\cong \\triangle DCE",
    figure: BOWTIE,
    rows: [
      ["\\angle ABE \\cong \\angle DCE", "\\text{Given}"],
      ["\\angle BAE \\cong \\angle CDE", "\\text{Alt. int. } \\angle s"],
    ],
    wrongRow: 1,
    note: "alternate interior angles need parallel lines, and none are known",
  },
  {
    id: "mid-1",
    kind: "does-not-follow",
    given: "E \\text{ is the midpoint of } \\overline{AD}",
    prove: "\\triangle ABE \\cong \\triangle DCE",
    figure: CROSS,
    rows: [
      ["E \\text{ is the midpoint of } \\overline{AD}", "\\text{Given}"],
      ["\\overline{BE} \\cong \\overline{EC}", "\\text{Def. of midpoint}"],
    ],
    wrongRow: 1,
    note: "the midpoint of AD halves AD, not BC",
  },
  {
    id: "isos-1",
    kind: "missing",
    given: "\\overline{AB} \\cong \\overline{BC}",
    prove: "\\angle B \\cong \\angle C",
    figure: { points: { A: [50, 0], B: [0, 100], C: [100, 100] }, lines: ["AB", "AC", "BC"] },
    rows: [
      ["\\overline{AB} \\cong \\overline{BC}", "\\text{Given}"],
      ["\\angle B \\cong \\angle C", "\\text{Isos. } \\triangle \\text{ thm}"],
    ],
    wrongRow: 1,
    note: "the congruent sides are not the ones opposite B and C",
  },
];
