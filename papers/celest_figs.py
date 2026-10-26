# -*- coding: utf-8 -*-
"""celest_figs.py —— 生成《天体运动讲义》配图（numpy + matplotlib）
图1：有效势 V_eff(r) = -α/r + h²/2r²，束缚轨道的两个转折点与圆轨道极小。
图2：夸大的近点进动玫瑰线 r = p/[1 + e cos(γθ)]，γ<1 时不闭合。
输出：papers/figs_celest/
"""
import os
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'figs_celest')
os.makedirs(OUT, exist_ok=True)

# ---------------- 图 1：有效势 ----------------
alpha, h = 1.0, 1.2
r = np.linspace(0.55, 6.0, 900)
Veff = -alpha / r + h**2 / (2 * r**2)

r0 = h**2 / alpha                       # 圆轨道半径
Vmin = -alpha**2 / (2 * h**2)           # V_eff 极小
E = -0.25                               # 一条束缚能级
a = -alpha / (2 * E)
e = np.sqrt(1 + 2 * E * h**2 / alpha**2)
rp, ra = a * (1 - e), a * (1 + e)

fig, ax = plt.subplots(figsize=(7.2, 4.6), dpi=150)
ax.plot(r, Veff, lw=2.2, color='#1f4e9c',
        label=r'$V_{\mathrm{eff}}(r)=-\alpha/r+h^2/(2r^2)$')
ax.axhline(E, color='crimson', ls='--', lw=1.3, label=r'$E<0$: bound orbit')
ax.axhline(0, color='gray', lw=0.8, ls=':')
ax.plot([r0], [Vmin], 'ko', ms=5)
ax.annotate('circular orbit  $r_0=h^2/\\alpha$\n(stable minimum)',
            xy=(r0, Vmin), xytext=(r0 + 0.55, Vmin - 0.055),
            fontsize=9, color='k')
for x, name in [(rp, r'$r_p$'), (ra, r'$r_a$')]:
    Vx = -alpha / x + h**2 / (2 * x**2)
    ax.plot([x, x], [Vx, E], color='gray', ls=':', lw=1.1)
    ax.annotate(name, xy=(x, E), xytext=(x, E + 0.018),
                ha='center', fontsize=11, color='crimson')
ax.set_ylim(-0.52, 0.55)
ax.set_xlim(0.4, 6.0)
ax.set_xlabel('r')
ax.set_ylabel('V_eff')
ax.set_title('Effective potential of 1/r^2 gravity (alpha=1, h=1.2)')
ax.legend(loc='upper right', fontsize=9)
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'fig1_eff_potential.png'))
plt.close(fig)

# ---------------- 图 2：进动玫瑰线 ----------------
p, e2, gamma = 1.0, 0.55, 0.86          # γ=1 即闭合椭圆；γ<1 近点前移
theta = np.linspace(0, 3 * 2 * np.pi / gamma, 6000)
rr = p / (1 + e2 * np.cos(gamma * theta))

th_closed = np.linspace(0, 2 * np.pi, 500)
r_closed = p / (1 + e2 * np.cos(th_closed))

fig, ax = plt.subplots(figsize=(6.4, 6.4), dpi=150)
ax.plot(rr * np.cos(theta), rr * np.sin(theta), lw=1.1, color='#1f4e9c',
        label=r'precessing: $r=p/[1+e\cos(\gamma\theta)]$, $\gamma=0.86$')
ax.plot(r_closed * np.cos(th_closed), r_closed * np.sin(th_closed),
        lw=1.0, ls='--', color='gray',
        label=r'Newtonian $1/r^2$: $\gamma=1$, closed ellipse')
for k in range(3):                      # 标出相继近日点
    tk = 2 * np.pi * k / gamma
    rk = p / (1 + e2)
    ax.plot([rk * np.cos(tk)], [rk * np.sin(tk)], 'o', color='crimson', ms=6)
ax.annotate('perihelion advances\nevery orbit', xy=(rk, 0), xytext=(1.15, 0.75),
            fontsize=9, color='crimson',
            arrowprops=dict(arrowstyle='->', color='crimson', lw=1))
ax.set_aspect('equal')
ax.set_xlim(-2.6, 2.6)
ax.set_ylim(-2.6, 2.6)
ax.set_xlabel('x')
ax.set_ylabel('y')
ax.set_title('Exaggerated apsidal precession (e = 0.55)')
ax.legend(loc='upper left', fontsize=8.5)
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'fig2_rosette.png'))
plt.close(fig)

print('saved:', os.listdir(OUT))
