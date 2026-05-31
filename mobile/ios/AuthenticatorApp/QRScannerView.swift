import SwiftUI
import AVFoundation

struct QRScannerView: UIViewControllerRepresentable {
    var onScanResult: (String) -> Void
    var onCancel: () -> Void

    func makeUIViewController(context: Context) -> ScannerViewController {
        let controller = ScannerViewController()
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: ScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    class Coordinator: NSObject, ScannerViewControllerDelegate {
        let parent: QRScannerView

        init(parent: QRScannerView) {
            self.parent = parent
        }

        func scannerDidFindCode(code: String) {
            parent.onScanResult(code)
        }

        func scannerDidCancel() {
            parent.onCancel()
        }
    }
}

protocol ScannerViewControllerDelegate: AnyObject {
    func scannerDidFindCode(code: String)
    func scannerDidCancel()
}

class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    weak var delegate: ScannerViewControllerDelegate?
    var captureSession: AVCaptureSession?
    var previewLayer: AVCaptureVideoPreviewLayer?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        
        #if targetEnvironment(simulator)
        // Simulator cannot run camera. Render a mock simulator view.
        setupMockSimulatorView()
        #else
        setupCamera()
        #endif
    }

    private func setupCamera() {
        let session = AVCaptureSession()
        self.captureSession = session

        guard let videoCaptureDevice = AVCaptureDevice.default(for: .video) else {
            failed()
            return
        }
        
        let videoInput: AVCaptureDeviceInput
        do {
            videoInput = try AVCaptureDeviceInput(device: videoCaptureDevice)
        } catch {
            failed()
            return
        }

        if (session.canAddInput(videoInput)) {
            session.addInput(videoInput)
        } else {
            failed()
            return
        }

        let metadataOutput = AVCaptureMetadataOutput()
        if (session.canAddOutput(metadataOutput)) {
            session.addOutput(metadataOutput)
            metadataOutput.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
            metadataOutput.metadataObjectTypes = [.qr]
        } else {
            failed()
            return
        }

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.frame = view.layer.bounds
        preview.videoGravity = .resizeAspectFill
        view.layer.addSublayer(preview)
        self.previewLayer = preview

        DispatchQueue.global(qos: .userInitiated).async {
            session.startRunning()
        }
    }

    private func setupMockSimulatorView() {
        let label = UILabel()
        label.text = "Camera is disabled on iOS Simulator."
        label.textColor = .lightGray
        label.font = UIFont.systemFont(ofSize: 14, weight: .semibold)
        label.textAlignment = .center
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)

        let dismissBtn = UIButton(type: .system)
        dismissBtn.setTitle("Tap to Cancel Scanner", for: .normal)
        dismissBtn.setTitleColor(.red, for: .normal)
        dismissBtn.translatesAutoresizingMaskIntoConstraints = false
        dismissBtn.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        view.addSubview(dismissBtn)

        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -20),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 40),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -40),
            
            dismissBtn.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 32),
            dismissBtn.centerXAnchor.constraint(equalTo: view.centerXAnchor)
        ])
    }

    @objc private func cancelTapped() {
        delegate?.scannerDidCancel()
    }

    private func failed() {
        print("[Scanner] Camera capture session initialization failed.")
        delegate?.scannerDidCancel()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if let session = captureSession, session.isRunning {
            session.stopRunning()
        }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        if let metadataObject = metadataObjects.first {
            guard let readableObject = metadataObject as? AVMetadataMachineReadableCodeObject,
                  let stringValue = readableObject.stringValue else { return }
            AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
            delegate?.scannerDidFindCode(code: stringValue)
        }
    }

    override var prefersStatusBarHidden: Bool {
        true
    }
}
