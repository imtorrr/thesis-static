#!/usr/bin/env bash
# Convert all LAZ files to COPC format for web streaming
# Run from thesis-static/ directory

set -euo pipefail

BASE="$(cd "$(dirname "$0")" && pwd)"
DATA="$BASE/data"
OUT="$BASE/public/data"

mkdir -p "$OUT/ground_truth"
mkdir -p "$OUT/pretrained/xyz/fsct" "$OUT/pretrained/xyz/pointnet++" "$OUT/pretrained/xyz/pointnext-s" "$OUT/pretrained/xyz/pointnext-l"
mkdir -p "$OUT/pretrained/hag/fsct" "$OUT/pretrained/hag/pointnet++" "$OUT/pretrained/hag/pointnext-s" "$OUT/pretrained/hag/pointnext-l"
mkdir -p "$OUT/fine-tune-encoder/xyz/fsct" "$OUT/fine-tune-encoder/xyz/pointnet++" "$OUT/fine-tune-encoder/xyz/pointnext-s" "$OUT/fine-tune-encoder/xyz/pointnext-l"
mkdir -p "$OUT/fine-tune-encoder/hag/fsct" "$OUT/fine-tune-encoder/hag/pointnet++" "$OUT/fine-tune-encoder/hag/pointnext-s" "$OUT/fine-tune-encoder/hag/pointnext-l"

convert() {
  local src="$1" dst="$2"
  if [[ -f "$dst" ]]; then
    echo "SKIP $dst (exists)"
    return
  fi
  echo "Converting: $src -> $dst"
  pdal translate "$src" "$dst" 2>/dev/null
  echo "Done: $(du -sh "$dst" | cut -f1)"
}

FORESTS=(benchapan diplang tengrung)

# Ground truth
for forest in "${FORESTS[@]}"; do
  convert "$DATA/test_data/${forest}_${forest}_test.laz" \
          "$OUT/ground_truth/${forest}.copc.laz"
done

# Pretrained - XYZ (no hag prefix)
for model in fsct pointnet++ pointnext-s pointnext-l; do
  dir_name="forinstancev2-train-${model}"
  for forest in "${FORESTS[@]}"; do
    convert "$DATA/pretrained/${dir_name}/${forest}_${forest}_test.segmented.laz" \
            "$OUT/pretrained/xyz/${model}/${forest}.copc.laz"
  done
done

# Pretrained - HAG
for model in fsct pointnet++ pointnext-s pointnext-l; do
  dir_name="forinstancev2-hag-train-${model}"
  for forest in "${FORESTS[@]}"; do
    convert "$DATA/pretrained/${dir_name}/${forest}_${forest}_test.segmented.laz" \
            "$OUT/pretrained/hag/${model}/${forest}.copc.laz"
  done
done

# Fine-tune-encoder - XYZ (no hag prefix)
for model in fsct pointnet++ pointnext-s pointnext-l; do
  dir_name="field_data-encoder-${model}"
  for forest in "${FORESTS[@]}"; do
    convert "$DATA/fine-tune-encoder/${dir_name}/${forest}_${forest}_test.segmented.laz" \
            "$OUT/fine-tune-encoder/xyz/${model}/${forest}.copc.laz"
  done
done

# Fine-tune-encoder - HAG
for model in fsct pointnet++ pointnext-s pointnext-l; do
  dir_name="field_data-hag-encoder-${model}"
  for forest in "${FORESTS[@]}"; do
    convert "$DATA/fine-tune-encoder/${dir_name}/${forest}_${forest}_test.segmented.laz" \
            "$OUT/fine-tune-encoder/hag/${model}/${forest}.copc.laz"
  done
done

echo ""
echo "All conversions complete!"
du -sh "$OUT"
