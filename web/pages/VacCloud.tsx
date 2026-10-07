import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchJson } from "../http";
import { useI18n } from "../i18n";

type CloudNode = {
  id: string;
  name: string;
  avatar: string | null;
  vacCount: number;
  vacFriends: number;
  group: number;
  lastBanDate: string | null;
  daysSinceLastBan: number | null;
};

type CloudLink = { source: string; target: string };
type CloudGroup = { id: number; size: number };

type SimNode = CloudNode & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  img: HTMLImageElement | null;
  color: string;
};

type HoverInfo = {
  node: SimNode;
  sx: number;
  sy: number;
};

const LIMIT_VALUES = [50, 100, 150, 250, 500, 1000, 0] as const;

const GROUP_COLORS = [
  "#f85149",
  "#58a6ff",
  "#d29922",
  "#3fb950",
  "#a371f7",
  "#ff7b72",
  "#79c0ff",
  "#ffa657",
  "#56d364",
  "#d2a8ff",
  "#ff9bce",
  "#39d353",
];

function groupColor(g: number) {
  return GROUP_COLORS[g % GROUP_COLORS.length];
}

function radiusForFriends(vacFriends: number) {
  // Bigger = more VAC friends in the cloud
  return 9 + Math.min(28, Math.sqrt(Math.max(0, vacFriends) + 1) * 5.5);
}

