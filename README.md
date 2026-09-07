# Particle Canvas

A hand-tracked particle art piece built with Three.js and MediaPipe Hands. Choose a 3D shape (or upload an image) and mold it into a swirling liquid or a controllable particle formation using nothing but your webcam.

## Running it

```bash
npm install
npm run dev
```

Then open the printed local URL in a browser and grant camera access.

If a camera isn't available or permission is denied, the experience automatically falls back to mouse-driven controls.

## Controls

| Gesture / Input       | Effect                                |
|------------------------|----------------------------------------|
| Open hand              | Rotate the current shape               |
| Pinch (thumb + index)  | Scale up/down from the pinch anchor    |
| Fist or no hand        | Melt into liquid                       |
| Hand reappears         | Auto-reform the last shape             |
| `Space`                | Toggle liquid &harr; shape             |
| Arrow keys             | Fine rotation while in shape/control state |

## Shapes

Sphere, cube, torus, and pyramid are generated procedurally (`js/shapes.js`). You can also upload any image — its visible pixels are sampled into a colored particle field.

## Project structure

```
index.html          Markup + UI overlay
css/style.css        Styling
js/main.js            Entry point, state machine, gesture routing
js/scene.js           Three.js scene/camera/renderer setup
js/particles.js        GPU-friendly particle system (liquid/shape states)
js/shapes.js           Procedural shape samplers + image sampler
js/handTracking.js      MediaPipe Hands wrapper
```

`creative-vision-project-plan.md` holds the original design/planning notes for the project.
