import { useCallback, useEffect, useState } from "react";

/* ============================================================
   TFT IQ — 통합 퀴즈 (홈 모드 선택 + 아이템 BIS + 덱 완성)
   홈에서 모드 선택 → 퀴즈 화면(탭으로 즉시 전환 가능)
   ============================================================ */
const USE_MOCK = false;
const API_BASE = "https://tft-iq-backend.fly.dev";

function getUserId() {
  try {
    let id = localStorage.getItem("tftiq_uid");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("tftiq_uid", id); }
    return id;
  } catch { return "anon"; }
}

const T = {
  bg: "#0B0918", bg2: "#130F26", card1: "#1C1638", card2: "#251C49",
  line: "rgba(139,108,255,0.22)", text: "#F0ECFF", muted: "#9A8FC2",
  violet: "#8B6CFF", gold: "#F6C652", teal: "#3DE0A8", red: "#FF6585",
  fontDisplay: "'Space Grotesk', system-ui, sans-serif",
  fontKR: "'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif",
};
const HEX = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";
const initial = (name) => name?.trim()?.[0] ?? "?";

const TABS = [
  { key: "item_combine", label: "아이템" },
  { key: "deck_complete", label: "덱 완성" },
];

function unitIcon(id) {
  if (!id) return null;
  const low = id.toLowerCase();
  const m = low.match(/^tft(\d+)_/);
  if (!m) return null;
  return `https://raw.communitydragon.org/latest/game/assets/characters/${low}/hud/${low}_square.tft_set${m[1]}.png`;
}