export default function VacCloudPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState<number>(150);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ nodes: 0, links: 0, groups: 0 });
  const [groupMeta, setGroupMeta] = useState<CloudGroup[]>([]);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [search, setSearch] = useState("");

  const simRef = useRef<{
    nodes: SimNode[];
    links: { a: SimNode; b: SimNode }[];
    groupCenters: Map<number, { x: number; y: number }>;
    alpha: number;
    scale: number;
    ox: number;
    oy: number;
    drag: SimNode | null;
    pan: boolean;
    lastX: number;
    lastY: number;
    downX: number;
    downY: number;
    downNode: SimNode | null;
    focusId: string | null;
  }>({
    nodes: [],
    links: [],
    groupCenters: new Map(),
    alpha: 1,
    scale: 1,
    ox: 0,
    oy: 0,
    drag: null,
    pan: false,
    lastX: 0,
    lastY: 0,
    downX: 0,
    downY: 0,
    downNode: null,
    focusId: null,
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHover(null);
    fetchJson<{
      nodes: CloudNode[];
      links: CloudLink[];
      groups: CloudGroup[];
    }>(`/api/vac-cloud?limit=${limit}`)
      .then((data) => {
        if (cancelled) return;
        const w = wrapRef.current?.clientWidth || 900;
        const h = wrapRef.current?.clientHeight || 560;
        const cx = w / 2;
        const cy = h / 2;

        const groupIds = [
          ...new Set(data.nodes.map((n) => n.group ?? 0)),
        ].sort((a, b) => a - b);
        const groupCenters = new Map<number, { x: number; y: number }>();
        const ring = Math.min(w, h) * 0.32;
        groupIds.forEach((g, i) => {
          if (groupIds.length === 1) {
            groupCenters.set(g, { x: cx, y: cy });
            return;
          }
          const ang = (i / groupIds.length) * Math.PI * 2 - Math.PI / 2;
          groupCenters.set(g, {
            x: cx + Math.cos(ang) * ring,
            y: cy + Math.sin(ang) * ring,
          });
        });

        const byId = new Map<string, SimNode>();
        const nodes: SimNode[] = data.nodes.map((n) => {
          const g = n.group ?? 0;
          const center = groupCenters.get(g) ?? { x: cx, y: cy };
          const jitter = 20 + Math.random() * 50;
          const ang = Math.random() * Math.PI * 2;
          const node: SimNode = {
            ...n,
            vacFriends: n.vacFriends ?? 0,
            group: g,
            x: center.x + Math.cos(ang) * jitter,
            y: center.y + Math.sin(ang) * jitter,
            vx: 0,
            vy: 0,
            r: radiusForFriends(n.vacFriends ?? 0),
            img: null,
            color: groupColor(g),
          };
          if (n.avatar) {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = n.avatar;
            img.onload = () => {
              node.img = img;
            };
          }
          byId.set(n.id, node);
          return node;
        });

        const links = data.links
          .map((l) => {
            const a = byId.get(l.source);
            const b = byId.get(l.target);
            return a && b ? { a, b } : null;
          })
          .filter(Boolean) as { a: SimNode; b: SimNode }[];

        const s = simRef.current;
        s.nodes = nodes;
        s.links = links;
        s.groupCenters = groupCenters;
        s.alpha = 1;
        s.scale = 1;
        s.ox = 0;
        s.oy = 0;
        s.focusId = null;
        setStats({
          nodes: nodes.length,
          links: links.length,
          groups: groupIds.length,
        });
        setGroupMeta(data.groups ?? []);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [limit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap!.clientWidth;
      const h = Math.max(480, wrap!.clientHeight);
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    function screenToWorld(sx: number, sy: number) {
      const s = simRef.current;
      return {
        x: (sx - s.ox) / s.scale,
        y: (sy - s.oy) / s.scale,
      };
    }

    function hitTest(sx: number, sy: number): SimNode | null {
      const { x, y } = screenToWorld(sx, sy);
      const s = simRef.current;
      let best: SimNode | null = null;
      let bestD = Infinity;
      for (const n of s.nodes) {
        const d = Math.hypot(n.x - x, n.y - y);
        if (d <= n.r + 6 && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    }

    function tick() {
      if (!running) return;
      const s = simRef.current;
      const w = wrap!.clientWidth;
      const h = Math.max(480, wrap!.clientHeight);

      if (s.alpha > 0.02 && !s.drag) {
        const nodes = s.nodes;
        const n = nodes.length;

        // Soft global center
        const gcx = w / 2;
        const gcy = h / 2;

        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const a = nodes[i];
            const b = nodes[j];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let dist2 = dx * dx + dy * dy || 0.01;
            const dist = Math.sqrt(dist2);
            const minDist = a.r + b.r + (a.group === b.group ? 6 : 18);
            // Stronger repulsion between different groups
            const strength = a.group === b.group ? 700 : 1600;
            let f = (strength * s.alpha) / dist2;
            if (dist < minDist) f += ((minDist - dist) * 0.1) / dist;
            dx = (dx / dist) * f;
            dy = (dy / dist) * f;
            a.vx -= dx;
            a.vy -= dy;
            b.vx += dx;
            b.vy += dy;
          }
        }

        for (const { a, b } of s.links) {
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const same = a.group === b.group;
          const target = (same ? 55 : 95) + (a.r + b.r) * 0.45;
          const k = same ? 0.035 : 0.012;
          const f = ((dist - target) * k * s.alpha) / dist;
          dx *= f;
          dy *= f;
          a.vx += dx;
          a.vy += dy;
          b.vx -= dx;
          b.vy -= dy;
        }

        // Pull each node toward its group centroid
        for (const node of nodes) {
          const c = s.groupCenters.get(node.group) ?? { x: gcx, y: gcy };
          node.vx += (c.x - node.x) * 0.012 * s.alpha;
          node.vy += (c.y - node.y) * 0.012 * s.alpha;
          node.vx += (gcx - node.x) * 0.0015 * s.alpha;
          node.vy += (gcy - node.y) * 0.0015 * s.alpha;
          node.vx *= 0.85;
          node.vy *= 0.85;
          node.x += node.vx;
          node.y += node.vy;
        }

        // Update group centers as average of members (keeps clusters cohesive)
        const acc = new Map<number, { x: number; y: number; n: number }>();
        for (const node of nodes) {
          const cur = acc.get(node.group) ?? { x: 0, y: 0, n: 0 };
          cur.x += node.x;
          cur.y += node.y;
          cur.n++;
          acc.set(node.group, cur);
        }
        for (const [g, v] of acc) {
          if (v.n > 0) {
            const prev = s.groupCenters.get(g) ?? { x: gcx, y: gcy };
            s.groupCenters.set(g, {
              x: prev.x * 0.7 + (v.x / v.n) * 0.3,
              y: prev.y * 0.7 + (v.y / v.n) * 0.3,
            });
          }
        }

        s.alpha *= 0.988;
      } else if (s.drag) {
        s.alpha = Math.max(s.alpha, 0.08);
      }

      ctx!.clearRect(0, 0, w, h);
      ctx!.fillStyle = "rgba(13, 17, 23, 0.35)";
      ctx!.fillRect(0, 0, w, h);

      ctx!.save();
      ctx!.translate(s.ox, s.oy);
      ctx!.scale(s.scale, s.scale);

      // Soft group halos
      for (const [g, c] of s.groupCenters) {
        const members = s.nodes.filter((n) => n.group === g);
        if (!members.length) continue;
        const spread =
          40 +
          members.reduce(
            (m, n) => Math.max(m, Math.hypot(n.x - c.x, n.y - c.y) + n.r),
            0,
          );
        const col = groupColor(g);
        const grd = ctx!.createRadialGradient(c.x, c.y, 8, c.x, c.y, spread);
        grd.addColorStop(0, `${col}33`);
        grd.addColorStop(1, `${col}00`);
        ctx!.fillStyle = grd;
        ctx!.beginPath();
        ctx!.arc(c.x, c.y, spread, 0, Math.PI * 2);
        ctx!.fill();
      }

      for (const { a, b } of s.links) {
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.strokeStyle =
          a.group === b.group
            ? `${a.color}66`
            : "rgba(139, 148, 158, 0.18)";
        ctx!.lineWidth = (a.group === b.group ? 1.4 : 0.8) / s.scale;
        ctx!.stroke();
      }

      for (const node of s.nodes) {
        const focused = s.focusId && node.id === s.focusId;
        const dimmed = s.focusId && !focused;
        ctx!.globalAlpha = dimmed ? 0.18 : 1;

        ctx!.beginPath();
        ctx!.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        if (node.img && node.img.complete) {
          ctx!.save();
          ctx!.clip();
          ctx!.drawImage(
            node.img,
            node.x - node.r,
            node.y - node.r,
            node.r * 2,
            node.r * 2,
          );
          ctx!.restore();
        } else {
          ctx!.fillStyle = "#3d1515";
          ctx!.fill();
        }
        ctx!.lineWidth = (focused ? 3.5 : 2) / s.scale;
        ctx!.strokeStyle = focused ? "#fff" : node.color;
        ctx!.stroke();

        if (s.scale > 0.65 || focused || node.vacFriends >= 3) {
          ctx!.fillStyle = "rgba(230, 237, 243, 0.95)";
          ctx!.font = `${Math.max(9, 11 / s.scale)}px Outfit, system-ui, sans-serif`;
          ctx!.textAlign = "center";
          const label =
            node.name.length > 14 ? `${node.name.slice(0, 12)}…` : node.name;
          ctx!.fillText(label, node.x, node.y + node.r + 12 / s.scale);
        }
        ctx!.globalAlpha = 1;
      }

      ctx!.restore();
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const s = simRef.current;
      const rect = canvas!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const before = screenToWorld(mx, my);
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      s.scale = Math.min(4, Math.max(0.25, s.scale * factor));
      s.ox = mx - before.x * s.scale;
      s.oy = my - before.y * s.scale;
    }

    function onDown(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const hit = hitTest(sx, sy);
      const s = simRef.current;
      s.lastX = sx;
      s.lastY = sy;
      s.downX = sx;
      s.downY = sy;
      s.downNode = hit;
      if (hit) {
        s.drag = hit;
        s.alpha = Math.max(s.alpha, 0.15);
        canvas!.setPointerCapture(e.pointerId);
      } else {
        s.pan = true;
        canvas!.setPointerCapture(e.pointerId);
      }
    }

    function onMove(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const s = simRef.current;
      if (s.drag) {
        const wpt = screenToWorld(sx, sy);
        s.drag.x = wpt.x;
        s.drag.y = wpt.y;
        s.drag.vx = 0;
        s.drag.vy = 0;
        setHover({ node: s.drag, sx, sy });
      } else if (s.pan) {
        s.ox += sx - s.lastX;
        s.oy += sy - s.lastY;
        s.lastX = sx;
        s.lastY = sy;
      } else {
        const hit = hitTest(sx, sy);
        if (hit) {
          setHover({ node: hit, sx, sy });
          canvas!.style.cursor = "pointer";
        } else {
          setHover(null);
          canvas!.style.cursor = "grab";
        }
      }
    }

    function onUp(e: PointerEvent) {
      const s = simRef.current;
      const rect = canvas!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const clicked =
        s.downNode && Math.hypot(sx - s.downX, sy - s.downY) < 8
          ? s.downNode
          : null;
      s.drag = null;
      s.pan = false;
      s.downNode = null;
      try {
        canvas!.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (clicked) nav(`/profile/${clicked.id}`);
    }

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", () => setHover(null));

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [nav]);

  function focusSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim().toLowerCase();
    if (!q) {
      simRef.current.focusId = null;
      return;
    }
    const hit = simRef.current.nodes.find(
      (n) => n.name.toLowerCase().includes(q) || n.id.includes(q),
    );
    if (!hit) return;
    simRef.current.focusId = hit.id;
    simRef.current.alpha = Math.max(simRef.current.alpha, 0.3);
    const wrap = wrapRef.current;
    if (!wrap) return;
    const s = simRef.current;
    s.scale = Math.max(s.scale, 1.4);
    s.ox = wrap.clientWidth / 2 - hit.x * s.scale;
    s.oy = wrap.clientHeight / 2 - hit.y * s.scale;
    setHover({
      node: hit,
      sx: wrap.clientWidth / 2,
      sy: wrap.clientHeight / 2,
    });
  }

  return (
    <div className="cloud-page">
      <div className="cloud-toolbar">
        <div>
          <h2 style={{ margin: 0 }}>{t("cloud.title")}</h2>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            {t("cloud.hint")}
          </p>
        </div>
        <div className="row">
          <form className="cloud-search" onSubmit={focusSearch}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("cloud.search")}
            />
            <button className="btn ghost" type="submit">
              {t("cloud.find")}
            </button>
          </form>
          <label className="cloud-limit">
            <span className="muted">{t("cloud.limit")}</span>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              {LIMIT_VALUES.map((n) => (
                <option key={String(n)} value={n}>
                  {n === 0 ? t("cloud.unlimited") : n}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              simRef.current.alpha = 1;
              simRef.current.focusId = null;
            }}
          >
            {t("cloud.reheat")}
          </button>
          <Link className="btn ghost" to="/">
            {t("nav.home")}
          </Link>
        </div>
      </div>

      <p className="muted cloud-meta">
        {loading
          ? t("cloud.loading")
          : t("cloud.metaGrouped", {
              nodes: stats.nodes,
              links: stats.links,
              groups: stats.groups,
            })}
      </p>
      {!loading && groupMeta.length > 0 && (
        <div className="cloud-legend">
          {groupMeta.slice(0, 10).map((g) => (
            <span key={g.id} className="cloud-legend-item">
              <i style={{ background: groupColor(g.id) }} />
              {t("cloud.group", { id: g.id + 1, size: g.size })}
            </span>
          ))}
          {groupMeta.length > 10 && (
            <span className="muted">+{groupMeta.length - 10}</span>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <div className="cloud-stage" ref={wrapRef}>
        <canvas ref={canvasRef} className="cloud-canvas" />
        {hover && (
          <div
            className="cloud-tooltip"
            style={{ left: hover.sx + 14, top: hover.sy + 14 }}
          >
            <strong>{hover.node.name}</strong>
            <div className="mono muted">{hover.node.id}</div>
            <div>
              {t("cloud.vacFriends", { n: hover.node.vacFriends })} · VAC ×
              {hover.node.vacCount}
            </div>
            <div>{t("cloud.groupLabel", { id: hover.node.group + 1 })}</div>
            {hover.node.lastBanDate && (
              <div className="muted">
                {String(hover.node.lastBanDate).slice(0, 10)}
              </div>
            )}
            <div className="muted">{t("cloud.click")}</div>
          </div>
        )}
        {!loading && stats.nodes === 0 && (
          <div className="cloud-empty">{t("cloud.empty")}</div>
        )}
      </div>
    </div>
  );
}
