"""生成调酒师工作台的本地提示音（不依赖第三方素材与网络）。

输出：assets/sounds/order-alert.wav
规格：22050 Hz / 16-bit / 单声道，约 0.45 秒的双音提示（A5 → D6），
带短促起音与自然衰减，音量控制在 -12 dBFS 左右，避免在店里突然吓人。

运行：python scripts/gen_sound.py
"""
import math
import os
import struct
import wave

SAMPLE_RATE = 22050
NOTES = [
    (880.00, 0.16),  # A5
    (1174.66, 0.22),  # D6
]
GAP = 0.05
AMP = 0.25  # 约 -12 dBFS


def envelope(index, total, attack=0.008, release=0.10):
    t = index / SAMPLE_RATE
    total_s = total / SAMPLE_RATE
    if t < attack:
        return t / attack
    if t > total_s - release:
        return max(0.0, (total_s - t) / release)
    return 1.0


def render():
    frames = bytearray()
    gap_frames = int(GAP * SAMPLE_RATE)

    for freq, duration in NOTES:
        total = int(duration * SAMPLE_RATE)
        for i in range(total):
            env = envelope(i, total)
            # 基频 + 一点二次谐波，比纯正弦更像「吧台铃」
            value = math.sin(2 * math.pi * freq * i / SAMPLE_RATE)
            value += 0.18 * math.sin(4 * math.pi * freq * i / SAMPLE_RATE)
            sample = int(max(-1.0, min(1.0, value * env * AMP)) * 32767)
            frames += struct.pack('<h', sample)
        frames += b'\x00\x00' * gap_frames

    return bytes(frames)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, 'assets', 'sounds')
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, 'order-alert.wav')

    data = render()
    with wave.open(out_path, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(data)

    print(f'wrote {out_path} ({os.path.getsize(out_path)} bytes)')


if __name__ == '__main__':
    main()