// DOM Elements
const video = document.getElementById('webcam');
const canvas = document.getElementById('overlay');
const loadingOverlay = document.getElementById('loading');
const wsUrlInput = document.getElementById('ws-url');
const btnConnect = document.getElementById('btn-connect');
const btnClearLock = document.getElementById('btn-clear-lock');
const wsStatusDot = document.getElementById('ws-status-dot');
const wsStatusText = document.getElementById('ws-status-text');
const btnRecord = document.getElementById('btn-record');
const recordText = document.getElementById('record-text');
const currentModeBadge = document.getElementById('current-mode');
const modeDesc = document.getElementById('mode-desc');
const telemetryX = document.getElementById('telemetry-x');
const telemetryFps = document.getElementById('telemetry-fps');

// State Variables
let socket = null;
let isModelsLoaded = false;
let lockedFaceDescriptor = null; // null means Mode B (Nearest), otherwise Mode A (Locked)
let lastSendTime = 0;
const SEND_INTERVAL_MS = 100; // ~10 FPS
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

// Colors
const COLOR_DETECTED = '#3b82f6';
const COLOR_NEAREST = '#eab308';
const COLOR_LOCKED = '#22c55e';

// Initialize
async function init() {
    await setupWebcam();
    await loadModels();
    
    // Resize canvas to match video
    video.addEventListener('play', () => {
        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        faceapi.matchDimensions(canvas, displaySize);
        requestAnimationFrame(() => detectLoop(displaySize));
    });
}

// 1. Webcam Setup
async function setupWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: 640, height: 480 },
            audio: false
        });
        video.srcObject = stream;
        
        // Wait for video to be ready
        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                resolve(video);
            };
        });
    } catch (err) {
        console.error("Error accessing webcam:", err);
        alert("Please allow webcam access for this application to work.");
    }
}

// 2. Load face-api.js models
async function loadModels() {
    const MODEL_URL = './models';
    try {
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        isModelsLoaded = true;
        loadingOverlay.style.opacity = '0';
        setTimeout(() => loadingOverlay.style.display = 'none', 300);
        console.log("Models loaded successfully");
    } catch (err) {
        console.error("Error loading models:", err);
        alert("Failed to load AI models. Ensure they are available in the /models directory.");
    }
}

// 3. Detection & Tracking Loop
async function detectLoop(displaySize) {
    if (!isModelsLoaded) return;

    // Detect all faces with landmarks and descriptors
    const detections = await faceapi.detectAllFaces(video).withFaceLandmarks().withFaceDescriptors();
    const resizedDetections = faceapi.resizeResults(detections, displaySize);
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let targetFace = null;
    let targetColor = COLOR_DETECTED;

    if (resizedDetections.length > 0) {
        if (lockedFaceDescriptor) {
            // MODE A: Locked Mode
            const faceMatcher = new faceapi.FaceMatcher([new faceapi.LabeledFaceDescriptors('locked', [lockedFaceDescriptor])], 0.6);
            
            let bestMatchObj = null;
            let bestMatchBox = null;
            
            resizedDetections.forEach(det => {
                const match = faceMatcher.findBestMatch(det.descriptor);
                if (match.label === 'locked') {
                    bestMatchObj = det;
                    bestMatchBox = det.detection.box;
                } else {
                    // Draw non-matching faces as standard blue
                    drawBox(ctx, det.detection.box, COLOR_DETECTED);
                }
            });

            if (bestMatchBox) {
                targetFace = bestMatchBox;
                targetColor = COLOR_LOCKED;
                drawBox(ctx, bestMatchBox, COLOR_LOCKED, 'Locked Target');
            }
        } else {
            // MODE B: Nearest Mode (Largest Box Area)
            let largestArea = 0;
            let nearestIdx = 0;
            
            resizedDetections.forEach((det, idx) => {
                const box = det.detection.box;
                const area = box.width * box.height;
                if (area > largestArea) {
                    largestArea = area;
                    nearestIdx = idx;
                }
            });

            // Draw boxes
            resizedDetections.forEach((det, idx) => {
                const box = det.detection.box;
                if (idx === nearestIdx) {
                    targetFace = box;
                    targetColor = COLOR_NEAREST;
                    drawBox(ctx, box, COLOR_NEAREST, 'Nearest Target');
                } else {
                    drawBox(ctx, box, COLOR_DETECTED);
                }
            });
        }

        // Calculate offset and send data
        if (targetFace) {
            const centerX = targetFace.x + (targetFace.width / 2);
            const videoCenterX = displaySize.width / 2;
            const offsetX = Math.round(centerX - videoCenterX); // Positive means target is to the right
            
            sendTrackingData(offsetX);
            telemetryX.textContent = `${offsetX} px`;
        }
    }

    // Assign current detections to canvas for click handling
    canvas.currentDetections = resizedDetections;

    requestAnimationFrame(() => detectLoop(displaySize));
}

