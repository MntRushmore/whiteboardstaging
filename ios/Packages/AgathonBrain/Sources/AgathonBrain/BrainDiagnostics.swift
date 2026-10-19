import Darwin
import Foundation

/// Numbers for the brain lab screen and the benchmarks.
public enum BrainDiagnostics {
    /// The process's physical footprint (what Xcode's memory gauge and jetsam count), in bytes.
    public static func physicalFootprint() -> UInt64 {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        return result == KERN_SUCCESS ? info.phys_footprint : 0
    }

    /// Median and 95th percentile of some timings (ms).
    public static func summary(_ samples: [Double]) -> (median: Double, p95: Double, max: Double) {
        guard !samples.isEmpty else { return (0, 0, 0) }
        let sorted = samples.sorted()
        func at(_ q: Double) -> Double { sorted[min(sorted.count - 1, Int((Double(sorted.count - 1) * q).rounded()))] }
        return (at(0.5), at(0.95), sorted[sorted.count - 1])
    }

    /// Wall time of `body` in ms.
    public static func time<T>(_ body: () throws -> T) rethrows -> (T, Double) {
        let start = DispatchTime.now().uptimeNanoseconds
        let value = try body()
        return (value, Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
    }
}
