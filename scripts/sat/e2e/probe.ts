import { judgeColumn, problemLines, engine } from "./lib";
const stem = "For a student council election, a triangular campaign banner is shaped like right triangle $ABC$ shown, with the right angle at $C$, $AC = 56$ inches, $BC = 33$ inches and $AB = 65$ inches. What is the value of $\\tan A$?";
const head = problemLines(stem);
console.log(head);
console.log(JSON.stringify(judgeColumn(head, ["\\tan A=\\frac{33}{56}"], [1]).map((j) => [j.analysis, j.mark, j.wantsCheck])));
console.log(JSON.stringify(engine.analyzeColumnOf({ lines: head, mode: "suggest" })));
