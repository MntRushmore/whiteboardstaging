#!/usr/bin/env python3
"""Edit one picture-tutor take (scripts/ios-demo-videos.sh pictures) into a finished 1920 × 1080 clip:
the iPad on a plain flat background, the kid's writing sped up, still waits cut down, the tutor's
picture arriving at (nearly) real speed, gentle zoom-ins on the writing and on the picture, and a
one-line title card first (Ink on Paper, Bricolage Grotesque, a Sunny bar). No gradients.

    demo-picture-cut.py <out dir> <clip id> <take> [--title "…"]

Reads <out>/raw/<id>-<take>.mp4 (+ .t0), <out>/results/<take>/<id>.json (the player's marks) and
<out>/scripts/<id>.json (where the kid wrote). Writes <out>/<id>.mp4 and <out>/frames/<id>/ (1 fps +
the last frame, for review)."""
import json, math, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, "ios/Packages/AgathonDesign/Sources/AgathonDesign/Resources/Fonts/BricolageGrotesque-Variable.ttf")
OW, OH, FPS = 1920, 1080, 30
SW, SH = 2420, 1668  # the iPad's screen, landscape, in the recording's pixels
INK, PAPER, SUNNY = (0x14, 0x15, 0x1F), (0xFF, 0xFF, 0xFF), (0xFF, 0xD1, 0x2E)
BG = (0xEC, 0xE9, 0xE3)  # a calm, flat stone
BASE = 0.58  # the iPad's scale on the stage at rest (1404 × 967)


def sh(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def ease(u):
    u = min(1, max(0, u))
    return u * u * (3 - 2 * u)


def title_card(text):
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (OW, OH), PAPER)
    d = ImageDraw.Draw(img)
    size = 84
    while True:
        f = ImageFont.truetype(FONT, size)
        try:
            f.set_variation_by_axes([48, 700, 100])
        except Exception:
            pass
        box = d.textbbox((0, 0), text, font=f)
        if box[2] - box[0] <= OW - 280 or size <= 48:
            break
        size -= 4
    x = (OW - (box[2] - box[0])) / 2 - box[0]
    y = (OH - (box[3] - box[1])) / 2 - box[1] - 16
    d.text((x, y), text, font=f, fill=INK)
    d.rounded_rectangle([(OW - 120) / 2, y + box[3] + 38, (OW + 120) / 2, y + box[3] + 54], radius=8, fill=SUNNY)
    return img


def page_rect(raw, at):
    """The board's white page in the screen (px): found in one frame, the page being pure white."""
    from PIL import Image
    png = raw + ".page.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{at:.2f}", "-i", raw, "-frames:v", "1", "-vf", "transpose=2", png], check=True)
    im = Image.open(png).convert("L")
    w, h = im.size
    px = im.load()
    row = h // 2
    xs = [x for x in range(w) if px[x, row] >= 254]
    col = w // 2
    ys = [y for y in range(h) if px[col, y] >= 254]
    if not xs or not ys:
        return (180, 240, 2060, 1150)
    return (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))


