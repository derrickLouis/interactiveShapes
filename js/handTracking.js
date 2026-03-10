/**
 * handTracking.js
 * Wraps MediaPipe Tasks-Vision HandLandmarker.
 *
 * Fixes over Phase 2:
 *   - Detection throttled to 20 fps (was every RAF frame = 60 fps, blocking render)
 *   - EMA position smoothing + velocity derivation for the pickup effect
 *   - Gesture uses wrist-normalised distance — works at any hand orientation/angle
 *   - Single-hand gestures (no longer requires both hands simultaneously)
 *   - Landmark skeleton drawn on canvas overlay in the camera preview
 */

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { screenToWorld } from './scene.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const WASM_CDN  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const DETECTION_INTERVAL = 50;  // ms → 20 fps detection rate
const SMOOTH_ALPHA       = 0.35; // EMA factor: higher = more responsive, less smooth

// MediaPipe hand skeleton connections
const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],             // thumb
    [0,5],[5,6],[6,7],[7,8],             // index
    [0,9],[9,10],[10,11],[11,12],        // middle
    [0,13],[13,14],[14,15],[15,16],      // ring
    [0,17],[17,18],[18,19],[19,20],      // pinky
    [5,9],[9,13],[13,17],                // palm knuckles
];

const FINGERTIP_IDX = [8, 12, 16, 20];  // index → pinky tips

