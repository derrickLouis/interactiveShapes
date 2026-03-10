/**
 * particles.js
 * ParticleSystem — owns the Three.js Points mesh and all per-frame physics.
 *
 * States
 *   IDLE      — gentle noise drift on page load
 *   REFORMING — particles fly to (transformed) home positions
 *   SHAPE     — hold formation with micro-wobble, waiting for hand
 *   CONTROL   — hand is actively rotating / scaling the shape (tight tracking)
 *   FLOWING   — gravity collapses the shape toward the floor
 *   LIQUID    — particles pool at floor with noise-driven ripple
 *
 * Shape transform (set from main.js by assigning public properties):
 *   particles.shapeRotX  — X-axis (pitch) rotation in radians
 *   particles.shapeRotY  — Y-axis (yaw)   rotation in radians
 *   particles.shapeRotZ  — Z-axis (roll)  rotation in radians
 *   particles.shapeScale — uniform scale factor
 */

import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { PARTICLE_COUNT } from './shapes.js';

const GRAVITY       = 9.0;
const FLOOR_Y       = -2.6;
const DAMPING       = 0.88;
const REFORM_SPEED  = 3.5;
const CONTROL_SPEED = 14.0; // fast tracking when user is manipulating
const COLOR_SPEED   = 4.0;  // lerp rate toward target colours

export class ParticleSystem {
    constructor(scene) {
        this.scene   = scene;
        this.noise3D = createNoise3D();
        this.time    = 0;
        this.state   = 'IDLE';

        // Public shape transform — written directly by main.js
        this.shapeRotX  = 0;
        this.shapeRotY  = 0;
        this.shapeRotZ  = 0;
        this.shapeScale = 1;

        this.pos             = new Float32Array(PARTICLE_COUNT * 3);
        this.vel             = new Float32Array(PARTICLE_COUNT * 3);
        this.home            = new Float32Array(PARTICLE_COUNT * 3);
        this.transformedHome = new Float32Array(PARTICLE_COUNT * 3);

        // Per-particle RGB colours (0-1). targetColors is the goal; colors lerps toward it.
        this.colors      = new Float32Array(PARTICLE_COUNT * 3).fill(1); // start white
        this.targetColors = new Float32Array(PARTICLE_COUNT * 3).fill(1);

        this._buildMesh();
        this._scatter();
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    /** Set the base (un-transformed) home positions and reset the transform. */
    setHome(positions) {
        this.home.set(positions);
        this.shapeRotX  = 0;
        this.shapeRotY  = 0;
        this.shapeRotZ  = 0;
        this.shapeScale = 1;
        this.targetColors.fill(1); // reset to white for built-in shapes
        this._computeTransformedHome();
    }

    /** Like setHome but also sets per-particle target colours (from image sampling). */
    setHomeWithColors(positions, colors) {
        this.home.set(positions);
        this.shapeRotX  = 0;
        this.shapeRotY  = 0;
        this.shapeRotZ  = 0;
        this.shapeScale = 1;
        this.targetColors.set(colors);
        this._computeTransformedHome();
    }

    setState(state) {
        this.state = state;
    }

    update(dt) {
        this.time += dt;
        const { pos, vel } = this;

        // Recompute the transformed home positions every frame for states that use them
        if (this.state === 'REFORMING' || this.state === 'SHAPE' || this.state === 'CONTROL') {
            this._computeTransformedHome();
        }

        const th = this.transformedHome;

        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const i3 = i * 3;
            switch (this.state) {
                case 'IDLE':      this._idle(i3, pos, vel, dt);            break;
                case 'REFORMING': this._reform(i3, pos, vel, th, dt);      break;
                case 'SHAPE':     this._holdShape(i3, pos, vel, th, dt);   break;
                case 'CONTROL':   this._control(i3, pos, vel, th, dt);     break;
                case 'FLOWING':   this._flow(i3, pos, vel, dt);            break;
                case 'LIQUID':    this._liquid(i3, pos, vel, dt);          break;
            }
        }

        // Lerp colours toward target every frame
        const alpha = Math.min(COLOR_SPEED * dt, 1);
        for (let j = 0; j < PARTICLE_COUNT * 3; j++) {
            this.colors[j] += (this.targetColors[j] - this.colors[j]) * alpha;
        }

        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate    = true;
    }

    // ─── Transform ───────────────────────────────────────────────────────────