def main():
    out, cid, take = sys.argv[1:4]
    title = None
    if "--title" in sys.argv:
        title = sys.argv[sys.argv.index("--title") + 1]
    raw = os.path.join(out, "raw", f"{cid}-{take}.mp4")
    t0 = float(open(os.path.join(out, "raw", f"{cid}-{take}.t0")).read())
    res = json.load(open(os.path.join(out, "results", take, f"{cid}.json")))
    script = json.load(open(os.path.join(out, "scripts", f"{cid}.json")))
    title = title or script.get("title") or cid
    M = {k: v - t0 for k, v in res["marks"].items()}
    end = res["endedAt"] - t0
    page = page_rect(raw, M.get("written", M["write"] + 3))

    def screen_of(lx, ly):
        return (page[0] + lx / 1600 * page[2], page[1] + ly / 900 * page[3])

    # where each write step's ink is, on the screen, in order
    boxes = []
    for st in script["steps"]:
        if "write" in st:
            pts = [p for s in st["write"] for p in s]
            x0, y0 = screen_of(min(p[0] for p in pts), min(p[1] for p in pts))
            x1, y1 = screen_of(max(p[0] for p in pts), max(p[1] for p in pts))
            boxes.append((x0, y0, x1, y1))
    problem = boxes[0]
    nprob = sum(1 for st in script["steps"][: next(i for i, st in enumerate(script["steps"]) if st.get("mark") == "written")] if "write" in st)
    for b in boxes[1:nprob]:
        problem = (min(problem[0], b[0]), min(problem[1], b[1]), max(problem[2], b[2]), max(problem[3], b[3]))
    pic = res.get("pictureView")
    picture = None
    if pic:
        # view points → the recording's pixels (2×)
        picture = (pic[0] * 2, pic[1] * 2, (pic[0] + pic[2]) * 2, (pic[1] + pic[3]) * 2)

    # MARK: the timeline: (source start, source end, speed)
    start = max(0.0, M["write"] - 0.8)
    spans = []

    def add(a, b, speed):
        if b > a:
            spans.append((a, b, speed))

    add(start, M["written"], 1.8)
    add(M["written"], M["drawNow"], 1.0)
    add(M["drawNow"], M["ghost"], 1.3)
    add(M["ghost"], M["accept"] + 1.2, 1.0)
    add(M["accept"] + 1.2, M.get("answer", M["accept"] + 1.2), 1.4)
    if "answer" in M:
        add(M["answer"], M["answered"], 1.8)
        add(M["answered"], M.get("tick", end - 2.5), 1.5)
        add(M.get("tick", end - 2.5), min(end, M.get("tick", end) + 2.6), 1.0)
    # still waits over 3 s inside a span are cut to ~1 s by the speed there (the activity map)
    act = activity(raw, start, end)

    def still_at(t):
        i = int((t - start) * 10)
        return 0 <= i < len(act) and act[i]

    # output frames → source times
    times = []
    for a, b, speed in spans:
        t = a
        run = 0.0
        while t < b:
            # inside a long still stretch: hurry through it
            if still_at(t):
                run += 1 / FPS * speed
            else:
                run = 0
            fast = 6.0 if run > 1.0 else 1.0
            times.append(t)
            t += speed * fast / FPS

    # MARK: the camera: (source time, centre x, centre y, zoom) keys, eased between
    full = (SW / 2, SH / 2, 1.0)

    def fit(box, pad=1.35, cap=1.75):
        x0, y0, x1, y1 = box
        w, h = (x1 - x0) * pad, (y1 - y0) * pad
        z = min(cap, max(1.0, min(SW / max(w, 1), SH / max(h, 1)) * 0.92))
        return ((x0 + x1) / 2, (y0 + y1) / 2, z)

    keys = [(start, full), (M["write"] + 0.4, fit(problem, cap=1.45)), (M["written"] + 0.2, fit(problem, cap=1.45)),
            (M["drawNow"] + 0.6, full)]
    if picture:
        keys += [(M["ghost"] - 1.5, full), (M["ghost"] + 0.6, fit(picture, pad=1.25, cap=1.6)), (M["accept"] + 1.0, fit(picture, pad=1.25, cap=1.6))]
    if "answer" in M and len(boxes) > 1:
        ans = boxes[-1]
        for b in boxes[nprob:]:
            ans = (min(ans[0], b[0]), min(ans[1], b[1]), max(ans[2], b[2]), max(ans[3], b[3]))
        both = ans
        if picture:
            both = (min(ans[0], picture[0]), min(ans[1], picture[1]), max(ans[2], picture[2]), max(ans[3], picture[3]))
        keys += [(M["answer"] - 0.2, fit(both, pad=1.15, cap=1.4)), (M.get("tick", end) + 0.4, fit(both, pad=1.15, cap=1.4)),
                 (M.get("tick", end) + 1.6, full)]
    keys.sort(key=lambda k: k[0])

    def camera(t):
        if t <= keys[0][0]:
            return keys[0][1]
        for (ta, a), (tb, b) in zip(keys, keys[1:]):
            if t <= tb:
                # move over at most 1.1 s of source, at the end of the gap (hold, then glide)
                glide = min(1.1, tb - ta)
                u = ease((t - (tb - glide)) / glide) if glide > 0 else 1
                return tuple(a[i] + (b[i] - a[i]) * u for i in range(3))
        return keys[-1][1]

    # MARK: render
    from PIL import Image, ImageDraw
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-to", f"{times[-1] + 0.2:.3f}", "-i", raw,
                            "-vf", f"fps={FPS},transpose=2,scale={SW}:{SH}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                           stdout=subprocess.PIPE)
    final = os.path.join(out, f"{cid}.mp4")
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{OW}x{OH}", "-r", str(FPS), "-i", "-",
                            "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", final],
                           stdin=subprocess.PIPE)
    card = title_card(title)
    for _ in range(int(2.2 * FPS)):
        enc.stdin.write(card.tobytes())
    n = SW * SH * 3
    src_i = -1
    frame = None
    for t in times:
        want = int(round((t - start) * FPS))
        while src_i < want:
            buf = dec.stdout.read(n)
            if len(buf) < n:
                break
            frame = buf
            src_i += 1
        if frame is None:
            continue
        cx, cy, z = camera(t)
        s = BASE * z
        # the camera's centre (screen px) at the stage's centre, the device kept on the stage
        ox, oy = OW / 2 - cx * s, OH / 2 - cy * s
        for o, size, full_ in ((0, SW * s, OW), (1, SH * s, OH)):
            lo, hi = min(0, full_ - size) - 30, max(0, full_ - size) + 30
            if o == 0:
                ox = min(max(ox, lo), hi)
            else:
                oy = min(max(oy, lo), hi)
        img = Image.new("RGB", (OW, OH), BG)
        d = ImageDraw.Draw(img)
        bez = 22 * s / BASE * 0.58
        d.rounded_rectangle([ox - bez, oy - bez, ox + SW * s + bez, oy + SH * s + bez], radius=56 * s / BASE * 0.58 + bez, fill=INK)
        # the visible part of the screen
        vx0, vy0 = max(0, ox), max(0, oy)
        vx1, vy1 = min(OW, ox + SW * s), min(OH, oy + SH * s)
        sx0, sy0 = (vx0 - ox) / s, (vy0 - oy) / s
        sx1, sy1 = (vx1 - ox) / s, (vy1 - oy) / s
        src = Image.frombuffer("RGB", (SW, SH), frame, "raw", "RGB", 0, 1)
        part = src.resize((int(round(vx1 - vx0)), int(round(vy1 - vy0))), Image.LANCZOS if z > 1.05 else Image.BILINEAR,
                          box=(sx0, sy0, sx1, sy1))
        mask = Image.new("L", part.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle([ox - vx0, oy - vy0, ox - vx0 + SW * s, oy - vy0 + SH * s], radius=34 * s / BASE * 0.58 * 1.0, fill=255)
        img.paste(part, (int(round(vx0)), int(round(vy0))), mask)
        enc.stdin.write(img.tobytes())
    enc.stdin.close()
    enc.wait()
    dec.kill()
    dur = float(sh(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", final]).strip())
    frames = os.path.join(out, "frames", cid)
    os.makedirs(frames, exist_ok=True)
    for f in os.listdir(frames):
        os.unlink(os.path.join(frames, f))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", final, "-vf", "fps=1,scale=960:-2", os.path.join(frames, "%03d.jpg")], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-sseof", "-0.2", "-i", final, "-frames:v", "1", os.path.join(frames, "last.png")], check=True)
    print(f"{final}: {dur:.1f} s; page {page}; picture {picture}; marks {', '.join(f'{k} {v:.1f}' for k, v in sorted(M.items(), key=lambda x: x[1]))}")


def activity(raw, start, end):
    """Per 0.1 s of source from `start`: True when nothing on screen changed (a still)."""
    import re, tempfile
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as t:
        stats = t.name
    vf = ("fps=10,transpose=2,scale=1210:-2,format=gray,tblend=all_mode=difference,lutyuv=y='if(gt(val,24),255,0)',"
          f"signalstats,metadata=print:key=lavfi.signalstats.YAVG:file={stats}")
    subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{start:.2f}", "-to", f"{end:.2f}", "-i", raw, "-vf", vf, "-f", "null", "-"], check=True)
    vals = [float(m.group(1)) for m in re.finditer(r"YAVG=([\d.]+)", open(stats).read())]
    os.unlink(stats)
    # a still: this tenth and the 1.5 s around it all quiet
    quiet = [v <= 0.004 for v in vals]
    out = []
    for i in range(len(quiet)):
        a, b = max(0, i - 15), min(len(quiet), i + 15)
        out.append(all(quiet[a:b]))
    return out


if __name__ == "__main__":
    main()
