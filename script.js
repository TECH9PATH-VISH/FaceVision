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
let mqttClient = null;
let isMqttConnected = false;
const MQTT_TOPIC = "yantriksha/facevision/servo";
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
    
    // The video is already playing by the time models load, so we set dimensions and start immediately
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    video.width = canvas.width;
    video.height = canvas.height;
    requestAnimationFrame(() => detectLoop());
}

// 1. Webcam Setup
async function setupWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
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

// 2. Load BlazeFace model
async function loadModels() {
    try {
        objectModel = await blazeface.load();
        loadingOverlay.style.opacity = '0';
        setTimeout(() => loadingOverlay.style.display = 'none', 300);
        console.log("BlazeFace loaded successfully");
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

    // Safety check: Prevent TFJS crash if webcam frames aren't fully initialized
    if (video.readyState < 2 || video.videoWidth === 0) {
        requestAnimationFrame(() => detectLoop());
        return;
    }

    // Sync canvas size to video size (critical for mobile where aspect ratio varies)
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        // TFJS requires explicit width/height attributes on the video element for mobile
        video.width = video.videoWidth;
        video.height = video.videoHeight;
    }

    let predictions = [];
    try {
        predictions = await objectModel.estimateFaces(video, false);
    } catch (e) {
        console.error("TFJS Detection Error:", e);
        requestAnimationFrame(() => detectLoop());
        return;
    }

    // Map BlazeFace predictions to our existing bbox format: [x, y, width, height]
    const people = predictions.map(p => {
        const x = p.topLeft[0];
        const y = p.topLeft[1];
        const width = p.bottomRight[0] - x;
        const height = p.bottomRight[1] - y;
        return { bbox: [x, y, width, height], class: 'face' };
    });
    
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

// 4. Interaction (Click/Touch to Lock)
function handleInteract(e) {
    if (e.type === 'touchstart') e.preventDefault(); // Prevent scrolling
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    let clientX = e.clientX;
    let clientY = e.clientY;
    
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    }
    
    const clickX = (clientX - rect.left) * scaleX;
    const clickY = (clientY - rect.top) * scaleY;

    const people = canvas.currentDetections || [];
    
    for (const person of people) {
        const [x, y, w, h] = person.bbox;
        if (clickX >= x && clickX <= x + w && clickY >= y && clickY <= y + h) {
            setLockedMode(person.bbox);
            break;
        }
    }
}

canvas.addEventListener('click', handleInteract);
canvas.addEventListener('touchstart', handleInteract, {passive: false});

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

// 5. Cloud MQTT Integration & Payload Logging
btnConnect.addEventListener('click', () => {
    if (isMqttConnected && mqttClient) {
        mqttClient.disconnect();
        return;
    }

    btnConnect.textContent = 'Connecting...';
    btnConnect.disabled = true;

    try {
        // Generate a random client ID
        const clientId = "FaceVisionWeb-" + Math.floor(Math.random() * 10000);
        
        // Connect to HiveMQ Public Broker over Secure WebSockets (port 8884)
        mqttClient = new Paho.MQTT.Client("broker.hivemq.com", 8884, clientId);

        mqttClient.onConnectionLost = (responseObject) => {
            isMqttConnected = false;
            wsStatusDot.className = 'dot disconnected';
            wsStatusText.textContent = 'Disconnected from Cloud';
            btnConnect.textContent = 'Connect';
            btnConnect.disabled = false;
            console.log("MQTT Connection Lost:", responseObject.errorMessage);
        };

        const connectOptions = {
            useSSL: true,
            onSuccess: () => {
                isMqttConnected = true;
                wsStatusDot.className = 'dot connected';
                wsStatusText.textContent = 'Connected to Cloud';
                btnConnect.textContent = 'Disconnect';
                btnConnect.disabled = false;
                console.log("Connected to MQTT Broker!");
            },
            onFailure: (error) => {
                isMqttConnected = false;
                wsStatusDot.className = 'dot disconnected';
                wsStatusText.textContent = 'Connection Failed';
                btnConnect.textContent = 'Connect';
                btnConnect.disabled = false;
                console.error("MQTT Connection Failed:", error.errorMessage);
                alert("Failed to connect to Cloud MQTT Broker.");
            }
        };

        mqttClient.connect(connectOptions);
    } catch (e) {
        console.error('MQTT Exception:', e);
        btnConnect.textContent = 'Connect';
        btnConnect.disabled = false;
        alert("Error initializing MQTT connection");
    }
});

let sendsInLastSecond = 0;
let lastFpsUpdate = Date.now();

function sendTrackingData(payloadObj) {
    const now = Date.now();
    
    // Check if it's time to send (throttling)
    if (now - lastSendTime >= sendIntervalMs) {
        const payloadStr = JSON.stringify(payloadObj);

        // Only actually send if connected to Cloud
        if (isMqttConnected && mqttClient) {
            const message = new Paho.MQTT.Message(payloadStr);
            message.destinationName = MQTT_TOPIC;
            mqttClient.send(message);
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
