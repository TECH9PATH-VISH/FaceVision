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

// Advanced UI Elements
const throttleSlider = document.getElementById('throttle-slider');
const throttleVal = document.getElementById('throttle-val');
const deadzoneSlider = document.getElementById('deadzone-slider');
const deadzoneVal = document.getElementById('deadzone-val');
const wsLogs = document.getElementById('ws-logs');

// State Variables
let socket = null;
let objectModel = null;
let lockedBox = null; 
let lastSendTime = 0;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

// Advanced Features State
let sendIntervalMs = parseInt(throttleSlider.value);
let deadzonePct = parseInt(deadzoneSlider.value);
let xHistory = [];
let lastDetectionTime = Date.now();
let hasSentLostTarget = false;

// Colors
const COLOR_DETECTED = '#3b82f6';
const COLOR_NEAREST = '#eab308';
const COLOR_LOCKED = '#22c55e';

// Advanced Setting Listeners
throttleSlider.addEventListener('input', (e) => {
    sendIntervalMs = parseInt(e.target.value);
    throttleVal.textContent = sendIntervalMs;
});
deadzoneSlider.addEventListener('input', (e) => {
    deadzonePct = parseInt(e.target.value);
    deadzoneVal.textContent = deadzonePct;
});

// Initialize
async function init() {
    await setupWebcam();
    await loadModels();
    
    // Resize canvas to match video
    video.addEventListener('play', () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        requestAnimationFrame(() => detectLoop());
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
        
        return new Promise((resolve) => {
            video.onloadedmetadata = () => resolve(video);
        });
    } catch (err) {
        console.error("Error accessing webcam:", err);
        alert("Please allow webcam access for this application to work.");
    }
}

// 2. Load COCO-SSD model
async function loadModels() {
    try {
        objectModel = await cocoSsd.load();
        loadingOverlay.style.opacity = '0';
        setTimeout(() => loadingOverlay.style.display = 'none', 300);
        console.log("COCO-SSD loaded successfully");
    } catch (err) {
        console.error("Error loading model:", err);
        alert("Failed to load AI model.");
    }
}

// Helper: Calculate Intersection over Union (IoU)
function getIoU(box1, box2) {
    const xA = Math.max(box1[0], box2[0]);
    const yA = Math.max(box1[1], box2[1]);
    const xB = Math.min(box1[0] + box1[2], box2[0] + box2[2]);
    const yB = Math.min(box1[1] + box1[3], box2[1] + box2[3]);
    
    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    if (interArea === 0) return 0;
    
    const box1Area = box1[2] * box1[3];
    const box2Area = box2[2] * box2[3];
    return interArea / (box1Area + box2Area - interArea);
}

// HUD Drawing Helpers
function drawCrosshair(ctx) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy);
    ctx.lineTo(cx + 20, cy);
    ctx.moveTo(cx, cy - 20);
    ctx.lineTo(cx, cy + 20);
    ctx.stroke();
}

function drawTargetLine(ctx, targetCenterX, targetCenterY, color) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(targetCenterX, targetCenterY);
    ctx.stroke();
    ctx.setLineDash([]);
}

// 3. Detection & Tracking Loop
async function detectLoop() {
    if (!objectModel) return;

    const predictions = await objectModel.detect(video);
    // Filter to only track people
    const people = predictions.filter(p => p.class === 'person');
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const now = Date.now();
    drawCrosshair(ctx);

    let targetBox = null;
    let targetColor = COLOR_DETECTED;

    if (people.length > 0) {
        lastDetectionTime = now;
        hasSentLostTarget = false;

        if (lockedBox) {
            // MODE A: Locked Mode (Spatial Tracking via IoU)
            let bestMatchBox = null;
            let highestIoU = 0;
            
            people.forEach(person => {
                const iou = getIoU(lockedBox, person.bbox);
                if (iou > highestIoU) {
                    highestIoU = iou;
                    bestMatchBox = person.bbox;
                }
            });

            // Draw boxes
            people.forEach(person => {
                if (person.bbox === bestMatchBox && highestIoU > 0.1) {
                    targetBox = bestMatchBox;
                    lockedBox = bestMatchBox; // Update lock to new position
                    targetColor = COLOR_LOCKED;
                    drawBox(ctx, person.bbox, COLOR_LOCKED, 'Locked Target');
                } else {
                    drawBox(ctx, person.bbox, COLOR_DETECTED);
                }
            });
        } else {
            // MODE B: Nearest Mode (Largest Box Area)
            let largestArea = 0;
            let nearestIdx = 0;
            
            people.forEach((person, idx) => {
                const box = person.bbox;
                const area = box[2] * box[3]; // width * height
                if (area > largestArea) {
                    largestArea = area;
                    nearestIdx = idx;
                }
            });

            // Draw boxes
            people.forEach((person, idx) => {
                const box = person.bbox;
                if (idx === nearestIdx) {
                    targetBox = box;
                    targetColor = COLOR_NEAREST;
                    drawBox(ctx, box, COLOR_NEAREST, 'Nearest Target');
                } else {
                    drawBox(ctx, box, COLOR_DETECTED);
                }
            });
        }

        // Calculate offset, smooth, and send data
        if (targetBox) {
            const centerX = targetBox[0] + (targetBox[2] / 2);
            const centerY = targetBox[1] + (targetBox[3] / 2);
            const videoCenterX = canvas.width / 2;
            
            drawTargetLine(ctx, centerX, centerY, targetColor);

            // Smoothing (Moving Average)
            xHistory.push(centerX);
            if (xHistory.length > 3) xHistory.shift();
            const smoothedCenterX = xHistory.reduce((a, b) => a + b, 0) / xHistory.length;
            
            let offsetX = Math.round(smoothedCenterX - videoCenterX);
            
            // Deadzone Logic
            const deadzonePx = (canvas.width * (deadzonePct / 100)) / 2;
            if (Math.abs(offsetX) <= deadzonePx) {
                offsetX = 0;
            }
            
            sendTrackingData({ target_x: offsetX });
            telemetryX.textContent = `${offsetX} px`;
        }
    } else {
        // No people detected
        xHistory = [];
        
        // Lost Target Protocol (3 seconds)
        if (!hasSentLostTarget && (now - lastDetectionTime > 3000)) {
            sendTrackingData({ status: "search", x_offset: 0 });
            hasSentLostTarget = true;
        }
    }

    // Save detections for click events
    canvas.currentDetections = people;

    requestAnimationFrame(() => detectLoop());
}

