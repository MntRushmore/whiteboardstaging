@testable import AgathonAsk
import Testing

/// The tutor's reply, Markdown-lite (src/lib/live/ask/__tests__/richText.test.ts, case for case):
/// what the panel shows for each mark, and for half a stream.
struct RichTextTests {
    func t(_ v: String) -> RichInline { .text(v) }
    func m(_ v: String, _ display: Bool = false) -> RichInline { .math(v, display: display) }

    @Test func paragraphsAndLineBreaks() {
        #expect(RichText.parse("Hi there!\n\nLet's look.\nLine two.") == [.paragraph([t("Hi there!")]), .paragraph([t("Let's look."), .br, t("Line two.")])])
    }

    @Test func lists() {
        #expect(RichText.parse("- one\n- two\n* three") == [.bullets([[t("one")], [t("two")], [t("three")]])])
        #expect(RichText.parse("1. Add\n2. Then check") == [.numbered(start: 1, items: [[t("Add")], [t("Then check")]])])
        #expect(RichText.parse("3) third\n4) fourth") == [.numbered(start: 3, items: [[t("third")], [t("fourth")]])])
        #expect(RichText.parse("Here's how:\n1. Multiply\n2. Add\nDone!") == [
            .paragraph([t("Here's how:")]), .numbered(start: 1, items: [[t("Multiply")], [t("Add")]]), .paragraph([t("Done!")]),
        ])
        #expect(RichText.parse("- first part\n  and more\n- second") == [.bullets([[t("first part and more")], [t("second")]])])
    }

    @Test func displayMaths() {
        #expect(RichText.parse("$$x^2 + 1$$") == [.math("x^2 + 1")])
        #expect(RichText.parse("So:\n\n$$\n\\frac{1}{2} + \\frac{1}{4} = \\frac{3}{4}\n$$\n\nNice!") == [
            .paragraph([t("So:")]), .math("\\frac{1}{2} + \\frac{1}{4} = \\frac{3}{4}"), .paragraph([t("Nice!")]),
        ])
        #expect(RichText.parse("\\[ a^2 + b^2 = c^2 \\]") == [.math("a^2 + b^2 = c^2")])
        #expect(RichText.parse("We get\n$$x = 4$$\nso x is 4.") == [.paragraph([t("We get"), m("x = 4", true), t("so x is 4.")])])
        #expect(RichText.parse("$$\n- 3 + 5 = 2\n$$") == [.math("- 3 + 5 = 2")])
    }

    @Test func headingsRulesAndNothing() {
        #expect(RichText.parse("### Step 1\nAdd them.\n\n---\n\nDone") == [.paragraph([.bold([t("Step 1")])]), .paragraph([t("Add them.")]), .paragraph([t("Done")])])
        #expect(RichText.parse("").isEmpty)
        #expect(RichText.parse("\n\n  \n").isEmpty)
    }

    @Test func marks() {
        #expect(RichText.parseInline("This is **very** big") == [t("This is "), .bold([t("very")]), t(" big")])
        #expect(RichText.parseInline("**$x = 3$ works**") == [.bold([m("x = 3"), t(" works")])])
        #expect(RichText.parseInline("So $x + 2 = 5$, and $x = 3$.") == [t("So "), m("x + 2 = 5"), t(", and "), m("x = 3"), t(".")])
        #expect(RichText.parseInline("Try \\(3 \\times 4\\) now") == [t("Try "), m("3 \\times 4"), t(" now")])
    }

    @Test func pricesStayPrices() {
        #expect(RichText.parseInline("I have $5 and $3 more.") == [t("I have $5 and $3 more.")])
        #expect(RichText.parseInline("It costs $5. Then $x$ is the change.") == [t("It costs $5. Then "), m("x"), t(" is the change.")])
        #expect(RichText.parseInline("Between $ 4 and $ 5") == [t("Between $ 4 and $ 5")])
        #expect(RichText.parseInline("\\$10 off") == [t("$10 off")])
        #expect(RichText.parseInline("2 * 3 * 4 = 24") == [t("2 * 3 * 4 = 24")])
        #expect(RichText.parseInline("\\*\\*not bold\\*\\*") == [t("**not bold**")])
        #expect(RichText.parseInline("<img src=x onerror=\"alert(1)\"> <b>hi</b>") == [t("<img src=x onerror=\"alert(1)\"> <b>hi</b>")])
    }

    @Test func halfAStream() {
        #expect(RichText.parseInline("So $x + ") == [t("So $x + ")])
        #expect(RichText.parseInline("So $x + 1$") == [t("So "), m("x + 1")])
        #expect(RichText.parse("We get\n$$\\frac{3}{") == [.paragraph([t("We get"), .br, t("$$\\frac{3}{")])])
        #expect(RichText.parse("We get\n$$\\frac{3}{4}$$") == [.paragraph([t("We get"), m("\\frac{3}{4}", true)])])
        #expect(RichText.parseInline("This is **ver", streaming: true) == [t("This is "), .bold([t("ver")])])
        #expect(RichText.parseInline("This is **", streaming: true) == [t("This is ")])
        #expect(RichText.parseInline("This is **ver") == [t("This is **ver")])
    }

    @Test func everyPrefixKeepsItsWords() {
        let reply = "Great question! **Fractions** are parts of a whole.\n\n1. Find a common denominator: $\\frac{1}{2} = \\frac{2}{4}$\n2. Add the tops:\n\n$$\\frac{2}{4} + \\frac{1}{4} = \\frac{3}{4}$$\n\n- It costs $5\n- Try **one** more!"
        let chars = Array(reply)
        for i in 0...chars.count {
            let prefix = String(chars[0..<i])
            let shown = RichText.plainText(RichText.parse(prefix, streaming: true))
            let words = prefix.replacingOccurrences(of: #"[$*\\\n#\-\d.:{}^+=]"#, with: " ", options: .regularExpression)
                .split(whereSeparator: \.isWhitespace).map(String.init)
                .filter { $0.range(of: "^[A-Za-z']{4,}$", options: .regularExpression) != nil }
            for w in words.dropLast() { #expect(shown.contains(w), "\(w) at \(i)") }
        }
    }

    @Test func plainTextAndHasMath() {
        #expect(RichText.plainText(RichText.parse("**Hi!** Look:\n\n1. $x = 2$\n2. done\n\n$$y$$")) == "Hi! Look:\n\n1. x = 2\n2. done\n\ny")
        #expect(!RichText.hasMath(RichText.parse("no maths here, $5 only")))
        #expect(RichText.hasMath(RichText.parse("- **a $x$ b**")))
        #expect(RichText.hasMath(RichText.parse("$$y$$")))
        #expect(RichText.mathAsText("\\frac{3}{4} + x^2 \\le 9") == "3/4 + x² ≤ 9")
    }
}