export default function App() {
  const [mode, setMode] = useState(null); // null=홈, 값=퀴즈
  const [tab, setTab] = useState("item_combine");
  const [queue, setQueue] = useState([]);
  const [reveal, setReveal] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [solved, setSolved] = useState(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [allSolved, setAllSolved] = useState(false);
  const [meta, setMeta] = useState(null);

  const current = queue[0];

  const loadNext = useCallback(async (forType) => {
    const t = forType || tab;
    setReveal(null); setChosen(null); setAllSolved(false); setLoading(true);
    if (USE_MOCK) { setLoading(false); return; }
    try {
      const r = await fetch(`${API_BASE}/api/quiz/next?type=${t}`, {
        headers: { "X-User-Id": getUserId() },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (data.status === "all_solved") { setAllSolved(true); setLoading(false); return; }
      const p = data.puzzle;
      const type = p.type ?? t;
      let card;
      if (type === "deck_complete") {
        card = {
          id: p.id, type, patch: p.patch,
          deckLabel: p.prompt?.deck_label ?? "?",
          shown: p.prompt?.shown_units ?? [],
          options: (p.options ?? []).map((o) => ({ id: o.id, name: o.name, icon: o.icon })),
          deckAvg: p.stats?.deck_avg, deckGames: p.stats?.deck_games,
        };
      } else {
        const carry = p.prompt?.carry ?? { name: "?" };
        card = {
          id: p.id, type, patch: p.patch, carry,
          options: (p.options ?? []).map((o) => ({ id: o.id, name: o.name, icon: o.icon })),
          hidden: p.stats?.hidden_pick
            ? { name: p.stats.hidden_pick.name, avg: p.stats.hidden_pick.avg_placement, n: p.stats.hidden_pick.sample_size }
            : null,
        };
      }
      setQueue([card]);
      setError(null); setLoading(false);
    } catch (e) {
      setError("서버에 연결할 수 없어요. 잠시 후 다시 시도하세요.");
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    if (!mode) return;
    setStreak(0); setSolved(0);
    loadNext(tab);
    /* eslint-disable-next-line */
  }, [tab, mode]);

  useEffect(() => {
    if (!USE_MOCK) {
      fetch(`${API_BASE}/api/meta/info`).then((r) => r.json()).then(setMeta).catch(() => {});
    }
  }, []);

  async function submit(optName, optId) {
    if (reveal) return;
    setChosen(optId);
    try {
      const r = await fetch(`${API_BASE}/api/quiz/${current.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": getUserId() },
        body: JSON.stringify({ chosen: optId }),
      });
      const d = await r.json();
      const statsArr = (d.stats?.options ?? []).map((o) => ({
        id: o.id, name: o.name, avg: o.avg_placement, n: o.sample_size, is_best: o.is_best,
      }));
      const answerName = statsArr.find((s) => s.is_best)?.name;
      finishReveal(d.correct, answerName, statsArr);
    } catch (e) {
      setError("채점 요청 실패. 서버 상태를 확인하세요.");
    }
  }

  function finishReveal(correct, answerName, statsArr) {
    setReveal({ correct, answer: answerName, stats: statsArr });
    setSolved((s) => s + 1);
    if (correct) setStreak((s) => { const n = s + 1; setBest((b) => Math.max(b, n)); return n; });
    else setStreak(0);
  }

  // 홈 화면
  if (!mode) {
    return <Home onSelect={(m) => { setTab(m); setMode(m); }} />;
  }

  return (
    <div style={{
      minHeight: "100%", background: `radial-gradient(120% 80% at 50% -10%, ${T.bg2}, ${T.bg})`,
      color: T.text, fontFamily: T.fontKR, display: "flex", flexDirection: "column",
      alignItems: "center", padding: "20px 16px 32px",
    }}>
      <StyleInject />

      <div style={{ width: "100%", maxWidth: 380, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setMode(null)} title="홈으로"
            style={{ appearance: "none", cursor: "pointer", background: "transparent", border: "none",
              color: T.muted, fontSize: 20, padding: "0 4px 0 0", lineHeight: 1 }}>&larr;</button>
          <div style={{ width: 30, height: 30, clipPath: HEX, background: `linear-gradient(135deg, ${T.violet}, ${T.gold})` }} />
          <div style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 18, letterSpacing: "0.04em" }}>
            TFT <span style={{ color: T.gold }}>IQ</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: T.muted }}>
          <Stat label="연속" value={streak} accent={streak > 0 ? T.gold : T.muted} />
          <Stat label="최고" value={best} accent={T.muted} />
          <Stat label="푼 문제" value={solved} accent={T.muted} />
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 380, marginTop: 14, display: "flex", gap: 8 }}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ flex: 1, appearance: "none", cursor: "pointer", borderRadius: 12,
                border: `1px solid ${on ? T.gold : T.line}`,
                background: on ? "rgba(246,198,82,0.12)" : "rgba(255,255,255,0.03)",
                color: on ? T.gold : T.muted, fontFamily: T.fontDisplay, fontWeight: 700,
                fontSize: 14, padding: "10px", letterSpacing: "0.03em", transition: "all .2s" }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {meta && (
        <div style={{ width: "100%", maxWidth: 380, marginTop: 8, textAlign: "center", fontSize: 11, color: T.muted }}>
          패치 {meta.patch} · {meta.region} {meta.approx_rank} · {meta.total_matches?.toLocaleString()}판 분석
        </div>
      )}

      <div style={{ position: "relative", width: "100%", maxWidth: 380, marginTop: 14, flex: 1 }}>
        {allSolved ? (
          <SolvedCard />
        ) : error ? (
          <ErrorCard msg={error} onRetry={() => loadNext(tab)} />
        ) : loading || !current ? (
          <SkeletonCard />
        ) : current.type === "deck_complete" ? (
          <DeckCard current={current} chosen={chosen} reveal={reveal} onPick={submit} onNext={() => loadNext(tab)} />
        ) : (
          <ItemCard current={current} chosen={chosen} reveal={reveal} onPick={submit} onNext={() => loadNext(tab)} />
        )}
      </div>
    </div>
  );
}

function Home({ onSelect }) {
  const modes = [
    { key: "item_combine", title: "아이템 BIS 퀴즈", desc: "캐리별 최적 아이템을 맞혀보세요", emoji: "⚔️" },
    { key: "deck_complete", title: "덱 완성 퀴즈", desc: "티어덱에서 빠진 핵심 유닛은?", emoji: "🧩" },
  ];
  return (
    <div style={{
      minHeight: "100%", background: `radial-gradient(120% 80% at 50% -10%, ${T.bg2}, ${T.bg})`,
      color: T.text, fontFamily: T.fontKR, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: "40px 20px",
    }}>
      <StyleInject />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <div style={{ width: 40, height: 40, clipPath: HEX, background: `linear-gradient(135deg, ${T.violet}, ${T.gold})` }} />
        <div style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 26, letterSpacing: "0.04em" }}>
          TFT <span style={{ color: T.gold }}>IQ</span>
        </div>
      </div>
      <div style={{ fontSize: 15, color: T.muted, marginBottom: 28 }}>무엇을 연습할까요?</div>
      <div style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 14 }}>
        {modes.map((m) => (
          <button key={m.key} onClick={() => onSelect(m.key)}
            style={{ appearance: "none", cursor: "pointer", textAlign: "left",
              borderRadius: 18, border: `1px solid ${T.line}`,
              background: `linear-gradient(160deg, ${T.card2}, ${T.card1})`,
              padding: "20px 22px", color: T.text, transition: "transform .12s",
              boxShadow: "0 16px 40px -16px rgba(0,0,0,0.6)" }}
            onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
            onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 26 }}>{m.emoji}</span>
              <div>
                <div style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 17 }}>{m.title}</div>
                <div style={{ fontSize: 12.5, color: T.muted, marginTop: 3 }}>{m.desc}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: T.muted, marginTop: 26, textAlign: "center", lineHeight: 1.6 }}>
        언제든 상단 탭이나 &larr; 버튼으로 바꿀 수 있어요
      </div>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 16, color: accent, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function CardShell({ children }) {
  return (
    <div style={{ height: 540, borderRadius: 24, padding: 22,
      background: `linear-gradient(160deg, ${T.card2}, ${T.card1})`, border: `1px solid ${T.line}`,
      boxShadow: "0 30px 60px -20px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)",
      display: "flex", flexDirection: "column" }}>
      {children}
    </div>
  );
}

function ItemCard({ current, chosen, reveal, onPick, onNext }) {
  const best = reveal?.stats?.find((s) => s.is_best);
  const yours = reveal?.stats?.find((s) => s.id === chosen);
  return (
    <CardShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: T.fontDisplay, fontSize: 11, letterSpacing: "0.12em", color: T.muted,
          border: `1px solid ${T.line}`, borderRadius: 999, padding: "4px 10px" }}>PATCH {current.patch}</span>
        <span style={{ fontSize: 11, color: T.muted }}>아이템 선택</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 18, marginBottom: 6 }}>
        <div style={{ position: "relative", width: 92, height: 92 }}>
          <div style={{ position: "absolute", inset: -3, clipPath: HEX, background: `linear-gradient(135deg, ${T.violet}, ${T.gold})` }} />
          <div style={{ position: "absolute", inset: 0, clipPath: HEX, overflow: "hidden",
            background: `linear-gradient(160deg, ${T.card2}, ${T.bg2})`,
            display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 34 }}>
            {unitIcon(current.carry.id) ? (
              <img src={unitIcon(current.carry.id)} alt="" width={92} height={92} style={{ objectFit: "cover" }}
                onError={(e) => { e.currentTarget.style.display = "none"; e.currentTarget.parentNode.textContent = initial(current.carry.name); }} />
            ) : initial(current.carry.name)}
          </div>
        </div>
        <div style={{ marginTop: 14, fontWeight: 800, fontSize: 22 }}>{current.carry.name}</div>
        <div style={{ marginTop: 4, fontSize: 13, color: T.muted }}>이 캐리에게 가장 좋은 아이템은?</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 14 }}>
        {current.options.map((opt) => {
          const st = reveal?.stats?.find((s) => s.id === opt.id);
          let border = T.line, bg = "rgba(255,255,255,0.03)", glow = "none", badge = null;
          if (reveal) {
            if (st?.is_best) { border = T.gold; bg = "rgba(246,198,82,0.12)"; glow = `0 0 0 1px ${T.gold}`; badge = "BEST"; }
            else if (opt.id === chosen) { border = T.red; bg = "rgba(255,101,133,0.12)"; }
          }
          return (
            <button key={opt.id} disabled={!!reveal} onClick={() => onPick(opt.name, opt.id)}
              style={{ appearance: "none", textAlign: "left", cursor: reveal ? "default" : "pointer",
                borderRadius: 14, border: `1px solid ${border}`, background: bg, boxShadow: glow,
                padding: "13px 15px", color: T.text, fontFamily: T.fontKR, fontSize: 15, fontWeight: 600,
                display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {opt.icon ? (
                  <img src={opt.icon} alt="" width={28} height={28}
                    style={{ borderRadius: 6, border: reveal && st?.is_best ? `2px solid ${T.gold}` : `1px solid ${T.line}` }} />
                ) : (
                  <span style={{ width: 12, height: 12, clipPath: HEX, background: reveal && st?.is_best ? T.gold : T.violet }} />
                )}
                {opt.name}
              </span>
              {reveal && st?.avg != null && (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {badge && <span style={{ fontFamily: T.fontDisplay, fontSize: 10, fontWeight: 700, color: T.gold }}>{badge}</span>}
                  <span style={{ fontFamily: T.fontDisplay, fontSize: 13, fontWeight: 700, color: st.is_best ? T.gold : T.muted }}>{st.avg.toFixed(2)}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: "auto", paddingTop: 16 }}>
        {reveal ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontWeight: 800, fontSize: 16, color: reveal.correct ? T.teal : T.red }}>
              <span style={{ fontFamily: T.fontDisplay }}>{reveal.correct ? "정답!" : "아쉬워!"}</span>
              <span style={{ color: T.muted, fontWeight: 500, fontSize: 13 }}>
                {reveal.correct ? `${best?.name} · 평균 ${best?.avg?.toFixed(2)}등 · ${best?.n}판`
                  : `최선은 ${best?.name}${yours?.avg != null ? ` (네 선택 ${yours.avg.toFixed(2)}등)` : ""}`}
              </span>
            </div>
            {current.hidden && (
              <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 12, background: "rgba(139,108,255,0.1)", border: `1px solid ${T.line}`, fontSize: 12 }}>
                💡 <b style={{ color: T.violet }}>숨은 픽</b> {current.hidden.name} — 픽률은 낮지만 평균 {current.hidden.avg?.toFixed(2)}등 ({current.hidden.n}판)
              </div>
            )}
            <NextButton onNext={onNext} />
          </div>
        ) : (
          <div style={{ textAlign: "center", fontSize: 12, color: T.muted }}>아이템을 탭해 정답을 맞혀보세요</div>
        )}
      </div>
    </CardShell>
  );
}

function DeckCard({ current, chosen, reveal, onPick, onNext }) {
  const best = reveal?.stats?.find((s) => s.is_best);
  return (
    <CardShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: T.fontDisplay, fontSize: 11, letterSpacing: "0.12em", color: T.muted,
          border: `1px solid ${T.line}`, borderRadius: 999, padding: "4px 10px" }}>PATCH {current.patch}</span>
        <span style={{ fontSize: 11, color: T.muted }}>덱 완성</span>
      </div>
      <div style={{ textAlign: "center", marginTop: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 20 }}>
          {current.deckLabel} <span style={{ color: T.muted, fontWeight: 500, fontSize: 15 }}>덱</span>
        </div>
        {current.deckAvg != null && (
          <div style={{ marginTop: 4, fontSize: 12, color: T.gold, fontFamily: T.fontDisplay }}>
            평균 {Number(current.deckAvg).toFixed(2)}등 · {current.deckGames?.toLocaleString()}판
          </div>
        )}
        <div style={{ marginTop: 6, fontSize: 13, color: T.muted }}>빠진 핵심 유닛은?</div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: 16 }}>
        {current.shown.map((u) => <UnitHex key={u.id} unit={u} />)}
        <UnitHex unit={reveal && best ? current.options.find((o) => o.id === best.id) : null} highlight />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto", paddingTop: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {current.options.map((opt) => {
            const st = reveal?.stats?.find((s) => s.id === opt.id);
            let border = T.line, bg = "rgba(255,255,255,0.03)";
            if (reveal) {
              if (st?.is_best) { border = T.gold; bg = "rgba(246,198,82,0.12)"; }
              else if (opt.id === chosen) { border = T.red; bg = "rgba(255,101,133,0.12)"; }
            }
            return (
              <button key={opt.id} disabled={!!reveal} onClick={() => onPick(opt.name, opt.id)}
                style={{ appearance: "none", cursor: reveal ? "default" : "pointer",
                  borderRadius: 12, border: `1px solid ${border}`, background: bg,
                  padding: "8px 10px", color: T.text, fontFamily: T.fontKR, fontSize: 13, fontWeight: 600,
                  display: "flex", alignItems: "center", gap: 8 }}>
                {opt.icon && <img src={opt.icon} alt="" width={26} height={26}
                  style={{ borderRadius: 5, border: reveal && st?.is_best ? `2px solid ${T.gold}` : `1px solid ${T.line}` }}
                  onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.name}</span>
              </button>
            );
          })}
        </div>
        {reveal ? (
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: reveal.correct ? T.teal : T.red, fontFamily: T.fontDisplay, marginBottom: 8 }}>
              {reveal.correct ? "정답!" : "아쉬워!"}
              <span style={{ color: T.muted, fontWeight: 500, fontSize: 12, marginLeft: 8 }}>핵심 유닛은 {best?.name}</span>
            </div>
            <NextButton onNext={onNext} />
          </div>
        ) : (
          <div style={{ textAlign: "center", fontSize: 12, color: T.muted }}>빠진 유닛을 골라보세요</div>
        )}
      </div>
    </CardShell>
  );
}

function UnitHex({ unit, highlight }) {
  const size = 52;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, width: size + 6 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <div style={{ position: "absolute", inset: -2, clipPath: HEX,
          background: highlight ? `linear-gradient(135deg, ${T.violet}, ${T.gold})` : T.line }} />
        <div style={{ position: "absolute", inset: 0, clipPath: HEX, overflow: "hidden",
          background: `linear-gradient(160deg, ${T.card2}, ${T.bg})`,
          display: "flex", alignItems: "center", justifyContent: "center" }}>
          {unit ? (
            <img src={unit.icon} alt={unit.name} width={size} height={size} style={{ objectFit: "cover" }}
              onError={(e) => { e.currentTarget.style.display = "none"; }} />
          ) : (
            <span style={{ fontFamily: T.fontDisplay, fontSize: 26, fontWeight: 800, color: T.violet }}>?</span>
          )}
        </div>
      </div>
      {unit && <span style={{ fontSize: 9, color: T.muted, maxWidth: size + 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{unit.name}</span>}
    </div>
  );
}

function NextButton({ onNext }) {
  return (
    <button onClick={onNext} style={{ width: "100%", borderRadius: 14, border: "none", cursor: "pointer",
      padding: "14px", fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 15, letterSpacing: "0.03em",
      color: T.bg, background: `linear-gradient(135deg, ${T.violet}, ${T.gold})` }}>
      다음 문제 →
    </button>
  );
}

function SkeletonCard() {
  return <CardShell><div style={{ margin: "auto", color: T.muted, fontSize: 14 }}>불러오는 중…</div></CardShell>;
}
function SolvedCard() {
  return (
    <CardShell>
      <div style={{ margin: "auto", textAlign: "center" }}>
        <div style={{ width: 44, height: 44, clipPath: HEX, background: `linear-gradient(135deg, ${T.violet}, ${T.gold})`, margin: "0 auto 16px" }} />
        <div style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 20, marginBottom: 8 }}>모든 문제 완료! 🎉</div>
        <div style={{ color: T.muted, fontSize: 13, lineHeight: 1.6 }}>이 유형을 다 풀었어요.<br />다른 탭을 풀거나 새 패치를 기다려보세요.</div>
      </div>
    </CardShell>
  );
}
function ErrorCard({ msg, onRetry }) {
  return (
    <CardShell>
      <div style={{ margin: "auto", textAlign: "center", maxWidth: 260 }}>
        <div style={{ width: 40, height: 40, clipPath: HEX, background: T.red, margin: "0 auto 16px" }} />
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>{msg}</div>
        <button onClick={onRetry} style={{ marginTop: 18, borderRadius: 12, border: `1px solid ${T.line}`, background: "transparent",
          color: T.text, padding: "10px 18px", cursor: "pointer", fontFamily: T.fontDisplay, fontWeight: 700 }}>다시 시도</button>
      </div>
    </CardShell>
  );
}

function StyleInject() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap');
      * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
      html, body, #root { height: 100%; margin: 0; }
      button:focus-visible { outline: 2px solid ${T.violet}; outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
    `}</style>
  );
}