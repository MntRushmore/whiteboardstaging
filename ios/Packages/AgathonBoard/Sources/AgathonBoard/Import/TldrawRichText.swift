import Foundation

/// tldraw's rich text (a TipTap document: `{type:"doc", content:[{type:"paragraph", content:[{type:
/// "text", text}]}]}`) as plain text, and plain text as LaTeX text mode for a typed note.
enum TldrawRichText {
    /// The text of a rich text value, paragraphs (and list items, headings, hard breaks) on their
    /// own lines. A plain string (tldraw before rich text kept `props.text`) is itself.
    static func plainText(_ value: JSONValue?) -> String {
        guard let value else { return "" }
        if let s = value.stringValue { return s }
        var lines: [String] = []
        var current = ""
        var open = false
        func flush() {
            if open { lines.append(current) }
            current = ""
            open = false
        }
        func walk(_ node: JSONValue) {
            guard let o = node.objectValue else { return }
            let type = o["type"]?.stringValue ?? ""
            switch type {
            case "text":
                current += o["text"]?.stringValue ?? ""
                open = true
            case "hardBreak":
                current += "\n"
                open = true
            case "doc", "bulletList", "orderedList", "listItem", "blockquote":
                for c in o["content"]?.arrayValue ?? [] { walk(c) }
            default:
                // a block (paragraph, heading, code block…): its own line
                flush()
                open = true
                for c in o["content"]?.arrayValue ?? [] { walk(c) }
                flush()
            }
        }
        walk(value)
        flush()
        // a document's trailing empty paragraphs are not text
        while let last = lines.last, last.isEmpty { lines.removeLast() }
        return lines.joined(separator: "\n")
    }

    /// Plain text as LaTeX: each line in `\text{…}`, lines joined by `\\`.
    static func latexText(_ text: String) -> String {
        guard !text.isEmpty else { return "" }
        return text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { "\\text{\(escape(String($0)))}" }
            .joined(separator: " \\\\ ")
    }

    static func escape(_ s: String) -> String {
        var out = ""
        for ch in s {
            switch ch {
            case "\\": out += "\\textbackslash{}"
            case "{", "}", "$", "%", "&", "#", "_": out += "\\\(ch)"
            case "^": out += "\\^{}"
            case "~": out += "\\~{}"
            default: out.append(ch)
            }
        }
        return out
    }
}
