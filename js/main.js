/**
 * main.js
 * Entry point — initialises Three.js, particles, and hand tracking.
 * Falls back to mouse simulation if camera is unavailable.
 *
 * Interaction model (single-hand):
 *   Open hand in frame  → shape reforms / holds formation; palm movement rotates
 *   Pinch (thumb+index) → scale mode: move from pinch anchor to scale up/down
 *   Fist OR no hand     → shape melts to liquid
 *   Hand reappears      → auto-reform shape
 *   Space bar           → toggle liquid ↔ shape
 */

import { initScene, screenToWorld } from './scene.js';
import { ParticleSystem } from './particles.js';
import { getShapePositions, sampleImage } from './shapes.js';
import { HandTracker } from './handTracking.js';

// ─── Scene + particles ────────────────────────────────────────────────────────

const { scene, camera, renderer } = initScene();
const particles = new ParticleSystem(scene);

// ─── Render loop ──────────────────────────────────────────────────────────────

let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt  = Math.min((now - lastTime) / 1000, 0.05);
    lastTime  = now;
    particles.update(dt);
    renderer.render(scene, camera);
}

animate();

// ─── Start screen ─────────────────────────────────────────────────────────────

const startScreen = document.getElementById('start-screen');
const beginBtn    = document.getElementById('begin-btn');

beginBtn.addEventListener('click', () => {
    startScreen.classList.add('hidden');
    startScreen.addEventListener('transitionend', () => startScreen.remove(), { once: true });
    // Kick off hand tracking now that user has interacted (required for camera permission)
    initHandTracking();
});

// ─── DOM references ───────────────────────────────────────────────────────────

const stateDisplay    = document.getElementById('state-display');
const shapeOptions    = document.querySelectorAll('.shape-option');
const uploadOption    = document.getElementById('upload-option');
const fileInput       = document.getElementById('file-input');
const leftHandStatus  = document.getElementById('left-hand-status');
const rightHandStatus = document.getElementById('right-hand-status');
const gestureStatus   = document.getElementById('gesture-status');
const gestureFeedback = document.getElementById('gesture-feedback');
const cameraStatus    = document.getElementById('camera-status');

// ─── State machine ────────────────────────────────────────────────────────────

const STATES = {
    IDLE:      'Idle',
    REFORMING: 'Reforming',
    SHAPE:     'Shape',
    CONTROL:   'Control',
    FLOWING:   'Flowing',
    LIQUID:    'Liquid',
};

let currentState = STATES.IDLE;
let stateTimer   = null;

function setState(state) {
    currentState = state;
    stateDisplay.textContent = state;
    particles.setState(state.toUpperCase());
}

function scheduleState(state, delayMs) {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => setState(state), delayMs);
}

// ─── Shape selection ──────────────────────────────────────────────────────────

let lastShapeName    = 'sphere';
let lastImageSample  = null; // { positions, colors } — cached for re-reform

function selectShape(shapeName) {
    lastShapeName   = shapeName;
    lastImageSample = null;
    const positions = getShapePositions(shapeName);
    particles.setHome(positions);

    clearTimeout(stateTimer);
    resetInteractionState();

    setState(STATES.REFORMING);
    scheduleState(STATES.SHAPE, 2000);
}

shapeOptions.forEach(option => {
    option.addEventListener('click', function () {
        shapeOptions.forEach(opt => opt.classList.remove('active'));
        this.classList.add('active');
        selectShape(this.dataset.shape);
    });
});

// ─── Image upload ─────────────────────────────────────────────────────────────

uploadOption.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileInput.value = '';

    const url = URL.createObjectURL(file);
    const img  = new Image();

    img.onload = () => {
        URL.revokeObjectURL(url);
        const result = sampleImage(img);
        if (!result) return;

        // Deactivate built-in shape buttons (no shape is "selected")
        shapeOptions.forEach(opt => opt.classList.remove('active'));

        lastShapeName   = '__image__';
        lastImageSample = result;
        particles.setHomeWithColors(result.positions, result.colors);

        clearTimeout(stateTimer);
        resetInteractionState();
        setState(STATES.REFORMING);
        scheduleState(STATES.SHAPE, 2000);
    };

    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
});

// ─── Single-hand interaction state ────────────────────────────────────────────

const ROT_SENSITIVITY        = 1.4;   // radians per world-unit
const PINCH_LOCK_DIST        = 0.10;  // world units before axis locks
const PINCH_SCALE_SENSITIVITY = 0.9;  // exponential scale sensitivity

let prevPalmPos     = null;  // { x, y } for rotation delta

