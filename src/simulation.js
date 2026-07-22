// Core simulation for the "protector / nemesis" field game.
//
// The rules of the real game: everyone on an open field secretly picks one
// person to be their PROTECTOR and another to be their NEMESIS. The goal is to
// move so that your protector always stays on the straight line between you and
// your nemesis — i.e. your protector "screens" you from your nemesis. Because
// everyone is doing this at once (and the protectors/nemeses are themselves
// moving), the whole crowd churns around endlessly. That churn is the game.
//
// This module is deliberately framework-agnostic — plain JS, no React — so the
// physics is easy to reason about on its own. Units are pixels and seconds.

const TAU = Math.PI * 2

export const AGENT_RADIUS = 9

// Distinct, friendly dot colors. They just help you tell people apart and
// follow an individual by eye.
const COLORS = [
  '#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#f78c6b',
  '#8338ec', '#3a86ff', '#fb5607', '#2ec4b6', '#e07be0',
  '#84a98c', '#ff70a6',
]

function rand(min, max) { return min + Math.random() * (max - min) }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }
function lerp(a, b, t) { return a + (b - a) * t }

// Box–Muller gaussian, used for "misjudging" where people are.
function gauss(sigma) {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v)
}

export class Simulation {
  constructor(width, height) {
    this.width = width
    this.height = height
    this.agents = []
    this.params = {
      count: 20,
      speed: 70,        // px/s — a person's comfortable top speed
      humanFactor: 0.4, // 0 = crisp robot, 1 = laggy, imperfect human
    }
    this.reset()
  }

  setSize(w, h) { this.width = w; this.height = h }

  // The "human factor" knob drives several human imperfections at once.
  // At 0 everything is instant and exact; at 1 people react late, misjudge
  // positions, can't turn or stop on a dime, wobble, and occasionally stop
  // paying attention (which is how the rare real collisions happen).
  tunables() {
    const hf = clamp(this.params.humanFactor, 0, 1)
    return {
      hf,
      reactionInterval: lerp(0, 0.34, hf),   // s between "glances" at the field
      perceptionNoise: lerp(0, 24, hf * hf), // px error in judging positions
      accelTime: lerp(0.03, 0.7, hf),        // s to reach/shed full speed (inertia)
      turnRate: lerp(40, 2.6, hf),           // rad/s — how fast you can change heading
      jitter: lerp(0, 1.0, hf),              // random wobble in your path
      lapseRate: lerp(0, 0.22, hf),          // per-second chance of a not-looking lapse
    }
  }

  // (Re)build the crowd: scatter positions and hand out fresh assignments.
  reset() {
    const n = clamp(Math.round(this.params.count), 2, 120)
    const agents = []
    for (let i = 0; i < n; i++) {
      agents.push({
        id: i,
        x: rand(AGENT_RADIUS, this.width - AGENT_RADIUS),
        y: rand(AGENT_RADIUS, this.height - AGENT_RADIUS),
        vx: 0, vy: 0,
        heading: rand(0, TAU),
        color: COLORS[i % COLORS.length],
        protector: 0,
        nemesis: 0,
        lineOverride: null,   // null = follow the global toggle; else a forced bool
        perc: { px: 0, py: 0, nx: 0, ny: 0, timer: 0 }, // delayed/noisy view of P & N
        distract: 0,          // >0 while momentarily not avoiding others
        _nvx: 0, _nvy: 0,
      })
    }
    this.agents = agents
    this.assign()
    for (const a of agents) this.refreshPerception(a, 0)
  }

  // Re-scatter everyone but keep their current protector/nemesis choices.
  scatter() {
    for (const a of this.agents) {
      a.x = rand(AGENT_RADIUS, this.width - AGENT_RADIUS)
      a.y = rand(AGENT_RADIUS, this.height - AGENT_RADIUS)
      a.vx = a.vy = 0
      a.distract = 0
      this.refreshPerception(a, 0)
    }
  }

  // Hand everyone a new, distinct protector and nemesis.
  assign() {
    const n = this.agents.length
    for (let i = 0; i < n; i++) {
      const a = this.agents[i]
      if (n < 3) { a.protector = (i + 1) % n; a.nemesis = (i + 1) % n; continue }
      let p = i, q = i
      while (p === i) p = (Math.random() * n) | 0
      while (q === i || q === p) q = (Math.random() * n) | 0
      a.protector = p
      a.nemesis = q
    }
    for (const a of this.agents) this.refreshPerception(a, 0)
  }

