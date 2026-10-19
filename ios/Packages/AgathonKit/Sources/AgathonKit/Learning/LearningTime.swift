import Foundation

/// Times as the web writes and reads them: `new Date(ms).toISOString()` and `Date.parse`, to the
/// millisecond, in UTC, never through a floating-point date formatter (which can round a
/// millisecond away).
public enum LearningTime {
    /// `new Date(ms).toISOString()`: a non-finite time is the epoch, as the web's `iso` writes it.
    public static func iso(_ ms: Double) -> String {
        let t = Int64((ms.isFinite ? ms : 0).rounded(.towardZero))
        let day = 86_400_000 as Int64
        var days = t / day
        var rest = t % day
        if rest < 0 {
            rest += day
            days -= 1
        }
        let (y, m, d) = civil(days)
        let h = rest / 3_600_000, mi = (rest / 60_000) % 60, s = (rest / 1000) % 60, f = rest % 1000
        let year = (0...9999).contains(y) ? pad(y, 4) : (y < 0 ? "-" : "+") + pad(abs(y), 6)
        return "\(year)-\(pad(m, 2))-\(pad(d, 2))T\(pad(h, 2)):\(pad(mi, 2)):\(pad(s, 2)).\(pad(f, 3))Z"
    }

    /// `Date.parse` of an ISO time with a zone (`Z` or `±HH:MM`); nil for anything else.
    public static func parse(_ text: String) -> Double? {
        let chars = Array(text.utf8)
        var i = 0
        func digits(_ n: Int) -> Int64? {
            guard i + n <= chars.count else { return nil }
            var v: Int64 = 0
            for k in 0..<n {
                let c = chars[i + k]
                guard c >= 48 && c <= 57 else { return nil }
                v = v * 10 + Int64(c - 48)
            }
            i += n
            return v
        }
        func expect(_ c: UInt8) -> Bool {
            guard i < chars.count, chars[i] == c else { return false }
            i += 1
            return true
        }
        guard let y = digits(4), expect(45), let mo = digits(2), expect(45), let d = digits(2) else { return nil }
        guard i < chars.count, chars[i] == 84 || chars[i] == 32 else { return nil }
        i += 1
        guard let h = digits(2), expect(58), let mi = digits(2) else { return nil }
        var s: Int64 = 0
        var ms: Int64 = 0
        if expect(58) {
            guard let sec = digits(2) else { return nil }
            s = sec
            if expect(46) {
                var scale: Int64 = 100
                var any = false
                while i < chars.count, chars[i] >= 48 && chars[i] <= 57 {
                    ms += Int64(chars[i] - 48) * scale
                    scale /= 10
                    any = true
                    i += 1
                }
                guard any else { return nil }
            }
        }
        var offset: Int64 = 0
        if expect(90) {
            offset = 0
        } else if i < chars.count, chars[i] == 43 || chars[i] == 45 {
            let sign: Int64 = chars[i] == 45 ? -1 : 1
            i += 1
            guard let oh = digits(2) else { return nil }
            _ = expect(58)
            guard let om = digits(2) else { return nil }
            offset = sign * (oh * 60 + om)
        } else {
            return nil
        }
        guard i == chars.count, (1...12).contains(mo), (1...31).contains(d), h <= 24, mi <= 59, s <= 59 else { return nil }
        let days = daysFrom(y, mo, d)
        let total = ((days * 24 + h) * 60 + mi - offset) * 60_000 + s * 1000 + ms
        return Double(total)
    }

    /// Now, as `Date.now()`: whole milliseconds.
    public static func now() -> Double { (Date().timeIntervalSince1970 * 1000).rounded(.down) }

    private static func pad(_ v: Int64, _ n: Int) -> String {
        let s = String(v)
        return s.count >= n ? s : String(repeating: "0", count: n - s.count) + s
    }

    /// days since 1970-01-01 → (year, month, day) (Howard Hinnant's `civil_from_days`).
    private static func civil(_ z0: Int64) -> (Int64, Int64, Int64) {
        let z = z0 + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
        let y = yoe + era * 400
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        return (m <= 2 ? y + 1 : y, m, d)
    }

    /// (year, month, day) → days since 1970-01-01 (`days_from_civil`).
    private static func daysFrom(_ y0: Int64, _ m: Int64, _ d: Int64) -> Int64 {
        let y = m <= 2 ? y0 - 1 : y0
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }
}
