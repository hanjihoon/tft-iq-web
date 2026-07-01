import { useCallback, useEffect, useRef, useState } from "react";

/* ============================================================
   TFT IQ — 아이템 BIS 퀴즈 (모바일 스와이프 카드)

   실서버 연결: USE_MOCK = false + 백엔드(cargo run --bin server) 실행.
   - GET  /api/quiz/next       헤더 X-User-Id로 "안 푼 문제" 조회
   - POST /api/quiz/:id/answer 채점 + 시도 기록
   - GET  /api/meta/info       전역 분석 표본 정보
   ============================================================ */
const USE_MOCK = false;
const API_BASE = "https://tft-iq-backend.fly.dev"; // 로컬은 http://localhost:8080

/* --- 익명 유저 id (브라우저 1회 생성, 로그인 없이 개인화) --- */
function getUserId() {
  try {
    let id = localStorage.getItem("tftiq_uid");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("tftiq_uid", id); }
    return id;
  } catch { return "anon"; } // 아티팩트 등 localStorage 불가 환경
}

/* --- 디자인 토큰 (코스믹 아케이드) --- */
const T = {
  bg: "#0B0918", bg2: "#130F26", card1: "#1C1638", card2: "#251C49",
  line: "rgba(139,108,255,0.22)", text: "#F0ECFF", muted: "#9A8FC2",
  violet: "#8B6CFF", gold: "#F6C652", teal: "#3DE0A8", red: "#FF6585",
  fontDisplay: "'Space Grotesk', system-ui, sans-serif",
  fontKR: "'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif",
};

/* --- 목업 (USE_MOCK=true 일 때만) --- */
const MOCK = [
  { id: "m1", patch: "16.13", carry: { name: "마스터 이" },
    options: ["스테락의 도전", "거인의 결의", "워모그의 갑옷", "죽음의 검"],
    answer: "스테락의 도전",
    stats: { "스테락의 도전": [4.05, 264], "거인의 결의": [4.10, 96], "워모그의 갑옷": [4.30, 40], "죽음의 검": [4.18, 30] },
    hidden: { name: "거인의 결의", avg: 4.10, n: 96 } },
  { id: "m2", patch: "16.13", carry: { name: "진" },
    options: ["죽음의 검", "무한의 대검", "거인 학살자", "최후의 속삭임"],
    answer: "죽음의 검",
    stats: { "죽음의 검": [3.54, 1190], "무한의 대검": [3.70, 348], "거인 학살자": [3.62, 450], "최후의 속삭임": [3.58, 800] },
    hidden: { name: "마법공학 총검", avg: 3.66, n: 50 } },
];

const HEX = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";
const initial = (name) => name?.trim()?.[0] ?? "?";

