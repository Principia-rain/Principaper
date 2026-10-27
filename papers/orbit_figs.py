# -*- coding: utf-8 -*-
"""
orbit_figs.py —— 天体运动讲义配图（可复现）
图1: 有效势（牛顿 vs GR 修正）
图2: RK4 空间积分轨道（左：纯牛顿闭合椭圆；右：GR 修正进动玫瑰）

对账（三链，讲义 §11 的数值验证）:
  链1  RK4 空间积分 (x,y,vx,vy) 的近心点方位角差
  链2  Binet 一维方程 u''+u = α + βu² 的数值积分近心点间隔（独立实现）
  链3  一阶微扰公式 6πGM/(c²a(1-e²))   —— 注明: 仅 O(GM/c²a) 精确
链1 与链2 应在 1e-3 rad 内一致; 链3 的偏差 = 微扰截断(光速被压缩的代价)。

单位制: AU, yr, M_sun  =>  GM = 4π²
运行: python papers/orbit_figs.py   （输出到 papers/figs_orbit/）
"""
import sys, os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
sys.stdout.reconfigure(encoding="utf-8")

GM = 4 * np.pi**2            # AU^3 / yr^2
A, E = 1.0, 0.5              # 初值轨道: a=1 AU, e=0.5
L2 = GM * A * (1 - E**2)     # 比角动量平方 (单位质量)
TARGET = 0.35                # 目标视觉进动量 rad/圈 (一阶微扰目标值)
C2 = 6 * np.pi * GM / (TARGET * A * (1 - E**2))   # 压缩后的 c² (真实 c≈63241 AU/yr)
C_TRUE = 63241.0             # 真空光速, AU/yr
ALPHA = GM / L2              # Binet 常数项
BETA = 3 * GM / C2           # Binet GR 项系数 [AU]

OUT = os.path.join(os.path.dirname(__file__), "figs_orbit")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- 图1 有效势
r = np.linspace(0.35, 2.6, 900)
U_newton = -GM / r + L2 / (2 * r**2)
U_gr = U_newton - GM * L2 / (C2 * r**3)
E_energy = -GM / (2 * A)
r0 = L2 / GM

fig, ax = plt.subplots(figsize=(7.2, 4.6), dpi=150)
ax.plot(r, U_newton, lw=2, color="#1f6fd6", label=r"Newton: $-GM/r+\tilde L^2/2r^2$")
ax.plot(r, U_gr, lw=2, color="#d62728", ls="--",
        label=r"with GR corr.: extra $-GM\tilde L^2/c^2 r^3$")
ax.axhline(E_energy, lw=1, color="k", alpha=0.6)
ax.text(2.02, E_energy + 0.8, r"$E=-GM/2a$", fontsize=9)
ax.plot(r0, -GM/r0 + L2/(2*r0**2), "o", ms=7, color="#1f6fd6")
ax.annotate(r"circular $r_0=\tilde L^2/GM=0.75$ AU", (r0, -GM/r0+L2/(2*r0**2)),
            textcoords="offset points", xytext=(14, 14), fontsize=9, color="#1f6fd6")
ax.axvline(A*(1-E), lw=0.8, color="gray", alpha=0.5)
ax.axvline(A*(1+E), lw=0.8, color="gray", alpha=0.5)
ax.text(A*(1-E)-0.02, 20, "perihelion", rotation=90, fontsize=8, color="gray", ha="right")
ax.text(A*(1+E)+0.02, 20, "aphelion", rotation=90, fontsize=8, color="gray")
ax.set(xlim=(0.35, 2.6), ylim=(-45, 25), xlabel="r  [AU]",
       ylabel=r"$U_{\rm eff}$  [$(\rm AU/yr)^2$]")
