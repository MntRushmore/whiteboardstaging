#!/usr/bin/env python3
"""The demo reel: finished clips in order (each opens on its own title card), then an Agathon end card.

    demo-reel.py <out.mp4> <clip.mp4>…
"""
import os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, "ios/Packages/AgathonDesign/Sources/AgathonDesign/Resources/Fonts/BricolageGrotesque-Variable.ttf")
LOGO = os.path.join(ROOT, "ios/Agathon/Resources/Assets.xcassets/Logo.imageset/Logo.png")
INK, PAPER, MUTED = (0x14, 0x15, 0x1F), (0xFF, 0xFF, 0xFF), (0x5C, 0x5E, 0x6B)


def end_card(path):
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (1920, 1080), PAPER)
    logo = Image.open(LOGO).convert("RGBA").resize((260, 260))
    img.paste(logo, ((1920 - 260) // 2, 300), logo)
    d = ImageDraw.Draw(img)
    for text, size, weight, y, color in (("Agathon", 110, 800, 590, INK), ("agathon.app", 44, 500, 740, MUTED)):
        f = ImageFont.truetype(FONT, size)
        f.set_variation_by_axes([48 if size < 60 else 96, weight, 100])
        b = d.textbbox((0, 0), text, font=f)
        d.text(((1920 - (b[2] - b[0])) / 2 - b[0], y), text, font=f, fill=color)
    img.save(path)


def main():
    out, clips = sys.argv[1], sys.argv[2:]
    work = tempfile.mkdtemp(prefix="reel-")
    card = os.path.join(work, "end.png")
    end_card(card)
    inputs, chains = [], []
    for i, c in enumerate(clips):
        inputs += ["-i", c]
        chains.append(f"[{i}:v]fps=30,scale=1920:1080,setsar=1,format=yuv420p[v{i}]")
    n = len(clips)
    inputs += ["-loop", "1", "-t", "3", "-framerate", "30", "-i", card]
    chains.append(f"[{n}:v]fps=30,scale=1920:1080,setsar=1,format=yuv420p[v{n}]")
    graph = ";".join(chains) + ";" + "".join(f"[v{i}]" for i in range(n + 1)) + f"concat=n={n + 1}:v=1:a=0[v]"
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-preset", "slow",
                    "-crf", "21", "-maxrate", "3M", "-bufsize", "6M", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", out], check=True)
    print(out)


if __name__ == "__main__":
    main()