export class HandTracker {
    constructor(camera) {
        this.camera = camera;

        this.onHandsUpdate = null;

        this._landmarker       = null;
        this._video            = null;
        this._canvas           = null;
        this._ctx              = null;
        this._running          = false;
        this._lastDetectionTs  = 0;

        // Per-hand smoothed world positions + derived velocities
        this._smooth     = { left: null, right: null };
        this._prevSmooth = { left: null, right: null };
        // Wrist position — stable control point for shape manipulation
        this._palmSmooth = { left: null, right: null };
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    async init(onHandsUpdate) {
        this.onHandsUpdate = onHandsUpdate;

        await this._initLandmarker();
        await this._initCamera();

        this._running = true;
        this._loop();
    }

    stop() {
        this._running = false;
        this._video?.srcObject?.getTracks().forEach(t => t.stop());
    }

    // ─── Setup ────────────────────────────────────────────────────────────────

    async _initLandmarker() {
        const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
        this._landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence:  0.6,
            minTrackingConfidence:      0.5,
        });
    }

    async _initCamera() {
        this._video = document.getElementById('camera-video');

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' },
            audio: false,
        });

        this._video.srcObject = stream;
        await new Promise(resolve => (this._video.onloadedmetadata = resolve));
        await this._video.play();

        // Landmark overlay canvas
        this._canvas = document.getElementById('landmark-canvas');
        this._canvas.width  = 192;
        this._canvas.height = 144;
        this._ctx = this._canvas.getContext('2d');

        document.getElementById('camera-preview').classList.add('visible');
    }

    // ─── Detection loop ───────────────────────────────────────────────────────

    _loop() {
        if (!this._running) return;

        const now = performance.now();

        // Throttle: only run inference at DETECTION_INTERVAL ms
        if (this._video.readyState >= 2 && (now - this._lastDetectionTs) >= DETECTION_INTERVAL) {
            const detDt = Math.max((now - this._lastDetectionTs) / 1000, 0.001);
            this._lastDetectionTs = now;

            const results = this._landmarker.detectForVideo(this._video, now);
            this._process(results, detDt);
        }

        requestAnimationFrame(() => this._loop());
    }

    // ─── Result processing ────────────────────────────────────────────────────

    _process(results, detDt) {
        const allLandmarks  = results.landmarks    ?? [];
        const allHandedness = results.handednesses ?? [];

        // Step 1: raw world positions this frame
        const raw = { left: null, right: null };
        allLandmarks.forEach((lm, i) => {
            const label       = allHandedness[i]?.[0]?.categoryName ?? 'Right';
            const isUserRight = label === 'Right'; // 'Right' = user's right (from user's perspective)
            const side        = isUserRight ? 'right' : 'left';
            raw[side] = {
                tipPos:  this._toWorld(lm[8]), // index fingertip — display / pointing
                palmPos: this._toWorld(lm[0]), // wrist — stable control point for shape
                landmarks: lm,
            };
        });

        // Step 2: EMA smooth + derive velocity
        const handData = { left: null, right: null };
        for (const side of ['left', 'right']) {
            const currTip  = raw[side]?.tipPos  ?? null;
            const currPalm = raw[side]?.palmPos ?? null;

            if (currTip && currPalm) {
                const prevTip  = this._smooth[side];
                const prevPalm = this._palmSmooth[side];

                const sx = prevTip  ? prevTip.x  * (1 - SMOOTH_ALPHA) + currTip.x  * SMOOTH_ALPHA : currTip.x;
                const sy = prevTip  ? prevTip.y  * (1 - SMOOTH_ALPHA) + currTip.y  * SMOOTH_ALPHA : currTip.y;
                const px = prevPalm ? prevPalm.x * (1 - SMOOTH_ALPHA) + currPalm.x * SMOOTH_ALPHA : currPalm.x;
                const py = prevPalm ? prevPalm.y * (1 - SMOOTH_ALPHA) + currPalm.y * SMOOTH_ALPHA : currPalm.y;

                this._smooth[side]     = { x: sx, y: sy };
                this._palmSmooth[side] = { x: px, y: py };

                const vx = this._prevSmooth[side] ? (sx - this._prevSmooth[side].x) / detDt : 0;
                const vy = this._prevSmooth[side] ? (sy - this._prevSmooth[side].y) / detDt : 0;

                handData[side] = {
                    pos:     this._smooth[side],
                    palm:    this._palmSmooth[side], // wrist — for shape rotation / scale
                    vx, vy,
                    gesture: this._getGesture(raw[side].landmarks),
                    landmarks: raw[side].landmarks,
                };
            } else {
                this._smooth[side]     = null;
                this._palmSmooth[side] = null;
            }

            this._prevSmooth[side] = this._smooth[side] ? { ...this._smooth[side] } : null;
        }

        this.onHandsUpdate?.(handData);
        this._drawLandmarks(allLandmarks);
    }

    // ─── Coordinate conversion ────────────────────────────────────────────────

    _toWorld(landmark) {
        // Flip X so world coords match the mirrored (selfie) video display
        const cx = (1 - landmark.x) * window.innerWidth;
        const cy = landmark.y       * window.innerHeight;
        return screenToWorld(cx, cy, this.camera, 0);
    }

    // ─── Per-hand gesture classification ─────────────────────────────────────
    //
    // Returns one of: 'open', 'pinch', 'fist', 'neutral'
    // All distances are wrist-normalised (robust to any hand size / distance).

    _getGesture(lm) {
        if (this._isFist(lm))    return 'fist';
        if (this._isPinch(lm))   return 'pinch';
        if (this._isOpen(lm))    return 'open';
        return 'neutral';
    }

    /** Open hand: 3+ fingertips far from wrist */
    _isOpen(lm) {
        const wrist  = lm[0];
        const midMCP = lm[9];
        const scale  = Math.hypot(midMCP.x - wrist.x, midMCP.y - wrist.y) + 0.001;
        let extended = 0;
        for (const idx of FINGERTIP_IDX) {
            const d = Math.hypot(lm[idx].x - wrist.x, lm[idx].y - wrist.y);
            if (d / scale > 1.7) extended++;
        }
        return extended >= 3;
    }

    /** Fist: 3+ fingertips close to wrist */
    _isFist(lm) {
        const wrist  = lm[0];
        const midMCP = lm[9];
        const scale  = Math.hypot(midMCP.x - wrist.x, midMCP.y - wrist.y) + 0.001;
        let curled = 0;
        for (const idx of FINGERTIP_IDX) {
            const d = Math.hypot(lm[idx].x - wrist.x, lm[idx].y - wrist.y);
            if (d / scale < 1.1) curled++;
        }
        return curled >= 3;
    }

    /** Pinch: thumb tip (lm[4]) close to index tip (lm[8]), other fingers not all curled */
    _isPinch(lm) {
        const wrist  = lm[0];
        const midMCP = lm[9];
        const scale  = Math.hypot(midMCP.x - wrist.x, midMCP.y - wrist.y) + 0.001;
        const dist   = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
        return (dist / scale) < 0.45;
    }

    // ─── Landmark canvas overlay ──────────────────────────────────────────────

    _drawLandmarks(allLandmarks) {
        if (!this._ctx) return;
        const { width, height } = this._canvas;
        this._ctx.clearRect(0, 0, width, height);

        allLandmarks.forEach(lm => {
            // Canvas has CSS scaleX(-1) matching the video — draw at raw landmark coords
            this._ctx.strokeStyle = 'rgba(255,255,255,0.55)';
            this._ctx.lineWidth   = 1;
            for (const [a, b] of HAND_CONNECTIONS) {
                this._ctx.beginPath();
                this._ctx.moveTo(lm[a].x * width, lm[a].y * height);
                this._ctx.lineTo(lm[b].x * width, lm[b].y * height);
                this._ctx.stroke();
            }

            // Landmark dots
            lm.forEach((pt, idx) => {
                const isTip = FINGERTIP_IDX.includes(idx) || idx === 4; // include thumb tip
                this._ctx.beginPath();
                this._ctx.arc(
                    pt.x * width,
                    pt.y * height,
                    isTip ? 3 : 1.5,
                    0, Math.PI * 2
                );
                this._ctx.fillStyle = isTip
                    ? 'rgba(255,255,255,1)'
                    : 'rgba(255,255,255,0.65)';
                this._ctx.fill();
            });
        });
    }
}