// Pinch state
let pinchActive     = false;
let pinchAnchorPos  = null;  // world pos where pinch started
let pinchAnchorScale = 1;
let pinchAxis       = null;  // { x, y } unit vector — locked after first movement
let pinchAxisLocked = false;

// Liquid debounce — prevents instant melt on transient detection loss
let liquidTimer     = null;
const LIQUID_DEBOUNCE_MS = 300;

function resetInteractionState() {
    prevPalmPos      = null;
    pinchActive      = false;
    pinchAnchorPos   = null;
    pinchAnchorScale = 1;
    pinchAxis        = null;
    pinchAxisLocked  = false;
    clearTimeout(liquidTimer);
    liquidTimer = null;
}

// ─── Transition helpers ───────────────────────────────────────────────────────

function triggerShape() {
    clearTimeout(liquidTimer);
    liquidTimer = null;

    if (currentState === STATES.LIQUID || currentState === STATES.FLOWING) {
        // Auto-reform when hand reappears
        if (lastImageSample) {
            particles.setHomeWithColors(lastImageSample.positions, lastImageSample.colors);
        } else {
            particles.setHome(getShapePositions(lastShapeName));
        }
        resetInteractionState();
        setState(STATES.REFORMING);
        scheduleState(STATES.SHAPE, 2000);
    } else if (currentState === STATES.SHAPE || currentState === STATES.REFORMING) {
        // Already in shape mode — let it be
    }
}

function triggerLiquid() {
    if (currentState === STATES.LIQUID || currentState === STATES.FLOWING) return;
    if (liquidTimer !== null) return;

    liquidTimer = setTimeout(() => {
        liquidTimer = null;
        resetInteractionState();
        setState(STATES.FLOWING);
        scheduleState(STATES.LIQUID, 1500);
    }, LIQUID_DEBOUNCE_MS);
}

// ─── Per-frame hand processing ────────────────────────────────────────────────

function processHand(hand) {
    if (!hand) {
        triggerLiquid();
        return;
    }

    const gesture = hand.gesture;

    // Fist → liquid
    if (gesture === 'fist') {
        triggerLiquid();
        return;
    }

    // Any non-fist gesture with a hand → cancel pending liquid
    clearTimeout(liquidTimer);
    liquidTimer = null;

    // Auto-reform if coming from liquid
    if (currentState === STATES.LIQUID || currentState === STATES.FLOWING) {
        triggerShape();
        return;
    }

    // Must be in a shape state to rotate/scale
    if (currentState !== STATES.SHAPE && currentState !== STATES.CONTROL &&
        currentState !== STATES.REFORMING) return;

    if (gesture === 'pinch') {
        // Pinch → scale mode
        if (!pinchActive) {
            pinchActive      = true;
            pinchAnchorPos   = { x: hand.pos.x, y: hand.pos.y };
            pinchAnchorScale = particles.shapeScale;
            pinchAxis        = null;
            pinchAxisLocked  = false;
        }

        const dx   = hand.pos.x - pinchAnchorPos.x;
        const dy   = hand.pos.y - pinchAnchorPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (!pinchAxisLocked && dist > PINCH_LOCK_DIST) {
            pinchAxis       = { x: dx / dist, y: dy / dist };
            pinchAxisLocked = true;
        }

        if (pinchAxisLocked) {
            const projection = dx * pinchAxis.x + dy * pinchAxis.y;
            particles.shapeScale = Math.max(0.2, Math.min(4.0,
                pinchAnchorScale * Math.exp(projection * PINCH_SCALE_SENSITIVITY)
            ));
        }

        prevPalmPos = null; // don't accumulate rotation while pinching

        if (currentState !== STATES.CONTROL) setState(STATES.CONTROL);

    } else {
        // Open / neutral → rotate via palm delta
        pinchActive = false;

        if (prevPalmPos && (currentState === STATES.SHAPE || currentState === STATES.CONTROL)) {
            particles.shapeRotY += (hand.palm.x - prevPalmPos.x) * ROT_SENSITIVITY;
            particles.shapeRotX += (hand.palm.y - prevPalmPos.y) * ROT_SENSITIVITY;
        }

        prevPalmPos = { x: hand.palm.x, y: hand.palm.y };

        if (currentState === STATES.SHAPE) setState(STATES.CONTROL);
    }
}

// ─── Hand tracking callbacks ──────────────────────────────────────────────────