// Draw Helper
function drawBox(ctx, box, color, label = '') {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    
    if (label) {
        ctx.fillStyle = color;
        ctx.font = '16px Outfit';
        const textWidth = ctx.measureText(label).width;
        ctx.fillRect(box.x, box.y - 25, textWidth + 10, 25);
        ctx.fillStyle = '#000';
        ctx.fillText(label, box.x + 5, box.y - 7);
    }
}

// 4. Interaction (Click to Lock)
canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    // Calculate click scale relative to actual canvas resolution
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    const detections = canvas.currentDetections || [];
    
    for (const det of detections) {
        const box = det.detection.box;
        if (clickX >= box.x && clickX <= box.x + box.width &&
            clickY >= box.y && clickY <= box.y + box.height) {
            // Clicked inside this bounding box!
            setLockedMode(det.descriptor);
            break;
        }
    }
});

function setLockedMode(descriptor) {
    lockedFaceDescriptor = descriptor;
    
    // Update UI
    currentModeBadge.textContent = 'Locked (Mode A)';
    currentModeBadge.className = 'mode-badge mode-a';
    modeDesc.textContent = 'Tracking a specific person. Ignore others.';
    btnClearLock.disabled = false;
}

btnClearLock.addEventListener('click', () => {
    lockedFaceDescriptor = null;
    
    // Update UI
    currentModeBadge.textContent = 'Nearest (Mode B)';
    currentModeBadge.className = 'mode-badge mode-b';
    modeDesc.textContent = 'Tracking the closest person. Click any bounding box to lock onto a target.';
    btnClearLock.disabled = true;
});

// 5. WebSocket Integration
btnConnect.addEventListener('click', () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
        return;
    }

    const url = wsUrlInput.value.trim();
    if (!url) return;

    btnConnect.textContent = 'Connecting...';
    btnConnect.disabled = true;

    try {
        socket = new WebSocket(url);
        
        socket.onopen = () => {
            wsStatusDot.className = 'dot connected';
            wsStatusText.textContent = 'Connected';
            btnConnect.textContent = 'Disconnect';
            btnConnect.disabled = false;
        };

        socket.onclose = () => {
            wsStatusDot.className = 'dot disconnected';
            wsStatusText.textContent = 'Disconnected';
            btnConnect.textContent = 'Connect';
            btnConnect.disabled = false;
            socket = null;
        };

        socket.onerror = (error) => {
            console.error('WebSocket Error:', error);
            wsStatusDot.className = 'dot disconnected';
            wsStatusText.textContent = 'Error';
            btnConnect.textContent = 'Connect';
            btnConnect.disabled = false;
        };
    } catch (e) {
        console.error('WebSocket Exception:', e);
        btnConnect.textContent = 'Connect';
        btnConnect.disabled = false;
        alert("Invalid WebSocket URL");
    }
});

let sendsInLastSecond = 0;
let lastFpsUpdate = Date.now();

function sendTrackingData(offsetX) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    if (now - lastSendTime >= SEND_INTERVAL_MS) {
        const payload = JSON.stringify({ target_x: offsetX });
        socket.send(payload);
        lastSendTime = now;
        sendsInLastSecond++;
    }

    // Update telemetry FPS every second
    if (now - lastFpsUpdate >= 1000) {
        telemetryFps.textContent = `${sendsInLastSecond} Hz`;
        sendsInLastSecond = 0;
        lastFpsUpdate = now;
    }
}

// 6. Camera Recording
btnRecord.addEventListener('click', () => {
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
});

function startRecording() {
    const stream = video.srcObject;
    if (!stream) {
        alert("Camera stream not available.");
        return;
    }
    
    recordedChunks = [];
    try {
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    } catch (e) {
        mediaRecorder = new MediaRecorder(stream); // Fallback
    }
    
    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };
    
    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `facevision_recording_${new Date().getTime()}.webm`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
    };
    
    mediaRecorder.start();
    isRecording = true;
    
    btnRecord.classList.add('recording');
    recordText.textContent = 'Stop Recording';
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    isRecording = false;
    
    btnRecord.classList.remove('recording');
    recordText.textContent = 'Start Recording';
}

// Start
init();