ax.legend(loc="lower right", fontsize=9, framealpha=0.92)
ax.set_title("Effective potential (Newton vs GR), $a=1$ AU, $e=0.5$\n"
             f"c compressed: $c$ = {np.sqrt(C2):.0f} AU/yr vs true {C_TRUE:.0f} "
             f"({C_TRUE/np.sqrt(C2):.0f}x)", fontsize=10)
fig.tight_layout()
fig.savefig(os.path.join(OUT, "effective_potential.png"))
plt.close(fig)

# ---------------------------------------------------------------- 链1: RK4 空间积分
def accel(s, gr):
    rx, ry, vx, vy = s
    rn = np.hypot(rx, ry)
    a = -GM * np.array([rx, ry]) / rn**3
    if gr:
        Lz = rx*vy - ry*vx
        a += -3.0 * GM * Lz**2 / (C2 * rn**5) * np.array([rx, ry])
    return a

def rk4_orbit(years, dt, gr):
    n = int(round(years / dt))
    st = np.zeros((n + 1, 4))
    st[0] = [A*(1-E), 0.0, 0.0, np.sqrt(GM*(1+E)/(A*(1-E)))]   # 近心点出发, 逆时针
    for i in range(n):
        s = st[i]
        k1 = np.array([s[2], s[3], *accel(s, gr)])
        s2 = s + dt/2*k1; k2 = np.array([s2[2], s2[3], *accel(s2, gr)])
        s3 = s + dt/2*k2; k3 = np.array([s3[2], s3[3], *accel(s3, gr)])
        s4 = s + dt*k3;   k4 = np.array([s4[2], s4[3], *accel(s4, gr)])
        st[i+1] = s + dt/6*(k1 + 2*k2 + 2*k3 + k4)
    return st

def peri_passages(orb):
    """近心点: r 的局部极小, 抛物线插值; 返回 (时刻, 方位角累计值)"""
    r = np.hypot(orb[:, 0], orb[:, 1])
    t = np.arange(len(r)) * (1/4000)
    idx = [i for i in range(2, len(r)-2)
           if r[i] < r[i-1] and r[i] <= r[i+1] and r[i] < r[i-2] and r[i] <= r[i+2]]
    times, phis = [], []
    for i in idx:
        y0, y1, y2 = r[i-1], r[i], r[i+1]
        d = y0 - 2*y1 + y2
        shift = 0.5*(y0 - y2)/d if d != 0 else 0.0
        times.append(t[i] + shift/4000)
        phis.append(np.arctan2(orb[i, 1], orb[i, 0]))
    return np.array(times), np.unwrap(np.array(phis))

DT = 1.0 / 4000.0
N_ORBITS = 4
orb_n = rk4_orbit(N_ORBITS, DT, gr=False)
orb_g = rk4_orbit(N_ORBITS, DT, gr=True)
tp_n, ph_n = peri_passages(orb_n)
tp_g, ph_g = peri_passages(orb_g)
# arctan2 已 mod 2π; 进动量 < π 时相邻近心点方位角差本身就是进动量
prec_rk4 = np.mean(np.diff(ph_g))

# ---------------------------------------------------------------- 链2: Binet 一维积分
def binet_integrate(n_orbits, steps_per_rad=800):
    """u'' + u = ALPHA + BETA*u², 初值 u(0)=1/r_p, u'(0)=0; 返回近心点 φ 序列"""
    dphi = 1.0 / steps_per_rad
    phi_max = n_orbits * 2 * np.pi * 1.5   # 多留 50% 余量 (进动使每圈 >2π)
    n = int(phi_max / dphi)
    u, du = 1.0/(A*(1-E)), 0.0
    phis = [0.0]
    for i in range(n):
        f = lambda uu: ALPHA + BETA*uu*uu - uu
        k1u, k1d = du, f(u)
        k2u, k2d = du + dphi/2*k1d, f(u + dphi/2*k1u)
        k3u, k3d = du + dphi/2*k2d, f(u + dphi/2*k2u)
        k4u, k4d = du + dphi*k3d, f(u + dphi*k3u)
        u += dphi/6*(k1u + 2*k2u + 2*k3u + k4u)
        du += dphi/6*(k1d + 2*k2d + 2*k3d + k4d)
        phi = (i+1) * dphi
        # 近心点: u 极大 (u' 过零由正变负)
        if i > 0 and du_prev > 0 and du <= 0:
            frac = du_prev / (du_prev - du) if du_prev != du else 0
            phis.append((i + frac) * dphi)
        du_prev = du
        if phi > phi_max - dphi:
            break
    return np.array(phis)