function onHandsUpdate(handData) {
    const hasLeft  = !!handData.left;
    const hasRight = !!handData.right;

    // Update UI labels
    leftHandStatus.classList.toggle('active', hasLeft);
    rightHandStatus.classList.toggle('active', hasRight);

    // Use whichever hand is present; prefer the one with a stronger gesture.
    // Priority: pinch > open/neutral > absent. If both hands present, pick the
    // one that isn't a fist (a fist from either hand still triggers liquid).
    const hasFistLeft  = handData.left?.gesture  === 'fist';
    const hasFistRight = handData.right?.gesture === 'fist';

    if (!hasLeft && !hasRight) {
        processHand(null);
    } else if (hasFistLeft || hasFistRight) {
        // Either hand fisting → liquid
        processHand({ gesture: 'fist' });
    } else {
        // Pick the active hand (prefer right, fall back to left)
        const activeHand = handData.right ?? handData.left;
        processHand(activeHand);
    }

    // Gesture status indicator — light up when a non-neutral gesture is seen
    const gesture = handData.right?.gesture ?? handData.left?.gesture ?? 'none';
    const gestureActive = gesture === 'pinch' || gesture === 'fist' || gesture === 'open';
    gestureStatus.classList.toggle('active', gestureActive);
}

// ─── MediaPipe hand tracking (with mouse fallback) ────────────────────────────

let usingMouseFallback = false;
let handTimeout        = null;

async function initHandTracking() {
    try {
        setCameraStatus('Initialising camera…');
        const tracker = new HandTracker(camera);
        await tracker.init(onHandsUpdate);
        setCameraStatus('Camera active');
        setTimeout(() => setCameraStatus(''), 2000);
    } catch (err) {
        console.warn('Hand tracking unavailable — using mouse fallback:', err.message);
        usingMouseFallback = true;
        setCameraStatus('Mouse mode');
        enableMouseFallback();
    }
}

// ─── Mouse fallback ───────────────────────────────────────────────────────────
// Simulates a single "hand" using cursor movement.
// Mouse position maps to palm; scroll → scale.

function enableMouseFallback() {
    document.addEventListener('mousemove', (e) => {
        if (!usingMouseFallback) return;

        const worldPos = screenToWorld(e.clientX, e.clientY, camera, 0);

        onHandsUpdate({
            left:  null,
            right: { pos: worldPos, palm: worldPos, vx: 0, vy: 0, gesture: 'open' },
        });

        clearTimeout(handTimeout);
        handTimeout = setTimeout(() => onHandsUpdate({ left: null, right: null }), 2000);
    });

    document.addEventListener('mouseleave', () => {
        if (!usingMouseFallback) return;
        clearTimeout(handTimeout);
        onHandsUpdate({ left: null, right: null });
    });

    // Scroll wheel → scale in mouse mode
    document.addEventListener('wheel', (e) => {
        if (!usingMouseFallback) return;
        if (currentState !== STATES.SHAPE && currentState !== STATES.CONTROL) return;
        const delta = e.deltaY > 0 ? 0.95 : 1.05;
        particles.shapeScale = Math.max(0.2, Math.min(4.0, particles.shapeScale * delta));
    });
}

// ─── Spacebar & keyboard shortcuts ────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        if (currentState === STATES.LIQUID || currentState === STATES.FLOWING) {
            // Reform
            if (lastImageSample) {
                particles.setHomeWithColors(lastImageSample.positions, lastImageSample.colors);
            } else {
                particles.setHome(getShapePositions(lastShapeName));
            }
            resetInteractionState();
            setState(STATES.REFORMING);
            scheduleState(STATES.SHAPE, 2000);
        } else if (currentState === STATES.SHAPE || currentState === STATES.CONTROL) {
            // Melt
            resetInteractionState();
            setState(STATES.FLOWING);
            scheduleState(STATES.LIQUID, 1500);
        }
    }

    // Arrow keys — fine rotation
    if (currentState === STATES.SHAPE || currentState === STATES.CONTROL) {
        const step = 0.05;
        if (e.code === 'ArrowLeft')  particles.shapeRotY -= step;
        if (e.code === 'ArrowRight') particles.shapeRotY += step;
        if (e.code === 'ArrowUp')    particles.shapeRotX -= step;
        if (e.code === 'ArrowDown')  particles.shapeRotX += step;
    }
});

// ─── Gesture feedback overlay ─────────────────────────────────────────────────

function triggerGestureFeedback() {
    gestureFeedback.classList.remove('show');
    void gestureFeedback.offsetWidth;
    gestureFeedback.classList.add('show');
    setTimeout(() => gestureFeedback.classList.remove('show'), 2500);
}

// ─── Camera status helper ─────────────────────────────────────────────────────

function setCameraStatus(msg) {
    if (cameraStatus) cameraStatus.textContent = msg;
}