// Draw Helper
function drawBox(ctx, bbox, color, label = '') {
    const [x, y, width, height] = bbox;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, width, height);
    
    if (label) {
        ctx.fillStyle = color;
        ctx.font = '16px Outfit';
        const textWidth = ctx.measureText(label).width;
        ctx.fillRect(x, y - 25, textWidth + 10, 25);
        ctx.fillStyle = '#000';
        ctx.fillText(label, x + 5, y - 7);
    }
}

// 4. Interaction (Click to Lock)
canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    const people = canvas.currentDetections || [];
    
    for (const person of people) {
        const [x, y, w, h] = person.bbox;
        if (clickX >= x && clickX <= x + w && clickY >= y && clickY <= y + h) {
            setLockedMode(person.bbox);
            break;
        }
    }
});

function setLockedMode(bbox) {
    lockedBox = bbox;
    currentModeBadge.textContent = 'Locked (Mode A)';
    currentModeBadge.className = 'mode-badge mode-a';
    modeDesc.textContent = 'Tracking a specific person via spatial tracking. Ignore others.';
    btnClearLock.disabled = false;
}

btnClearLock.addEventListener('click', () => {
    lockedBox = null;
    currentModeBadge.textContent = 'Nearest (Mode B)';
    currentModeBadge.className = 'mode-badge mode-b';
    modeDesc.textContent = 'Tracking the closest person. Click any bounding box to lock onto a target.';
    btnClearLock.disabled = true;
});

// 5. WebSocket Integration & Payload Logging
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

function sendTrackingData(payloadObj) {
    const now = Date.now();
    
    // Check if it's time to send (throttling)
    if (now - lastSendTime >= sendIntervalMs) {
        const payloadStr = JSON.stringify(payloadObj);

        // Only actually send if connected
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(payloadStr);
        }
        
        logPayload(payloadStr);

        lastSendTime = now;
        sendsInLastSecond++; // Increment telemetry even if disconnected to show loop is active
    }

    // Update telemetry FPS every second
    if (now - lastFpsUpdate >= 1000) {
        telemetryFps.textContent = `${sendsInLastSecond} Hz`;
        sendsInLastSecond = 0;
        lastFpsUpdate = now;
    }
}

function logPayload(payloadStr) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `> ${payloadStr}`;
    wsLogs.insertBefore(entry, wsLogs.firstChild);
    
    // Keep only last 5
    while (wsLogs.children.length > 5) {
        wsLogs.removeChild(wsLogs.lastChild);
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

let recordingCanvas = document.createElement('canvas');
let recCtx = recordingCanvas.getContext('2d');

function renderRecordingFrame() {
    if (!isRecording) return;
    // Draw the raw camera feed first
    recCtx.drawImage(video, 0, 0, recordingCanvas.width, recordingCanvas.height);
    // Draw the transparent canvas with the HUD and tracking boxes on top
    recCtx.drawImage(canvas, 0, 0, recordingCanvas.width, recordingCanvas.height);
    
    requestAnimationFrame(renderRecordingFrame);
}

function startRecording() {
    if (!video.srcObject) {
        alert("Camera stream not available.");
        return;
    }
    
    // Match dimensions
    recordingCanvas.width = canvas.width;
    recordingCanvas.height = canvas.height;
    
    // Capture the composite canvas at 30 FPS
    const stream = recordingCanvas.captureStream(30);
    
    recordedChunks = [];
    try {
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    } catch (e) {
        try {
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        } catch (e2) {
            mediaRecorder = new MediaRecorder(stream); // Fallback
        }
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
    
    // Start the render loop to feed frames to the media recorder
    requestAnimationFrame(renderRecordingFrame);
    
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