export default function App() {
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

  const loadNext = useCallback(async () => {
    setReveal(null); setChosen(null);

    if (USE_MOCK) {
      const pick = MOCK[Math.floor(Math.random() * MOCK.length)];
      const normalized = { ...pick, options: pick.options.map((name) => ({ id: name, name })) };
      setQueue((q) => [normalized, ...q].slice(0, 3));
      setLoading(false);
      return;
    }

    try {
      const r = await fetch(`${API_BASE}/api/quiz/next`, { headers: { "X-User-Id": getUserId() } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (data.status === "all_solved") { setAllSolved(true); setLoading(false); return; }
      const p = data.puzzle;
      const carry = p.prompt?.carry ?? { name: "?" };
      const options = (p.options ?? []).map((o) => ({ id: o.id, name: o.name, icon: o.icon }));
      const hidden = p.stats?.hidden_pick
        ? { name: p.stats.hidden_pick.name, avg: p.stats.hidden_pick.avg_placement, n: p.stats.hidden_pick.sample_size }
        : null;
      setQueue((q) => [{ id: p.id, patch: p.patch, carry, options, hidden, _raw: p }, ...q].slice(0, 3));
      setError(null); setLoading(false);
    } catch (e) {
      setError("서버에 연결할 수 없어요. 백엔드를 실행하고 새로고침하세요.");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNext();
    if (!USE_MOCK) {
      fetch(`${API_BASE}/api/meta/info`).then((r) => r.json()).then(setMeta).catch(() => {});
    }
    /* eslint-disable-next-line */
  }, []);

  async function submit(optName, optId) {
    if (reveal) return;
    setChosen(optName);

    if (USE_MOCK) {
      const correct = optName === current.answer;
      const statsArr = current.options.map((opt) => ({
        name: opt.name, avg: current.stats[opt.name]?.[0] ?? null,
        n: current.stats[opt.name]?.[1] ?? 0, is_best: opt.name === current.answer,
      }));
      finishReveal(correct, current.answer, statsArr, current.hidden);
      return;
    }

    try {
      const r = await fetch(`${API_BASE}/api/quiz/${current.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": getUserId() },
        body: JSON.stringify({ chosen: optId }),
      });
      const d = await r.json();
      const statsArr = (d.stats?.options ?? []).map((o) => ({
        name: o.name, avg: o.avg_placement, n: o.sample_size, is_best: o.is_best,
      }));
      const answerName = statsArr.find((s) => s.is_best)?.name;
      finishReveal(d.correct, answerName, statsArr, current.hidden);
    } catch (e) {
      setError("채점 요청 실패. 서버 상태를 확인하세요.");
    }
  }

  function finishReveal(correct, answerName, statsArr, hidden) {
    setReveal({ correct, answer: answerName, stats: statsArr, hidden });
    setSolved((s) => s + 1);
    if (correct) setStreak((s) => { const n = s + 1; setBest((b) => Math.max(b, n)); return n; });
    else setStreak(0);
  }

  return (
    <div style={{
      minHeight: "100%", background: `radial-gradient(120% 80% at 50% -10%, ${T.bg2}, ${T.bg})`,
      color: T.text, fontFamily: T.fontKR, display: "flex", flexDirection: "column",
      alignItems: "center", padding: "20px 16px 32px",
    }}>
      <StyleInject />
      <Header streak={streak} best={best} solved={solved} />
      {meta && (
        <div style={{ width: "100%", maxWidth: 380, marginTop: 8, textAlign: "center", fontSize: 11, color: T.muted }}>
          패치 {meta.patch} · {meta.region} {meta.approx_rank} · {meta.total_matches?.toLocaleString()}판 분석
        </div>
      )}

      <div style={{ position: "relative", width: "100%", maxWidth: 380, marginTop: 16, flex: 1 }}>
        {allSolved ? (
          <SolvedCard />
        ) : error ? (
          <ErrorCard msg={error} onRetry={() => { setLoading(true); setError(null); loadNext(); }} />
        ) : loading || !current ? (
          <SkeletonCard />
        ) : (
          <CardStack current={current} chosen={chosen} reveal={reveal} onPick={submit} onNext={loadNext} />
        )}
      </div>
    </div>
  );
}

function Header({ streak, best, solved }) {
  return (
    <div style={{ width: "100%", maxWidth: 380, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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

function CardStack({ current, chosen, reveal, onPick, onNext }) {
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const start = useRef(null);
  const onDown = (e) => { if (!reveal) return; start.current = { x: e.clientX, y: e.clientY }; setDrag((d) => ({ ...d, active: true })); };
  const onMove = (e) => { if (!start.current) return; setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y, active: true }); };
  const onUp = () => {
    if (!start.current) return;
    const dismissed = Math.abs(drag.x) > 110; start.current = null;
    if (dismissed) { setDrag({ x: drag.x > 0 ? 600 : -600, y: drag.y, active: false }); setTimeout(() => { setDrag({ x: 0, y: 0, active: false }); onNext(); }, 180); }
    else setDrag({ x: 0, y: 0, active: false });
  };
  const rot = drag.x / 22;
  return (
    <div style={{ position: "relative", height: 540 }}>
      <div style={{ position: "absolute", inset: 0, transform: "scale(0.94) translateY(14px)", opacity: 0.5 }}><CardShell /></div>
      <div style={{ position: "absolute", inset: 0, transform: "scale(0.97) translateY(7px)", opacity: 0.75 }}><CardShell /></div>
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
        style={{ position: "absolute", inset: 0, touchAction: "none",
          transform: `translate(${drag.x}px, ${drag.y}px) rotate(${rot}deg)`,
          transition: drag.active ? "none" : "transform 0.32s cubic-bezier(.2,.8,.2,1)", cursor: reveal ? "grab" : "default" }}>
        <QuizCard current={current} chosen={chosen} reveal={reveal} onPick={onPick} onNext={onNext} />
      </div>
    </div>
  );
}

function CardShell({ children }) {
  return (
    <div style={{ height: "100%", borderRadius: 24, padding: 22,
      background: `linear-gradient(160deg, ${T.card2}, ${T.card1})`, border: `1px solid ${T.line}`,
      boxShadow: "0 30px 60px -20px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)",
      display: "flex", flexDirection: "column" }}>
      {children}
    </div>
  );
}

function QuizCard({ current, chosen, reveal, onPick, onNext }) {
  const best = reveal?.stats?.find((s) => s.is_best);
  const yours = reveal?.stats?.find((s) => s.name === chosen);
  return (
    <CardShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: T.fontDisplay, fontSize: 11, letterSpacing: "0.12em", color: T.muted,
          border: `1px solid ${T.line}`, borderRadius: 999, padding: "4px 10px" }}>
          PATCH {current.patch}
        </span>
        <span style={{ fontSize: 11, color: T.muted }}>아이템 선택</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 18, marginBottom: 6 }}>
        <div style={{ position: "relative", width: 92, height: 92 }}>
          <div style={{ position: "absolute", inset: -3, clipPath: HEX, background: `linear-gradient(135deg, ${T.violet}, ${T.gold})` }} />
          <div style={{ position: "absolute", inset: 0, clipPath: HEX, background: `linear-gradient(160deg, ${T.card2}, ${T.bg2})`,
            display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 34 }}>
            {initial(current.carry.name)}
          </div>
        </div>
        <div style={{ marginTop: 14, fontWeight: 800, fontSize: 22 }}>{current.carry.name}</div>
        <div style={{ marginTop: 4, fontSize: 13, color: T.muted }}>이 캐리에게 가장 좋은 아이템은?</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 14 }}>
        {current.options.map((opt) => {
          const name = opt.name;
          const st = reveal?.stats?.find((s) => s.name === name);
          let border = T.line, bg = "rgba(255,255,255,0.03)", glow = "none", badge = null;
          if (reveal) {
            if (st?.is_best) { border = T.gold; bg = "rgba(246,198,82,0.12)"; glow = `0 0 0 1px ${T.gold}, 0 8px 24px -8px rgba(246,198,82,0.4)`; badge = "BEST"; }
            else if (name === chosen) { border = T.red; bg = "rgba(255,101,133,0.12)"; }
          }
          return (
            <button key={opt.id} disabled={!!reveal} onClick={() => onPick(opt.name, opt.id)}
              style={{ appearance: "none", textAlign: "left", cursor: reveal ? "default" : "pointer",
                borderRadius: 14, border: `1px solid ${border}`, background: bg, boxShadow: glow,
                padding: "13px 15px", color: T.text, fontFamily: T.fontKR, fontSize: 15, fontWeight: 600,
                display: "flex", alignItems: "center", justifyContent: "space-between", transition: "transform .12s, background .2s, border-color .2s" }}
              onMouseDown={(e) => !reveal && (e.currentTarget.style.transform = "scale(0.98)")}
              onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {opt.icon ? (
                  <img src={opt.icon} alt="" width={28} height={28}
                    style={{ borderRadius: 6, border: reveal && st?.is_best ? `2px solid ${T.gold}` : `1px solid ${T.line}` }} />
                ) : (
                  <span style={{ width: 12, height: 12, clipPath: HEX, background: reveal && st?.is_best ? T.gold : T.violet }} />
                )}
                {name}
              </span>
              {reveal && st?.avg != null && (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {badge && <span style={{ fontFamily: T.fontDisplay, fontSize: 10, fontWeight: 700, color: T.gold, letterSpacing: "0.1em" }}>{badge}</span>}
                  <span style={{ fontFamily: T.fontDisplay, fontSize: 13, fontWeight: 700, color: st.is_best ? T.gold : T.muted }}>
                    {st.avg.toFixed(2)}
                  </span>
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
                {reveal.correct
                  ? `${best?.name} · 평균 ${best?.avg?.toFixed(2)}등 · ${best?.n}판`
                  : `최선은 ${best?.name}${yours?.avg != null ? ` (네 선택 ${yours.avg.toFixed(2)}등)` : ""}`}
              </span>
            </div>
            {reveal.hidden && (
              <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 12, background: "rgba(139,108,255,0.1)", border: `1px solid ${T.line}`, fontSize: 12, color: T.text }}>
                💡 <b style={{ color: T.violet }}>숨은 픽</b> {reveal.hidden.name} — 픽률은 낮지만 평균 {reveal.hidden.avg?.toFixed(2)}등 ({reveal.hidden.n}판)
              </div>
            )}
            <button onClick={onNext} style={{ width: "100%", borderRadius: 14, border: "none", cursor: "pointer",
              padding: "14px", fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 15, letterSpacing: "0.03em",
              color: T.bg, background: `linear-gradient(135deg, ${T.violet}, ${T.gold})` }}>
              다음 문제 →
            </button>
            <div style={{ textAlign: "center", fontSize: 11, color: T.muted, marginTop: 8 }}>카드를 옆으로 밀어도 돼요</div>
          </div>
        ) : (
          <div style={{ textAlign: "center", fontSize: 12, color: T.muted }}>아이템을 탭해 정답을 맞혀보세요</div>
        )}
      </div>
    </CardShell>
  );
}

function SkeletonCard() {
  return <div style={{ height: 540 }}><CardShell><div style={{ margin: "auto", color: T.muted, fontSize: 14 }}>불러오는 중…</div></CardShell></div>;
}
function SolvedCard() {
  return (
    <div style={{ height: 540 }}><CardShell>
      <div style={{ margin: "auto", textAlign: "center" }}>
        <div style={{ width: 44, height: 44, clipPath: HEX, background: `linear-gradient(135deg, ${T.violet}, ${T.gold})`, margin: "0 auto 16px" }} />
        <div style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 20, marginBottom: 8 }}>모든 문제 완료! 🎉</div>
        <div style={{ color: T.muted, fontSize: 13, lineHeight: 1.6 }}>지금 있는 퀴즈를 다 풀었어요.<br />새 패치가 오거나 기록을 리셋하면 다시 도전할 수 있어요.</div>
      </div>
    </CardShell></div>
  );
}
function ErrorCard({ msg, onRetry }) {
  return (
    <div style={{ height: 540 }}><CardShell>
      <div style={{ margin: "auto", textAlign: "center", maxWidth: 260 }}>
        <div style={{ width: 40, height: 40, clipPath: HEX, background: T.red, margin: "0 auto 16px" }} />
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>{msg}</div>
        <button onClick={onRetry} style={{ marginTop: 18, borderRadius: 12, border: `1px solid ${T.line}`, background: "transparent",
          color: T.text, padding: "10px 18px", cursor: "pointer", fontFamily: T.fontDisplay, fontWeight: 700 }}>다시 시도</button>
      </div>
    </CardShell></div>
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