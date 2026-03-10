/**
 * scene.js
 * Three.js scene, camera, and renderer setup.
 */

import * as THREE from 'three';

export function initScene() {
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        100
    );
    camera.position.set(0, 0, 5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 1);

    // Insert canvas behind all UI elements
    const container = document.getElementById('canvas-container');
    container.prepend(renderer.domElement);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    });

    return { scene, camera, renderer };
}

/**
 * Convert screen-space mouse coordinates to world-space position
 * on the given Z plane (default 0).
 */
export function screenToWorld(clientX, clientY, camera, planeZ = 0) {
    const ndc = new THREE.Vector3(
        (clientX / window.innerWidth)  *  2 - 1,
        (clientY / window.innerHeight) * -2 + 1,
        0.5
    );
    ndc.unproject(camera);
    const dir = ndc.sub(camera.position).normalize();
    const t   = (planeZ - camera.position.z) / dir.z;
    return camera.position.clone().add(dir.multiplyScalar(t));
}
