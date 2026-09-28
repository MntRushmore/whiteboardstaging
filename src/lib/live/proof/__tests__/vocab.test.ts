import { describe, expect, it } from "vitest";
import { normalizeReason, REASON_LATEX, REASONS, reasonLatex, resolveBisector } from "../vocab";

describe("proof reasons: Mathpix's reads → the fixed vocabulary", () => {
  const cases: Array<[string, ReturnType<typeof normalizeReason>]> = [
    ["\\text{Given}", "given"],
    ["\\text { Given }", "given"],
    ["G i v e n", "given"],
    ["\\text{given.}", "given"],
    ["SAS", "sas"],
    ["S A S", "sas"],
    ["\\text{SAS} \\cong", "sas"],
    ["\\text{SAS Postulate}", "sas"],
    ["\\mathrm{SSS}", "sss"],
    ["\\text{ASA} \\cong \\text{ post.}", "asa"],
    ["\\text{SAA}", "aas"],
    ["\\text{HL}", "hl"],
    ["\\text{H L}", "hl"],
    ["\\text{SSA}", "ssa"],
    ["\\text{ASS}", "ssa"],
    ["\\text{AAA}", "aaa"],
    ["\\text{CPCTC}", "cpctc"],
    ["C P C T C", "cpctc"],
    ["\\text{Reflexive}", "reflexive"],
    ["\\text{reflexive prop}", "reflexive"],
    ["\\text{Reflexive Prop. of } \\cong", "reflexive"],
    ["\\text{Refl. Prop.}", "reflexive"],
    ["\\text{common side}", "reflexive"],
    ["\\text{Symmetric Prop.}", "symmetric"],
    ["\\text{Transitive}", "transitive"],
    ["\\text{Trans. Prop. of } \\cong", "transitive"],
    ["\\text{Substitution}", "substitution"],
    ["\\text{Subst.}", "substitution"],
    ["\\text{Vert. } \\angle s \\cong", "vertical"],
    ["\\text{vertical angles thm}", "vertical"],
    ["\\text{Vertical } \\angle \\text{s}", "vertical"],
    ["\\text{Vertical Angles Theorem}", "vertical"],
    ["\\text{def of midpt}", "midpoint"],
    ["\\text{Def. of midpoint}", "midpoint"],
    ["\\text{Definition of Midpoint}", "midpoint"],
    ["\\text{Def. of } \\angle \\text{ bisector}", "angleBisector"],
    ["\\text{def of angle bisector}", "angleBisector"],
    ["\\text{Def. of seg. bisector}", "segmentBisector"],
    ["\\text{Def. of bisector}", "bisector"],
    ["\\text{Def. of } \\perp", "perpendicular"],
    ["\\text{def of perpendicular lines}", "perpendicular"],
    ["\\text{Def. of rt. } \\angle", "rightAngle"],
    ["\\text{Rt. } \\angle s \\cong", "rightAngles"],
    ["\\text{All right angles are congruent}", "rightAngles"],
    ["\\text{Alt. int. } \\angle s", "altInterior"],
    ["\\text{Alternate Interior Angles Theorem}", "altInterior"],
    ["\\text{Alt. ext. } \\angle s", "altExterior"],
    ["\\text{Corr. } \\angle s", "corresponding"],
    ["\\text{Corresponding Angles Postulate}", "corresponding"],
    ["\\text{Conv. alt. int. } \\angle s", "altInteriorConverse"],
    ["\\text{Converse of Alt. Int. Angles Thm}", "altInteriorConverse"],
    ["\\text{Isos. } \\triangle \\text{ thm}", "isosceles"],
    ["\\text{Base Angles Theorem}", "isosceles"],
    ["\\text{Conv. isos. } \\triangle \\text{ thm}", "isoscelesConverse"],
    ["\\text{Third } \\angle s \\text{ thm}", "thirdAngles"],
    ["\\text{Linear Pair Postulate}", "linearPair"],
    ["\\text{Def. of } \\cong", "congruence"],
    ["\\text{Seg. Add. Post.}", "segmentAddition"],
  ];
  it.each(cases)("%s → %s", (latex, id) => {
    expect(normalizeReason(latex)).toBe(id);
  });

  it("a statement, a Given line or a word is not a reason", () => {
    for (const latex of [
      "\\overline{AB} \\cong \\overline{CD}",
      "\\triangle ABD \\cong \\triangle CDB",
      "\\text{Given: } \\overline{AB} \\cong \\overline{CD}",
      "M \\text { is the midpoint of } \\overline{A B}",
      "\\text{reflection}",
      "x = 5",
      "\\text{Statements}",
      "",
    ])
      expect(normalizeReason(latex), latex).toBeNull();
  });

  it("every reason the tutor writes reads back as itself", () => {
    for (const id of REASONS) {
      const back = normalizeReason(reasonLatex(id));
      expect(back, `${id}: ${REASON_LATEX[id]}`).toBe(id);
    }
  });

  it("a bare `Def. of bisector` is the angle bisector's about angles, the segment bisector's about segments", () => {
    expect(resolveBisector("bisector", true)).toBe("angleBisector");
    expect(resolveBisector("bisector", false)).toBe("segmentBisector");
    expect(resolveBisector("sas", true)).toBe("sas");
  });
});
