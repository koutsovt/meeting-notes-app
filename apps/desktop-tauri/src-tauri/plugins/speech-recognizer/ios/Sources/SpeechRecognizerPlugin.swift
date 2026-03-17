import AVFoundation
import Speech
import Tauri
import UIKit
import WebKit

struct StartArgs: Decodable {
    let onResult: Channel
    let language: String?
    let interimResults: Bool?
    let continuous: Bool?
}

class SpeechRecognizerPlugin: Plugin {
    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var audioEngine: AVAudioEngine?
    private var isListening = false
    private var resultChannel: Channel?
    private var currentArgs: StartArgs?
    private var isManualStop = false

    override init() {
        super.init()
        NSLog("[SpeechRec] Plugin initialized, iOS %@", UIDevice.current.systemVersion)
        audioEngine = AVAudioEngine()
        setupInterruptionHandling()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private func setupInterruptionHandling() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInterruption),
            name: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance()
        )
    }

    @objc private func handleInterruption(notification: Notification) {
        guard let userInfo = notification.userInfo,
              let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else {
            return
        }

        if type == .began && isListening {
            NSLog("[SpeechRec] Audio interrupted, stopping")
            stopRecognition()
        }
    }

    // MARK: - Commands

    @objc func start(_ invoke: Invoke) {
        NSLog("[SpeechRec] start() called")

        let args: StartArgs
        do {
            args = try invoke.parseArgs(StartArgs.self)
            NSLog("[SpeechRec] Args parsed, language=%@", args.language ?? "default")
        } catch {
            NSLog("[SpeechRec] Failed to parse args: %@", error.localizedDescription)
            invoke.reject("Failed to parse arguments: \(error.localizedDescription)")
            return
        }

        if isListening {
            invoke.reject("Already listening")
            return
        }

        resultChannel = args.onResult
        currentArgs = args

        let locale = Locale(identifier: args.language ?? "en-US")
        speechRecognizer = SFSpeechRecognizer(locale: locale)

        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            NSLog("[SpeechRec] SFSpeechRecognizer not available")
            invoke.reject("Speech recognition not available")
            return
        }

        do {
            try startRecognition(args: args)
            NSLog("[SpeechRec] Recognition started successfully")
            invoke.resolve()
        } catch {
            NSLog("[SpeechRec] Failed to start: %@", error.localizedDescription)
            invoke.reject("Failed to start: \(error.localizedDescription)")
        }
    }

    @objc func stop(_ invoke: Invoke) {
        NSLog("[SpeechRec] stop() called")
        isManualStop = true
        stopRecognition()
        invoke.resolve()
    }

    @objc override func checkPermissions(_ invoke: Invoke) {
        let micStatus: String
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: micStatus = "granted"
        case .denied: micStatus = "denied"
        default: micStatus = "unknown"
        }

        let speechStatus: String
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: speechStatus = "granted"
        case .denied, .restricted: speechStatus = "denied"
        default: speechStatus = "unknown"
        }

        invoke.resolve([
            "microphone": micStatus,
            "speechRecognition": speechStatus
        ])
    }

    @objc override func requestPermissions(_ invoke: Invoke) {
        let group = DispatchGroup()
        var micResult = "unknown"
        var speechResult = "unknown"

        group.enter()
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            micResult = granted ? "granted" : "denied"
            NSLog("[SpeechRec] Mic permission: %@", micResult)
            group.leave()
        }

        group.enter()
        SFSpeechRecognizer.requestAuthorization { status in
            switch status {
            case .authorized: speechResult = "granted"
            case .denied, .restricted: speechResult = "denied"
            default: speechResult = "unknown"
            }
            NSLog("[SpeechRec] Speech permission: %@", speechResult)
            group.leave()
        }

        group.notify(queue: .main) {
            invoke.resolve([
                "microphone": micResult,
                "speechRecognition": speechResult
            ])
        }
    }

    // MARK: - Recognition

    private func startRecognition(args: StartArgs) throws {
        isManualStop = false

        recognitionTask?.cancel()
        recognitionTask = nil

        NSLog("[SpeechRec] Configuring audio session...")
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.playAndRecord, mode: .measurement,
                                      options: [.defaultToSpeaker, .allowBluetoothA2DP])
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        NSLog("[SpeechRec] Audio session configured")

        if audioEngine == nil {
            audioEngine = AVAudioEngine()
        }

        guard let audioEngine = audioEngine else {
            throw NSError(domain: "SpeechRec", code: -1,
                         userInfo: [NSLocalizedDescriptionKey: "Audio engine not available"])
        }

        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let request = recognitionRequest else {
            throw NSError(domain: "SpeechRec", code: -1,
                         userInfo: [NSLocalizedDescriptionKey: "Could not create request"])
        }

        request.shouldReportPartialResults = args.interimResults ?? true

        if #available(iOS 13, *) {
            request.requiresOnDeviceRecognition = false
        }

        guard let recognizer = speechRecognizer else {
            throw NSError(domain: "SpeechRec", code: -1,
                         userInfo: [NSLocalizedDescriptionKey: "No recognizer"])
        }

        NSLog("[SpeechRec] Starting recognition task...")

        // Use closure-based API — results sent directly through Channel
        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }

            if let result = result {
                let transcript = result.bestTranscription.formattedString
                let confidence: Float = result.bestTranscription.segments.last?.confidence ?? 0.0
                let isFinal = result.isFinal

                NSLog("[SpeechRec] Result: final=%d, conf=%.2f, text=%@",
                      isFinal ? 1 : 0, confidence, String(transcript.prefix(60)))

                // KEY: Send through Channel directly — bypasses broken self.trigger()
                self.resultChannel?.send([
                    "transcript": transcript,
                    "isFinal": isFinal,
                    "confidence": confidence
                ] as [String: Any])

                if isFinal {
                    self.handleFinalResult()
                }
            }

            if let error = error {
                NSLog("[SpeechRec] Recognition error: %@", error.localizedDescription)
                self.handleRecognitionEnd()
            }
        }

        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        NSLog("[SpeechRec] Format: %@", format.description)

        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }
        NSLog("[SpeechRec] Tap installed")

        audioEngine.prepare()
        try audioEngine.start()
        isListening = true
        NSLog("[SpeechRec] Audio engine started, listening")
    }

    private func handleFinalResult() {
        stopRecognitionInternal()

        // Restart in continuous mode
        if let args = currentArgs, args.continuous ?? false, !isManualStop {
            NSLog("[SpeechRec] Restarting continuous mode...")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                guard let self = self, let args = self.currentArgs else { return }
                do {
                    try self.startRecognition(args: args)
                } catch {
                    NSLog("[SpeechRec] Failed to restart: %@", error.localizedDescription)
                }
            }
        }
    }

    private func handleRecognitionEnd() {
        stopRecognitionInternal()

        // Restart in continuous mode on non-fatal errors
        if let args = currentArgs, args.continuous ?? false, !isManualStop {
            NSLog("[SpeechRec] Restarting after error...")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                guard let self = self, let args = self.currentArgs else { return }
                do {
                    try self.startRecognition(args: args)
                } catch {
                    NSLog("[SpeechRec] Failed to restart: %@", error.localizedDescription)
                }
            }
        }
    }

    private func stopRecognition() {
        stopRecognitionInternal()
        resultChannel = nil
        currentArgs = nil
        isManualStop = false
    }

    private func stopRecognitionInternal() {
        NSLog("[SpeechRec] Stopping recognition internal")

        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)

        recognitionRequest?.endAudio()
        recognitionRequest = nil

        recognitionTask?.cancel()
        recognitionTask = nil

        isListening = false

        do {
            try AVAudioSession.sharedInstance().setActive(false,
                options: .notifyOthersOnDeactivation)
        } catch {
            NSLog("[SpeechRec] Failed to deactivate audio session: %@", error.localizedDescription)
        }
    }
}

@_cdecl("init_plugin_speech_recognizer")
func initPlugin() -> Plugin {
    return SpeechRecognizerPlugin()
}