  setCount(c) {
    this.params.count = clamp(Math.round(c), 2, 120)
    this.reset()
  }

  // Refresh an agent's remembered view of where its protector & nemesis are,
  // optionally with some misjudgement (noise) baked in.
  refreshPerception(a, noise) {
    const p = this.agents[a.protector]
    const n = this.agents[a.nemesis]
    a.perc.px = p.x + (noise ? gauss(noise) : 0)
    a.perc.py = p.y + (noise ? gauss(noise) : 0)
    a.perc.nx = n.x + (noise ? gauss(noise) : 0)
    a.perc.ny = n.y + (noise ? gauss(noise) : 0)
  }

  // Whether an agent's sightlines should be drawn, given the global toggle.
  linesVisible(a, globalOn) {
    return a.lineOverride === null ? globalOn : a.lineOverride
  }

  // Advance the whole simulation by dt seconds.
  step(dt) {
    dt = Math.min(dt, 0.05) // don't let a stalled tab teleport everyone
    const t = this.tunables()
    const maxSpeed = this.params.speed
    const maxAccel = maxSpeed / t.accelTime
    const agents = this.agents

    // --- 1. Perception & attention -----------------------------------------
    for (const a of agents) {
      a.perc.timer -= dt
      if (t.reactionInterval <= 1e-4 || a.perc.timer <= 0) {
        this.refreshPerception(a, t.perceptionNoise)
        a.perc.timer = t.reactionInterval
      }
      if (a.distract > 0) {
        a.distract -= dt
      } else if (t.lapseRate > 0 && Math.random() < t.lapseRate * dt) {
        // A momentary lapse: for a fraction of a second this person stops
        // watching out for others, which is how the occasional real bump happens.
        a.distract = rand(0.3, 0.9)
      }
    }

    // --- 2. Steering -------------------------------------------------------
    const sepRadius = AGENT_RADIUS * 4.2   // "personal space"
    const sepWeight = 1.7
    const margin = 70                      // soft edge starts this far in

    for (const a of agents) {
      // Seek: the goal is only a clear SIGHTLINE, not closeness. The set of
      // valid spots is the whole ray that starts behind the protector and
      // points away from the nemesis. We aim at the *nearest* point on that
      // ray, so a person already well-screened barely moves and is happy to
      // stay far from their protector.
      let sx = 0, sy = 0
      let ux = a.perc.px - a.perc.nx
      let uy = a.perc.py - a.perc.ny
      const ulen = Math.hypot(ux, uy)
      if (ulen > 1e-3) {
        ux /= ulen; uy /= ulen
        const tmin = AGENT_RADIUS * 1.5 // stay at least just behind the protector
        let tproj = (a.x - a.perc.px) * ux + (a.y - a.perc.py) * uy
        if (tproj < tmin) tproj = tmin
        const tx = a.perc.px + ux * tproj
        const ty = a.perc.py + uy * tproj
        const dx = tx - a.x, dy = ty - a.y
        const d = Math.hypot(dx, dy)
        if (d > 1e-3) {
          const desiredSpeed = maxSpeed * clamp(d / 45, 0, 1) // ease in near the target
          sx = dx / d * desiredSpeed
          sy = dy / d * desiredSpeed
        }
      }

      // Separation: keep out of each other's space and drift toward openings.
      // This is what turns "stay screened" into "stay screened AND in the
      // clear". It's switched off while an agent is having an attention lapse.
      let sepx = 0, sepy = 0
      if (a.distract <= 0) {
        for (const b of agents) {
          if (b === a) continue
          const dx = a.x - b.x, dy = a.y - b.y
          const d = Math.hypot(dx, dy)
          if (d > 0 && d < sepRadius) {
            const w = (sepRadius - d) / sepRadius
            sepx += dx / d * w
            sepy += dy / d * w
          }
        }
        sepx *= maxSpeed * sepWeight
        sepy *= maxSpeed * sepWeight
      }

      // Soft field edge — no fence, people just ease back toward the middle.
      let bx = 0, by = 0
      if (a.x < margin) bx += (margin - a.x) / margin
      if (a.x > this.width - margin) bx -= (a.x - (this.width - margin)) / margin
      if (a.y < margin) by += (margin - a.y) / margin
      if (a.y > this.height - margin) by -= (a.y - (this.height - margin)) / margin
      bx *= maxSpeed * 1.4
      by *= maxSpeed * 1.4

      // Desired velocity = all urges combined, capped at top speed.
      let dvx = sx + sepx + bx
      let dvy = sy + sepy + by
      const dv = Math.hypot(dvx, dvy)
      if (dv > maxSpeed) { dvx = dvx / dv * maxSpeed; dvy = dvy / dv * maxSpeed }

      // Inertia: you can only change your velocity so fast.
      let ax = dvx - a.vx, ay = dvy - a.vy
      const amag = Math.hypot(ax, ay)
      const maxDV = maxAccel * dt
      if (amag > maxDV) { ax = ax / amag * maxDV; ay = ay / amag * maxDV }
      let nvx = a.vx + ax
      let nvy = a.vy + ay

      // Turn-rate limit: you can't pivot instantly either.
      const spd = Math.hypot(nvx, nvy)
      const curSpeed = Math.hypot(a.vx, a.vy)
      if (curSpeed > 1e-3 && spd > 1e-3) {
        const curAng = Math.atan2(a.vy, a.vx)
        const newAng = Math.atan2(nvy, nvx)
        let dAng = newAng - curAng
        while (dAng > Math.PI) dAng -= TAU
        while (dAng < -Math.PI) dAng += TAU
        const maxTurn = t.turnRate * dt
        if (Math.abs(dAng) > maxTurn) {
          const ang = curAng + Math.sign(dAng) * maxTurn
          nvx = Math.cos(ang) * spd
          nvy = Math.sin(ang) * spd
        }
      }

      // Wobble/confusion: a little random veer in the path.
      if (t.jitter > 0 && spd > 1e-3) {
        const j = (Math.random() - 0.5) * t.jitter * dt * 6
        const c = Math.cos(j), s = Math.sin(j)
        const rx = nvx * c - nvy * s
        const ry = nvx * s + nvy * c
        nvx = rx; nvy = ry
      }

      a._nvx = nvx
      a._nvy = nvy
    }

    // --- 3. Integrate ------------------------------------------------------
    for (const a of agents) {
      a.vx = a._nvx
      a.vy = a._nvy
      a.x += a.vx * dt
      a.y += a.vy * dt
      if (Math.hypot(a.vx, a.vy) > 4) a.heading = Math.atan2(a.vy, a.vx)
    }

    // --- 4. Bodies can't overlap (and sometimes bump) ----------------------
    this.resolveCollisions()

    // --- 5. Hard field boundary (safety net behind the soft edge) ----------
    for (const a of agents) {
      a.x = clamp(a.x, AGENT_RADIUS, this.width - AGENT_RADIUS)
      a.y = clamp(a.y, AGENT_RADIUS, this.height - AGENT_RADIUS)
    }
  }

