import Foundation

/// The points of a Pencil stroke still waiting for their late values. A Pencil sends a sample's
/// force (and tilt) a moment after its position, over Bluetooth: UIKit marks such a sample
/// (`estimatedPropertiesExpectingUpdates`, keyed by `estimationUpdateIndex`) and calls
/// `touchesEstimatedPropertiesUpdated` when the real values land, sometimes after the pen has lifted.
/// The canvas keeps which point each pending sample became, fixes it when the update comes, and
/// waits (briefly) for the last ones before it commits the stroke.
public struct EstimationTracker: Sendable, Equatable {
    private var pending: [Int: Int] = [:]

    public init() {}

    public var isEmpty: Bool { pending.isEmpty }
    public var count: Int { pending.count }

    /// Sample `updateIndex` became point `point` of the stroke.
    public mutating func expect(updateIndex: Int, point: Int) {
        pending[updateIndex] = point
    }

    /// The point an update is for (nil: another stroke's, or already settled).
    public func point(for updateIndex: Int) -> Int? { pending[updateIndex] }

    /// The sample's values are final.
    public mutating func settle(_ updateIndex: Int) {
        pending[updateIndex] = nil
    }

    public mutating func removeAll() { pending.removeAll() }
}
