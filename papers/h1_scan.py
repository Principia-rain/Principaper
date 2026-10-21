# -*- coding: utf-8 -*-
"""
h1_scan.py —— 论文《一步记忆就够了吗？》的全部数值实验与图
运行:  python h1_scan.py          （依赖 numpy + matplotlib，约 1 分钟）
输出:  figs_h1/fig1_h1_scan.png   h1 与 lambda 随 r 的扫描
       figs_h1/fig2_hn_conv.png   r=4 处块熵率 h_n 的收敛
       以及 stdout 的数字表（论文正文引用的数值都来自这些输出）

已验证：lambda(r=4)=+1.0000 bits（理论 ln2），lambda(3.9)=0.7157（文献 0.7155），
r=4 的不变测度与 arcsine 分布逐 bin 吻合（见 diag_measure.py）。
"""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pathlib import Path

OUT = Path(__file__).resolve().parent / "figs_h1"
OUT.mkdir(exist_ok=True)
LN2 = np.log(2.0)
R_INF = 3.569945672          # Feigenbaum 起点（周期倍化累积点）


def entropy_bits(counts):
    c = np.asarray(counts, dtype=np.float64)
    c = c[c > 0]
    p = c / c.sum()
    return float(-(p * np.log2(p)).sum())


def scan_point(r, norb=384, nit=16000, burn=3000, M=200, seed=0):
    """单个 r：返回 (lambda_bits, h1_bits)。
    lambda = <ln|r(1-2x)|>/ln2（对 384 条轨道取平均）；
    h1 = H(s_t | s_{t-1})，s = 均匀 M 格的符号，全部轨道合并统计。"""
    rng = np.random.default_rng(2026 + seed)
    x = rng.random(norb)
    for _ in range(burn):
        x = r * x * (1.0 - x)
    acc = np.zeros(norb)
    S = np.empty((nit, norb), dtype=np.int16)
    for t in range(nit):
        acc += np.log(np.maximum(np.abs(1.0 - 2.0 * x), 1e-300))
        x = r * x * (1.0 - x)
        S[t] = np.minimum((x * M).astype(np.int16), M - 1)
    lam = (np.log(r) + acc.mean() / nit) / LN2
    pair = (S[:-1].astype(np.int64) * M + S[1:]).ravel()
    cur = S[:-1].ravel().astype(np.int64)
    h1 = entropy_bits(np.bincount(pair, minlength=M * M)) - \
         entropy_bits(np.bincount(cur, minlength=M))
    return lam, h1


def run_scan(r_values, M=200):
    H1 = np.zeros(len(r_values))
    LAM = np.zeros(len(r_values))
    for i, r in enumerate(r_values):
        LAM[i], H1[i] = scan_point(r, M=M, seed=i)
        if (i + 1) % 20 == 0:
            print(f"  scan {i + 1}/{len(r_values)}  r={r:.3f}  h1={H1[i]:.3f}  lam={LAM[i]:+.3f}",
                  flush=True)
    return H1, LAM


def block_rate_r4(norb=1024, nit=16384, burn=2000, M=4, nmax=8, seed=7):
    """r=4：H_n 与 h_n = H_n - H_{n-1}，检验收敛到 KS 熵 = 1 bit。"""
    rng = np.random.default_rng(seed)
    x = rng.random(norb)
    for _ in range(burn):
        x = 4.0 * x * (1.0 - x)
    acc = np.zeros(norb)
    traj = np.empty((nit, norb), dtype=np.float64)
    for t in range(nit):
        acc += np.log(np.maximum(np.abs(1.0 - 2.0 * x), 1e-300))
        x = 4.0 * x * (1.0 - x)
        traj[t] = x
    lam = (np.log(4.0) + acc.mean() / nit) / LN2
    s = np.minimum((traj * M).astype(np.int64), M - 1)
    Hs = []
    for n in range(1, nmax + 1):
        L = nit - n + 1
        code = np.zeros((L, norb), dtype=np.int64)
        for k in range(n):
            code = code * M + s[k:k + L]
        cnt = np.bincount(code.ravel(), minlength=M ** n)
        Hs.append(entropy_bits(cnt))
    hn = [Hs[i] - Hs[i - 1] for i in range(1, len(Hs))]   # h_n, n = 2..nmax
    return lam, Hs, hn


