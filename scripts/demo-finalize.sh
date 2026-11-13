#!/bin/bash
# A finished clip for the web page: H.264 1080p, silent, faststart, ≤ 14 MB (the page's cap is 15).
#   demo-finalize.sh <in.mp4> <out.mp4>
set -eu
in=$1; out=$2
for crf in 20 23 26 29; do
  ffmpeg -v error -y -i "$in" -c:v libx264 -preset slow -crf $crf -maxrate 3M -bufsize 6M -pix_fmt yuv420p -an -movflags +faststart "$out"
  [ "$(stat -f %z "$out")" -le 14000000 ] && break
done
printf "%s  %.1f s  %.1f MB\n" "$out" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")" "$(echo "$(stat -f %z "$out") / 1000000" | bc -l)"
