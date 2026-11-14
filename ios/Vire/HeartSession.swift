import Foundation
import HealthKit

/// AirPods Pro 3 only measure heart rate for apps while a workout session runs (iOS 26+).
/// This starts a quiet session, forwards every heart-rate update, and discards the workout at the end.
final class HeartSession: NSObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
    enum State: String { case off, starting, on, denied }

    var onRate: ((Double, Date) -> Void)?
    /// Every heart-rate sample Health gets while the session runs, with what measured it:
    /// bpm, the sample's end, the device or source name, its model, how many readings it holds.
    var onSample: ((Double, Date, String, String, Int) -> Void)?
    var onState: ((State) -> Void)?
    private(set) var gotSample = false
    private(set) var state: State = .off {
        didSet { if oldValue != state { onState?(state) } }
    }

    private let store = HKHealthStore()
    private let heartRate = HKQuantityType(.heartRate)
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var fallbackTimer: Timer?
    private var sampleQuery: HKAnchoredObjectQuery?
    private var triedWalking = false

    func start() {
        guard HKHealthStore.isHealthDataAvailable() else {
            state = .denied
            return
        }
        guard session == nil else { return }
        state = .starting
        store.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [heartRate]) { [weak self] ok, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                if ok { self.begin(activity: .mindAndBody) } else { self.state = .denied }
            }
        }
    }

    func stop() {
        teardown()
        triedWalking = false
        state = .off
    }

    private func begin(activity: HKWorkoutActivityType) {
        let cfg = HKWorkoutConfiguration()
        cfg.activityType = activity
        cfg.locationType = .indoor
        do {
            let s = try HKWorkoutSession(healthStore: store, configuration: cfg)
            let b = s.associatedWorkoutBuilder()
            s.delegate = self
            b.delegate = self
            b.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: cfg)
            session = s
            builder = b
            let now = Date()
            watchSamples(from: now)
            s.startActivity(with: now)
            b.beginCollection(withStart: now) { [weak self] ok, _ in
                DispatchQueue.main.async {
                    guard let self, !ok else { return }
                    self.teardown()
                    self.state = .denied
                }
            }
            // If the sensor stays silent for this activity type, try once more as a walk.
            fallbackTimer?.invalidate()
            fallbackTimer = Timer.scheduledTimer(withTimeInterval: 25, repeats: false) { [weak self] _ in
                guard let self, !self.gotSample, !self.triedWalking, self.session != nil else { return }
                self.triedWalking = true
                self.teardown()
                self.begin(activity: .walking)
            }
        } catch {
            state = .denied
        }
    }

    /// The workout builder only gives a number. This asks Health for the samples themselves as they
    /// arrive, so the page can say what measured each one (the AirPods, a watch, or something else).
    private func watchSamples(from start: Date) {
        if let q = sampleQuery { store.stop(q) }
        let unit = HKUnit.count().unitDivided(by: .minute())
        let handle: (HKAnchoredObjectQuery, [HKSample]?, [HKDeletedObject]?, HKQueryAnchor?, Error?) -> Void = { [weak self] _, found, _, _, _ in
            guard let self, let samples = found as? [HKQuantitySample] else { return }
            for s in samples {
                let bpm = s.quantity.doubleValue(for: unit)
                let name = s.device?.name ?? s.sourceRevision.source.name
                let model = s.device?.model ?? s.sourceRevision.productType ?? ""
                let end = s.endDate
                let n = s.count
                DispatchQueue.main.async { self.onSample?(bpm, end, name, model, n) }
            }
        }
        let q = HKAnchoredObjectQuery(
            type: heartRate, predicate: HKQuery.predicateForSamples(withStart: start, end: nil, options: .strictStartDate),
            anchor: nil, limit: HKObjectQueryNoLimit, resultsHandler: handle)
        q.updateHandler = handle
        sampleQuery = q
        store.execute(q)
    }

    private func teardown() {
        fallbackTimer?.invalidate()
        fallbackTimer = nil
        if let q = sampleQuery { store.stop(q) }
        sampleQuery = nil
        let s = session
        let b = builder
        session = nil
        builder = nil
        s?.end()
        b?.endCollection(withEnd: Date()) { _, _ in b?.discardWorkout() }
    }

    // MARK: HKLiveWorkoutBuilderDelegate

    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        guard collectedTypes.contains(heartRate),
            let stats = workoutBuilder.statistics(for: heartRate),
            let quantity = stats.mostRecentQuantity()
        else { return }
        let bpm = quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        let date = stats.mostRecentQuantityDateInterval()?.end ?? Date()
        DispatchQueue.main.async {
            self.gotSample = true
            self.state = .on
            self.onRate?(bpm, date)
        }
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    // MARK: HKWorkoutSessionDelegate

    func workoutSession(
        _ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState, date: Date
    ) {}

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        DispatchQueue.main.async {
            self.teardown()
            self.state = .off
        }
    }
}