  // Push apart any overlapping bodies so no one ever passes through anyone.
  // When two people are actually closing on each other (which mostly happens
  // after an attention lapse) they get a little jostle out of it.
  resolveCollisions() {
    const R = AGENT_RADIUS * 2
    const agents = this.agents
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < agents.length; i++) {
        for (let j = i + 1; j < agents.length; j++) {
          const a = agents[i], b = agents[j]
          let dx = b.x - a.x, dy = b.y - a.y
          let d = Math.hypot(dx, dy)
          if (d === 0) { dx = rand(-1, 1); dy = rand(-1, 1); d = Math.hypot(dx, dy) }
          if (d < R) {
            const nx = dx / d, ny = dy / d
            const push = (R - d) / 2
            a.x -= nx * push; a.y -= ny * push
            b.x += nx * push; b.y += ny * push
            if (iter === 0) {
              const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
              if (vn < 0) { // they were moving together — bump them apart
                const imp = -vn * 0.6
                a.vx -= nx * imp; a.vy -= ny * imp
                b.vx += nx * imp; b.vy += ny * imp
              }
            }
          }
        }
      }
    }
  }

  // Nearest agent to a point, within a generous click radius. Used for the
  // per-person sightline toggle.
  pick(x, y) {
    let best = null
    let bestD = (AGENT_RADIUS + 8) ** 2
    for (const a of this.agents) {
      const dx = a.x - x, dy = a.y - y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD) { bestD = d2; best = a }
    }
    return best
  }
}
