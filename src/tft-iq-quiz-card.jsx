import { useCallback, useEffect, useRef, useState } from "react";

/* ============================================================
   TFT IQ — 아이템 BIS 퀴즈 (모바일 스와이프 카드)

   실서버 연결: USE_MOCK = false 로 바꾸고, 백엔드(cargo run --bin server)를
   띄운 뒤 사용. 서버는 CorsLayer::permissive() 라 브라우저에서 바로 호출됨.
   ============================================================ */
const USE_MOCK = false;
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8080";

/* --- 디자인 토큰 (코스믹 아케이드) --- */
const T = {
  bg: "#0B0918",
  bg2: "#130F26",
  card1: "#1C1638",
  card2: "#251C49",
  line: "rgba(139,108,255,0.22)",
  text: "#F0ECFF",
  muted: "#9A8FC2",
  violet: "#8B6CFF",
  gold: "#F6C652",
  teal: "#3DE0A8",
  red: "#FF6585",
  fontDisplay: "'Space Grotesk', system-ui, sans-serif",
  fontKR: "'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif",
};

/* --- 목업 데이터 (실제 16.13 결과 기반) --- */
const MOCK = [
  {
    id: "m1", patch: "16.13",
    carry: { id: "TFT17_MasterYi", name: "마스터 이" },
    options: ["스테락의 도전", "크라운가드", "거인 학살자", "도적의 장갑"],
    answer: "거인 학살자",
    stats: { "거인 학살자": [3.81, 39], "도적의 장갑": [4.30, 28], "스테락의 도전": [4.55, 15], "크라운가드": [4.80, 11] },
  },
  {
    id: "m2", patch: "16.13",
    carry: { id: "TFT17_Jhin", name: "진" },
    options: ["쇼진의 창", "거인 학살자", "도적의 장갑", "적응형 투구"],
    answer: "거인 학살자",
    stats: { "거인 학살자": [3.92, 31], "도적의 장갑": [4.21, 24], "쇼진의 창": [4.44, 13], "적응형 투구": [4.90, 10] },
  },
  {
    id: "m3", patch: "16.13",
    carry: { id: "TFT17_Nami", name: "나미" },
    options: ["정령의 형상", "거인 학살자", "피바라기", "라바돈의 죽음모자"],
    answer: "라바돈의 죽음모자",
    stats: { "라바돈의 죽음모자": [4.02, 13], "거인 학살자": [4.38, 11], "피바라기": [4.71, 12], "정령의 형상": [4.95, 10] },
  },
  {
    id: "m4", patch: "16.13",
    carry: { id: "TFT17_Samira", name: "사미라" },
    options: ["스테락의 도전", "죽음의 검", "크라켄의 분노", "용의 발톱"],
    answer: "죽음의 검",
    stats: { "죽음의 검": [4.09, 22], "크라켄의 분노": [4.33, 16], "용의 발톱": [4.80, 11], "스테락의 도전": [4.88, 10] },
  },
  {
    id: "m5", patch: "16.13",
    carry: { id: "TFT17_Jinx", name: "징크스" },
    options: ["피바라기", "크라켄의 분노", "최후의 속삭임", "적응형 투구"],
    answer: "최후의 속삭임",
    stats: { "최후의 속삭임": [3.95, 32], "크라켄의 분노": [4.18, 21], "피바라기": [4.52, 14], "적응형 투구": [5.10, 10] },
  },
];

/* 헥사곤 clip-path */
const HEX = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

/* 캐리 이니셜(한글 첫 글자) */
function initial(name) {
  return name?.trim()?.[0] ?? "?";
}