phis_b = binet_integrate(N_ORBITS)
prec_binet = np.mean(np.diff(phis_b)) - 2*np.pi   # φ 未 mod, 相邻差 = 2π + 进动

# ---------------------------------------------------------------- 链3: 一阶微扰公式
prec_theory1 = 6*np.pi*GM / (C2 * A * (1 - E**2))

# ---------------------------------------------------------------- 对账打印
print("="*62)
print("Precession audit (rad per orbit), a=1 AU, e=0.5")
print(f"  c compressed to {np.sqrt(C2):.2f} AU/yr (true {C_TRUE:.0f}, "
      f"factor {C_TRUE/np.sqrt(C2):.0f})")
print("-"*62)
print(f"  chain1  RK4 space integral  : {prec_rk4:+.6f}")
print(f"  chain2  Binet 1-D integral  : {prec_binet:+.6f}")
print(f"  chain3  1st-order formula   : {prec_theory1:+.6f}   [O(σ) only]")
print("-"*62)
print(f"  |chain1 - chain2| = {abs(prec_rk4-prec_binet):.2e}  (integration/agreement)")
print(f"  chain3 vs chain1  = {(prec_theory1/prec_rk4-1)*100:+.1f}%  (perturbative truncation)")
print(f"  Newton closure check: |r_p(end)-r_p(0)| = "
      f"{abs(np.hypot(*orb_n[-1][:2]) - A*(1-E)):.2e} AU after {N_ORBITS} orbits")
E0 = 0.5*(orb_g[0,2]**2 + orb_g[0,3]**2) - GM/np.hypot(*orb_g[0][:2]) - GM*L2/(C2*np.hypot(*orb_g[0][:2])**3)
E1 = 0.5*(orb_g[-1,2]**2 + orb_g[-1,3]**2) - GM/np.hypot(*orb_g[-1][:2]) - GM*L2/(C2*np.hypot(*orb_g[-1][:2])**3)
print(f"  GR energy drift: {abs(E0-E1):.1e}   [E0 = {E0:.6f}, not -GM/2a: GR term incl.]")
print("="*62)

# ---------------------------------------------------------------- 图2 双 panel
fig, axes = plt.subplots(1, 2, figsize=(11, 5.2), dpi=150, sharey=True)
for ax, orb, ttl in [(axes[0], orb_n, "Newton (closed ellipse, A fixed)"),
                     (axes[1], orb_g, "Newton + GR corr. (rose orbit)")]:
    ax.plot(orb[:, 0], orb[:, 1], lw=1.1, color="#1f6fd6")
    ax.plot(0, 0, "*", ms=14, color="#ffb000")
    ax.plot(orb[0, 0], orb[0, 1], "o", ms=6, color="#d62728")
    ax.set_aspect("equal")
    ax.set_xlabel("x [AU]")
    ax.set_title(f"{ttl}\n{N_ORBITS} orbits, RK4, dt = T/4000", fontsize=10)
axes[0].set_ylabel("y [AU]")
fig.suptitle(f"Runge–Lenz vector: locked (left) vs precession "
             f"({np.degrees(prec_rk4):.0f} deg/orbit, c compressed "
             f"{C_TRUE/np.sqrt(C2):.0f}x)", fontsize=11)
fig.tight_layout()
fig.savefig(os.path.join(OUT, "rose_orbit.png"))
plt.close(fig)
print("figures ->", OUT)
