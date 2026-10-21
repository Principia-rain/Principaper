# -*- coding: utf-8 -*-
"""诊断：float64 下的 logistic r=4，不变测度到底是 arcsine 还是别的？"""
import numpy as np

LN2 = np.log(2.0)

def run(r, norb=512, nit=40000, burn=5000, seed=1):
    rng = np.random.default_rng(seed)
    x = rng.random(norb)
    for _ in range(burn):
        x = r * x * (1.0 - x)
    acc = np.zeros(norb)
    hist = np.zeros(20, dtype=np.int64)
    for t in range(nit):
        acc += np.log(np.maximum(np.abs(1.0 - 2.0 * x), 1e-300))
        x = r * x * (1.0 - x)
        hist += np.bincount(np.minimum((x * 20).astype(np.int64), 19), minlength=20)
    lam_nats = np.log(r) + acc.mean() / nit          # 修正：除以步数
    frac0 = float(np.mean(x == 0.0))
    return lam_nats / LN2, hist / hist.sum(), frac0

for r in [3.9, 4.0]:
    lam, hist, frac0 = run(r)
    print(f"\n=== r = {r} ===")
    print(f"lambda = {lam:+.4f} bits   (orbit-derivative 公式)")
    print(f"末态 x==0 的轨道比例 = {frac0:.4f}")
    # 20 个等宽 bin 的理论密度：arcsine vs 均匀
    edges = np.linspace(0, 1, 21)
    arc = []
    for a, b in zip(edges[:-1], edges[1:]):
        # arcsine cdf = (2/pi) asin(sqrt(x))
        arc.append((2 / np.pi) * (np.arcsin(np.sqrt(b)) - np.arcsin(np.sqrt(a))))
    arc = np.array(arc) / 20.0     # bin 内概率
    uni = np.full(20, 0.05)
    print("bin  实测     arcsine  均匀")
    for i, (h, a) in enumerate(zip(hist, arc)):
        flag = " <--" if abs(h - a) > 0.01 and abs(h - 0.05) < 0.003 else ""
        print(f"{i:>3}  {hist[i]:.4f}  {a:.4f}   0.0500{flag}")
