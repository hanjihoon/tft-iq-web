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

// 앱 공유 (모바일 네이티브 공유 시트 / 데스크탑 클립보드 폴백)
async function shareApp() {
  const data = {
    title: "TFT IQ",
    text: "TFT 메타 덱·아이템 퀴즈! 당신은 몇 개나 맞힐 수 있나요? 🧩",
    url: "https://tft-iq-web.vercel.app",
  };
  try {
    if (navigator.share) {
      await navigator.share(data);
    } else {
      await navigator.clipboard.writeText(`${data.text} ${data.url}`);
      alert("링크가 복사되었어요!");
    }
  } catch (e) {
    // 사용자 취소 등은 무시
  }
}
const initial = (name) => name?.trim()?.[0] ?? "?";

// 오답/문제 제보 (원클릭)
async function reportPuzzle(id) {
  try {
    await fetch(`${API_BASE}/api/quiz/${id}/report`, {
      method: "POST",
      headers: { "X-User-Id": getUserId() },
    });
    alert("제보 감사합니다! 검토 후 개선할게요 🙏");
  } catch (e) {
    alert("제보 전송에 실패했어요. 잠시 후 다시 시도해주세요.");
  }
}

const TABS = [
  { key: "item_combine", label: "아이템" },
  { key: "deck_complete", label: "덱 완성" },
  { key: "trait_quiz", label: "특성" },
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
  const [reviewMode, setReviewMode] = useState(false); // 복습 모드 여부
  const [reviewCounts, setReviewCounts] = useState({}); // {item_combine:N, deck_complete:M}
  const [showStats, setShowStats] = useState(false); // 통계 화면 표시
  const [showMeta, setShowMeta] = useState(false); // 메타 목록 화면 표시
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

  const loadNext = useCallback(async (forType, isReview) => {
    const t = forType || tab;
    const rev = isReview ?? reviewMode;
    setReveal(null); setChosen(null); setAllSolved(false); setLoading(true);
    if (USE_MOCK) { setLoading(false); return; }
    try {
      const modeParam = rev ? "&mode=review" : "";
      const r = await fetch(`${API_BASE}/api/quiz/next?type=${t}${modeParam}`, {
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
          synergies: p.prompt?.synergies ?? [],
          options: (p.options ?? []).map((o) => ({ id: o.id, name: o.name, icon: o.icon })),
          deckAvg: p.stats?.deck_avg, deckGames: p.stats?.deck_games,
        };
      } else if (type === "trait_quiz") {
        card = {
          id: p.id, type, patch: p.patch,
          unit: p.prompt?.unit ?? { name: "?" },
          options: p.prompt?.options ?? [],   // 특성 보기 (문자열 배열)
          answer: p.prompt?.answer ?? [],      // 정답 특성들 (문자열 배열)
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
  }, [tab, reviewMode]);

  useEffect(() => {
    if (!mode) return;
    setStreak(0); setSolved(0);
    loadNext(tab, reviewMode);
    /* eslint-disable-next-line */
  }, [tab, mode, reviewMode]);

  useEffect(() => {
    if (!USE_MOCK) {
      fetch(`${API_BASE}/api/meta/info`).then((r) => r.json()).then(setMeta).catch(() => {});
    }
  }, []);

  // 복습 대상 개수 불러오기 (홈 진입 시, 채점 후)
  const refreshReviewCounts = useCallback(() => {
    if (USE_MOCK) return;
    fetch(`${API_BASE}/api/quiz/review/count`, { headers: { "X-User-Id": getUserId() } })
      .then((r) => r.json())
      .then(setReviewCounts)
      .catch(() => {});
  }, []);

  useEffect(() => { refreshReviewCounts(); }, [refreshReviewCounts]);

  // 기록 초기화
  async function handleReset() {
    if (!window.confirm("정말 모든 기록을 초기화할까요?\n복습 목록과 통계가 모두 사라집니다.")) return;
    try {
      await fetch(`${API_BASE}/api/quiz/reset`, {
        method: "POST", headers: { "X-User-Id": getUserId() },
      });
      setReviewCounts({});
      setShowStats(false);
      window.alert("기록이 초기화되었어요.");
    } catch (e) {
      window.alert("초기화에 실패했어요. 잠시 후 다시 시도하세요.");
    }
  }

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
    refreshReviewCounts(); // 복습 개수 갱신 (맞히면 줄고, 새로 틀리면 늚)
  }

  // 특성 퀴즈: 다중선택 제출 (선택한 특성 배열 전송)
  async function submitTraits(selected) {
    if (reveal) return;
    // 정답 판정: 선택 집합 == 정답 집합 (완전 일치)
    const answerSet = new Set(current.answer);
    const selSet = new Set(selected);
    const correct =
      answerSet.size === selSet.size &&
      [...answerSet].every((a) => selSet.has(a));
    try {
      // attempt 기록 (통계/복습용) — chosen에 선택 특성들을 문자열로
      await fetch(`${API_BASE}/api/quiz/${current.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": getUserId() },
        body: JSON.stringify({ chosen: selected.join(","), correct }),
      });
    } catch (e) {
      // 기록 실패해도 채점은 진행 (학습 우선)
    }
    setChosen(selected); // 선택한 특성 배열 저장 (채점 표시용)
    finishReveal(correct, current.answer.join(", "), null);
  }

  // 통계 화면
  if (!mode && showStats) {
    return <StatsScreen onBack={() => setShowStats(false)} onReset={handleReset} onReview={(m) => { setShowStats(false); setReviewMode(true); setTab(m); setMode(m); }} />;
  }

  // 메타 목록 화면
  if (!mode && showMeta) {
    return <MetaListScreen onBack={() => setShowMeta(false)} />;
  }

  // 홈 화면
  if (!mode) {
    return (
      <Home
        reviewCounts={reviewCounts}
        onSelect={(m) => { setReviewMode(false); setTab(m); setMode(m); }}
        onReview={(m) => { setReviewMode(true); setTab(m); setMode(m); }}
        onStats={() => setShowStats(true)}
        onMeta={() => setShowMeta(true)}
      />
    );
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
          {reviewMode && (
            <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: T.teal,
              border: `1px solid ${T.teal}`, borderRadius: 999, padding: "2px 8px" }}>복습</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: T.muted, alignItems: "center" }}>
          <Stat label="연속" value={streak} accent={streak > 0 ? T.gold : T.muted} />
          <Stat label="최고" value={best} accent={T.muted} />
          <Stat label="푼 문제" value={solved} accent={T.muted} />
          <button onClick={shareApp} title="공유하기"
            style={{ appearance: "none", cursor: "pointer", background: "transparent",
              border: "none", color: T.violet, fontSize: 16, padding: 0, lineHeight: 1 }}>📤</button>
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
          <SolvedCard reviewMode={reviewMode} onHome={() => setMode(null)} />
        ) : error ? (
          <ErrorCard msg={error} onRetry={() => loadNext(tab)} />
        ) : loading || !current ? (
          <SkeletonCard />
        ) : current.type === "deck_complete" ? (
          <DeckCard current={current} chosen={chosen} reveal={reveal} onPick={submit} onNext={() => loadNext(tab)} />
        ) : current.type === "trait_quiz" ? (
          <TraitCard current={current} chosen={chosen} reveal={reveal} onSubmit={submitTraits} onNext={() => loadNext(tab)} />
        ) : (
          <ItemCard current={current} chosen={chosen} reveal={reveal} onPick={submit} onNext={() => loadNext(tab)} />
        )}
      </div>
    </div>
  );
}

function Home({ onSelect, onReview, reviewCounts, onStats, onMeta }) {
  const modes = [
    { key: "item_combine", title: "아이템 BIS 퀴즈", desc: "캐리별 최적 아이템을 맞혀보세요", emoji: "⚔️" },
    { key: "deck_complete", title: "덱 완성 퀴즈", desc: "티어덱에서 빠진 핵심 유닛은?", emoji: "🧩" },
    { key: "trait_quiz", title: "특성 퀴즈", desc: "이 유닛의 특성을 모두 맞혀보세요", emoji: "🔮" },
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
        {modes.map((m) => {
          const reviewN = reviewCounts?.[m.key] ?? 0;
          return (
            <div key={m.key} style={{ borderRadius: 18, border: `1px solid ${T.line}`, overflow: "hidden",
              background: `linear-gradient(160deg, ${T.card2}, ${T.card1})`,
              boxShadow: "0 16px 40px -16px rgba(0,0,0,0.6)" }}>
              <button onClick={() => onSelect(m.key)}
                style={{ width: "100%", appearance: "none", cursor: "pointer", textAlign: "left",
                  border: "none", background: "transparent", padding: "20px 22px", color: T.text,
                  transition: "transform .12s" }}
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
              {reviewN > 0 && (
                <button onClick={() => onReview(m.key)}
                  style={{ width: "100%", appearance: "none", cursor: "pointer",
                    border: "none", borderTop: `1px solid ${T.line}`,
                    background: "rgba(61,224,168,0.08)", color: T.teal,
                    fontFamily: T.fontKR, fontWeight: 600, fontSize: 13, padding: "11px",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  🔁 틀린 문제 {reviewN}개 복습하기 →
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap", justifyContent: "center" }}>
        <button onClick={onMeta}
          style={{ appearance: "none", cursor: "pointer",
            borderRadius: 12, border: `1px solid ${T.teal}`,
            background: "rgba(61,224,168,0.1)", color: T.teal,
            fontFamily: T.fontKR, fontWeight: 600, fontSize: 13, padding: "10px 18px",
            display: "flex", alignItems: "center", gap: 6 }}>
          📋 메타 보기
        </button>
        <button onClick={onStats}
          style={{ appearance: "none", cursor: "pointer",
            borderRadius: 12, border: `1px solid ${T.gold}`,
            background: "rgba(246,198,82,0.1)", color: T.gold,
            fontFamily: T.fontKR, fontWeight: 600, fontSize: 13, padding: "10px 18px",
            display: "flex", alignItems: "center", gap: 6 }}>
          📊 내 기록
        </button>
        <button onClick={shareApp}
          style={{ appearance: "none", cursor: "pointer",
            borderRadius: 12, border: `1px solid ${T.violet}`,
            background: "rgba(139,108,255,0.1)", color: T.violet,
            fontFamily: T.fontKR, fontWeight: 600, fontSize: 13, padding: "10px 18px",
            display: "flex", alignItems: "center", gap: 6 }}>
          📤 공유하기
        </button>
      </div>
      <div style={{ fontSize: 11, color: T.muted, marginTop: 16, textAlign: "center", lineHeight: 1.6 }}>
        언제든 상단 탭이나 &larr; 버튼으로 바꿀 수 있어요
      </div>
      <div style={{ fontSize: 9.5, color: T.muted, opacity: 0.7, marginTop: 20, textAlign: "center",
        lineHeight: 1.5, maxWidth: 340, padding: "0 8px" }}>
        TFT IQ isn't endorsed by Riot Games and doesn't reflect the views or opinions
        of Riot Games or anyone officially involved in producing or managing Riot Games
        properties. Riot Games, and all associated properties are trademarks or registered
        trademarks of Riot Games, Inc.
      </div>
    </div>
  );
}

const TYPE_LABEL = { item_combine: "아이템 BIS", deck_complete: "덱 완성", trait_quiz: "특성" };

function StatsScreen({ onBack, onReset, onReview }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/quiz/stats`, { headers: { "X-User-Id": getUserId() } })
      .then((r) => r.json())
      .then((d) => { setStats(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div style={{
      minHeight: "100%", background: `radial-gradient(120% 80% at 50% -10%, ${T.bg2}, ${T.bg})`,
      color: T.text, fontFamily: T.fontKR, display: "flex", flexDirection: "column",
      alignItems: "center", padding: "24px 16px 40px",
    }}>
      <StyleInject />
      <div style={{ width: "100%", maxWidth: 380, display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <button onClick={onBack} title="홈으로"
          style={{ appearance: "none", cursor: "pointer", background: "transparent", border: "none",
            color: T.muted, fontSize: 20, padding: "0 4px 0 0", lineHeight: 1 }}>&larr;</button>
        <div style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 20 }}>📊 내 기록</div>
      </div>

      {loading ? (
        <div style={{ color: T.muted, marginTop: 40 }}>불러오는 중…</div>
      ) : !stats || stats.total === 0 ? (
        <div style={{ maxWidth: 380, textAlign: "center", marginTop: 40, color: T.muted, fontSize: 14, lineHeight: 1.7 }}>
          아직 푼 문제가 없어요.<br />퀴즈를 풀면 여기에 기록이 쌓여요!
        </div>
      ) : (
        <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 18 }}>
          {/* 전체 정답률 */}
          <div style={{ borderRadius: 18, border: `1px solid ${T.line}`, padding: "20px 22px",
            background: `linear-gradient(160deg, ${T.card2}, ${T.card1})`, textAlign: "center" }}>
            <div style={{ fontSize: 13, color: T.muted, marginBottom: 6 }}>전체 정답률</div>
            <div style={{ fontFamily: T.fontDisplay, fontWeight: 800, fontSize: 40, color: T.gold, lineHeight: 1 }}>
              {stats.rate}%
            </div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 6 }}>
              {stats.correct} / {stats.total} 문제
            </div>
          </div>

          {/* 유형별 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {(stats.by_type ?? []).map((t) => (
              <div key={t.type}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                  <span>{TYPE_LABEL[t.type] ?? t.type}</span>
                  <span style={{ color: T.muted }}>{t.rate}% · {t.correct}/{t.total}</span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <div style={{ width: `${t.rate}%`, height: "100%", borderRadius: 999,
                    background: `linear-gradient(90deg, ${T.violet}, ${T.gold})` }} />
                </div>
              </div>
            ))}
          </div>

          {/* 약점 */}
          {(stats.weak ?? []).length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.red, marginBottom: 10 }}>
                약한 부분 · 복습 추천
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {stats.weak.map((w, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    borderRadius: 12, border: `1px solid ${T.line}`, padding: "10px 14px",
                    background: "rgba(255,101,133,0.06)" }}>
                    <div>
                      <span style={{ fontSize: 11, color: T.muted, marginRight: 6 }}>
                        {t_emoji(w.type)}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{w.group}</span>
                      <span style={{ fontSize: 11, color: T.muted, marginLeft: 8 }}>
                        {w.rate}% ({w.total}문제)
                      </span>
                    </div>
                    <button onClick={() => onReview(w.type)}
                      style={{ appearance: "none", cursor: "pointer", borderRadius: 8,
                        border: `1px solid ${T.teal}`, background: "transparent", color: T.teal,
                        fontFamily: T.fontKR, fontSize: 11, fontWeight: 600, padding: "5px 10px" }}>
                      복습 →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 초기화 (작게, 구석에) */}
          <button onClick={onReset}
            style={{ marginTop: 8, appearance: "none", cursor: "pointer", background: "transparent",
              border: "none", color: T.muted, fontSize: 11, textDecoration: "underline", alignSelf: "center" }}>
            기록 초기화
          </button>
        </div>
      )}
    </div>
  );
}

function t_emoji(type) {
  if (type === "deck_complete") return "🧩";
  if (type === "trait_quiz") return "🔮";
  return "⚔️";
}

function MetaListScreen({ onBack }) {
  const [decks, setDecks] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/meta/decks`, { headers: { "X-User-Id": getUserId() } })
      .then((r) => r.json())
      .then((d) => { setDecks(Array.isArray(d) ? d : (d.decks ?? [])); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div style={{
      minHeight: "100%", background: `radial-gradient(120% 80% at 50% -10%, ${T.bg2}, ${T.bg})`,
      color: T.text, fontFamily: T.fontKR, display: "flex", flexDirection: "column",
      alignItems: "center", padding: "24px 16px 40px",
    }}>
      <StyleInject />
      <div style={{ width: "100%", maxWidth: 420, display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <button onClick={onBack} title="홈으로"
          style={{ appearance: "none", cursor: "pointer", background: "transparent", border: "none",
            color: T.muted, fontSize: 20, padding: "0 4px 0 0", lineHeight: 1 }}>&larr;</button>
        <div style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 20 }}>📋 메타 티어</div>
      </div>
      <div style={{ width: "100%", maxWidth: 420, fontSize: 11, color: T.muted, marginBottom: 16, paddingLeft: 32 }}>
        평균 등수가 낮을수록 상위 티어예요
      </div>

      {loading ? (
        <div style={{ color: T.muted, marginTop: 40 }}>불러오는 중…</div>
      ) : !decks || decks.length === 0 ? (
        <div style={{ color: T.muted, marginTop: 40, textAlign: "center", fontSize: 14 }}>
          아직 메타 데이터가 없어요.
        </div>
      ) : (
        <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 10 }}>
          {decks.map((d, i) => (
            <div key={i} style={{ borderRadius: 16, border: `1px solid ${T.line}`, padding: "14px 16px",
              background: `linear-gradient(160deg, ${T.card2}, ${T.card1})` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: T.fontDisplay, fontWeight: 800, fontSize: 15,
                    color: i < 3 ? T.gold : T.muted, minWidth: 22 }}>#{i + 1}</span>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{d.trait_label ?? "덱"}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 14, color: T.gold }}>
                    {Number(d.avg_placement).toFixed(2)}등
                  </span>
                  <span style={{ fontSize: 10, color: T.muted, marginLeft: 6 }}>
                    {d.games?.toLocaleString()}판
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {(d.units ?? []).map((u) => (
                  <MetaUnit key={u.id ?? u.name} unit={u} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetaUnit({ unit }) {
  const icon = unit.icon ?? unitIcon(unit.id); // id로 icon 생성 (저장 안 했으니)
  const items = unit.items ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 46 }}>
      <div style={{ position: "relative", width: 40, height: 40 }}>
        <div style={{ position: "absolute", inset: -1.5, clipPath: HEX, background: T.line }} />
        <div style={{ position: "absolute", inset: 0, clipPath: HEX, overflow: "hidden",
          background: `linear-gradient(160deg, ${T.card2}, ${T.bg})`,
          display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon ? (
            <img src={icon} alt={unit.name} width={40} height={40} style={{ objectFit: "cover" }}
              onError={(e) => { e.currentTarget.style.display = "none"; }} />
          ) : (
            <span style={{ fontSize: 10, color: T.violet }}>{initial(unit.name)}</span>
          )}
        </div>
      </div>
      {/* 캐리 유닛의 추천 아이템 (있을 때만) */}
      {items.length > 0 && (
        <div style={{ display: "flex", gap: 1, marginTop: 2, height: 15 }}>
          {items.map((it, i) => (
            <img key={i} src={it.icon} alt={it.name}
              title={`${it.name} · 평균 ${Number(it.avg).toFixed(2)}등`}
              width={14} height={14}
              style={{ borderRadius: 3, border: `1px solid ${T.line}` }}
              onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
          ))}
        </div>
      )}
      <span style={{ fontSize: 8, color: T.muted, marginTop: 2, maxWidth: 44,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{unit.name}</span>
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
            <ReportLink puzzleId={current.id} />
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
  const [hintOpen, setHintOpen] = useState(false);
  // 문제 바뀌면 힌트 다시 접기
  useEffect(() => { setHintOpen(false); }, [current.id]);
  const synergies = current.synergies ?? [];

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

      {/* 시너지 힌트 (드롭다운, 접힘 기본 — 난이도 보존) */}
      {synergies.length > 0 && (
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <button onClick={() => setHintOpen((v) => !v)}
            style={{ appearance: "none", cursor: "pointer", background: "transparent",
              border: `1px solid ${T.line}`, borderRadius: 999, color: T.muted,
              fontFamily: T.fontKR, fontSize: 11, padding: "5px 12px",
              display: "inline-flex", alignItems: "center", gap: 5 }}>
            💡 시너지 힌트 {hintOpen ? "▲" : "▼"}
          </button>
          {hintOpen && (
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6 }}>
              {synergies.map((s) => (
                <span key={s.trait} style={{ fontSize: 11, color: T.violet, fontWeight: 600,
                  border: `1px solid ${T.line}`, borderRadius: 999, padding: "4px 10px",
                  background: "rgba(139,108,255,0.08)" }}>
                  {s.trait} {s.count}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

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
            <ReportLink puzzleId={current.id} />
          </div>
        ) : (
          <div style={{ textAlign: "center", fontSize: 12, color: T.muted }}>빠진 유닛을 골라보세요</div>
        )}
      </div>
    </CardShell>
  );
}

function TraitCard({ current, chosen, reveal, onSubmit, onNext }) {
  const [selected, setSelected] = useState([]);
  useEffect(() => { setSelected([]); }, [current.id]); // 문제 바뀌면 선택 초기화

  const answerSet = new Set(current.answer);
  const toggle = (tr) => {
    if (reveal) return;
    setSelected((s) => s.includes(tr) ? s.filter((x) => x !== tr) : [...s, tr]);
  };

  return (
    <CardShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: T.fontDisplay, fontSize: 11, letterSpacing: "0.12em", color: T.muted,
          border: `1px solid ${T.line}`, borderRadius: 999, padding: "4px 10px" }}>PATCH {current.patch}</span>
        <span style={{ fontSize: 11, color: T.muted }}>특성 퀴즈</span>
      </div>

      {/* 유닛 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 14 }}>
        <UnitHex unit={current.unit} highlight />
        <div style={{ fontWeight: 800, fontSize: 18, marginTop: 8 }}>{current.unit.name}</div>
        <div style={{ marginTop: 4, fontSize: 13, color: T.muted }}>이 유닛의 특성을 모두 고르세요</div>
      </div>

      {/* 특성 보기 (다중선택) */}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 18 }}>
        {current.options.map((tr) => {
          const isSel = selected.includes(tr);
          const isAns = answerSet.has(tr);
          let border = T.line, bg = "rgba(255,255,255,0.03)", color = T.text;
          if (reveal) {
            if (isAns) { border = T.teal; bg = "rgba(61,224,168,0.12)"; color = T.teal; }       // 정답
            else if (isSel) { border = T.red; bg = "rgba(255,101,133,0.12)"; color = T.red; }    // 틀리게 고름
          } else if (isSel) {
            border = T.violet; bg = "rgba(139,108,255,0.15)"; color = T.violet;                  // 선택 중
          }
          return (
            <button key={tr} disabled={!!reveal} onClick={() => toggle(tr)}
              style={{ appearance: "none", cursor: reveal ? "default" : "pointer",
                borderRadius: 999, border: `1.5px solid ${border}`, background: bg, color,
                padding: "8px 14px", fontFamily: T.fontKR, fontSize: 13, fontWeight: 600 }}>
              {reveal && isAns ? "✓ " : ""}{tr}
            </button>
          );
        })}
      </div>

      {/* 하단: 제출 or 결과 */}
      <div style={{ marginTop: "auto", paddingTop: 18 }}>
        {reveal ? (
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: reveal.correct ? T.teal : T.red,
              fontFamily: T.fontDisplay, marginBottom: 6 }}>
              {reveal.correct ? "정답!" : "아쉬워!"}
              <span style={{ color: T.muted, fontWeight: 500, fontSize: 12, marginLeft: 8 }}>
                {current.unit.name}: {current.answer.join(", ")}
              </span>
            </div>
            <NextButton onNext={onNext} />
            <ReportLink puzzleId={current.id} />
          </div>
        ) : (
          <button onClick={() => onSubmit(selected)} disabled={selected.length === 0}
            style={{ width: "100%", appearance: "none",
              cursor: selected.length === 0 ? "default" : "pointer",
              borderRadius: 12, border: "none",
              background: selected.length === 0 ? T.line : `linear-gradient(135deg, ${T.violet}, ${T.gold})`,
              color: selected.length === 0 ? T.muted : "#0a0a0f",
              padding: "13px", fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 15 }}>
            제출하기 {selected.length > 0 ? `(${selected.length}개 선택)` : ""}
          </button>
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

// 정답 공개 후 표시되는 제보 링크 (작게)
function ReportLink({ puzzleId }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { if (!done) { reportPuzzle(puzzleId); setDone(true); } }}
      disabled={done}
      style={{ display: "block", margin: "10px auto 0", appearance: "none",
        background: "transparent", border: "none", cursor: done ? "default" : "pointer",
        color: T.muted, fontSize: 11, opacity: done ? 0.5 : 0.8,
        textDecoration: done ? "none" : "underline" }}>
      {done ? "제보 완료 🙏" : "🚩 이 문제가 이상해요"}
    </button>
  );
}

function SkeletonCard() {
  return <CardShell><div style={{ margin: "auto", color: T.muted, fontSize: 14 }}>불러오는 중…</div></CardShell>;
}
function SolvedCard({ reviewMode, onHome }) {
  return (
    <CardShell>
      <div style={{ margin: "auto", textAlign: "center" }}>
        <div style={{ width: 44, height: 44, clipPath: HEX, background: `linear-gradient(135deg, ${T.violet}, ${T.gold})`, margin: "0 auto 16px" }} />
        <div style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 20, marginBottom: 8 }}>
          {reviewMode ? "복습 완료! 🎉" : "모든 문제 완료! 🎉"}
        </div>
        <div style={{ color: T.muted, fontSize: 13, lineHeight: 1.6 }}>
          {reviewMode
            ? <>틀렸던 문제를 모두 다시 맞혔어요.<br />잘하고 있어요!</>
            : <>이 유형을 다 풀었어요.<br />다른 탭을 풀거나 새 패치를 기다려보세요.</>}
        </div>
        {onHome && (
          <button onClick={onHome} style={{ marginTop: 18, borderRadius: 12, border: `1px solid ${T.line}`,
            background: "transparent", color: T.text, padding: "10px 18px", cursor: "pointer",
            fontFamily: T.fontDisplay, fontWeight: 700 }}>홈으로</button>
        )}
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