    /**
     * Apply Y → X → Z rotation then uniform scale to every home position.
     * Trig constants are computed once outside the loop for performance.
     */
    _computeTransformedHome() {
        const cx = Math.cos(this.shapeRotX);
        const sx = Math.sin(this.shapeRotX);
        const cy = Math.cos(this.shapeRotY);
        const sy = Math.sin(this.shapeRotY);
        const cz = Math.cos(this.shapeRotZ);
        const sz = Math.sin(this.shapeRotZ);
        const s  = this.shapeScale;

        const th   = this.transformedHome;
        const home = this.home;

        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const i3 = i * 3;
            const hx = home[i3];
            const hy = home[i3 + 1];
            const hz = home[i3 + 2];

            // Y rotation (yaw)
            const x1 =  hx * cy + hz * sy;
            const y1 =  hy;
            const z1 = -hx * sy + hz * cy;

            // X rotation (pitch)
            const x2 = x1;
            const y2 = y1 * cx - z1 * sx;
            const z2 = y1 * sx + z1 * cx;

            // Z rotation (roll)
            const x3 = x2 * cz - y2 * sz;
            const y3 = x2 * sz + y2 * cz;
            const z3 = z2;

            th[i3]     = x3 * s;
            th[i3 + 1] = y3 * s;
            th[i3 + 2] = z3 * s;
        }
    }

    // ─── Setup ───────────────────────────────────────────────────────────────

    _scatter() {
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const i3 = i * 3;
            this.pos[i3]     = (Math.random() - 0.5) * 5;
            this.pos[i3 + 1] = (Math.random() - 0.5) * 4;
            this.pos[i3 + 2] = (Math.random() - 0.5) * 1;
        }
    }

    _buildMesh() {
        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
        this.geometry.setAttribute('color',    new THREE.BufferAttribute(this.colors, 3));

        this.material = new THREE.PointsMaterial({
            vertexColors: true,
            size: 0.055,
            map: this._glowTexture(),
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });

        this.points = new THREE.Points(this.geometry, this.material);
        this.scene.add(this.points);
    }

    _glowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const g   = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0,   'rgba(255,255,255,1)');
        g.addColorStop(0.3, 'rgba(255,255,255,0.8)');
        g.addColorStop(0.7, 'rgba(255,255,255,0.3)');
        g.addColorStop(1,   'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(canvas);
    }

    // ─── Per-state physics ────────────────────────────────────────────────────

    _idle(i3, pos, vel, dt) {
        const t  = this.time * 0.15;
        const nx = this.noise3D(pos[i3] * 0.4,       pos[i3 + 1] * 0.4, t);
        const ny = this.noise3D(pos[i3] * 0.4 + 100, pos[i3 + 1] * 0.4, t);

        vel[i3]     += nx * 0.9 * dt;
        vel[i3 + 1] += ny * 0.9 * dt;
        vel[i3]     *= 0.97;
        vel[i3 + 1] *= 0.97;
        pos[i3]     += vel[i3]     * dt;
        pos[i3 + 1] += vel[i3 + 1] * dt;
        pos[i3]     -= pos[i3]     * 0.008 * dt;
        pos[i3 + 1] -= pos[i3 + 1] * 0.008 * dt;
    }

    /** Fly toward the current transformed home position */
    _reform(i3, pos, vel, th, dt) {
        pos[i3]     += (th[i3]     - pos[i3])     * REFORM_SPEED * dt;
        pos[i3 + 1] += (th[i3 + 1] - pos[i3 + 1]) * REFORM_SPEED * dt;
        pos[i3 + 2] += (th[i3 + 2] - pos[i3 + 2]) * REFORM_SPEED * dt;
        vel[i3] = vel[i3 + 1] = vel[i3 + 2] = 0;
    }

    /** Hold formation with a subtle breathing wobble — shape is waiting for a hand */
    _holdShape(i3, pos, vel, th, dt) {
        const wobble = 0.003;
        pos[i3]     = th[i3]     + Math.sin(this.time * 1.1 + i3 * 0.013) * wobble;
        pos[i3 + 1] = th[i3 + 1] + Math.cos(this.time * 0.9 + i3 * 0.013) * wobble;
        pos[i3 + 2] = th[i3 + 2];
        vel[i3] = vel[i3 + 1] = vel[i3 + 2] = 0;
    }

    /**
     * Actively controlled by the user's hand — fast spring to transformedHome
     * so the shape tracks rotation/scale changes in near real-time.
     */
    _control(i3, pos, vel, th, dt) {
        pos[i3]     += (th[i3]     - pos[i3])     * CONTROL_SPEED * dt;
        pos[i3 + 1] += (th[i3 + 1] - pos[i3 + 1]) * CONTROL_SPEED * dt;
        pos[i3 + 2] += (th[i3 + 2] - pos[i3 + 2]) * CONTROL_SPEED * dt;
        vel[i3] = vel[i3 + 1] = vel[i3 + 2] = 0;
    }

    _flow(i3, pos, vel, dt) {
        vel[i3 + 1] -= GRAVITY * dt;
        vel[i3]     *= 0.99;
        pos[i3]     += vel[i3]     * dt;
        pos[i3 + 1] += vel[i3 + 1] * dt;

        if (pos[i3 + 1] < FLOOR_Y) {
            pos[i3 + 1]  = FLOOR_Y + Math.random() * 0.02;
            vel[i3 + 1] *= -0.12;
            vel[i3]     += (Math.random() - 0.5) * 0.4;
        }
    }

    _liquid(i3, pos, vel, dt) {
        const t  = this.time * 0.25;
        const nx = this.noise3D(pos[i3] * 0.6,       pos[i3 + 1] * 0.6, t);
        const ny = this.noise3D(pos[i3] * 0.6 + 100, pos[i3 + 1] * 0.6, t);

        vel[i3]     += nx * 1.4 * dt;
        vel[i3 + 1] += (ny * 0.4 - GRAVITY * 0.28) * dt;
        vel[i3]     *= DAMPING;
        vel[i3 + 1] *= DAMPING;
        pos[i3]     += vel[i3]     * dt;
        pos[i3 + 1] += vel[i3 + 1] * dt;

        if (pos[i3 + 1] < FLOOR_Y) {
            pos[i3 + 1]  = FLOOR_Y + Math.random() * 0.05;
            vel[i3 + 1] *= -0.06;
        }

        const BND = 4.5;
        if (Math.abs(pos[i3]) > BND) {
            vel[i3] *= -0.6;
            pos[i3]  = Math.sign(pos[i3]) * BND;
        }
    }
}
