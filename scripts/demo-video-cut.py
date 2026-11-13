#!/usr/bin/env python3
"""Cut one demo take (scripts/ios-demo-videos.sh) into a finished clip: the session's own span of the
screen recording (the player's startedAt/endedAt against the recording's start), turned to landscape,
idle stretches over ~3 s cut down, and a 2 s title card in front (Ink on Paper, Bricolage Grotesque).

    demo-video-cut.py <out dir> <session id> <take> [--keep-idle 1.0] [--start-pad 0.3] [--end-pad 1.5]

Writes <out>/<NN>-<id>.mp4 (NN: the clip's place in the list) and <out>/frames/<id>/ (1 fps + last
frame, for review). Needs ffmpeg and Pillow."""
import json, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, "ios/Packages/AgathonDesign/Sources/AgathonDesign/Resources/Fonts/BricolageGrotesque-Variable.ttf")
ORDER = ["dK-add", "d1-subtract", "d2-carry", "d3-multiply", "d4-divide", "d5-fractions", "d6-equation", "d7-slip-fix", "d8-help-me",
         "w1-pizza", "w2-change", "w3-recipe", "w4-speed", "w5-sale"]
TITLES = {
    "dK-add": "Kindergarten · Adding 3 + 4",
    "d1-subtract": "Grade 1 · Taking away: 15 − 8",
    "d2-carry": "Grade 2 · Adding with a carry",
    "d3-multiply": "Grade 3 · Multiplying 23 × 4",
    "d4-divide": "Grade 4 · Dividing 156 ÷ 12",
    "d5-fractions": "Grade 5 · Adding fractions",
    "d6-equation": "Grade 6 · Solving x − 7 = 15",
    "d7-slip-fix": "Grade 7 · A slip, a hint, fixed",
    "d8-help-me": "Grade 8 · Help me: the tutor writes the next step",
    "w1-pizza": "Real life · Sharing a pizza",
    "w2-change": "Real life · Change at the store",
    "w3-recipe": "Real life · Doubling a recipe",
    "w4-speed": "Real life · Miles per hour",
    "w5-sale": "Real life · 25% off",
}
FPS = 30
W, H = 2420, 1668
INK, PAPER, SUNNY = (0x14, 0x15, 0x1F), (0xFF, 0xFF, 0xFF), (0xFF, 0xD1, 0x2E)


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def card(text, path):
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    size = 112
    while True:
        f = ImageFont.truetype(FONT, size)
        try:
            f.set_variation_by_axes([48, 700, 100])
        except Exception:
            pass
        box = d.textbbox((0, 0), text, font=f)
        if box[2] - box[0] <= W - 360 or size <= 60:
            break
        size -= 6
    tw, th = box[2] - box[0], box[3] - box[1]
    x = (W - tw) / 2 - box[0]
    y = (H - th) / 2 - box[1] - 20
    d.text((x, y), text, font=f, fill=INK)
    # a flat Sunny bar under the line (the brand's Blocks)
    bw = 160
    d.rounded_rectangle([(W - bw) / 2, y + box[3] + 48, (W + bw) / 2, y + box[3] + 48 + 22], radius=11, fill=SUNNY)
    img.save(path)


def activity(path):
    """Per 0.1 s: how much of the picture changed since the frame before (0…255)."""
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as t:
        stats = t.name
    vf = ("fps=10,scale=1210:-2,format=gray,tblend=all_mode=difference,lutyuv=y='if(gt(val,24),255,0)',"
          f"signalstats,metadata=print:key=lavfi.signalstats.YAVG:file={stats}")
    run(["ffmpeg", "-v", "error", "-i", path, "-vf", vf, "-f", "null", "-"])
    out, t = [], None
    for line in open(stats):
        m = re.search(r"pts_time:([\d.]+)", line)
        if m:
            t = float(m.group(1))
        m = re.search(r"YAVG=([\d.]+)", line)
        if m and t is not None:
            out.append((t, float(m.group(1))))
    os.unlink(stats)
    return out


def keeps(act, length, keep_idle, min_idle=3.0, thresh=0.004):
    """The spans to keep: everything but the middle of each still stretch longer than `min_idle`."""
    still = []
    start = None
    for t, v in act:
        if v <= thresh:
            if start is None:
                start = t
        else:
            if start is not None and t - start > min_idle:
                still.append((start, t))
            start = None
    if start is not None and length - start > min_idle:
        still.append((start, length))
    spans, cur = [], 0.0
    for a, b in still:
        half = keep_idle / 2
        spans.append((cur, a + half))
        cur = b - half
    spans.append((cur, length))
    return [(a, b) for a, b in spans if b - a > 0.05], still


def main():
    out, sid, take = sys.argv[1:4]
    args = sys.argv[4:]
    opt = {"--keep-idle": 1.2, "--start-pad": 0.3, "--end-pad": 1.5, "--min-idle": 3.0}
    for k in list(opt):
        if k in args:
            opt[k] = float(args[args.index(k) + 1])
    raw = os.path.join(out, "raw", f"{sid}-{take}.mp4")
    t0 = float(open(os.path.join(out, "raw", f"{sid}-{take}.t0")).read())
    res = json.load(open(os.path.join(out, "results", take, f"{sid}.json")))
    start = max(0.0, res["startedAt"] - t0 + opt["--start-pad"])
    end = res["endedAt"] - t0 + opt["--end-pad"]
    work = tempfile.mkdtemp(prefix=f"demo-{sid}-")
    body = os.path.join(work, "body.mp4")
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.2f}", "-to", f"{end:.2f}", "-i", raw,
         "-vf", f"fps={FPS},transpose=2,scale={W}:{H},format=yuv420p", "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-an", body])
    length = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", body]).stdout.strip())
    spans, still = keeps(activity(body), length, opt["--keep-idle"], opt["--min-idle"])
    sel = "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b in spans)
    cut = os.path.join(work, "cut.mp4")
    run(["ffmpeg", "-v", "error", "-y", "-i", body, "-vf", f"select='{sel}',setpts=N/{FPS}/TB", "-r", str(FPS),
         "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-an", cut])
    png = os.path.join(work, "card.png")
    card(TITLES.get(sid, res.get("title", sid)), png)
    n = ORDER.index(sid) + 1 if sid in ORDER else 99
    final = os.path.join(out, f"{n:02d}-{sid}.mp4")
    run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-t", "2.2", "-framerate", str(FPS), "-i", png, "-i", cut,
         "-filter_complex", f"[0:v]format=yuv420p,setsar=1[c];[1:v]format=yuv420p,setsar=1[b];[c][b]concat=n=2:v=1:a=0[v]",
         "-map", "[v]", "-r", str(FPS), "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart", final])
    dur = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", final]).stdout.strip())
    frames = os.path.join(out, "frames", sid)
    os.makedirs(frames, exist_ok=True)
    for f in os.listdir(frames):
        os.unlink(os.path.join(frames, f))
    run(["ffmpeg", "-v", "error", "-y", "-i", final, "-vf", "fps=1,scale=1210:-2", os.path.join(frames, "%03d.jpg")])
    run(["ffmpeg", "-v", "error", "-y", "-sseof", "-0.2", "-i", final, "-frames:v", "1", "-vf", "scale=1210:-2", os.path.join(frames, "last.jpg")])
    cutaway = sum(b - a for a, b in still) - opt["--keep-idle"] * len(still)
    print(f"{final}: {dur:.1f} s (span {length:.1f} s, {len(still)} still stretches, {cutaway:.1f} s cut)")


if __name__ == "__main__":
    main()
