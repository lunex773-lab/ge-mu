  function rayAabb(ro, rd, b) {
    let tmin = 0, tmax = Infinity;
    const lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1], o = [ro.x, ro.y, ro.z], d = [rd.x, rd.y, rd.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) return Infinity; }
      else { let t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a]; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return Infinity; }
    }
    return tmin > 0.05 ? tmin : Infinity;
  }
  function aabbTouch(ro, rd, b) {
    let tmin = -Infinity, tmax = Infinity;
    const lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1], o = [ro.x, ro.y, ro.z], d = [rd.x, rd.y, rd.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) return false; }
      else { let t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a]; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return false; }
    }
    return tmax >= Math.max(tmin, 0);
  }
