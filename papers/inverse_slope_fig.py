# -*- coding: utf-8 -*-
"""
inverse_slope_fig.py —— 生成讲义《反函数求导讲义》的配图

输出: figs_inverse/inverse_slope.png（相对本脚本所在目录）
依赖: numpy, matplotlib
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "Arial Unicode MS"]
plt.rcParams["axes.unicode_minus"] = False

fig, ax = plt.subplots(figsize=(7.2, 7.2))

xs = np.linspace(0, 3.25, 500)
ax.plot(xs, xs**2, color="#1f77b4", lw=2.2)                 # f(x) = x^2
ax.plot(xs, np.sqrt(xs), color="#d62728", lw=2.2)           # g(y) = sqrt(y)
ax.plot(xs, xs, color="#888888", lw=1.1, ls="--")           # y = x

x0, y0 = 1.5, 2.25   # A = (1.5, 2.25) 在 f 上；B = (2.25, 1.5) 是其镜像
d = 0.28

# A 处切线，斜率 f'(1.5) = 3
ax.plot([x0 - d, x0 + d], [y0 - 3*d, y0 + 3*d], color="#1f77b4", lw=1.8)
# B 处切线，斜率 g'(2.25) = 1/(2*sqrt(2.25)) = 1/3
ax.plot([y0 - d, y0 + d], [x0 - d/3, x0 + d/3], color="#d62728", lw=1.8)

ax.scatter([x0, y0], [y0, x0], s=28, c=["#1f77b4", "#d62728"], zorder=5)

# A -> (x0,x0) -> B 的直角三角形（横竖增量互换的可视化）
ax.plot([x0, x0], [x0, y0], color="#999999", lw=0.9, ls=":")
ax.plot([x0, y0], [x0, x0], color="#999999", lw=0.9, ls=":")

ax.text(0.30, 2.92, "f: y = x²", color="#1f77b4", fontsize=12)
ax.text(0.85, 0.28, "反函数 g: y = √x", color="#d62728", fontsize=12)
ax.text(2.28, 2.40, "y = x", color="#777777", fontsize=11, rotation=45)

ax.text(0.42, 2.42, "A(1.5, 2.25)\n此处 f 的斜率 = 3", color="#1f77b4", fontsize=10)
ax.text(2.02, 0.60, "B(2.25, 1.5)\n此处 g 的斜率 = 1/3", color="#d62728", fontsize=10)

ax.text(1.82, 3.06, "斜率 3", color="#1f77b4", fontsize=10)
ax.text(2.56, 1.72, "斜率 1/3", color="#d62728", fontsize=10)

ax.set_xlim(0, 3.35)
ax.set_ylim(0, 3.35)
ax.set_aspect("equal")
ax.grid(alpha=0.25)
ax.set_title("关于 y = x 镜像：横竖增量互换，斜率取倒数", fontsize=12)

out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "figs_inverse")
os.makedirs(out_dir, exist_ok=True)
out = os.path.join(out_dir, "inverse_slope.png")
fig.savefig(out, dpi=160, bbox_inches="tight")
print("saved:", out)
