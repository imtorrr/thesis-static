# thesis-static

Interactive 3D point cloud viewer for NCCE31 thesis — semantic segmentation of Thai forest LiDAR data.

## Overview

Side-by-side comparison of ground truth labels vs model predictions across:
- **3 forest plots** — Mixed Deciduous (Benchapan), Dry Evergreen (Diplang), Dry Dipterocarp (Tengrung)
- **4 models** — PointNet++ (Vanilla), PointNet++ (Modified), PointNeXt-S, PointNeXt-L
- **2 training setups** — Pretrained, Fine-tuned
- **2 feature sets** — XYZ, XYZ+HAG
- **3 classes** — Ground, Stem, Vegetation

## Tech Stack

- **Three.js** — WebGL point cloud rendering
- **COPC** (Cloud-Optimized Point Cloud) — HTTP range request streaming
- **EDL** (Eye-Dome Lighting) — custom GLSL post-processing shader
- **Vite** — build tool
- **Cloudflare Pages** — hosting
- **Cloudflare R2** — COPC file storage (private, served via Worker)
- **Cloudflare Worker** — range-request proxy with access control

## Project Structure

```
thesis-static/
├── src/
│   ├── main.js          # UI wiring, state, controls
│   ├── viewer.js        # Three.js dual-viewer with synced cameras
│   ├── copc-loader.js   # Progressive COPC streaming loader
│   ├── edl.js           # Eye-Dome Lighting post-process pass
│   └── config.js        # File URL mapping
├── css/
│   └── style.css
├── public/
│   └── sw.js            # Service worker — caches COPC chunks in browser
├── worker/
│   ├── src/index.js     # Cloudflare Worker — R2 proxy with access control
│   └── wrangler.toml
├── index.html
└── vite.config.js
```

## Local Development

```bash
npm install
npm run dev
```

Point cloud data is not included in this repo. Set `VITE_DATA_BASE` in `.env.local`:

```
VITE_DATA_BASE=http://localhost:5173/data
```

Then place COPC files under `public/data/` following this structure:

```
public/data/
├── ground_truth/{forest}.copc.laz
├── pretrained/{xyz|hag}/{model}/{forest}.copc.laz
└── fine-tune-encoder/{xyz|hag}/{model}/{forest}.copc.laz
```

## Data Conversion

Convert LAZ → COPC using PDAL:

```bash
bash convert_to_copc.sh
```

## Deployment

**Worker** (run once or on changes):
```bash
cd worker
npx wrangler deploy
```

**Pages** — connected to this repo via Cloudflare Pages. Pushes to `main` trigger automatic deploys.

Build command: `npm run build`  
Output dir: `dist`  
Env var: `VITE_DATA_BASE=https://data.imtorrr.xyz/data`