export default function App() {
  const [queue, setQueue] = useState([]);
  const [reveal, setReveal] = useState(null); // {correct, answer, stats, chosen}
  const [chosen, setChosen] = useState(null);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [solved, setSolved] = useState(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const current = queue[0];

  /* 다음 퀴즈 적재 */
  const loadNext = useCallback(async () => {
    setReveal(null);
    setChosen(null);
    if (USE_MOCK) {
      const pick = MOCK[Math.floor(Math.random() * MOCK.length)];
      // 목업 옵션(문자열)을 실서버와 같은 {id,name} 형태로 통일.
      // 목업은 로컬 채점이라 id에 name을 그대로 써도 무방.
      const normalized = { ...pick, options: pick.options.map((name) => ({ id: name, name })) };
      setQueue((q) => [normalized, ...q].slice(0, 3));
      setLoading(false);
      return;
    }
    try {
      const r = await fetch(`${API_BASE}/api/quiz/item`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const p = await r.json();
      const carry = p.prompt?.carry ?? { name: "?" };
      const options = (p.options ?? []).map((o) => ({ id: o.id, name: o.name })); // id 보존
      setQueue((q) => [{ id: p.id, patch: p.patch, carry, options, _raw: p }, ...q].slice(0, 3));
      setError(null);
    } catch (e) {
      setError("서버에 연결할 수 없어요. 백엔드를 실행하고 새로고침하세요. (cargo run --bin server)");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadNext(); /* eslint-disable-next-line */ }, []);

  /* 답안 제출 */
  async function submit(optName, optId) {
    if (reveal) return;
    setChosen(optName);

    if (USE_MOCK) {
      const correct = optName === current.answer;
      const statsArr = current.options.map((opt) => ({
        name: opt.name,
        avg: current.stats[opt.name]?.[0] ?? null,
        n: current.stats[opt.name]?.[1] ?? 0,
        is_best: opt.name === current.answer,
      }));
      finishReveal(correct, current.answer, statsArr);
      return;
    }

    try {
      const r = await fetch(`${API_BASE}/api/quiz/${current.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chosen: optId }),
      });
      const d = await r.json();
      // 서버 stats.options: [{id,name,avg_placement,sample_size,is_best}]
      const statsArr = (d.stats?.options ?? []).map((o) => ({
        name: o.name,
        avg: o.avg_placement,
        n: o.sample_size,
        is_best: o.is_best,
      }));
      const answerName =
        statsArr.find((s) => s.is_best)?.name ?? current.options.find((_, i) => i === 0);
      finishReveal(d.correct, answerName, statsArr);
    } catch (e) {
      setError("채점 요청 실패. 서버 상태를 확인하세요.");
    }
  }

  function finishReveal(correct, answerName, statsArr) {
    setReveal({ correct, answer: answerName, stats: statsArr });
    setSolved((s) => s + 1);
    if (correct) {
      setStreak((s) => { const n = s + 1; setBest((b) => Math.max(b, n)); return n; });
    } else {
      setStreak(0);
    }
  }

  return (
    <div style={{
      minHeight: "100%", background: `radial-gradient(120% 80% at 50% -10%, ${T.bg2}, ${T.bg})`,
      color: T.text, fontFamily: T.fontKR, display: "flex", flexDirection: "column",
      alignItems: "center", padding: "20px 16px 32px",
    }}>
      <StyleInject />
      <Header streak={streak} best={best} solved={solved} />

      <div style={{ position: "relative", width: "100%", maxWidth: 380, marginTop: 18, flex: 1 }}>
        {error ? (
          <ErrorCard msg={error} onRetry={() => { setLoading(true); setError(null); loadNext(); }} />
        ) : loading || !current ? (
          <SkeletonCard />
        ) : (
          <CardStack
            current={current}
            chosen={chosen}
            reveal={reveal}
            onPick={submit}
            onNext={loadNext}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- 헤더 ---------- */
function Header({ streak, best, solved }) {
  return (
    <div style={{ width: "100%", maxWidth: 380, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 30, height: 30, clipPath: HEX,
          background: `linear-gradient(135deg, ${T.violet}, ${T.gold})`,
        }} />
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

/* ---------- 카드 스택 (틴더식 깊이) ---------- */
function CardStack({ current, chosen, reveal, onPick, onNext }) {
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const start = useRef(null);

  const onDown = (e) => {
    if (!reveal) return; // 답하기 전엔 스와이프 잠금
    start.current = { x: e.clientX, y: e.clientY };
    setDrag((d) => ({ ...d, active: true }));
  };
  const onMove = (e) => {
    if (!start.current) return;
    setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y, active: true });
  };
  const onUp = () => {
    if (!start.current) return;
    const dismissed = Math.abs(drag.x) > 110;
    start.current = null;
    if (dismissed) { setDrag({ x: drag.x > 0 ? 600 : -600, y: drag.y, active: false }); setTimeout(() => { setDrag({ x: 0, y: 0, active: false }); onNext(); }, 180); }
    else setDrag({ x: 0, y: 0, active: false });
  };

  const rot = drag.x / 22;

  return (
    <div style={{ position: "relative", height: 520 }}>
      {/* 뒤 카드(깊이감) */}
      <div style={{ position: "absolute", inset: 0, transform: "scale(0.94) translateY(14px)", opacity: 0.5, filter: "saturate(0.7)" }}>
        <CardShell />
      </div>
      <div style={{ position: "absolute", inset: 0, transform: "scale(0.97) translateY(7px)", opacity: 0.75 }}>
        <CardShell />
      </div>
      {/* 앞 카드 */}
      <div
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
        style={{
          position: "absolute", inset: 0, touchAction: "none",
          transform: `translate(${drag.x}px, ${drag.y}px) rotate(${rot}deg)`,
          transition: drag.active ? "none" : "transform 0.32s cubic-bezier(.2,.8,.2,1)",
          cursor: reveal ? "grab" : "default",
        }}
      >
        <QuizCard current={current} chosen={chosen} reveal={reveal} onPick={onPick} onNext={onNext} />
      </div>
    </div>
  );
}

function CardShell({ children }) {
  return (
    <div style={{
      height: "100%", borderRadius: 24, padding: 22,
      background: `linear-gradient(160deg, ${T.card2}, ${T.card1})`,
      border: `1px solid ${T.line}`,
      boxShadow: "0 30px 60px -20px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)",
      display: "flex", flexDirection: "column",
    }}>
      {children}
    </div>
  );
}

/* ---------- 퀴즈 카드 ---------- */
function QuizCard({ current, chosen, reveal, onPick, onNext }) {
  const best = reveal?.stats?.find((s) => s.is_best);
  const yours = reveal?.stats?.find((s) => s.name === chosen);

  return (
    <CardShell>
      {/* 패치 뱃지 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{
          fontFamily: T.fontDisplay, fontSize: 11, letterSpacing: "0.12em", color: T.muted,
          border: `1px solid ${T.line}`, borderRadius: 999, padding: "4px 10px",
        }}>
          PATCH {current.patch}
        </span>
        <span style={{ fontSize: 11, color: T.muted }}>아이템 선택</span>
      </div>

      {/* 캐리 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 18, marginBottom: 6 }}>
        <div style={{ position: "relative", width: 92, height: 92 }}>
          <div style={{ position: "absolute", inset: -3, clipPath: HEX, background: `linear-gradient(135deg, ${T.violet}, ${T.gold})` }} />
          <div style={{
            position: "absolute", inset: 0, clipPath: HEX,
            background: `linear-gradient(160deg, ${T.card2}, ${T.bg2})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: T.fontKR, fontWeight: 800, fontSize: 34, color: T.text,
          }}>
            {initial(current.carry.name)}
          </div>
        </div>
        <div style={{ marginTop: 14, fontWeight: 800, fontSize: 22 }}>{current.carry.name}</div>
        <div style={{ marginTop: 4, fontSize: 13, color: T.muted }}>이 캐리에게 가장 좋은 아이템은?</div>
      </div>

      {/* 보기 */}
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
              style={{
                appearance: "none", textAlign: "left", cursor: reveal ? "default" : "pointer",
                borderRadius: 14, border: `1px solid ${border}`, background: bg, boxShadow: glow,
                padding: "13px 15px", color: T.text, fontFamily: T.fontKR, fontSize: 15, fontWeight: 600,
                display: "flex", alignItems: "center", justifyContent: "space-between",
                transition: "transform .12s, background .2s, border-color .2s",
              }}
              onMouseDown={(e) => !reveal && (e.currentTarget.style.transform = "scale(0.98)")}
              onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 12, height: 12, clipPath: HEX, background: reveal && st?.is_best ? T.gold : T.violet, opacity: reveal && !st?.is_best && name !== chosen ? 0.4 : 1 }} />
                {name}
              </span>
              {reveal && st?.avg != null && (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {badge && <span style={{ fontFamily: T.fontDisplay, fontSize: 10, fontWeight: 700, color: T.gold, letterSpacing: "0.1em" }}>{badge}</span>}
                  <span style={{ fontFamily: T.fontDisplay, fontSize: 13, fontWeight: 700, color: st.is_best ? T.gold : T.muted }}>
                    평균 {st.avg.toFixed(2)}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 피드백 / 다음 */}
      <div style={{ marginTop: "auto", paddingTop: 16 }}>
        {reveal ? (
          <div>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
              fontWeight: 800, fontSize: 16, color: reveal.correct ? T.teal : T.red,
            }}>
              <span style={{ fontFamily: T.fontDisplay }}>{reveal.correct ? "정답!" : "아쉬워!"}</span>
              <span style={{ color: T.muted, fontWeight: 500, fontSize: 13 }}>
                {reveal.correct
                  ? `${best?.name} · 평균 ${best?.avg?.toFixed(2)}등 (표본 ${best?.n})`
                  : `최선은 ${best?.name}${yours?.avg != null ? ` · 네 선택 평균 ${yours.avg.toFixed(2)}등` : ""}`}
              </span>
            </div>
            <button onClick={onNext} style={{
              width: "100%", borderRadius: 14, border: "none", cursor: "pointer",
              padding: "14px", fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 15, letterSpacing: "0.03em",
              color: T.bg, background: `linear-gradient(135deg, ${T.violet}, ${T.gold})`,
            }}>
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

/* ---------- 상태 카드들 ---------- */
function SkeletonCard() {
  return (
    <div style={{ height: 520 }}>
      <CardShell>
        <div style={{ margin: "auto", textAlign: "center", color: T.muted, fontSize: 14 }}>불러오는 중…</div>
      </CardShell>
    </div>
  );
}
function ErrorCard({ msg, onRetry }) {
  return (
    <div style={{ height: 520 }}>
      <CardShell>
        <div style={{ margin: "auto", textAlign: "center", maxWidth: 260 }}>
          <div style={{ width: 40, height: 40, clipPath: HEX, background: T.red, margin: "0 auto 16px" }} />
          <div style={{ fontSize: 14, color: T.text, lineHeight: 1.6 }}>{msg}</div>
          <button onClick={onRetry} style={{
            marginTop: 18, borderRadius: 12, border: `1px solid ${T.line}`, background: "transparent",
            color: T.text, padding: "10px 18px", cursor: "pointer", fontFamily: T.fontDisplay, fontWeight: 700,
          }}>다시 시도</button>
        </div>
      </CardShell>
    </div>
  );
}

/* ---------- 폰트 주입 ---------- */
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