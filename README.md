# a blissful drive

An AE86 in an endless field of grass, in the browser. No goal, no timer, no score — you
drive around a field and the grass moves out of the way.

It started as an excuse to learn instanced rendering and ended up as a small exercise in
how much you can get out of a static page: one HTML file, one stylesheet, one script, no
build step, no framework.

## Running it

There is nothing to compile. Serve the directory over HTTP and open it:

```bash
npx serve .
```

Opening `index.html` straight off the filesystem won't work — the ES module import and the
glTF fetches need a real origin. `npm install` isn't required either; three.js is vendored
in `vendor/` and Rapier is pulled from a CDN at runtime. The `dependencies` in
`package.json` only record which versions those copies came from.

## Controls

| | |
|---|---|
| `W` `A` `S` `D` / arrows | drive |
| `Shift` | nitro |
| `Space` | handbrake |
| `H` | hide the interface |

On a phone you get a joystick instead. The buttons in the bottom-left corner cover audio,
graphics quality and an auto-drive mode that takes the wheel if you'd rather just watch.

## How it works

**Grass.** Every blade is an instance of a crossed-card mesh, split across several layers
that tile around the camera and fade in and out by distance. Wind is a noise lookup applied
in the vertex shader in world space, so neighbouring tiles stay in phase as they stream in.
Blades near the car are pushed aside by the wheels rather than being culled, which is the
part that took the longest to make look right.

**Clouds.** Raymarched in a fragment shader. Step count is the main quality dial — 16 on
Low, 80 on Ultra.

**Car.** Rapier's raycast vehicle controller drives a rigid body; the visual mesh is five
hand-exported LODs that swap by screen coverage. The suspension, gear-shift jolt and camera
lag are all tuned by feel rather than by any real vehicle model.

**Quality.** Five presets from Low to Ultra, each setting a render scale, a grass draw
distance and a cloud step count. Resolution then floats inside a per-preset range based on
measured frame time, so a struggling device degrades gradually instead of dropping frames.
There's a hidden tuning panel behind the settings cog for anyone who wants to poke at the
scene parameters directly.

## Credits

- Car model: ["Toyota Levin AE85 Grandfather"](https://skfb.ly/pEC9o) by GagoSahi, CC BY 4.0.
- Grass mesh and textures: [FluffyGrass](https://github.com/thebenezer/FluffyGrass) by
  Ebenezer, MIT. The wind and LOD approach here is heavily indebted to that project; the
  implementation was rewritten for this scene.
- Music: reidenshi — *november 8*.

Full terms are in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) and in the license
files next to the assets.

## License

Code is [MIT](LICENSE). The bundled models, textures and audio are not mine to relicense —
see above.
