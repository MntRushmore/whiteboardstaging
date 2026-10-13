/**
 * The K–8 skills' guides (every skill on a grade's path, GRADE_PATHS): see ../skillGuide.ts.
 *
 * One hand-written guide per skill, for the math library's skill pages (`/math/long-division`):
 * what the skill is, how to do it, the slips kids make and what parents ask. Each one matches the
 * problems the app's generators really write for that skill (src/lib/learning/generators/primary.ts
 * and the others): the same kinds of problems, the same sizes of numbers.
 *
 * The words follow the landing page's rules (docs/SEO.md, "Rules for every page"): plain text with
 * the math in Unicode (×, ÷, −, ², √), US English, short sentences to a parent, nothing Agathon does
 * not do. Every example is real math, and `__tests__/guides.k8.test.ts` works out every chain of
 * plain numbers joined by "=" (in the explanations, steps, fixes and answers) to hold it to that.
 * Each guide's grade answer agrees with GRADE_PATHS, which is loosely the US Common Core.
 */
import type { TopicId } from "@/lib/learning/topics";
import type { SkillGuide } from "../skillGuide";

export const K8_GUIDES: Readonly<Partial<Record<TopicId, SkillGuide>>> = {
  // ---------------------------------------------------------------- Kindergarten

  add_within_10: {
    title: "Addition within 10",
    what: "Addition within 10 means putting two or three small numbers together to make a total of 10 or less, like 3 + 4 = 7. It is the first adding a child does, usually by counting objects or fingers. Knowing these facts well makes every later kind of adding easier.",
    steps: [
      "Read the problem out loud: 3 + 4 means 3, and 4 more.",
      "Start at the bigger number and count on the smaller one: for 3 + 4, start at 4 and count 5, 6, 7.",
      "Use fingers, dots or a ten frame when counting in your head is hard.",
      "With three numbers, add two first and then the third: 2 + 3 + 4 is 5 + 4, which is 9.",
      "Write the total after the equals sign.",
    ],
    slips: [
      {
        slip: "Counting the starting number twice, so 4 + 3 comes out as 6.",
        fix: "Say the first number, then count only the new ones: 4, then 5, 6, 7. Each count after the start is one of the 3 being added.",
      },
      {
        slip: "Losing track in a three-number problem and adding only two of the numbers.",
        fix: "Touch each number as it is added, or cross it off, so none gets skipped.",
      },
      {
        slip: "Taking away instead of adding, especially right after a page of take-away problems.",
        fix: "Have your child read the sign out loud as “plus” before starting. If the answer is smaller than a number in the problem, it was subtracted.",
      },
    ],
    faq: [
      {
        q: "What grade learns addition within 10?",
        a: "Kindergarten. Most US schools expect kindergartners to add within 10 using objects or fingers by the end of the year, and to know sums within 5 quickly, though schools vary.",
      },
      {
        q: "Is it okay for my child to count on their fingers?",
        a: "Yes. Fingers are a normal tool at this age and a step toward knowing the facts by heart. Over time, nudge them to count on from the bigger number instead of counting both numbers from 1.",
      },
      {
        q: "How can I practice adding to 10 at home?",
        a: "Use real things: 3 spoons and 4 more spoons, or crackers on a plate. Pairs that make 10, like 6 + 4 and 7 + 3, are worth extra time because kids use them for years.",
      },
    ],
    related: ["subtract_within_10", "add_within_20", "add_tens"],
  },

  subtract_within_10: {
    title: "Subtraction within 10",
    what: "Subtraction within 10 means taking some away from a small group and finding how many are left, like 7 − 2 = 5. Kids start by crossing out objects or counting back. It also answers “how many more?”, which comes up in comparing and in word problems.",
    steps: [
      "Start with the first number, the whole group: in 7 − 2, that is 7.",
      "Take away the second number by crossing out objects or counting back two: 6, 5.",
      "The number you land on is how many are left, so 7 − 2 = 5.",
      "Check by adding back: 5 + 2 = 7, so the answer is right.",
      "With two take-aways, like 9 − 2 − 3, go left to right: 9 − 2 = 7, then 7 − 3 = 4.",
    ],
    slips: [
      {
        slip: "Saying the starting number as the first count back, so 7 − 2 comes out as 6.",
        fix: "Count only the jumps: from 7, the first jump back lands on 6 and the second on 5. Two jumps back from 7 is 5.",
      },
      {
        slip: "Adding instead of taking away, so 6 − 2 comes out as 8.",
        fix: "A take-away answer is always smaller than the first number. If it came out bigger, read the sign again.",
      },
      {
        slip: "Doing only one of the two take-aways in a problem like 9 − 2 − 3.",
        fix: "Cross off each number once it has been taken away. The answer, 4, uses both of them.",
      },
    ],
    faq: [
      {
        q: "What grade learns subtraction within 10?",
        a: "Kindergarten, right alongside addition within 10. Kids usually move on to subtraction within 20 in 1st grade, at a pace that varies by school.",
      },
      {
        q: "Why is subtraction harder for my child than addition?",
        a: "Counting back is less natural than counting up, and it is easy to count the starting number by mistake. Many kids find it easier to think of 7 − 2 as “what goes with 2 to make 7?” and count up from 2.",
      },
      {
        q: "Should my kindergartner know these facts by heart?",
        a: "Only the smallest ones: kindergartners are usually expected to know facts within 5 quickly. Facts up to 10 become automatic in 1st grade, once kids understand what taking away means.",
      },
    ],
    related: ["add_within_10", "subtract_within_20", "add_within_20"],
  },

  // ---------------------------------------------------------------- 1st grade

  add_within_20: {
    title: "Addition within 20",
    what: "Addition within 20 covers facts like 8 + 7 = 15 and 13 + 5 = 18, where the total is between 11 and 20. The big idea is making a ten: 8 + 7 is 8 + 2 to make 10, then 5 more. Kids who know these facts quickly have a much easier time with two-digit adding in 2nd grade.",
    steps: [
      "Look for a way to make 10: in 8 + 7, the 8 needs 2 more.",
      "Split the other number to get those 2: 7 is 2 and 5.",
      "Make the 10, then add what is left: 8 + 2 = 10 and 10 + 5 = 15.",
      "Use doubles when they fit: 7 + 8 is the double 7 + 7 = 14, plus 1 more, so 15.",
      "With three numbers, like 3 + 5 + 7, look for a pair that makes 10 first: 3 + 7 = 10, then 10 + 5 = 15.",
    ],
    slips: [
      {
        slip: "Counting on by ones and losing count, so 8 + 7 comes out as 14 or 16.",
        fix: "Make 10 first instead of counting ones. A double checks it: 8 + 7 is one more than 7 + 7 = 14, so it must be 15.",
      },
      {
        slip: "Adding the ones to the 1 in a teen number, so 13 + 5 comes out as 63.",
        fix: "The 1 in 13 is one ten. Add ones to ones: 3 + 5 = 8, so 13 + 5 = 18.",
      },
      {
        slip: "Knowing the easy facts but guessing on the ones that cross ten, like 6 + 5 or 9 + 4.",
        fix: "Most hard facts are one step from a double or a ten: 6 + 5 = 5 + 5 + 1 = 11, and 9 + 4 is 10 + 3 = 13.",
      },
    ],
    faq: [
      {
        q: "What grade learns addition within 20?",
        a: "1st grade. US schools usually expect kids to add within 20 using strategies in 1st grade and to know these facts from memory by the end of 2nd grade, though the timing varies by school.",
      },
      {
        q: "What does “make a ten” mean?",
        a: "It is the strategy of breaking one number apart so the other reaches 10. For 9 + 6, take 1 from the 6 to turn 9 into 10, leaving 10 + 5 = 15.",
      },
      {
        q: "How much should my child practice math facts?",
        a: "A few minutes most days works better than one long session a week. Short, regular practice is how facts become automatic.",
      },
    ],
    related: ["add_within_10", "subtract_within_20", "add_tens", "add_within_100"],
  },

  subtract_within_20: {
    title: "Subtraction within 20",
    what: "Subtraction within 20 covers facts like 15 − 8 = 7 and 17 − 4 = 13. The hard ones cross ten: to find 15 − 8, take 5 to get down to 10, then 3 more to get to 7. These facts are the base for regrouping in two-digit subtraction.",
    steps: [
      "Check whether you need to cross ten: in 17 − 4, the ones work (7 − 4 = 3), so 17 − 4 = 13.",
      "If you do, go down to 10 first: in 15 − 8, take away 5 to reach 10.",
      "Take away the rest from 10: 8 is 5 and 3, so 10 − 3 = 7.",
      "Or count up from the smaller number: from 8, it takes 2 to reach 10 and 5 more to reach 15, so the answer is 7.",
      "Check by adding: 7 + 8 = 15.",
    ],
    slips: [
      {
        slip: "Subtracting the smaller digit from the bigger one, so 15 − 8 comes out as 13 (8 − 5 = 3, then keeping the 1).",
        fix: "The 5 ones can't give away 8, so the ten has to be used. Going down to 10 first avoids the flip: 15 − 5 − 3 = 7.",
      },
      {
        slip: "Off-by-one answers from counting back, like 14 − 6 coming out as 9.",
        fix: "Count up instead: from 6 it is 4 to reach 10 and 4 more to reach 14, so 8. Then check: 8 + 6 = 14.",
      },
      {
        slip: "Writing teen numbers backward, like 31 for 13.",
        fix: "Say the number as “one ten and three ones” and write the ten first.",
      },
    ],
    faq: [
      {
        q: "What grade learns subtraction within 20?",
        a: "1st grade, together with addition within 20. Most schools want these facts to be quick by the end of 2nd grade, but the pace varies.",
      },
      {
        q: "My child can add but not subtract. What helps?",
        a: "Show that each subtraction fact is an addition fact turned around: 8 + 7 = 15 means 15 − 8 = 7 and 15 − 7 = 8. Practicing fact families this way means learning one set of facts instead of two.",
      },
      {
        q: "Is counting back on a number line a good method?",
        a: "It works for small take-aways, like 13 − 2. For bigger ones, like 13 − 9, counting up from 9 to 13 is shorter and causes fewer slips.",
      },
    ],
    related: ["subtract_within_10", "add_within_20", "add_tens", "subtract_within_100"],
  },

  add_tens: {
    title: "Adding tens",
    what: "Adding tens means adding and taking away multiples of 10, like 40 + 30 = 70, 34 + 20 = 54 and 70 − 40 = 30. Only the tens digit changes: 4 tens and 3 tens make 7 tens. It teaches place value, the idea that the 3 in 34 means 30.",
    steps: [
      "Read each multiple of 10 as a number of tens: 40 is 4 tens and 30 is 3 tens.",
      "Add or take away the tens like small numbers: 4 tens and 3 tens make 7 tens, which is 70.",
      "When one number has ones, like 34 + 20, keep the ones digit and change only the tens: 3 tens and 2 tens make 5 tens, so 54.",
      "Taking away works the same way: 56 − 30 is 5 tens take away 3 tens, which leaves 2 tens and the 6 ones, so 26.",
      "Check on a hundred chart, where each jump of 10 is one row down, or one row up when taking away.",
    ],
    slips: [
      {
        slip: "Adding the 2 in 20 to the ones digit, so 34 + 20 comes out as 36.",
        fix: "The 2 in 20 is 2 tens. Line the numbers up by place, tens with tens and ones with ones: 34 + 20 = 54.",
      },
      {
        slip: "Dropping the zero, so 40 + 30 is written as 7.",
        fix: "Say it as “4 tens plus 3 tens is 7 tens”. Seven tens is written 70.",
      },
      {
        slip: "Changing the ones when taking away tens, so 56 − 30 comes out as 23.",
        fix: "Taking away tens never changes the ones digit. The 6 stays: 56 − 30 = 26.",
      },
    ],
    faq: [
      {
        q: "What grade learns adding and subtracting tens?",
        a: "1st grade. Kids learn to add a multiple of 10 to a two-digit number, to find 10 more or 10 less in their heads, and to subtract multiples of 10.",
      },
      {
        q: "Why does adding tens matter so much?",
        a: "It is where place value becomes real: kids see that 34 is 3 tens and 4 ones. Two-digit addition in 2nd grade is built on it.",
      },
      {
        q: "How can we practice adding tens at home?",
        a: "Count by tens from a number that isn't a multiple of 10, like 7, 17, 27, 37. Dimes work well too, since each one is worth 10 cents.",
      },
    ],
    related: ["add_within_20", "subtract_within_20", "add_within_100", "subtract_within_100", "multiply_by_tens"],
  },

  // ---------------------------------------------------------------- 2nd grade

  add_within_100: {
    title: "Two-digit addition",
    what: "Two-digit addition is adding numbers like 47 + 38, where the ones can add up to 10 or more. When they do, 10 ones are regrouped as 1 ten, which many parents learned as carrying. It is the first time a child adds by place value, the method used for every bigger number later.",
    steps: [
      "Write the numbers one above the other, ones under ones and tens under tens.",
      "Add the ones first: 7 + 8 = 15.",
      "If the ones make 10 or more, write the ones digit (5) and regroup the ten by writing a small 1 above the tens column.",
      "Add the tens, including the regrouped 1: 4 + 3 + 1 = 8.",
      "Read the answer, 85, and check that it is about right: 47 + 38 is close to 50 + 40 = 90.",
    ],
    slips: [
      {
        slip: "Writing the whole 15 under the ones, so 47 + 38 comes out as 715.",
        fix: "Only one digit fits in each column. Write the 5 and regroup the 1 ten into the tens column.",
      },
      {
        slip: "Forgetting the regrouped 1, so 47 + 38 comes out as 75.",
        fix: "Write the small 1 above the tens before adding them. An estimate of about 90 shows that 75 is too small.",
      },
      {
        slip: "Lining up 48 + 6 with the 6 under the 4.",
        fix: "Line digits up from the right: the 6 is a ones digit and goes under the 8. Then 8 + 6 = 14, so 48 + 6 = 54.",
      },
    ],
    faq: [
      {
        q: "What grade learns two-digit addition?",
        a: "2nd grade, for sums up to 100. Many schools teach it with base-ten blocks and drawings first and the stacked method after, and when they switch varies by school.",
      },
      {
        q: "Is “carrying” the same as regrouping?",
        a: "Yes. Schools today usually say regroup, because 10 ones are traded for 1 ten. The written method is the same one you learned.",
      },
      {
        q: "Should my child add in their head or on paper?",
        a: "Both. Mental strategies like 47 + 40 − 2 = 85 build number sense, and the written method stays reliable as numbers get bigger.",
      },
    ],
    related: ["add_tens", "add_within_20", "subtract_within_100", "add_subtract_within_1000"],
  },

  subtract_within_100: {
    title: "Two-digit subtraction",
    what: "Two-digit subtraction is taking away numbers like 72 − 35 = 37. When a top ones digit is too small (2 can't take away 5), a ten is regrouped into 10 ones, which many parents learned as borrowing. Kids learn it after two-digit addition, and it takes more care, because the regrouping has to happen before the subtracting.",
    steps: [
      "Write the bigger number on top, ones under ones and tens under tens.",
      "Look at the ones: 2 can't take away 5, so regroup.",
      "Take 1 ten from the 7 tens, leaving 6 tens, and add 10 ones to the 2, making 12.",
      "Subtract the ones, 12 − 5 = 7, then the tens, 6 − 3 = 3.",
      "Check by adding: 37 + 35 = 72.",
    ],
    slips: [
      {
        slip: "Subtracting the smaller digit from the bigger one in each column, so 72 − 35 comes out as 43.",
        fix: "Always take the bottom digit from the top one, and regroup first when the top is smaller. Adding back shows the slip: 43 + 35 = 78, not 72.",
      },
      {
        slip: "Regrouping the ones but forgetting to lower the tens, so 72 − 35 comes out as 47.",
        fix: "Cross out the 7 and write 6 above it the moment you regroup.",
      },
      {
        slip: "Getting stuck when the top ones digit is 0, as in 30 − 17.",
        fix: "A 0 still regroups: 3 tens become 2 tens and 10 ones. Then 10 − 7 = 3 and 2 − 1 = 1, so 30 − 17 = 13.",
      },
    ],
    faq: [
      {
        q: "What grade learns two-digit subtraction?",
        a: "2nd grade, for numbers up to 100. Three-digit subtraction follows later in 2nd grade or in 3rd, depending on the school.",
      },
      {
        q: "Why doesn't my child's school say “borrow”?",
        a: "Regroup describes what really happens: one ten is traded for ten ones, and nothing is paid back. The steps on paper are the ones you learned.",
      },
      {
        q: "How does Agathon help with two-digit subtraction?",
        a: "Your child writes each problem by hand and the tutor checks each line, circling a wrong one. A slip like subtracting the smaller digit from the bigger is caught on that problem, not at the end of the page.",
      },
    ],
    related: ["subtract_within_20", "add_tens", "add_within_100", "add_subtract_within_1000"],
  },

  add_subtract_within_1000: {
    title: "Three-digit addition and subtraction",
    what: "This skill is adding and subtracting numbers up to 1000, like 386 + 247 = 633 and 634 − 278 = 356. It uses the same column method as two-digit numbers, with one more column, the hundreds. Regrouping can now happen twice in one problem, from ones to tens and from tens to hundreds.",
    steps: [
      "Line up the numbers by place: hundreds, tens and ones.",
      "Work from right to left, starting with the ones.",
      "When adding, regroup any column that makes 10 or more: 6 + 7 = 13, so write 3 and regroup 1 ten.",
      "When subtracting, regroup before any column whose top digit is too small: in 634 − 278, 4 can't take away 8, so the 3 tens become 2 tens and the 4 becomes 14.",
      "Check the answer with the opposite operation: 356 + 278 = 634.",
    ],
    slips: [
      {
        slip: "Losing the regrouped 1s when there are two in a row, so 386 + 247 comes out as 523 instead of 633.",
        fix: "Write each small 1 at the top of the next column the moment it appears. An estimate, about 400 + 250 = 650, shows that 523 is too small.",
      },
      {
        slip: "Getting stuck subtracting across a zero, as in 503 − 278.",
        fix: "When the tens digit is 0, regroup from the hundreds first: 503 becomes 4 hundreds, 9 tens and 13 ones. Then 13 − 8 = 5, 9 − 7 = 2 and 4 − 2 = 2, so the answer is 225.",
      },
      {
        slip: "Skipping a part of a three-number problem like 348 + 276 − 129.",
        fix: "Work left to right, one operation at a time: first 348 + 276 = 624, then 624 − 129 = 495.",
      },
    ],
    faq: [
      {
        q: "What grade learns three-digit addition and subtraction?",
        a: "It starts in 2nd grade and becomes fluent in 3rd grade, which is why Agathon's path has it in both grades. Schools vary in how fast they move.",
      },
      {
        q: "Should my child use the stacked method or other strategies?",
        a: "Many schools teach strategies like adding hundreds, tens and ones separately before the stacked method. Both are correct, and the stacked method is the one kids carry into bigger numbers.",
      },
      {
        q: "How can my child check an answer?",
        a: "Use the opposite operation: if 634 − 278 = 356, then 356 + 278 should give back 634. Rounding to the nearest hundred first also catches big slips.",
      },
    ],
    related: ["add_within_100", "subtract_within_100", "multi_digit_add_subtract", "multiply_by_tens"],
  },

  // ---------------------------------------------------------------- 3rd grade

  times_tables: {
    title: "Times tables",
    what: "Times tables are the multiplication facts from 2 × 2 up to 12 × 12, like 6 × 7 = 42. Multiplying is a fast way to add equal groups: 6 × 7 means 6 groups of 7. Knowing these facts by heart makes division, fractions and bigger multiplication much easier.",
    steps: [
      "Start with the easier tables: the 2s are doubles, the 5s count by fives and the 10s end in 0.",
      "Use turnarounds: 3 × 8 and 8 × 3 are the same fact, so every fact you learn gives you two.",
      "Build hard facts from easy ones: 6 × 7 is 5 × 7 = 35 plus one more 7, which is 42.",
      "Use patterns: in the 9s up to 9 × 10, the digits of the answer add up to 9, as in 9 × 6 = 54.",
      "With three numbers, like 3 × 4 × 2, multiply two of them first and then the third: 3 × 4 = 12 and 12 × 2 = 24.",
      "Practice a few facts each day until the answer comes without counting.",
    ],
    slips: [
      {
        slip: "Mixing up neighboring facts, like 7 × 8 = 54 or 6 × 8 = 42.",
        fix: "Anchor the tricky ones to a fact you're sure of: 7 × 8 is 7 × 7 = 49 plus one more 7, so 56.",
      },
      {
        slip: "Adding instead of multiplying, so 4 × 3 comes out as 7.",
        fix: "Read × as “groups of”: 4 groups of 3 is 3 + 3 + 3 + 3 = 12.",
      },
      {
        slip: "Losing count while skip counting, so 8 × 4 comes out as 36.",
        fix: "Keep track of the counts on fingers: 8 × 4 is eight counts of 4 (4, 8, 12, 16, 20, 24, 28, 32), ending at 32.",
      },
    ],
    faq: [
      {
        q: "What grade learns times tables?",
        a: "3rd grade. Most US schools expect kids to know all products of two one-digit numbers from memory by the end of 3rd grade, and many go on to 12 × 12, though schools vary.",
      },
      {
        q: "How can my child memorize times tables?",
        a: "Learn a few facts at a time, easiest first, and say the whole fact (6 × 7 = 42), not just the answer. A few minutes a day works better than long drills, and hard facts stick once they are built from easy ones.",
      },
      {
        q: "Is it a problem if my child still skip counts to multiply?",
        a: "It is a normal stage, but it gets slow and error-prone as problems grow. Strategies like doubling a 3s fact to get the 6s fact (3 × 7 = 21, so 6 × 7 = 42) are a good bridge to knowing facts by heart.",
      },
      {
        q: "Can my child practice times tables in Agathon?",
        a: "Yes. Times tables is a skill on Agathon's 3rd-grade path, and the tutor checks each answer your child writes.",
      },
    ],
    related: ["add_tens", "division_facts", "multiply_by_tens", "multiply_multi_digit"],
  },

  division_facts: {
    title: "Division facts",
    what: "Division facts are the sharing facts that go with the times tables, like 42 ÷ 6 = 7, because 6 × 7 = 42. Dividing means splitting a number into equal groups, or finding how many groups fit. Kids who know these facts quickly are ready for long division and for simplifying fractions.",
    steps: [
      "Read 42 ÷ 6 as “how many 6s make 42?” or “42 shared into 6 equal groups”.",
      "Think of the matching multiplication fact, asking what number times 6 makes 42.",
      "Use the times tables to find it: 6 × 7 = 42, so 42 ÷ 6 = 7.",
      "If the fact doesn't come, skip count by the number you divide by and count the jumps: 6, 12, 18, 24, 30, 36, 42 is 7 jumps.",
      "Check by multiplying back: 7 × 6 = 42.",
    ],
    slips: [
      {
        slip: "Mixing up which number is being divided, as if 42 ÷ 6 meant 6 ÷ 42.",
        fix: "The first number is the total being shared. Read it as “42 split into groups of 6”.",
      },
      {
        slip: "Pulling the wrong fact from memory, so 56 ÷ 8 comes out as 6.",
        fix: "Check by multiplying back: 6 × 8 = 48, not 56. Since 7 × 8 = 56, the answer is 7.",
      },
      {
        slip: "Freezing on the 11s and 12s, as in 132 ÷ 11 or 144 ÷ 12.",
        fix: "Learn the 11 and 12 times tables first, then divide from them: 11 × 12 = 132, so 132 ÷ 11 = 12.",
      },
    ],
    faq: [
      {
        q: "What grade learns division facts?",
        a: "3rd grade, together with the times tables. Most US schools expect kids to divide within 100 quickly by the end of 3rd grade.",
      },
      {
        q: "Should my child memorize division facts separately?",
        a: "Mostly no. A child who knows 6 × 7 = 42 well can get 42 ÷ 6 and 42 ÷ 7 from it, so time spent on times tables pays off twice.",
      },
      {
        q: "What is a fact family?",
        a: "Three numbers that go together and the four facts they make: 6 × 7 = 42, 7 × 6 = 42, 42 ÷ 6 = 7 and 42 ÷ 7 = 6. Practicing the whole family at once ties division to multiplication.",
      },
    ],
    related: ["times_tables", "multiply_by_tens", "long_division", "equivalent_fractions"],
  },

  multiply_by_tens: {
    title: "Multiplying by multiples of 10",
    what: "This skill is multiplying a single digit by a multiple of 10 or 100, like 4 × 60 = 240 or 6 × 400 = 2400, and multiplying two multiples of 10, like 30 × 50 = 1500. The trick is a times table fact plus place value: 4 × 6 tens is 24 tens, which is 240. It is the first piece of multi-digit multiplication, and the tool kids use to estimate.",
    steps: [
      "Find the basic fact hiding in the problem: 4 × 60 hides 4 × 6 = 24.",
      "Count the zeros at the end of the multiples of 10 or 100: 60 has one.",
      "Write the basic fact's answer followed by that many zeros: 24 with one zero is 240.",
      "For two multiples of 10, like 30 × 50, use 3 × 5 = 15 and write both zeros: 1500.",
      "Check that the size makes sense: 4 × 60 is 4 groups of 60, which should be more than 200.",
    ],
    slips: [
      {
        slip: "Losing a zero when the basic fact already ends in 0, so 50 × 40 comes out as 200.",
        fix: "Write the basic fact in full first (5 × 4 = 20), then add the zeros from the problem, two here: 50 × 40 = 2000.",
      },
      {
        slip: "Writing only one zero for two multiples of 10, so 30 × 50 comes out as 150.",
        fix: "Each factor brings its own zero: 3 × 5 × 10 × 10 = 1500.",
      },
      {
        slip: "Using the wrong basic fact, so 8 × 70 comes out as 480.",
        fix: "The zeros are only as good as the fact in front of them. Since 8 × 7 = 56, the answer is 560.",
      },
    ],
    faq: [
      {
        q: "What grade learns multiplying by multiples of 10?",
        a: "3rd grade starts with problems like 4 × 60, and 4th and 5th grade go on to ones like 6 × 400 and 30 × 50. Schools vary in when the bigger ones appear.",
      },
      {
        q: "Is “just add a zero” a good rule?",
        a: "It works for whole numbers, as long as kids also know why: 4 × 60 is 4 × 6 tens, which is 24 tens. The rule breaks with decimals (0.3 × 10 is 3, not 0.30), so the place-value reason matters more.",
      },
      {
        q: "Why does this skill matter later?",
        a: "It is how kids estimate, since 38 × 6 is close to 40 × 6 = 240, and how they check bigger multiplication. It is also the idea behind the second row of a two-digit multiplication, like 34 × 20 = 680.",
      },
    ],
    related: ["times_tables", "add_tens", "multiply_multi_digit", "decimals_multiply"],
  },

  // ---------------------------------------------------------------- 4th grade

  multi_digit_add_subtract: {
    title: "Multi-digit addition and subtraction",
    what: "Multi-digit addition and subtraction uses the standard column method on four- and five-digit numbers, like 4386 + 2947 = 7333 and 7032 − 2847 = 4185. By the end of 4th grade, kids are expected to do this accurately on paper. The steps are the same at every size: line up by place, start at the ones, and regroup when needed.",
    steps: [
      "Write the numbers in columns, lining up the ones digits on the right.",
      "Add or subtract one column at a time, from the ones toward the left.",
      "In addition, a column that makes 10 or more puts its ones digit in the answer and regroups 1 into the next column.",
      "In subtraction, regroup from the column to the left when the top digit is too small, even if that means regrouping across a zero.",
      "Estimate to check the size: 4386 + 2947 is about 4000 + 3000 = 7000, so 7333 makes sense.",
      "Check exactly with the opposite operation: 4185 + 2847 = 7032.",
    ],
    slips: [
      {
        slip: "Lining up numbers of different lengths on the left, so in 4386 + 725 the 7 sits under the 4.",
        fix: "Line numbers up on the right, by their ones digits. Lined paper turned sideways keeps the columns straight.",
      },
      {
        slip: "Getting lost regrouping across a zero, as in 5032 − 687.",
        fix: "Regroup from the first digit that isn't 0: the 5 becomes 4 and the 0 becomes 10, which can then give a ten to the next column. Adding back, 4345 + 687 = 5032, confirms the answer.",
      },
      {
        slip: "Dropping one regrouped 1 in a long chain of them, so 4386 + 2947 comes out as 7233.",
        fix: "Write each regrouped 1 before adding the next column. Checking with subtraction, 7333 − 2947 = 4386, catches a lost one.",
      },
    ],
    faq: [
      {
        q: "What grade learns multi-digit addition and subtraction?",
        a: "4th grade is when US schools usually expect kids to add and subtract multi-digit whole numbers fluently with the standard method. The skill keeps showing up in every grade after.",
      },
      {
        q: "My child knows the method but keeps getting wrong answers. Why?",
        a: "Usually it is one small slip: a basic fact, a lost regroup or a column out of line. Checking each answer with the opposite operation finds most of these.",
      },
      {
        q: "Is it okay to use a calculator?",
        a: "For checking, yes. For practice, doing it by hand is the point, because it builds the place-value sense that multiplication and long division need.",
      },
    ],
    related: ["add_subtract_within_1000", "multiply_multi_digit", "long_division", "decimals_add_subtract"],
  },

  multiply_multi_digit: {
    title: "Multi-digit multiplication",
    what: "Multi-digit multiplication means multiplying bigger numbers, like 46 × 7 = 322 or 34 × 26 = 884, by breaking them into place values. Each part is multiplied separately and the parts are added, either in the stacked method or in an area model (the box method). It uses times tables, multiplying by tens and addition all at once.",
    steps: [
      "Write the bigger number on top and line up the ones digits.",
      "Multiply the top number by the ones digit of the bottom number, regrouping as you go: 34 × 6 = 204.",
      "Start the next row with a 0 in the ones place, because the next digit stands for tens.",
      "Multiply by the tens digit: 34 × 2 tens is 68 tens, so the row reads 680.",
      "Add the rows: 204 + 680 = 884.",
      "Estimate to check: 34 × 26 is about 30 × 30 = 900.",
    ],
    slips: [
      {
        slip: "Forgetting the 0 at the start of the second row, so 34 × 26 comes out as 204 + 68 = 272.",
        fix: "The 2 in 26 means 20, so its row is 34 × 20 = 680. An estimate of about 900 shows that 272 is far too small.",
      },
      {
        slip: "Adding the regrouped digit before multiplying, so 46 × 7 comes out as 562.",
        fix: "Multiply first, then add what was regrouped: 4 × 7 = 28, plus the regrouped 4 is 32, so 46 × 7 = 322.",
      },
      {
        slip: "Regrouped digits from the first row getting mixed into the second row.",
        fix: "Cross out the small regrouped digits when a row is finished, so only the new ones are left on top.",
      },
    ],
    faq: [
      {
        q: "What grade learns multi-digit multiplication?",
        a: "4th grade, for a number up to four digits times one digit and two digits times two digits. US schools usually expect the stacked method to be fluent by the end of 5th grade.",
      },
      {
        q: "What is the box method?",
        a: "It is an area model: 34 × 26 is drawn as a rectangle split into 30 × 20, 30 × 6, 4 × 20 and 4 × 6. The four parts, 600 + 180 + 80 + 24, add up to 884.",
      },
      {
        q: "Why does my child's school teach several methods?",
        a: "The box method shows why multiplication works, and the stacked method is faster once that is clear. Both give the same answer, so one is a good way to check the other.",
      },
    ],
    related: ["times_tables", "multiply_by_tens", "long_division", "decimals_multiply"],
  },

  long_division: {
    title: "Long division",
    what: "Long division is a way to divide a big number by a smaller one, one digit at a time, like 864 ÷ 4 = 216. It repeats four steps: divide, multiply, subtract and bring down. It matters because it is the method for dividing any large number, and it comes back for turning fractions into decimals and, in high school, for dividing polynomials.",
    steps: [
      "Divide: look at the first digit, 8, and ask how many times 4 goes into it; it goes 2 times, so write 2 above the 8.",
      "Multiply: 2 × 4 = 8, and write that 8 under the 8.",
      "Subtract: 8 − 8 = 0, and check that what is left is smaller than 4, the number you are dividing by.",
      "Bring down the next digit, 6, and repeat: 4 goes into 6 once, 1 × 4 = 4, and 6 − 4 = 2.",
      "Bring down the last digit to make 24, and 4 goes into 24 six times with nothing left, so 864 ÷ 4 = 216.",
      "Check by multiplying: 216 × 4 = 864.",
    ],
    slips: [
      {
        slip: "A leftover bigger than the divisor partway through, like subtracting and getting 5 when dividing by 4.",
        fix: "It means the digit on top is too small. Make it one bigger and multiply again; every leftover must be smaller than the number you divide by.",
      },
      {
        slip: "Leaving out a 0 in the answer, so 618 ÷ 3 comes out as 26 instead of 206.",
        fix: "Every digit you bring down needs a digit on top. When the divisor doesn't go into it (3 into 1), write 0 above it and bring down the next digit.",
      },
      {
        slip: "Skipping a bring down, or bringing down two digits at once.",
        fix: "Draw a small arrow for each digit brought down. The answer should have a digit above every digit of the number being divided, from the first one used.",
      },
      {
        slip: "A times-table slip inside one of the steps, like 7 × 6 = 48.",
        fix: "Long division is only as good as the facts in it, so check the multiplication when a step looks off: 7 × 6 = 42.",
      },
    ],
    faq: [
      {
        q: "What grade learns long division?",
        a: "Most US schools start long division in 4th grade with one-digit divisors, like 864 ÷ 4. Two-digit divisors come in 5th grade, and the standard method is expected to be fluent by 6th grade, though schools vary.",
      },
      {
        q: "Why is long division so hard for kids?",
        a: "It stacks several skills in one problem: division facts, multiplication, subtraction and keeping digits lined up. A slip in any one of them spreads to every step after it, so it helps to check each step, not just the final answer.",
      },
      {
        q: "Is there a trick to remember the steps?",
        a: "Many teachers use “Dad, Mom, Sister, Brother” for divide, multiply, subtract, bring down. After each bring down, the four steps start again until no digits are left.",
      },
      {
        q: "What should my child do when stuck partway through?",
        a: "Go back to the last step that was right and redo the next one: is the leftover smaller than the divisor, and was the next digit brought down? In Agathon, the tutor checks each line your child writes, and Help me lets them ask for a hint instead of the answer.",
      },
    ],
    related: ["division_facts", "multiply_multi_digit", "multi_digit_add_subtract", "decimals_multiply"],
  },

  equivalent_fractions: {
    title: "Equivalent fractions",
    what: "Equivalent fractions are different fractions that name the same amount, like 3/4 = 6/8 = 9/12. Kids make them by multiplying the top and bottom by the same number, and they simplify a fraction by dividing both until no common factor is left, so 20/25 becomes 4/5. This is the skill behind adding fractions with unlike denominators and writing every fraction answer in simplest form.",
    steps: [
      "To make an equivalent fraction, multiply the numerator (top) and denominator (bottom) by the same number: 3/4 = 6/8, with both multiplied by 2.",
      "To simplify, find a number that divides both the top and the bottom, such as 5 for 20/25.",
      "Divide both by it: 20 ÷ 5 = 4 and 25 ÷ 5 = 5, so 20/25 = 4/5.",
      "Repeat until only 1 divides both, which is simplest form, also called lowest terms.",
      "If the top is bigger than the bottom, simplify and then write it as a mixed number if asked: 18/8 = 9/4 = 2 1/4.",
    ],
    slips: [
      {
        slip: "Adding the same number to the top and bottom, so 3/4 becomes 5/6.",
        fix: "Only multiplying or dividing keeps the amount the same, and a fraction bar drawing shows 5/6 is bigger than 3/4. Multiply instead: 3/4 = 6/8.",
      },
      {
        slip: "Stopping too early, so 24/36 is simplified to 12/18 and left there.",
        fix: "Check again for a common factor: 12/18 still divides by 6, giving 2/3. Dividing by the greatest common factor, 12, gets there in one step.",
      },
      {
        slip: "Dividing only the top or only the bottom, so 6/9 becomes 2/9.",
        fix: "Whatever you do to the numerator, do to the denominator: 6 ÷ 3 = 2 and 9 ÷ 3 = 3, so 6/9 = 2/3.",
      },
    ],
    faq: [
      {
        q: "What grade learns equivalent fractions?",
        a: "Kids first meet them with fraction strips in 3rd grade, and 4th grade makes them a full skill, with multiplying and dividing the top and bottom. Simplifying fractions is used in every grade after that.",
      },
      {
        q: "What does “simplest form” mean?",
        a: "A fraction is in simplest form when its top and bottom have no common factor other than 1, like 2/3. Teachers usually want every fraction answer written this way.",
      },
      {
        q: "Why does my child keep getting fractions wrong?",
        a: "Often it is one idea underneath: a fraction's top and bottom work as a pair, and changing one without the other changes the amount. Drawing the fraction as a bar cut into equal parts makes that easy to see.",
      },
    ],
    related: ["division_facts", "add_fractions_like", "add_fractions_unlike", "multiply_fractions", "proportions"],
  },

  add_fractions_like: {
    title: "Adding fractions with like denominators",
    what: "Fractions with like denominators have the same bottom number, like 2/7 and 3/7. The pieces are the same size, so you add or subtract the tops and keep the bottom: 2/7 + 3/7 = 5/7. Kids also add and subtract mixed numbers this way, like 2 1/5 + 1 3/5 = 3 4/5.",
    steps: [
      "Check that the denominators match, as in 5/8 − 3/8.",
      "Add or subtract the numerators: 5 − 3 = 2.",
      "Keep the denominator the same: 5/8 − 3/8 = 2/8.",
      "Simplify if you can: 2/8 = 1/4.",
      "With mixed numbers, add the whole numbers and the fractions separately, and turn a fraction of 1 or more into a whole: 4 3/4 + 2 3/4 = 6 6/4 = 7 2/4 = 7 1/2.",
      "To take away a bigger fraction from a mixed number, regroup a whole first: 6 1/5 − 3 2/5 = 5 6/5 − 3 2/5 = 2 4/5.",
    ],
    slips: [
      {
        slip: "Adding the denominators too, so 2/7 + 3/7 comes out as 5/14.",
        fix: "The denominator names the size of the pieces, and that doesn't change. Two sevenths and three sevenths are five sevenths: 5/7.",
      },
      {
        slip: "Taking the smaller fraction from the bigger one, so 6 1/5 − 3 2/5 comes out as 3 1/5.",
        fix: "1/5 can't give away 2/5, so regroup one whole as 5/5 first: 6 1/5 becomes 5 6/5, and 5 6/5 − 3 2/5 = 2 4/5.",
      },
      {
        slip: "Leaving answers like 7 6/4 or 3/3 as they are.",
        fix: "When the top is as big as the bottom or bigger, there is a whole inside: 6/4 is 1 2/4, and 3/3 is 1.",
      },
    ],
    faq: [
      {
        q: "What grade learns adding fractions with like denominators?",
        a: "4th grade, including subtracting and mixed numbers with the same denominator. Fractions with different denominators come in 5th grade.",
      },
      {
        q: "Why can't you add the bottom numbers?",
        a: "The bottom number tells how many equal pieces make a whole, so it names the piece instead of counting them. 1/4 + 1/4 is two quarter pieces, which is 2/4 or one half, not 2/8.",
      },
      {
        q: "Does Agathon practice include subtracting and mixed numbers?",
        a: "Yes. Agathon's practice for this skill mixes adding and subtracting, three fractions at once, and mixed numbers, and the tutor checks each line your child writes.",
      },
    ],
    related: ["equivalent_fractions", "add_fractions_unlike", "multiply_fractions", "decimals_add_subtract"],
  },

  // ---------------------------------------------------------------- 5th grade

  add_fractions_unlike: {
    title: "Adding fractions with unlike denominators",
    what: "Unlike denominators means the bottom numbers are different, as in 3/4 + 1/6. You can't add fourths and sixths directly, so you first rewrite both fractions with a common denominator, then add the numerators: 3/4 + 1/6 = 9/12 + 2/12 = 11/12. The same steps work for subtracting and for mixed numbers.",
    steps: [
      "Find a common denominator, ideally the least common multiple of the two bottoms: for 4 and 6, list multiples (4, 8, 12 and 6, 12) and pick 12.",
      "Rewrite each fraction over that denominator by multiplying its top and bottom by the same number: 3/4 = 9/12 and 1/6 = 2/12.",
      "Add or subtract the numerators and keep the new denominator: 9/12 + 2/12 = 11/12.",
      "Simplify the answer, and turn an improper fraction into a mixed number: 3/4 + 7/8 = 6/8 + 7/8 = 13/8 = 1 5/8.",
      "For mixed numbers, add the wholes and the fractions separately: 1 1/2 + 2 1/3 = 3 + 3/6 + 2/6 = 3 5/6.",
    ],
    slips: [
      {
        slip: "Adding straight across, so 1/2 + 1/3 comes out as 2/5.",
        fix: "Check the size: 2/5 is less than 1/2, but adding 1/3 should make it bigger. With a common denominator, 1/2 + 1/3 = 3/6 + 2/6 = 5/6.",
      },
      {
        slip: "Changing the denominator but not the numerator, so 3/4 becomes 3/12.",
        fix: "Whatever multiplies the bottom must multiply the top: 4 × 3 = 12, so 3 × 3 = 9 and 3/4 = 9/12.",
      },
      {
        slip: "Picking a denominator that isn't a multiple of both, like 8 for 3/4 + 1/6.",
        fix: "The common denominator has to be in both times tables, and 8 is not a multiple of 6. Use 12, or multiply the two denominators to get 24 and simplify at the end.",
      },
    ],
    faq: [
      {
        q: "What grade learns adding fractions with unlike denominators?",
        a: "5th grade, in most US schools. It comes after 4th grade's fractions with the same denominator and equivalent fractions, which it depends on.",
      },
      {
        q: "Why does my child keep adding the tops and the bottoms?",
        a: "It looks like the way you add everything else, and it gives a neat-looking answer. Asking “is my answer bigger than each fraction I added?” catches it, because 2/5 is smaller than 1/2, so it can't be 1/2 + 1/3.",
      },
      {
        q: "Do you have to use the least common denominator?",
        a: "No. Any common denominator gives the right answer, though bigger ones take more simplifying at the end. Multiplying the two denominators always works: for 1/4 + 1/6, 24 works as well as 12.",
      },
      {
        q: "What if my child gets stuck on one of the steps?",
        a: "Ask which step they're on: finding the denominator, rewriting the fractions, or adding. In Agathon, the tutor checks each line as your child writes it, and Help me lets them ask for a hint instead of the answer.",
      },
    ],
    related: ["equivalent_fractions", "add_fractions_like", "multiply_fractions", "divide_fractions", "rational_expressions"],
  },

  multiply_fractions: {
    title: "Multiplying fractions",
    what: "Multiplying fractions means finding a fraction of something: 2/3 × 3/5 is two thirds of three fifths. You multiply the tops together and the bottoms together: 2/3 × 3/5 = 6/15 = 2/5. Kids also multiply a fraction by a whole number, like 3/4 × 8 = 6, and by mixed numbers.",
    steps: [
      "Write any whole number as a fraction over 1: 8 is 8/1.",
      "Turn any mixed number into an improper fraction: 2 1/2 = 5/2.",
      "Multiply the numerators and multiply the denominators: 5/2 × 3/1 = 15/2.",
      "Simplify, and write an improper answer as a mixed number: 15/2 = 7 1/2.",
      "To save work, simplify before multiplying: in 3/4 × 8/1, divide the 4 and the 8 by 4 to get 3/1 × 2/1 = 6.",
    ],
    slips: [
      {
        slip: "Finding a common denominator first, as if adding, so 2/3 × 3/5 turns into 10/15 × 9/15.",
        fix: "Multiplying never needs a common denominator. Multiply top by top and bottom by bottom, then simplify.",
      },
      {
        slip: "Multiplying the whole number into both the top and the bottom, so 3 × 2/5 comes out as 6/15.",
        fix: "Write 3 as 3/1: 3/1 × 2/5 = 6/5, which is 1 1/5. Three groups of two fifths is six fifths.",
      },
      {
        slip: "Multiplying only the whole part of a mixed number, so 2 1/2 × 3 comes out as 6 1/2.",
        fix: "Turn 2 1/2 into 5/2 first, or multiply both parts: 2 × 3 = 6 and 1/2 × 3 = 1 1/2, so the answer is 7 1/2.",
      },
    ],
    faq: [
      {
        q: "What grade learns multiplying fractions?",
        a: "4th grade multiplies a fraction by a whole number, and 5th grade multiplies a fraction by a fraction, including mixed numbers. Schools vary a little in the pace.",
      },
      {
        q: "Why does multiplying by a fraction make the answer smaller?",
        a: "Multiplying by a fraction less than 1 means taking part of something: 1/2 × 8 is half of 8, which is 4. You are taking less than one whole group, so you get less than you started with.",
      },
      {
        q: "Is multiplying fractions easier than adding them?",
        a: "Usually, yes, because there is no common denominator to find. The tricky parts are mixed numbers and remembering to simplify.",
      },
    ],
    related: ["equivalent_fractions", "add_fractions_unlike", "divide_fractions", "decimals_multiply", "percents"],
  },

  decimals_add_subtract: {
    title: "Adding and subtracting decimals",
    what: "Adding and subtracting decimals works like whole numbers, as long as the decimal points line up: tenths under tenths and hundredths under hundredths. For example, 3.45 + 2.8 = 6.25 and 5 − 2.3 = 2.7. Kids use it for money and measurements, and later in almost every calculation with decimals.",
    steps: [
      "Write the numbers in a column with the decimal points lined up.",
      "Fill empty places with zeros so both numbers have the same number of digits after the point: 2.8 becomes 2.80, and 5 becomes 5.0.",
      "Add or subtract from the right, regrouping just as with whole numbers.",
      "Bring the decimal point straight down into the answer: 3.45 + 2.80 = 6.25.",
      "Check by estimating: 3.45 + 2.8 is about 3 + 3 = 6.",
    ],
    slips: [
      {
        slip: "Lining up the last digits instead of the points, so 3.45 + 2.8 comes out as 3.73.",
        fix: "Line up the points, not the right edges. Writing 2.8 as 2.80 makes the columns easy to see.",
      },
      {
        slip: "Subtracting from a whole number by bringing the decimal part down, so 5 − 2.3 comes out as 3.3.",
        fix: "Write 5 as 5.0 so the 0 tenths show, then regroup: 5.0 − 2.3 = 2.7.",
      },
      {
        slip: "Leaving the point out of the answer, or putting it in the wrong place.",
        fix: "Estimate first: 6.3 − 2.7 is about 6 − 3 = 3, so 3.6 makes sense and 36 does not.",
      },
    ],
    faq: [
      {
        q: "What grade learns adding and subtracting decimals?",
        a: "5th grade, to hundredths, in most US schools. In 6th grade kids are expected to do it quickly with the standard method.",
      },
      {
        q: "Why does lining up the decimal points matter?",
        a: "Each column has to hold one place value, ones with ones and tenths with tenths. Lining up the points does that automatically, even when the numbers have different lengths.",
      },
      {
        q: "Is money a good way to practice decimals?",
        a: "Yes. Cents are hundredths of a dollar, so adding two prices or working out change is real decimal practice.",
      },
    ],
    related: ["multi_digit_add_subtract", "add_fractions_like", "decimals_multiply", "percents"],
  },

  decimals_multiply: {
    title: "Multiplying decimals",
    what: "Multiplying decimals uses whole-number multiplication and then places the decimal point, like 1.2 × 3 = 3.6 or 0.6 × 0.4 = 0.24. The answer has as many digits after the point as the two factors have together. This skill also covers multiplying and dividing by 10, 100 and 0.1, which just moves the point.",
    steps: [
      "Multiply as if there were no decimal points: for 1.8 × 0.4, work out 18 × 4 = 72.",
      "Count the digits after the point in both factors: 1.8 has one and 0.4 has one, so two in all.",
      "Place the point so the answer has that many digits after it: 1.8 × 0.4 = 0.72.",
      "To multiply by 10 or 100, move the point 1 or 2 places to the right: 3.45 × 10 = 34.5 and 2.7 × 100 = 270.",
      "To divide by 10, or multiply by 0.1, move the point 1 place to the left: 3.6 ÷ 10 = 0.36 and 5.4 × 0.1 = 0.54.",
    ],
    slips: [
      {
        slip: "Putting one digit after the point when both factors have one, so 0.6 × 0.4 comes out as 2.4.",
        fix: "Count digits after the point in both numbers: 0.6 and 0.4 have one each, so the answer has two, 0.24. A check: 0.4 is less than half, so the answer must be less than half of 0.6.",
      },
      {
        slip: "Moving the point the wrong way, so 3.6 ÷ 10 comes out as 36.",
        fix: "Dividing by 10 makes a number smaller: 3.6 ÷ 10 = 0.36. Ask whether the answer should be bigger or smaller before moving the point.",
      },
      {
        slip: "Using “add a zero” from whole numbers, so 3.45 × 10 comes out as 3.450.",
        fix: "A zero at the end of a decimal doesn't change it. Move the point one place right instead: 3.45 × 10 = 34.5.",
      },
    ],
    faq: [
      {
        q: "What grade learns multiplying decimals?",
        a: "5th grade, with decimals to hundredths and multiplying and dividing by 10, 100 and 1000. Kids get faster at it in 6th grade.",
      },
      {
        q: "Why don't you line up the decimal points when multiplying?",
        a: "Lining up points keeps place values together when adding. Multiplying works differently, since tenths times tenths make hundredths, which is why you count the digits after the point instead.",
      },
      {
        q: "Why does multiplying by 0.1 make a number smaller?",
        a: "Multiplying by 0.1 means taking one tenth of the number, so 5.4 × 0.1 = 0.54. Any factor less than 1 shrinks a positive number.",
      },
    ],
    related: ["multiply_by_tens", "multiply_multi_digit", "decimals_add_subtract", "multiply_fractions", "percents"],
  },

  order_of_operations: {
    title: "Order of operations (PEMDAS)",
    what: "The order of operations is the rule for which part of a math problem to do first, so everyone gets the same answer. Parentheses come first, then exponents, then multiplication and division from left to right, then addition and subtraction from left to right. For example, 12 + 5 × 3 = 27, not 51, because the multiplication comes before the addition.",
    steps: [
      "Do what is inside the parentheses first: (7 + 4) × 2 = 11 × 2 = 22.",
      "Work out any exponents next, such as 3² = 9.",
      "Then do multiplication and division, in the order they appear from left to right.",
      "Then do addition and subtraction, in the order they appear from left to right.",
      "Rewrite the problem after each step so nothing gets lost: 18 − 6 ÷ 2 becomes 18 − 3, which is 15.",
    ],
    slips: [
      {
        slip: "Working straight from left to right, so 12 + 5 × 3 comes out as 51.",
        fix: "Underline the multiplication and division and do those first, then add: 12 + 15 = 27.",
      },
      {
        slip: "Reading PEMDAS as “multiplication before division”, so 24 ÷ 4 × 2 comes out as 3.",
        fix: "Multiplication and division are a pair, done left to right as they appear, and so are addition and subtraction: 24 ÷ 4 × 2 = 6 × 2 = 12.",
      },
      {
        slip: "Multiplying only the first number inside the parentheses, so 5 × (6 + 5) is worked as 5 × 6 + 5.",
        fix: "Add inside the parentheses first, 6 + 5 = 11 and 5 × 11 = 55, or multiply both numbers inside: 5 × 6 + 5 × 5 = 55.",
      },
    ],
    faq: [
      {
        q: "What grade learns order of operations?",
        a: "5th grade, with parentheses and the four operations. Exponents join the rule in 6th grade, and it keeps mattering all through algebra.",
      },
      {
        q: "What does PEMDAS stand for?",
        a: "Parentheses, Exponents, Multiplication and Division, Addition and Subtraction; many kids remember it as “Please Excuse My Dear Aunt Sally.” Some teachers say GEMDAS, where G stands for grouping symbols, and it means the same thing.",
      },
      {
        q: "Why does the order matter?",
        a: "Without one agreed order, 12 + 5 × 3 could be 27 or 51. The rule makes every written problem mean just one thing, and calculators follow it too.",
      },
    ],
    related: ["times_tables", "negative_numbers", "powers_roots", "simplify_expressions"],
  },

  // ---------------------------------------------------------------- 6th grade

  divide_fractions: {
    title: "Dividing fractions",
    what: "Dividing fractions asks how many of one amount fit into another: 6 ÷ 1/3 = 18, because 18 thirds fit into 6 wholes. The usual method is to keep the first fraction, change ÷ to ×, and flip the second fraction. So 3/4 ÷ 1/2 = 3/4 × 2/1 = 6/4 = 1 1/2.",
    steps: [
      "Write any whole number as a fraction over 1: 4/5 ÷ 2 becomes 4/5 ÷ 2/1.",
      "Keep the first fraction as it is.",
      "Change the division sign to multiplication.",
      "Flip the second fraction, so 2/1 becomes 1/2 (this is its reciprocal).",
      "Multiply and simplify: 4/5 × 1/2 = 4/10 = 2/5.",
    ],
    slips: [
      {
        slip: "Flipping the first fraction instead of the second, so 3/4 ÷ 1/2 becomes 4/3 × 1/2.",
        fix: "Keep the first, flip the second. As a check, one and a half halves fit in 3/4, so the answer should be 1 1/2.",
      },
      {
        slip: "Expecting a smaller answer, so 6 ÷ 1/3 comes out as 2.",
        fix: "Dividing by a fraction less than 1 gives a bigger answer: each whole holds 3 thirds, so 6 wholes hold 6 × 3 = 18.",
      },
      {
        slip: "Flipping both fractions, or flipping one and then dividing anyway.",
        fix: "Flip only the second fraction, once, and then multiply. Writing “keep, change, flip” above each problem keeps the steps apart.",
      },
    ],
    faq: [
      {
        q: "What grade learns dividing fractions?",
        a: "6th grade divides a fraction by a fraction, like 3/4 ÷ 1/2. Kids see simpler cases in 5th grade, such as 6 ÷ 1/3 and 1/4 ÷ 2, often with drawings.",
      },
      {
        q: "Why does “keep, change, flip” work?",
        a: "Dividing by a number is the same as multiplying by its reciprocal. Dividing by 1/2 asks how many halves fit, and there are 2 halves in every whole, so ÷ 1/2 and × 2 give the same answer.",
      },
      {
        q: "My child knows the trick but not what it means. Does that matter?",
        a: "The trick gets the right answer, but word problems need the meaning: 2 ÷ 1/4 asks how many quarter cups are in 2 cups. Drawing a few problems out before using the trick builds both.",
      },
    ],
    related: ["multiply_fractions", "add_fractions_unlike", "equivalent_fractions", "proportions"],
  },

  percents: {
    title: "Percents",
    what: "A percent is a number out of 100: 25% means 25 out of every 100, the same as 1/4 or 0.25. Kids learn to find a percent of a number, like 25% of 80 = 20, and to work backward to find the whole or the percent. Percents show up in sales, tips, sports and data.",
    steps: [
      "Change the percent to a fraction or a decimal: 25% = 25/100 = 1/4, or 0.25.",
      "To find a percent of a number, multiply: 25% of 80 is 1/4 × 80 = 20.",
      "Use 10% as a shortcut, since it is the number divided by 10: 10% of 70 is 7, so 30% of 70 is 3 × 7 = 21.",
      "To find the whole from a part, write an equation: 25% of x is 20 means 0.25x = 20, so x = 20 ÷ 0.25 = 80.",
      "To find the percent, divide the part by the whole and multiply by 100: 20 out of 80 is 20 ÷ 80 = 0.25, which is 25%.",
    ],
    slips: [
      {
        slip: "Treating the percent as a whole number, so 15% of 80 comes out as 15 × 80 = 1200.",
        fix: "A percent is out of 100, so 15% of 80 is 0.15 × 80 = 12. An answer bigger than the whole only makes sense for percents over 100.",
      },
      {
        slip: "Mixing up the part and the whole in “what percent of 80 is 20?”, dividing 80 by 20 to get 400%.",
        fix: "The whole comes after “of”. Divide the part by the whole: 20 ÷ 80 = 0.25, so the answer is 25%.",
      },
      {
        slip: "Moving the decimal point only one place, so 5% becomes 0.5.",
        fix: "Percent means divide by 100, which moves the point two places left: 5% = 0.05. Only 50% is 0.5.",
      },
    ],
    faq: [
      {
        q: "What grade learns percents?",
        a: "6th grade, as part of ratios: finding a percent of a number and finding the whole from a part. In 7th grade kids use percents for discounts, tax, tips and percent change.",
      },
      {
        q: "What is an easy way to find a percent in your head?",
        a: "Start from 10%, which is the number divided by 10, and 50%, which is half. Then build the rest: 15% of 80 is 10% (8) plus 5% (4), which is 12.",
      },
      {
        q: "How are percents, fractions and decimals related?",
        a: "They are three ways to write the same amount: 3/4 = 0.75 = 75%. Switching between them easily is a big part of the skill.",
      },
    ],
    related: ["decimals_multiply", "multiply_fractions", "equivalent_fractions", "proportions", "one_step_equations"],
  },

  negative_numbers: {
    title: "Negative numbers",
    what: "Negative numbers are numbers less than zero, like −3, the kind you see on a thermometer below 0. In 6th grade kids place them on a number line, and in 7th grade they add, subtract, multiply and divide them, like −9 + (−3) = −12 and (−4) × (−8) = 32. Every part of algebra uses these rules.",
    steps: [
      "To add two numbers with the same sign, add their sizes and keep the sign: −9 + (−3) = −12.",
      "To add numbers with different signs, take the smaller size from the larger and keep the sign of the larger: −5 + 11 = 6.",
      "To subtract, add the opposite: −2 − (−5) becomes −2 + 5 = 3.",
      "To multiply or divide, work with the sizes, then choose the sign: the same signs give a positive answer and different signs give a negative one.",
      "So (−4) × (−8) = 32, and 45 ÷ (−5) = −9.",
    ],
    slips: [
      {
        slip: "Treating two minus signs in a row as staying negative, so −2 − (−5) comes out as −7.",
        fix: "Subtracting a negative is adding: −2 − (−5) = −2 + 5 = 3. On a number line, taking away a debt moves you up.",
      },
      {
        slip: "Using the multiplying rule when adding, so −8 + (−5) comes out as 13.",
        fix: "Two negatives make a positive only when multiplying or dividing. Adding two negatives goes further below zero: −8 + (−5) = −13.",
      },
      {
        slip: "Keeping the wrong sign when the signs differ, so 3 − 7 comes out as 4.",
        fix: "3 − 7 starts at 3 and moves 7 to the left, past zero, so it is −4. The answer takes the sign of the number with the bigger size.",
      },
    ],
    faq: [
      {
        q: "What grade learns negative numbers?",
        a: "Kids meet them in 6th grade on the number line and in graphing, and learn to add, subtract, multiply and divide them in 7th grade. That is why the skill shows up in two grades.",
      },
      {
        q: "Why do two negatives make a positive?",
        a: "One way to see it is a pattern: 3 × (−2) = −6, 2 × (−2) = −4, 1 × (−2) = −2 and 0 × (−2) = 0, going up by 2 each time. Keep going and (−1) × (−2) = 2.",
      },
      {
        q: "Is a minus sign the same as a negative sign?",
        a: "They look alike but do different jobs: in 5 − 3 it means subtract, and in −3 it means the number is below zero. Writing negatives in parentheses, like 4 − (−3), keeps the two apart.",
      },
    ],
    related: ["order_of_operations", "one_step_equations", "two_step_equations", "simplify_expressions", "absolute_value"],
  },

  powers_roots: {
    title: "Exponents and square roots",
    what: "An exponent says how many times to multiply a number by itself: 5² = 5 × 5 = 25 and 2⁴ = 2 × 2 × 2 × 2 = 16. A square root goes the other way: √49 = 7, because 7² = 49. Kids use squares and roots for area, the Pythagorean theorem and algebra.",
    steps: [
      "Read the small raised number as how many times the base is used: 4³ means 4 × 4 × 4.",
      "Multiply one step at a time: 4 × 4 = 16, then 16 × 4 = 64.",
      "For a square root, ask which number times itself makes the number under the root sign: √81 = 9, because 9 × 9 = 81.",
      "Learn the perfect squares from 1² = 1 to 15² = 225 so roots come quickly.",
      "In a longer problem, work out powers and roots before multiplying, dividing, adding or subtracting: 6² + √4 = 36 + 2 = 38.",
    ],
    slips: [
      {
        slip: "Multiplying the base by the exponent, so 5² comes out as 10 and 2³ as 6.",
        fix: "The exponent counts how many of the base to multiply: 5² = 5 × 5 = 25, and 2³ = 2 × 2 × 2 = 8.",
      },
      {
        slip: "Halving instead of taking the root, so √16 comes out as 8.",
        fix: "Check by squaring: 8 × 8 = 64, not 16. The root of 16 is 4, because 4 × 4 = 16.",
      },
      {
        slip: "Subtracting before squaring, so 12² − 11² is worked as 1².",
        fix: "Square each number first: 12² − 11² = 144 − 121 = 23.",
      },
    ],
    faq: [
      {
        q: "What grade learns exponents and square roots?",
        a: "6th grade writes and works out whole-number exponents, and square roots of perfect squares come between 6th and 8th grade depending on the school. 8th grade adds cube roots and roots like √2 that aren't whole numbers.",
      },
      {
        q: "What's the difference between squared and cubed?",
        a: "Squared means an exponent of 2, like the area of a square: 3² = 9. Cubed means an exponent of 3, like the volume of a cube: 3³ = 27.",
      },
      {
        q: "Should my child memorize the perfect squares?",
        a: "It helps a lot. Knowing 1, 4, 9, 16 and so on up to 225 makes square roots, the Pythagorean theorem and simplifying radicals much faster later.",
      },
    ],
    related: ["times_tables", "order_of_operations", "exponent_rules", "pythagorean", "radicals"],
  },

  one_step_equations: {
    title: "One-step equations",
    what: "A one-step equation, like x + 12 = 28 or 7x = 42, can be solved with a single operation. The goal is to get x alone by doing the inverse operation to both sides: subtract 12 to undo adding 12, or divide by 7 to undo multiplying by 7. These are the first equations kids solve, and every harder equation is built from these steps.",
    steps: [
      "Find what is being done to x: in x + 12 = 28, 12 is added.",
      "Choose the inverse operation, since subtraction undoes addition and division undoes multiplication.",
      "Do it to both sides of the equation: x + 12 − 12 = 28 − 12, so x = 16.",
      "For x/7 = 2, multiply both sides by 7 to get x = 14.",
      "Check by putting the answer back in: 16 + 12 = 28.",
    ],
    slips: [
      {
        slip: "Doing the same operation instead of the inverse, so x + 5 = 9 becomes x = 14.",
        fix: "To undo adding 5, subtract 5 from both sides: x = 4. Checking 14 + 5 = 19, not 9, shows the slip.",
      },
      {
        slip: "Changing only one side, so 3x = 12 becomes x = 12.",
        fix: "Whatever you do to one side, do to the other: divide both sides by 3, so x = 4.",
      },
      {
        slip: "Dividing upside down, so 5n = −20 gives n = −1/4.",
        fix: "Divide by the number next to the letter: n = −20 ÷ 5, which is −4. Check it: 5 × (−4) = −20.",
      },
      {
        slip: "Losing the sign, so x + 9 = 0 gives x = 9.",
        fix: "Subtract 9 from both sides: x = −9. Checking 9 + 9 = 18, not 0, shows why the answer has to be negative.",
      },
    ],
    faq: [
      {
        q: "What grade learns one-step equations?",
        a: "6th grade, with whole numbers and fractions. In 7th grade they grow into two-step equations, and in 8th grade into multi-step ones.",
      },
      {
        q: "My child can see the answer. Why write the steps?",
        a: "For x + 12 = 28 the answer is easy to see, but for 3x + 5 = 2x + 9 it isn't. Writing the inverse step now builds the habit for when the answer can't be guessed.",
      },
      {
        q: "What does “do the same thing to both sides” mean?",
        a: "An equation is like a balanced scale: both sides weigh the same. Adding, subtracting, multiplying or dividing both sides by the same number (never dividing by zero) keeps it balanced.",
      },
      {
        q: "How does Agathon help with equations?",
        a: "Your child solves on the board one line at a time, and the tutor checks each line. A slip, like adding 5 where it should subtract, is circled on the line where it happened.",
      },
    ],
    related: ["negative_numbers", "simplify_expressions", "two_step_equations", "proportions", "inequalities"],
  },

  simplify_expressions: {
    title: "Simplifying expressions",
    what: "Simplifying an expression means writing it in a shorter form with the same value, like turning 9x + 4 − 3x − 8 into 6x − 4. You do it by combining like terms, which have the same letter and power, and by using the distributive property to clear parentheses. It is a first big step into algebra and part of solving almost every equation.",
    steps: [
      "Clear parentheses with the distributive property, multiplying every term inside: 2(5x + 7) becomes 10x + 14.",
      "Watch the sign in front of the parentheses: −3(x − 6) becomes −3x + 18.",
      "Group like terms: x terms with x terms, x² terms with x² terms, and plain numbers with plain numbers.",
      "Combine each group by adding the numbers in front of the letters, called coefficients: 8x − 4x = 4x.",
      "Write the result with the highest power first and the plain number last, as in 7x² − 4x.",
    ],
    slips: [
      {
        slip: "Combining unlike terms, so 2x + 9x + 9 comes out as 20x.",
        fix: "Only terms with the same letter combine: 2x + 9x = 11x, and the 9 stays on its own, so the answer is 11x + 9.",
      },
      {
        slip: "Multiplying only the first term in the parentheses, so 4(x − 8) becomes 4x − 8.",
        fix: "The 4 multiplies everything inside: 4(x − 8) = 4x − 32. Drawing an arrow from the 4 to each term helps.",
      },
      {
        slip: "Losing a negative sign, so −3(x − 6) becomes −3x − 18.",
        fix: "A negative times a negative is positive: (−3) × (−6) = 18, so the answer is −3x + 18.",
      },
      {
        slip: "Dropping the sign in front of a term when regrouping, as in 8x + 4y − 4x − 5y.",
        fix: "Each term owns the sign in front of it. Circle the x terms with their signs (8x and −4x) and the y terms (4y and −5y), which gives 4x − y.",
      },
    ],
    faq: [
      {
        q: "What grade learns simplifying expressions?",
        a: "6th grade starts combining like terms and using the distributive property, and 7th grade adds negative numbers and longer expressions. By 8th grade, kids simplify as part of solving equations.",
      },
      {
        q: "What are like terms?",
        a: "Terms with exactly the same letter raised to the same power, such as 3x and −5x, or 4x² and x². 3x and 3x² are not like terms, even though they look close.",
      },
      {
        q: "Why simplify if there's no answer to find?",
        a: "Equations get much easier once each side is simplified. A child who can turn 4(x − 8) − 6(x − 1) into −2x − 26 has done most of the work of solving an equation with it.",
      },
    ],
    related: ["order_of_operations", "negative_numbers", "one_step_equations", "multi_step_equations", "polynomials"],
  },

  // ---------------------------------------------------------------- 7th grade

  proportions: {
    title: "Proportions",
    what: "A proportion says two ratios are equal, like x/4 = 9/12 or x:4 = 5:20. Solving one means finding the missing number that keeps the ratios the same, which here is x = 3 and x = 1. Proportions are used for recipes, maps, unit prices and scale drawings.",
    steps: [
      "Write the proportion as two fractions, so a ratio like x:4 = 5:20 becomes x/4 = 5/20.",
      "Look for a scale factor first: in 3/5 = x/20, the bottom went from 5 to 20, times 4, so x = 3 × 4 = 12.",
      "If there is no easy factor, cross multiply: in x/4 = 9/12, that gives 12x = 4 × 9 = 36.",
      "Divide to get x alone: x = 36 ÷ 12 = 3.",
      "Check that both sides match: with x = 3 the left side is 3/4, and 9/12 also simplifies to 3/4.",
    ],
    slips: [
      {
        slip: "Cross multiplying the wrong pairs, such as multiplying the two tops together.",
        fix: "Cross multiply on the diagonals, each top times the other bottom. In 6/x = 9/12, that gives 9x = 6 × 12 = 72, so x = 8.",
      },
      {
        slip: "Adding instead of scaling, so 3/5 = x/20 gives x = 18, because 5 + 15 = 20.",
        fix: "Ratios grow by multiplying, not adding: 5 × 4 = 20, so 3 × 4 = 12.",
      },
      {
        slip: "Setting up a word problem's ratios in different orders, cups to cookies on one side and cookies to cups on the other.",
        fix: "Label each ratio with its units and keep the same order on both sides.",
      },
    ],
    faq: [
      {
        q: "What grade learns proportions?",
        a: "6th grade introduces ratios and rates, and 7th grade is when kids solve proportions and decide whether two quantities are proportional. They come back in 8th grade with slope.",
      },
      {
        q: "Is cross multiplying the right way to solve a proportion?",
        a: "It always works, and teachers use it. Looking for the scale factor first is often faster and shows what a proportion means, so it is worth trying before cross multiplying.",
      },
      {
        q: "Where will my child use proportions outside school?",
        a: "Doubling a recipe, reading a map scale, comparing prices per ounce and converting units are all proportions.",
      },
    ],
    related: ["equivalent_fractions", "percents", "one_step_equations", "linear_functions", "units"],
  },

  two_step_equations: {
    title: "Two-step equations",
    what: "A two-step equation, like 2x + 3 = 11, needs two inverse operations to get x alone. You undo the adding or subtracting first, then the multiplying or dividing: subtract 3 to get 2x = 8, then divide by 2 to get x = 4. It is the core equation skill of 7th grade and leads straight into algebra.",
    steps: [
      "Undo the addition or subtraction first: in 7x + 19 = 33, subtract 19 from both sides to get 7x = 14.",
      "Then undo the multiplication or division: divide both sides by 7, so x = 2.",
      "For x/5 + 4 = 10, subtract 4 to get x/5 = 6, then multiply both sides by 5, so x = 30.",
      "When x has a minus in front, as in 7 − 2x = −17, keep the sign with its term: subtract 7 to get −2x = −24, then divide by −2, so x = 12.",
      "Check by putting the answer back in: 7 × 2 + 19 = 14 + 19 = 33.",
    ],
    slips: [
      {
        slip: "Dividing first but only dividing part of a side, so 2x + 3 = 11 becomes x + 3 = 5.5.",
        fix: "Undo the adding first, so the division later covers the whole side: 2x = 8, then x = 4. If you do divide first, divide every term, which gives x + 1.5 = 5.5.",
      },
      {
        slip: "Dropping the negative when dividing, so −2x = −24 gives x = −12.",
        fix: "Divide by −2, sign and all: −24 ÷ (−2) = 12. Then check: 7 − 2 × 12 = −17.",
      },
      {
        slip: "Moving a number across the equals sign without changing its sign, so 2x + 3 = 11 becomes 2x = 11 + 3.",
        fix: "Moving the 3 really means subtracting it from both sides, which gives 11 − 3 = 8. Writing the subtraction on both sides, instead of “moving” numbers, prevents this.",
      },
    ],
    faq: [
      {
        q: "What grade learns two-step equations?",
        a: "7th grade, in most US schools, including equations with negative numbers and fractions. Some 6th-grade classes start them early.",
      },
      {
        q: "Which step comes first?",
        a: "Undo the addition or subtraction first, then the multiplication or division. It is the order of operations in reverse, like taking off your shoes before your socks.",
      },
      {
        q: "My child gets the right answer but skips the steps. Is that okay?",
        a: "For simple problems it can be fine, but written steps make slips easy to find and are needed once equations get longer. One line per operation is a good middle ground.",
      },
    ],
    related: ["one_step_equations", "negative_numbers", "simplify_expressions", "multi_step_equations", "inequalities"],
  },

  inequalities: {
    title: "Solving inequalities",
    what: "An inequality compares two sides with <, >, ≤ or ≥ instead of =, like 3(x − 2) ≥ 21. Solving one works almost like an equation, and the answer is a range of numbers, here x ≥ 9, which you can show on a number line. The one new rule is that multiplying or dividing both sides by a negative number flips the sign.",
    steps: [
      "Solve as you would an equation, undoing adding or subtracting and then multiplying or dividing, on both sides.",
      "If you multiply or divide both sides by a negative number, flip the inequality sign: −6x ≥ 12 becomes x ≤ −2.",
      "For a compound inequality like −5 ≤ x − 4 ≤ 2, do the same step to all three parts, so adding 4 gives −1 ≤ x ≤ 6.",
      "Graph the answer on a number line, with a filled-in dot for ≤ or ≥ and an open dot for < or >.",
      "Check with a number from your answer: x = 10 in 3(x − 2) ≥ 21 gives 24 ≥ 21, which is true.",
    ],
    slips: [
      {
        slip: "Forgetting to flip the sign after dividing by a negative, so −7x ≤ −42 becomes x ≤ 6.",
        fix: "Dividing by −7 flips the sign, so x ≥ 6. Test a number to be sure: x = 10 gives −70 ≤ −42, which is true, so the answer includes numbers above 6.",
      },
      {
        slip: "Flipping the sign when it isn't needed, so 2x < −8 becomes x > −4.",
        fix: "Only multiplying or dividing by a negative flips the sign. Dividing by 2 keeps it, even though the answer is negative: x < −4.",
      },
      {
        slip: "Changing only two parts of a compound inequality, so −1 ≤ 2x − 3 < 15 becomes −1 ≤ 2x < 18.",
        fix: "Add 3 to all three parts, which gives 2 ≤ 2x < 18, then divide all three by 2: 1 ≤ x < 9.",
      },
      {
        slip: "Using the wrong dot on the number line.",
        fix: "≤ and ≥ include the number itself, so its dot is filled in. < and > leave it out, so the dot is open.",
      },
    ],
    faq: [
      {
        q: "What grade learns inequalities?",
        a: "6th grade writes simple inequalities like x > 3 and graphs them, and 7th grade solves two-step inequalities, including the sign flip. Compound inequalities, like −1 ≤ x ≤ 6, and x on both sides usually get their full treatment in Algebra 1.",
      },
      {
        q: "Why does the sign flip with a negative?",
        a: "Multiplying by a negative reverses the order of numbers: 2 < 5, but −2 > −5. So when both sides are multiplied or divided by a negative, the inequality has to turn around to stay true.",
      },
      {
        q: "What's the difference between < and ≤?",
        a: "x < 4 means numbers below 4, not including 4 itself. x ≤ 4, read “less than or equal to”, includes 4.",
      },
    ],
    related: ["one_step_equations", "two_step_equations", "negative_numbers", "multi_step_equations", "absolute_value"],
  },

  area_perimeter: {
    title: "Area and perimeter",
    what: "Perimeter is the distance around a shape, and area is how much flat space it covers, measured in square units. A rectangle 8 units long and 5 wide has a perimeter of 2(8) + 2(5) = 26 and an area of 8 × 5 = 40. Kids use formulas for rectangles, squares, triangles and trapezoids, and later for circles.",
    steps: [
      "For perimeter, add all the side lengths, which for a rectangle is P = 2 × length + 2 × width.",
      "For the area of a rectangle, multiply length by width: A = 8 × 5 = 40 square units.",
      "For a square with side s, P = 4s and A = s², so a side of 13 gives an area of 169.",
      "For a triangle, A = 1/2 × base × height, so a base of 6 and a height of 8 give an area of 24.",
      "For a trapezoid, add the two parallel sides, multiply by the height and halve: A = 1/2 × (9 + 7) × 8 = 64.",
      "Label the answer: perimeter in units like cm, area in square units like cm².",
    ],
    slips: [
      {
        slip: "Mixing up area and perimeter, adding the sides when the question asks for area.",
        fix: "Perimeter is a fence around the shape, so you add. Area is the carpet inside, so you multiply, and the answer is in square units.",
      },
      {
        slip: "Forgetting the 1/2 in a triangle's area, so a base of 6 and a height of 8 give 48.",
        fix: "A triangle is half of a rectangle with the same base and height, so halve it: 1/2 × 6 × 8 = 24.",
      },
      {
        slip: "Adding only two sides of a rectangle for its perimeter, so a 20 by 3 rectangle gives 23.",
        fix: "A rectangle has four sides: 2(20) + 2(3) = 46.",
      },
      {
        slip: "Using a slanted side as the height of a triangle or trapezoid.",
        fix: "The height is measured straight up from the base, at a right angle to it, and is often drawn as a dotted line inside the shape.",
      },
    ],
    faq: [
      {
        q: "What grade learns area and perimeter?",
        a: "3rd grade starts with rectangles, 4th grade uses the formulas, and 6th grade adds triangles and trapezoids. In 7th grade kids solve harder area problems, including circles.",
      },
      {
        q: "Why is area measured in square units?",
        a: "Area counts how many 1-by-1 squares fit inside the shape. A 3-by-4 rectangle holds 12 of them, so its area is 12 square units.",
      },
      {
        q: "Can two shapes have the same perimeter but different areas?",
        a: "Yes. A 1-by-5 rectangle and a 3-by-3 square both have a perimeter of 12, but their areas are 5 and 9.",
      },
    ],
    related: ["times_tables", "multiply_fractions", "circles", "pythagorean", "powers_roots"],
  },

  circles: {
    title: "Circumference and area of circles",
    what: "The circumference of a circle is the distance around it, C = 2πr or πd, and its area is the space inside, A = πr², where r is the radius and d the diameter. π is about 3.14, and answers are often left in terms of π: a circle with radius 4 has an area of 16π. Kids also work backward, finding the radius from an area or a circumference.",
    steps: [
      "Find the radius, which is half the diameter: a diameter of 12 means a radius of 6.",
      "For circumference, use C = 2πr, so a radius of 3 gives C = 6π.",
      "For area, square the radius first and then multiply by π, so a radius of 5 gives A = 25π.",
      "Leave the answer in terms of π, or multiply by 3.14 when a decimal is asked for: 25π ≈ 78.5.",
      "To work backward, solve for r: if πr² = 49π, then r² = 49 and r = 7.",
    ],
    slips: [
      {
        slip: "Using the diameter in a formula that needs the radius, so a circle 12 across gets an area of 144π.",
        fix: "Halve the diameter first: r = 6, so the area is 36π.",
      },
      {
        slip: "Doubling the radius instead of squaring it, so a radius of 5 gives an area of 10π.",
        fix: "r² means r × r, so 5² = 25 and the area is 25π. Doubling the radius gives the diameter, not r².",
      },
      {
        slip: "Mixing up the two formulas, using πr² for the distance around.",
        fix: "Circumference is a length, so its formula has r (not r²) and plain units. Area covers space, so its formula has r² and square units.",
      },
    ],
    faq: [
      {
        q: "What grade learns circumference and area of circles?",
        a: "7th grade, in most US schools. Kids learn both formulas, how they connect, and how to use them with real objects.",
      },
      {
        q: "What is π, exactly?",
        a: "π is what you get when you divide any circle's circumference by its diameter, about 3.14159. Its digits never end or repeat, so we write π or round it to 3.14.",
      },
      {
        q: "Should my child use 3.14 or leave π in the answer?",
        a: "Follow the question. Leaving π in, as in 16π, is exact, and 3.14 gives a decimal you can picture, about 50.24.",
      },
    ],
    related: ["area_perimeter", "powers_roots", "decimals_multiply", "proportions"],
  },

  // ---------------------------------------------------------------- 8th grade

  exponent_rules: {
    title: "Exponent rules",
    what: "Exponent rules are shortcuts for working with powers of the same base. When you multiply, add the exponents (x⁵ · x² = x⁷); when you divide, subtract them (x⁶ ÷ x³ = x³); and for a power of a power, multiply them ((x⁴)² = x⁸). They make algebra with powers quick and are the basis of scientific notation.",
    steps: [
      "Product rule: to multiply powers of the same base, add the exponents, so x⁵ · x² = x⁷.",
      "Quotient rule: to divide, subtract the exponents, so x⁸/x⁶ = x².",
      "Power rule: for a power raised to a power, multiply the exponents, so (x²)³ = x⁶.",
      "With numbers in front, work the numbers and the letters separately: 6x⁴ · 2x³ = 12x⁷, and (2x⁴)³ = 8x¹².",
      "A negative exponent means one over the power, and the same rules apply: x⁻³ · x⁷ = x⁴.",
    ],
    slips: [
      {
        slip: "Multiplying the exponents when multiplying powers, so x⁵ · x² comes out as x¹⁰.",
        fix: "Write it out: five x's times two x's is seven x's, so x⁷. Add when multiplying powers, and multiply only for a power of a power.",
      },
      {
        slip: "Leaving the number in front out of the power, so (2x⁴)³ comes out as 2x¹².",
        fix: "The power applies to everything inside the parentheses: 2³ = 8, so (2x⁴)³ = 8x¹².",
      },
      {
        slip: "Adding the numbers in front, so 6x⁴ · 2x³ comes out as 8x⁷.",
        fix: "The numbers in front multiply like any numbers: 6 × 2 = 12, so the answer is 12x⁷.",
      },
      {
        slip: "Dividing the exponents in a quotient, so x⁸/x⁴ comes out as x².",
        fix: "Subtract instead: 8 − 4 = 4, so x⁸/x⁴ = x⁴.",
      },
    ],
    faq: [
      {
        q: "What grade learns exponent rules?",
        a: "8th grade, including zero and negative exponents and scientific notation. Algebra 1 and 2 use the same rules on longer expressions.",
      },
      {
        q: "Why is anything to the power 0 equal to 1?",
        a: "Dividing a power by itself shows it: x³ ÷ x³ is 1, and by the quotient rule it is also x⁰. So x⁰ = 1 for any x that isn't 0.",
      },
      {
        q: "How can my child remember which rule is which?",
        a: "Write a small example out in full when unsure: x² · x³ is (x · x)(x · x · x), five x's in all, so the exponents add.",
      },
    ],
    related: ["powers_roots", "simplify_expressions", "polynomials", "radicals", "exponential_equations"],
  },

  multi_step_equations: {
    title: "Multi-step equations",
    what: "Multi-step equations take several moves to solve, because they have parentheses, like terms on one side, or x on both sides, as in 4(x + 2) = 2x + 14. The plan is always the same: simplify each side, gather the x terms on one side and the numbers on the other, then divide. Solving them well is the heart of 8th-grade math and Algebra 1.",
    steps: [
      "Simplify each side by distributing and combining like terms, so 4(x + 2) = 2x + 14 becomes 4x + 8 = 2x + 14.",
      "Get the x terms on one side by subtracting 2x from both sides, which gives 2x + 8 = 14.",
      "Get the numbers on the other side by subtracting 8 from both sides, which gives 2x = 6.",
      "Divide by the number in front of x, so x = 3.",
      "Check in the original equation: 4(3 + 2) = 20 and 2 × 3 + 14 = 20, so both sides match.",
    ],
    slips: [
      {
        slip: "Distributing to the first term only, so 4(x + 2) becomes 4x + 2.",
        fix: "Multiply every term inside the parentheses: 4(x + 2) = 4x + 8.",
      },
      {
        slip: "Adding an x term to the other side instead of subtracting it, so 6x + 1 = 8x + 9 becomes 14x + 1 = 9.",
        fix: "To move 8x, subtract it from both sides: −2x + 1 = 9, so −2x = 8 and x = −4.",
      },
      {
        slip: "Losing the minus in front of parentheses, so −3(x + 5) becomes −3x + 15.",
        fix: "The −3 multiplies both terms: −3(x + 5) = −3x − 15.",
      },
      {
        slip: "Checking the answer in a later line instead of the original equation.",
        fix: "Put the answer back into the very first line. A slip made while simplifying only shows up there.",
      },
    ],
    faq: [
      {
        q: "What grade learns multi-step equations?",
        a: "8th grade, including equations with x on both sides and ones with one, no or infinitely many solutions. They are also a main topic of Algebra 1.",
      },
      {
        q: "What does it mean when the x disappears?",
        a: "If the x terms cancel and both sides match, as in 2x + 5 = 2x + 5, every number works. If they cancel and the numbers differ, as in 2x + 1 = 2x + 4, there is no solution.",
      },
      {
        q: "How can my child keep long equations organized?",
        a: "Write one step per line, keep the equals signs lined up under each other, and say what each step does, like “subtract 2x from both sides”. Neat work makes slips much easier to find.",
      },
      {
        q: "What if my child gets stuck halfway?",
        a: "In Agathon, the tutor checks each line as it is written, so your child sees which step went wrong. Help me can also write just the next step, in the tutor's handwriting beside theirs.",
      },
    ],
    related: ["two_step_equations", "simplify_expressions", "inequalities", "systems", "linear_functions"],
  },

  pythagorean: {
    title: "Pythagorean theorem",
    what: "The Pythagorean theorem says that in a right triangle, the two shorter sides a and b (the legs) and the longest side c (the hypotenuse) fit the rule a² + b² = c². If the legs are 3 and 4, then 3² + 4² = 9 + 16 = 25 = 5², so the hypotenuse is 5. It finds a missing side of any right triangle and the distance between two points on a graph.",
    steps: [
      "Check that the triangle has a right angle, and find the hypotenuse c, the longest side, across from the right angle.",
      "Write a² + b² = c² and put in the sides you know.",
      "To find the hypotenuse, square the legs and add: 6² + 8² = 36 + 64 = 100.",
      "Then take the square root: √100 = 10, so c = 10.",
      "To find a leg, subtract instead: 5² + x² = 13² gives x² = 169 − 25 = 144, so x = 12.",
    ],
    slips: [
      {
        slip: "Adding the legs without squaring them, so legs of 6 and 8 give a hypotenuse of 14.",
        fix: "Square first: 36 + 64 = 100, and then take the root, which is 10.",
      },
      {
        slip: "Forgetting the square root at the end, so c comes out as 100 instead of 10.",
        fix: "100 is c², not c. The hypotenuse must be shorter than the two legs put together (6 + 8 = 14), so 100 can't be right.",
      },
      {
        slip: "Adding when finding a leg, so 5² + x² = 13² gives x = √194.",
        fix: "When c is known, subtract: x² = 169 − 25 = 144, so x = 12. A leg is always shorter than the hypotenuse.",
      },
    ],
    faq: [
      {
        q: "What grade learns the Pythagorean theorem?",
        a: "8th grade, in most US schools, including using it to find the distance between points on a graph. It comes back in high school geometry and trigonometry.",
      },
      {
        q: "What are Pythagorean triples?",
        a: "Sets of three whole numbers that fit a² + b² = c², like 3, 4, 5 and 5, 12, 13. Multiples of them work too: 6, 8, 10 is 3, 4, 5 doubled.",
      },
      {
        q: "Does the theorem work for every triangle?",
        a: "No, only for right triangles. If a² + b² comes out bigger or smaller than c², the triangle has no right angle.",
      },
    ],
    related: ["powers_roots", "area_perimeter", "triangles", "coordinate_geometry", "trig_values"],
  },

  linear_functions: {
    title: "Slope and linear equations",
    what: "A linear equation like y = 2x + 8 makes a straight line on a graph. The number in front of x is the slope, how steep the line is (this one rises 2 for every 1 across), and the number on its own is the y-intercept, where the line crosses the y-axis (here at 8). Kids find slopes from two points, put numbers into equations, and rewrite equations in the form y = mx + b.",
    steps: [
      "To find the slope between two points, divide the change in y by the change in x: from (1, 4) to (3, 6), m = (6 − 4)/(3 − 1) = 2/2 = 1.",
      "To find y for a given x, substitute: in y = 5x − 7 with x = 3, y = 5 × 3 − 7 = 8.",
      "To find x for a given y, set the equation equal to it and solve: 2x + 8 = 14, so 2x = 6 and x = 3.",
      "To turn point-slope form into slope-intercept form, distribute and get y alone: y − 9 = −4(x − 3) becomes y − 9 = −4x + 12, so y = −4x + 21.",
      "Read the slope and intercept from y = mx + b: in y = −4x + 21, the slope is −4 and the line crosses the y-axis at 21.",
    ],
    slips: [
      {
        slip: "Flipping the slope, dividing the change in x by the change in y.",
        fix: "Slope is rise over run, with the change in y on top. From (1, 3) to (2, 7) the rise is 4 and the run is 1, so the slope is 4, not 1/4.",
      },
      {
        slip: "Subtracting the points in different orders on top and bottom, which flips the slope's sign.",
        fix: "Use the same order for both: (y₂ − y₁)/(x₂ − x₁). From (1, 4) to (2, 3), that is (3 − 4)/(2 − 1), which gives −1.",
      },
      {
        slip: "Multiplying the slope into only the x, so y − 9 = −4(x − 3) becomes y − 9 = −4x − 3.",
        fix: "−4 times −3 is +12, so y − 9 = −4x + 12, which gives y = −4x + 21.",
      },
      {
        slip: "Dropping the intercept's sign, so y = 2x − 5 is read as crossing at 5.",
        fix: "The intercept keeps its sign: y = 2x − 5 crosses the y-axis at −5, which is the value of y when x = 0.",
      },
    ],
    faq: [
      {
        q: "What grade learns slope and linear equations?",
        a: "8th grade, in most US schools: slope, y = mx + b and graphing lines. Algebra 1 builds on it with point-slope form, linear functions and systems.",
      },
      {
        q: "What does slope mean in real life?",
        a: "Slope is a rate of change: how much y changes for each 1 that x changes. If a taxi ride costs 2 dollars a mile plus a 3-dollar fee, the cost is y = 2x + 3, and the slope 2 is the cost per mile.",
      },
      {
        q: "What do m and b stand for in y = mx + b?",
        a: "m is the slope and b is the y-intercept, the y value where the line crosses the y-axis. The letters are just tradition, and some books use other ones.",
      },
    ],
    related: ["proportions", "two_step_equations", "systems", "functions", "coordinate_geometry"],
  },

  systems: {
    title: "Systems of equations",
    what: "A system of equations is two equations with the same two unknowns, like x + y = 10 and x − y = 4. The solution is the pair of numbers that makes both true, here x = 7 and y = 3, which is also where the two lines cross on a graph. 8th graders solve systems by graphing, substitution or elimination.",
    steps: [
      "Choose a method: substitution when one equation already says y = or x =, and elimination when the x or y terms line up.",
      "For substitution, put the expression for y into the other equation: with y = 4x − 1 and 2x + y = 11, that gives 2x + 4x − 1 = 11, so 6x = 12 and x = 2.",
      "For elimination, add or subtract the equations to cancel a letter: adding 3x + y = −11 and 4x − y = −17 gives 7x = −28, so x = −4.",
      "Put the value you found back into either equation to find the other letter: y = 4 × 2 − 1 = 7.",
      "Write the answer as a pair, (2, 7), and check it in both original equations.",
    ],
    slips: [
      {
        slip: "Stopping after finding one letter, as if x = 2 were the whole answer.",
        fix: "A system's answer is a pair. Find y as well and write (2, 7).",
      },
      {
        slip: "Losing a sign when subtracting one equation from another, as in 2 − (−8) coming out as −6.",
        fix: "Subtract every term, signs and all: 2 − (−8) = 10. For 4x − 3y = 2 and 2x − 3y = −8, that gives 2x = 10 and x = 5.",
      },
      {
        slip: "Checking the answer in only one of the equations.",
        fix: "The pair must work in both. For (2, 7), 4 × 2 − 1 = 7 and 2 × 2 + 7 = 11, so it is right.",
      },
    ],
    faq: [
      {
        q: "What grade learns systems of equations?",
        a: "8th grade, in most US schools, by graphing, substitution and elimination. Algebra 1 goes further, with word problems and systems of inequalities.",
      },
      {
        q: "Should my child use substitution or elimination?",
        a: "Substitution is quicker when one equation is already solved for a letter, like y = 4x − 1. Elimination is quicker when the same letter has matching or opposite numbers in front, like +y and −y, and both give the same answer.",
      },
      {
        q: "What does it mean if the lines never cross?",
        a: "Parallel lines never meet, so the system has no solution. If both equations describe the same line, every point on it is a solution.",
      },
    ],
    related: ["multi_step_equations", "linear_functions", "simplify_expressions", "functions"],
  },
};