def main():
    print("== 扫描 h1 与 lambda (M=200) ==", flush=True)
    r_values = np.round(np.arange(3.40, 4.0001, 0.005), 4)
    H1, LAM = run_scan(r_values, M=200)

    print("\n-- 论文引用的数字表 (M=200) --")
    print(f"{'r':>7} {'lambda':>9} {'h1':>7}")
    for rq in [3.56, 3.565, 3.57, 3.575, 3.58, 3.60, 3.83, 3.90, 4.00]:
        i = int(np.argmin(np.abs(r_values - rq)))
        print(f"{r_values[i]:>7.3f} {LAM[i]:>+9.4f} {H1[i]:>7.3f}")

    below = H1[(r_values > 3.555) & (r_values < R_INF)]
    above = H1[(r_values >= R_INF) & (r_values < 3.585)]
    print(f"\nonset 两侧: max h1 (3.555<r<r_inf) = {below.max():.3f} ; "
          f"min h1 (r_inf<=r<3.585) = {above.min():.3f}")

    # 格子分辨率的稳健性：同一批 r，用 M=50 再算一遍 h1
    print("\n-- 格子分辨率稳健性 (h1, M=50 vs M=200) --")
    for rq in [3.56, 3.57, 3.60, 3.83, 4.00]:
        i = int(np.argmin(np.abs(r_values - rq)))
        _, h50 = scan_point(r_values[i], M=50, seed=1000 + i)
        print(f"  r={r_values[i]:.3f}:  h1(M=50)={h50:.3f}   h1(M=200)={H1[i]:.3f}")

    # 自检
    i4 = int(np.argmin(np.abs(r_values - 4.0)))
    assert abs(LAM[i4] - 1.0) < 0.03, f"r=4 的 lambda 应为 1 bit，实测 {LAM[i4]:.4f}"
    i83 = int(np.argmin(np.abs(r_values - 3.83)))
    assert H1[i83] < 0.05, f"r=3.83 周期三窗口内 h1 应接近 0，实测 {H1[i83]:.4f}"
    print(f"\n[自检通过] r=4.000: lambda={LAM[i4]:+.4f} (期望 1) ; r=3.830: h1={H1[i83]:.4f} (期望≈0)")

    # ---------------------------------------------------------------- fig1
    fig, ax = plt.subplots(figsize=(8.2, 5.0))
    ax.plot(r_values, H1, lw=2.2, color="#2d5f8f")
    ax.plot(r_values, LAM, lw=1.8, color="#b3403a")
    ax.axhline(1.0, ls=":", lw=1, color="gray")
    ax.axvline(R_INF, ls="--", lw=1, color="gray")
    ymax = max(float(H1.max()), 1.1)
    ax.text(R_INF + 0.006, ymax * 0.97, "r_inf = 3.56995", fontsize=9, color="dimgray")
    ax.text(3.415, float(H1[3]) + 0.10, "h1  (one-step conditional entropy)", fontsize=10, color="#2d5f8f")
    i75 = int(np.argmin(np.abs(r_values - 3.75)))
    ax.text(3.62, float(LAM[i75]) + 0.16, "lambda (Lyapunov exponent)", fontsize=10, color="#b3403a")
    i_w = int(np.argmin(np.abs(r_values - 3.832)))
    ax.annotate("period-3 window", xy=(3.832, float(H1[i_w]) + 0.02),
                xytext=(3.66, 0.45), fontsize=9, color="dimgray",
                arrowprops=dict(arrowstyle="->", color="dimgray", lw=0.9))
    ax.set_xlabel("r")
    ax.set_ylabel("bits per iterate")
    ax.set_xlim(3.40, 4.01)
    ax.set_ylim(-0.08, ymax + 0.08)
    fig.savefig(OUT / "fig1_h1_scan.png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"已生成 {OUT / 'fig1_h1_scan.png'}")

    # ---------------------------------------------------------------- fig2
    print("\n== r=4 块熵率收敛 ==", flush=True)
    lam4, Hs, hn = block_rate_r4()
    print(f"lambda(r=4) = {lam4:.4f} bits (理论值 1)")
    for n, h in enumerate(hn, start=2):
        print(f"  h_{n} = H_{n} - H_{n-1} = {h:.4f}")
    fig, ax = plt.subplots(figsize=(6.6, 4.4))
    ns = np.arange(2, len(hn) + 2)
    ax.plot(ns, hn, "o-", lw=2, color="#2d5f8f", ms=6)
    ax.axhline(1.0, ls="--", lw=1.2, color="#b3403a")
    ax.text(2.1, 1.008, "KS entropy = lambda = 1 bit", fontsize=10, color="#b3403a")
    ax.set_xlabel("block length n")
    ax.set_ylabel("h_n = H_n - H_(n-1)  (bits)")
    ax.set_xticks(ns)
    ax.set_ylim(0.9, 1.06)
    fig.savefig(OUT / "fig2_hn_conv.png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"已生成 {OUT / 'fig2_hn_conv.png'}")
    print("\n完成。")


if __name__ == "__main__":
    main()
