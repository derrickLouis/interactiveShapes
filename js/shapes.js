/**
 * shapes.js
 * Generates Float32Array particle home-positions for each shape.
 * All shapes are centred at the origin and scaled to fit ~1.5 units radius.
 */

export const PARTICLE_COUNT = 25000;

export function getShapePositions(shape) {
    switch (shape) {
        case 'sphere':  return sampleSphere(PARTICLE_COUNT, 1.5);
        case 'cube':    return sampleCube(PARTICLE_COUNT, 2.4);
        case 'torus':   return sampleTorus(PARTICLE_COUNT, 1.2, 0.45);
        case 'pyramid': return samplePyramid(PARTICLE_COUNT, 1.5);
        default:        return sampleSphere(PARTICLE_COUNT, 1.5);
    }
}

// ─── Image sampler ────────────────────────────────────────────────────────────

/**
 * Samples PARTICLE_COUNT positions + colours from an HTMLImageElement.
 * Returns { positions: Float32Array, colors: Float32Array } or null if the
 * image has no visible pixels.
 *
 * Pixels with alpha < 32 are ignored. Remaining pixels are sampled uniformly
 * at random so the particle cloud faithfully represents the full image silhouette.
 * World-space Y is flipped (image Y increases down, world Y increases up).
 */
export function sampleImage(img) {
    // Draw into an offscreen canvas to read pixel data
    const canvas = document.createElement('canvas');
    const MAX_DIM = 256; // cap resolution — enough detail, keeps candidate list small
    const scale   = Math.min(MAX_DIM / img.naturalWidth, MAX_DIM / img.naturalHeight, 1);
    canvas.width  = Math.round(img.naturalWidth  * scale);
    canvas.height = Math.round(img.naturalHeight * scale);

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const w = canvas.width;
    const h = canvas.height;

    // Collect all visible pixel indices
    const candidates = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const base = (y * w + x) * 4;
            if (data[base + 3] > 32) candidates.push(base);
        }
    }

    if (candidates.length === 0) return null;

    // Map pixel coords to world coords — fit within 2.4 units on the longest axis
    const maxWorld = 2.4;
    const worldScale = maxWorld / Math.max(w, h);

    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors    = new Float32Array(PARTICLE_COUNT * 3);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const base = candidates[Math.floor(Math.random() * candidates.length)];
        const px   = (base / 4) % w;
        const py   = Math.floor((base / 4) / w);
        const i3   = i * 3;

        positions[i3]     = (px / w - 0.5) * w * worldScale;
        positions[i3 + 1] = (0.5 - py / h) * h * worldScale;
        positions[i3 + 2] = (Math.random() - 0.5) * 0.15; // slight Z scatter for depth

        colors[i3]     = data[base]     / 255;
        colors[i3 + 1] = data[base + 1] / 255;
        colors[i3 + 2] = data[base + 2] / 255;
    }

    return { positions, colors };
}

// ─── Sphere ───────────────────────────────────────────────────────────────────

function sampleSphere(count, radius) {
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi   = Math.acos(2 * Math.random() - 1);
        out[i * 3]     = radius * Math.sin(phi) * Math.cos(theta);
        out[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        out[i * 3 + 2] = radius * Math.cos(phi);
    }
    return out;
}

// ─── Cube (surface only) ──────────────────────────────────────────────────────

function sampleCube(count, size) {
    const out = new Float32Array(count * 3);
    const h   = size / 2;
    for (let i = 0; i < count; i++) {
        const face = Math.floor(Math.random() * 6);
        const u    = (Math.random() - 0.5) * size;
        const v    = (Math.random() - 0.5) * size;
        switch (face) {
            case 0: out[i*3]=h;  out[i*3+1]=u;  out[i*3+2]=v;  break; // +X
            case 1: out[i*3]=-h; out[i*3+1]=u;  out[i*3+2]=v;  break; // -X
            case 2: out[i*3]=u;  out[i*3+1]=h;  out[i*3+2]=v;  break; // +Y
            case 3: out[i*3]=u;  out[i*3+1]=-h; out[i*3+2]=v;  break; // -Y
            case 4: out[i*3]=u;  out[i*3+1]=v;  out[i*3+2]=h;  break; // +Z
            case 5: out[i*3]=u;  out[i*3+1]=v;  out[i*3+2]=-h; break; // -Z
        }
    }
    return out;
}

// ─── Torus ────────────────────────────────────────────────────────────────────

function sampleTorus(count, R, r) {
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi   = Math.random() * Math.PI * 2;
        out[i * 3]     = (R + r * Math.cos(phi)) * Math.cos(theta);
        out[i * 3 + 1] = (R + r * Math.cos(phi)) * Math.sin(theta);
        out[i * 3 + 2] = r * Math.sin(phi);
    }
    return out;
}

// ─── Pyramid ──────────────────────────────────────────────────────────────────

function samplePyramid(count, size) {
    const out  = new Float32Array(count * 3);
    const h    = size;
    const b    = size * 0.85;
    const apex = [0, h / 2, 0];
    const base = [
        [-b, -h / 2, -b],
        [ b, -h / 2, -b],
        [ b, -h / 2,  b],
        [-b, -h / 2,  b],
    ];

    for (let i = 0; i < count; i++) {
        const face = Math.floor(Math.random() * 5);
        let x, y, z;

        if (face === 4) {
            // Base — split into two triangles
            const useSecond = Math.random() < 0.5;
            const tri = useSecond
                ? [base[0], base[2], base[3]]
                : [base[0], base[1], base[2]];
            const s = Math.random();
            const t = Math.random() * (1 - s);
            const w = 1 - s - t;
            x = tri[0][0] * s + tri[1][0] * t + tri[2][0] * w;
            y = tri[0][1] * s + tri[1][1] * t + tri[2][1] * w;
            z = tri[0][2] * s + tri[1][2] * t + tri[2][2] * w;
        } else {
            // Side face triangle: apex + two adjacent base corners
            const c1 = base[face % 4];
            const c2 = base[(face + 1) % 4];
            const s  = Math.random();
            const t  = Math.random() * (1 - s);
            const w  = 1 - s - t;
            x = apex[0] * s + c1[0] * t + c2[0] * w;
            y = apex[1] * s + c1[1] * t + c2[1] * w;
            z = apex[2] * s + c1[2] * t + c2[2] * w;
        }

        out[i * 3]     = x;
        out[i * 3 + 1] = y;
        out[i * 3 + 2] = z;
    }
    return out;
}
