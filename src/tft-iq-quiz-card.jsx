import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { parseSkillDesc, parseTraitDesc } from "./skill-parser";

import { STRINGS, fmt } from "./i18n";


/* ============================================================
   TFT IQ — 통합 퀴즈 (홈 모드 선택 + 아이템 BIS + 덱 완성)
   홈에서 모드 선택 → 퀴즈 화면(탭으로 즉시 전환 가능)
   ============================================================ */
const USE_MOCK = false;
// const API_BASE = "http://localhost:8080";
const API_BASE = "https://tft-iq-backend.fly.dev";

const CostContext = createContext({});     
const UnitInfoContext = createContext({}); 
const TraitInfoContext = createContext({});
const ItemInfoContext = createContext({});
const LangContext = createContext({ lang: "ko_kr", changeLang: () => {} });

function LangSelector() {
  const { lang, changeLang } = useContext(LangContext);
  const LANGS = {
    ko_kr: "한국어", en_us: "English", ja_jp: "日本語",
    zh_cn: "中文", pt_br: "Português", es_mx: "Español",
    fr_fr: "Français", de_de: "Deutsch", ru_ru: "Русский",
    vi_vn: "Tiếng Việt", th_th: "ไทย",
  };

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      {/* 🌐 아이콘 + 화살표로 "선택 가능" 암시 */}
      <span style={{ position: "absolute", left: 10, fontSize: 14, pointerEvents: "none" }}>🌐</span>
      <select
        value={lang}
        onChange={e => changeLang(e.target.value)}
        style={{
          appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
          background: T.card2, color: T.text,
          border: `1px solid ${T.line}`, borderRadius: 999,
          padding: "7px 30px 7px 32px",  // 좌(아이콘)/우(화살표) 여백
          fontSize: 13, fontWeight: 600, cursor: "pointer",
          outline: "none",
        }}
      >
        {Object.entries(LANGS).map(([code, name]) => (
          <option key={code} value={code}>{name}</option>
        ))}
      </select>
      {/* 아래 화살표 (선택 가능 표시) */}
      <span style={{ position: "absolute", right: 11, fontSize: 10, color: T.muted, pointerEvents: "none" }}>▼</span>
    </div>
  );
}

function resolveDeckLabel(label, unitInfo, traitInfo) {
  if (!label) return "";
  const [type, id] = label.split(":");
  if (type === "trait") return traitInfo[id]?.name ?? id;
  if (type === "unit") return unitInfo[id]?.name ?? id;
  return label; 
}

// 코스트별 테두리 색 (TFT 표준)
const COST_COLORS = {
  1: "#808080",  // 회색
  2: "#11b288",  // 초록 (연두)
  3: "#207ac7",  // 파랑
  4: "#c440da",  // 보라 (자주)
  5: "#ffb93b",  // 금색 (노랑)
};

const STYLE_COLORS = {
  1: "#b06a3b",  // 브론즈
  2: "#9fb4c4",  // 실버(구)
  3: "#9fb4c4",  // 실버
  5: "#ffc93c",  // 골드
  6: "#6ad4e0",  // 프리즘 (청록)
};

// 개수 → style (breakpoints에서 해당 구간)
function traitStyle(count, breakpoints) {
  let style = 0;  // 0 = 비활성
  for (const [min, st] of breakpoints) {
    if (count >= min) style = st;
    else break;
  }
  return style;
}

function costColor(cost) {
  return COST_COLORS[cost] ?? T.line;
}

function getUserId() {
  try {
    let id = localStorage.getItem("tftiq_uid");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("tftiq_uid", id); }
    return id;
  } catch { return "anon"; }
}

function computeDeckTraits(units, unitInfo, traitInfo) {
  const count = {};
  units.forEach(u => {
    (unitInfo[u.id]?.traits ?? []).forEach(api => {  // api = apiName
      count[api] = (count[api] ?? 0) + 1;
    });
  });
  return Object.entries(count)
    .map(([api, n]) => {
      const info = traitInfo[api];  // apiName 키로 조회
      if (!info) return null;
      const style = traitStyle(n, info.breakpoints ?? []);
      return { api, name: info.name, count: n, icon: info.icon, style };  // name 추가
    })
    .filter(t => t && t.style > 0)
    .sort((a,b) => b.style - a.style || b.count - a.count);
}

function detectLang() {
  const nav = (navigator.language || "en").toLowerCase();
  if (nav.startsWith("ko")) return "ko_kr";
  if (nav.startsWith("ja")) return "ja_jp";
  if (nav.startsWith("zh")) return "zh_cn";
  if (nav.startsWith("pt")) return "pt_br";
  if (nav.startsWith("es")) return "es_mx";
  if (nav.startsWith("fr")) return "fr_fr";
  if (nav.startsWith("de")) return "de_de";
  if (nav.startsWith("ru")) return "ru_ru";
  if (nav.startsWith("vi")) return "vi_vn";
  if (nav.startsWith("th")) return "th_th";
  return "en_us";  // 기본
}

const T = {
  bg: "#0B0918", bg2: "#130F26", card1: "#1C1638", card2: "#251C49",
  line: "rgba(139,108,255,0.22)", text: "#F0ECFF", muted: "#9A8FC2",
  violet: "#8B6CFF", gold: "#F6C652", teal: "#3DE0A8", red: "#FF6585",
  fontDisplay: "'Space Grotesk', system-ui, sans-serif",
  fontKR: "'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif",
};
const HEX = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";


// 파일명이 유닛 id와 다른 특수 유닛 (변신폼 등). 폴더는 id, 파일명만 예외.
const UNIT_ICON_OVERRIDES = {
  tft17_rhaast: "tft17_kayn_slay", // 라스트 = 케인 변신폼
};

export default function App() {
  const [unitInfo, setUnitInfo] = useState({});   // 전체: {id: {cost, traits, ability}}
  const [costMap, setCostMap] = useState({});      // cost만: {id: cost} (테두리 호환)
  const [traitInfo, setTraitInfo] = useState({});
  const [itemInfo, setItemInfo] = useState({});
  const [loading, setLoading] = useState(true);
  

  const [lang, setLang] = useState(() => 
    localStorage.getItem("lang") || detectLang() || "en_us"
  );

  function changeLang(newLang) {
    localStorage.setItem("lang", newLang);
    setLang(newLang);  // useEffect 트리거
  }

  const t = STRINGS[lang] ?? STRINGS.en_us;

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/api/meta/units?lang=${lang}`).then(r => r.json()),
      fetch(`${API_BASE}/api/meta/traits?lang=${lang}`).then(r => r.json()),
      fetch(`${API_BASE}/api/meta/items?lang=${lang}`).then(r => r.json()),
    ]).then(([units, traits, items]) => {
      setUnitInfo(units);
      setTraitInfo(traits);
      setItemInfo(items); 
      const cm = {};
      Object.entries(units).forEach(([id, u]) => { cm[id] = u?.cost; });
      setCostMap(cm);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, changeLang, t }}>
      <CostContext.Provider value={costMap}>
        <UnitInfoContext.Provider value={unitInfo}>
          <TraitInfoContext.Provider value={traitInfo}>
            <ItemInfoContext.Provider value={itemInfo}>
              <AppMain/>
            </ItemInfoContext.Provider>
          </TraitInfoContext.Provider>
        </UnitInfoContext.Provider>
      </CostContext.Provider>
    </LangContext.Provider>
  );
}


// 앱 공유 (모바일 네이티브 공유 시트 / 데스크탑 클립보드 폴백)
async function shareApp() {
  const data = {
    title: "TFT IQ",
    text: t.share_text,
    url: "https://tft-iq-web.vercel.app",
  };
  try {
    if (navigator.share) {
      await navigator.share(data);
    } else {
      await navigator.clipboard.writeText(`${data.text} ${data.url}`);
      alert(t.share_copied);
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
    alert(t.report_thanks);
  } catch (e) {
    alert(t.report_fail);
  }
}

function unitIcon(id) {
  if (!id) return null;
  const low = id.toLowerCase();
  const m = low.match(/^tft(\d+)_/);
  if (!m) return null;
  const fileBase = UNIT_ICON_OVERRIDES[low] || low;
  return `https://raw.communitydragon.org/latest/game/assets/characters/${low}/hud/${fileBase}_square.tft_set${m[1]}.png`;
}

function UnitDetailModal({ unitId, onClose }) {
  const unitInfo = useContext(UnitInfoContext);
  const traitInfo = useContext(TraitInfoContext);
  const info = unitId ? unitInfo[unitId] : null;

  if (!unitId || !info) return null;

  const ability = info.ability;
  const icon = unitIcon(unitId);
  const cc = costColor(info.cost);

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.7)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 400, maxHeight: "85vh", overflow: "auto",
          borderRadius: 20, border: `1px solid ${T.line}`,
          background: `linear-gradient(160deg, ${T.card2}, ${T.card1})`,
          padding: 20, position: "relative" }}>

        {/* 닫기 */}
        <button onClick={onClose}
          style={{ position: "absolute", top: 14, right: 16, appearance: "none",
            background: "transparent", border: "none", color: T.muted,
            fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>

        {/* 헤더: 아이콘 + 이름 + 코스트 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{ position: "relative", width: 60, height: 60, flexShrink: 0 }}>
            <div style={{ position: "absolute", inset: -2, clipPath: HEX,
              background: cc ?? T.line }} />
            <div style={{ position: "absolute", inset: 0, clipPath: HEX, overflow: "hidden",
              background: T.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {icon && <img src={icon} alt="" width={60} height={60}
                style={{ objectFit: "cover" }}
                onError={(e) => { e.currentTarget.style.display = "none"; }} />}
            </div>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 800, fontSize: 20 }}>{info.name ?? unitId}</span>
              <span style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 14,
                color: cc ?? T.gold }}>💰{info.cost}</span>
            </div>
            {/* 특성 */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
              {(info.traits ?? []).map((tr) => (
                <span key={tr} style={{ fontSize: 11, color: T.violet,
                  border: `1px solid ${T.line}`, borderRadius: 999,
                  padding: "2px 9px", background: "rgba(139,108,255,0.08)" }}>{traitInfo[tr]?.name ?? tr}</span>
              ))}
            </div>
          </div>
        </div>

        {/* 스킬 */}
        {ability && (
          <div style={{ borderRadius: 14, border: `1px solid ${T.line}`,
            background: "rgba(255,255,255,0.02)", padding: 14, marginTop: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              {ability.icon && <img src={ability.icon} alt="" width={36} height={36}
                style={{ borderRadius: 8, border: `1px solid ${T.line}` }}
                onError={(e) => { e.currentTarget.style.display = "none"; }} />}
              <span style={{ fontWeight: 700, fontSize: 15, color: T.gold }}>{ability.name}</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: T.text }}
              dangerouslySetInnerHTML={{
                __html: parseSkillDesc(ability.desc, ability.variables ?? []),
              }} />
          </div>
        )}
      </div>
    </div>
  );
}

function TraitDetailModal({ traitName, onClose }) {
  const traitInfo = useContext(TraitInfoContext);
  const info = traitName ? traitInfo[traitName] : null;

  const unitInfo = useContext(UnitInfoContext);

  if (!traitName || !info) return null;

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.7)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 400, maxHeight: "85vh", overflowY: "auto",
          borderRadius: 20, border: `1px solid ${T.line}`,
          background: `linear-gradient(160deg, ${T.card2}, ${T.card1})`,
          padding: 20, position: "relative" }}>

        <button onClick={onClose}
          style={{ position: "absolute", top: 14, right: 16, appearance: "none",
            background: "transparent", border: "none", color: T.muted,
            fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>

        {/* 헤더: 아이콘 + 이름 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
            <div style={{ position: "absolute", inset: 0, clipPath: HEX,
              background: T.violet }} />
            <img src={info.icon} alt="" width={44} height={44}
              style={{ position: "relative", padding: 8, boxSizing: "border-box",
                filter: "brightness(0) invert(1)" }}
              onError={(e) => { e.currentTarget.style.display = "none"; }} />
          </div>
          <span style={{ fontWeight: 800, fontSize: 20 }}>{resolveDeckLabel(info.name, unitInfo, traitInfo)}</span>
        </div>

        {/* 등급별 임계값 */}
        {info.breakpoints?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {info.breakpoints.map(([min, style], i) => (
              <span key={i} style={{ fontSize: 12, fontWeight: 700,
                color: STYLE_COLORS[style] ?? T.muted,
                border: `1px solid ${STYLE_COLORS[style] ?? T.line}`,
                borderRadius: 999, padding: "2px 10px" }}>{min}</span>
            ))}
          </div>
        )}

        {/* 설명 */}
        {info.desc && (
          <div style={{ fontSize: 13, lineHeight: 1.7, color: T.text }}
            dangerouslySetInnerHTML={{ __html: parseTraitDesc(info.desc, info.effects) }} />
        )}
      </div>
    </div>
  );
}


function AppMain() {
  const { t } = useContext(LangContext); 
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

  const TABS = [
    { key: "item_combine", label: t.tab_item },
    { key: "deck_complete", label: t.tab_deck },
    { key: "trait_quiz", label: t.tab_trait },
  ];

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
      setError(t.err_connect);
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
    if (!window.confirm(t.confirm_reset)) return;
    try {
      await fetch(`${API_BASE}/api/quiz/reset`, {
        method: "POST", headers: { "X-User-Id": getUserId() },
      });
      setReviewCounts({});
      setShowStats(false);
      window.alert(t.reset_done);
    } catch (e) {
      window.alert(t.reset_fail);
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
      setError(t.err_grade);
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
          <button onClick={() => setMode(null)} title={t.home}
            style={{ appearance: "none", cursor: "pointer", background: "transparent", border: "none",
              color: T.muted, fontSize: 20, padding: "0 4px 0 0", lineHeight: 1 }}>&larr;</button>
          <div style={{ width: 30, height: 30, clipPath: HEX, background: `linear-gradient(135deg, ${T.violet}, ${T.gold})` }} />
          <div style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 18, letterSpacing: "0.04em" }}>
            TFT <span style={{ color: T.gold }}>IQ</span>
          </div>
          {reviewMode && (
            <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: T.teal,
              border: `1px solid ${T.teal}`, borderRadius: 999, padding: "2px 8px" }}>{t.review}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: T.muted, alignItems: "center" }}>
          <Stat label={t.streak} value={streak} accent={streak > 0 ? T.gold : T.muted} />
          <Stat label={t.best} value={best} accent={T.muted} />
          <Stat label={t.solved} value={solved} accent={T.muted} />
          <button onClick={shareApp} title={t.share}
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
          {fmt(t.patch_line, {
            patch: meta.patch,
            region: "Korea",
            rank: "Top 1500",
            matches: meta.total_matches?.toLocaleString(),
          })}
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
  const { t } = useContext(LangContext); 

  const modes = [
    { key: "item_combine", title: t.home_item_title, desc: t.home_item_desc, emoji: "⚔️" },
    { key: "deck_complete", title: t.home_deck_title, desc: t.home_deck_desc, emoji: "🧩" },
    { key: "trait_quiz", title: t.home_trait_title, desc: t.home_trait_desc, emoji: "🔮" },
  ];
  return (
    <div style={{
      minHeight: "100%", background: `radial-gradient(120% 80% at 50% -10%, ${T.bg2}, ${T.bg})`,
      color: T.text, fontFamily: T.fontKR, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: "40px 20px",
    }}>
      <StyleInject />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, width: "100%", maxWidth: 360, }}>
        <div style={{ width: 40, height: 40, clipPath: HEX, background: `linear-gradient(135deg, ${T.violet}, ${T.gold})` }} />
        <div style={{ flexGrow: 1, fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 26, letterSpacing: "0.04em" }}>
          TFT <span style={{ color: T.gold }}>IQ</span>
        </div>
        <LangSelector />
      </div>
      <div style={{ fontSize: 15, color: T.muted, marginBottom: 28 }}> {t.home_practice} </div>
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
                      {fmt(t.home_review, {
                        n: reviewN,
                      })}
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
          {t.home_meta}
        </button>
        <button onClick={onStats}
          style={{ appearance: "none", cursor: "pointer",
            borderRadius: 12, border: `1px solid ${T.gold}`,
            background: "rgba(246,198,82,0.1)", color: T.gold,
            fontFamily: T.fontKR, fontWeight: 600, fontSize: 13, padding: "10px 18px",
            display: "flex", alignItems: "center", gap: 6 }}>
          {t.home_stats}
        </button>
        <button onClick={shareApp}
          style={{ appearance: "none", cursor: "pointer",
            borderRadius: 12, border: `1px solid ${T.violet}`,
            background: "rgba(139,108,255,0.1)", color: T.violet,
            fontFamily: T.fontKR, fontWeight: 600, fontSize: 13, padding: "10px 18px",
            display: "flex", alignItems: "center", gap: 6 }}>
          {t.home_share}
        </button>
      </div>
      <div style={{ fontSize: 11, color: T.muted, marginTop: 16, textAlign: "center", lineHeight: 1.6 }}>
        {t.home_hint}
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


function StatsScreen({ onBack, onReset, onReview }) {

  const { t } = useContext(LangContext); 

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const TYPE_LABEL = { item_combine: t.type_item, deck_complete: t.type_deck, trait_quiz: t.type_trait };

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
        <button onClick={onBack} title={t.home}
          style={{ appearance: "none", cursor: "pointer", background: "transparent", border: "none",
            color: T.muted, fontSize: 20, padding: "0 4px 0 0", lineHeight: 1 }}>&larr;</button>
        <div style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 20 }}>{t.stats_title}</div>
      </div>

      {loading ? (
        <div style={{ color: T.muted, marginTop: 40 }}>{t.loading}…</div>
      ) : !stats || stats.total === 0 ? (
        <div style={{ maxWidth: 380, textAlign: "center", marginTop: 40, color: T.muted, fontSize: 14, lineHeight: 1.7 }}>
          {t.stats_empty}
        </div>
      ) : (
        <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 18 }}>
          {/* 전체 정답률 */}
          <div style={{ borderRadius: 18, border: `1px solid ${T.line}`, padding: "20px 22px",
            background: `linear-gradient(160deg, ${T.card2}, ${T.card1})`, textAlign: "center" }}>
            <div style={{ fontSize: 13, color: T.muted, marginBottom: 6 }}>{t.stats_accuracy}</div>
            <div style={{ fontFamily: T.fontDisplay, fontWeight: 800, fontSize: 40, color: T.gold, lineHeight: 1 }}>
              {stats.rate}%
            </div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 6 }}>
              {fmt(t.stats_count, {
                correct: stats.correct,
                total: stats.total,
              })}
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
                {t.stats_weak}
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
                        {fmt(t.stats_weak_rate, {
                          rate: w.rate,
                          total: w.total,
                        })}
                      </span>
                    </div>
                    <button onClick={() => onReview(w.type)}
                      style={{ appearance: "none", cursor: "pointer", borderRadius: 8,
                        border: `1px solid ${T.teal}`, background: "transparent", color: T.teal,
                        fontFamily: T.fontKR, fontSize: 11, fontWeight: 600, padding: "5px 10px" }}>
                      {t.stats_review}
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
            {t.stats_reset}
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
  const { t } = useContext(LangContext); 

  const [decks, setDecks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedUnit, setSelectedUnit] = useState(null);

  const unitInfo = useContext(UnitInfoContext);
  const traitInfo = useContext(TraitInfoContext);


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
        <button onClick={onBack} title={t.home}
          style={{ appearance: "none", cursor: "pointer", background: "transparent", border: "none",
            color: T.muted, fontSize: 20, padding: "0 4px 0 0", lineHeight: 1 }}>&larr;</button>
        <div style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 20 }}>{t.meta_title}</div>
      </div>
      <div style={{ width: "100%", maxWidth: 420, fontSize: 11, color: T.muted, marginBottom: 16, paddingLeft: 32 }}>
        {t.meta_sub}
      </div>

      {loading ? (
        <div style={{ color: T.muted, marginTop: 40 }}>{t.loading}…</div>
      ) : !decks || decks.length === 0 ? (
        <div style={{ color: T.muted, marginTop: 40, textAlign: "center", fontSize: 14 }}>
          {t.meta_empty}
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
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{resolveDeckLabel(d.trait_label, unitInfo, traitInfo) ?? t.meta_deck}</span>
                  <DeckTraits units={d.units ?? []} />
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 14, color: T.gold }}>
                    {fmt(t.meta_avg, {
                      n: Number(d.avg_placement).toFixed(2),
                    })}
                  </span>
                  <span style={{ fontSize: 10, color: T.muted, marginLeft: 6 }}>
                    {fmt(t.meta_games, {
                      n: d.games?.toLocaleString(),
                    })}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {(d.units ?? []).map((u) => (
                  // MetaListScreen 안에 상태 추가
                  <MetaUnit key={u.id ?? u.name} unit={u} onClick={() => setSelectedUnit(u.id)} />

                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {selectedUnit && (
        <UnitDetailModal unitId={selectedUnit} onClose={() => setSelectedUnit(null)} />
      )}
    </div>
  );
}

function MetaUnit({ unit, onClick }) {
  const icon = unit.icon ?? unitIcon(unit.id); // id로 icon 생성 (저장 안 했으니)
  const items = unit.items ?? [];
  const costMap = useContext(CostContext);
  const cc = costColor(costMap[unit.id]);
  
  const unitInfo = useContext(UnitInfoContext);
  
  return (
    <div onClick={onClick} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 46 }}>
      <div style={{ position: "relative", width: 40, height: 40 }}>
        <div style={{ position: "absolute", inset: -1.5, clipPath: HEX, background: cc ?? T.line }} />
        <div style={{ position: "absolute", inset: 0, clipPath: HEX, overflow: "hidden",
          background: `linear-gradient(160deg, ${T.card2}, ${T.bg})`,
          display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon ? (
            <img src={icon} alt={unit.name} width={40} height={40} style={{ objectFit: "cover" }}
              onError={(e) => { e.currentTarget.style.display = "none"; }} />
          ) : (
            <span style={{ fontSize: 10, color: T.violet }}>{initial(unitInfo[unit.id]?.name ?? unit.name)}</span>
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
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{unitInfo[unit.id]?.name ?? unit.name}</span>
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
  const { t } = useContext(LangContext); 
  const best = reveal?.stats?.find((s) => s.is_best);
  const yours = reveal?.stats?.find((s) => s.id === chosen);
  const costMap = useContext(CostContext);
  const carryCost = costColor(costMap[current.carry.id]);
  const unitInfo = useContext(UnitInfoContext);
  const itemInfo = useContext(ItemInfoContext);

  return (
    <CardShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: T.fontDisplay, fontSize: 11, letterSpacing: "0.12em", color: T.muted,
          border: `1px solid ${T.line}`, borderRadius: 999, padding: "4px 10px" }}>PATCH {current.patch}</span>
        <span style={{ fontSize: 11, color: T.muted }}>{t.item_pick}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 18, marginBottom: 6 }}>
        <div style={{ position: "relative", width: 92, height: 92 }}>
          <div style={{ position: "absolute", inset: -3, clipPath: HEX, background: carryCost ?? `linear-gradient(135deg, ${T.violet}, ${T.gold})` }} />
          <div style={{ position: "absolute", inset: 0, clipPath: HEX, overflow: "hidden",
            background: `linear-gradient(160deg, ${T.card2}, ${T.bg2})`,
            display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 34 }}>
            {unitIcon(current.carry.id) ? (
              <img src={unitIcon(current.carry.id)} alt="" width={92} height={92} style={{ objectFit: "cover" }}
                onError={(e) => { e.currentTarget.style.display = "none"; e.currentTarget.parentNode.textContent = initial(name); }} />
            ) : initial(name)}
          </div>
        </div>
        <div style={{ marginTop: 14, fontWeight: 800, fontSize: 22 }}>{unitInfo[current.carry.id]?.name ?? current.carry.name}</div>
        <div style={{ marginTop: 4, fontSize: 13, color: T.muted }}>{t.item_q}</div>
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
                {itemInfo[opt.id] ?? opt.name ?? opt.id}
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
              <span style={{ fontFamily: T.fontDisplay }}>{reveal.correct ? t.correct : t.wrong}</span>
              <span style={{ color: T.muted, fontWeight: 500, fontSize: 13 }}>
                {reveal.correct ? fmt(t.item_best, { name: itemInfo[best.id] ?? best.name ?? best.id, avg: best?.avg?.toFixed(2), n: best?.n,})
                  : fmt(t.item_best_wrong, { name: itemInfo[best.id] ?? best.name ?? best.id,}) + fmt(t.item_best_wrong_yours, { avg: best?.n,})}
              </span>
            </div>
            {current.hidden && (
              <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 12, background: "rgba(139,108,255,0.1)", border: `1px solid ${T.line}`, fontSize: 12 }}>
                💡 <b style={{ color: T.violet }}>{t.hidden_pick}</b> 
                {fmt(t.item_hidden, { 
                  name: itemInfo[current.hidden.id] ?? current.hidden.name ?? current.hidden.id, 
                  avg: current.hidden.avg?.toFixed(2), 
                  n: current.hidden.n,
                  })}
              </div>
            )}
            <NextButton onNext={onNext} />
            <ReportLink puzzleId={current.id} />
          </div>
        ) : (
          <div style={{ textAlign: "center", fontSize: 12, color: T.muted }}>{t.item_hint}</div>
        )}
      </div>
    </CardShell>
  );
}

function DeckCard({ current, chosen, reveal, onPick, onNext }) {
  const { t } = useContext(LangContext);

  const best = reveal?.stats?.find((s) => s.is_best);
  const [hintOpen, setHintOpen] = useState(false);
  // 문제 바뀌면 힌트 다시 접기
  useEffect(() => { setHintOpen(false); }, [current.id]);
  const synergies = current.synergies ?? [];
  const costMap = useContext(CostContext);

  const unitInfo = useContext(UnitInfoContext);
  const traitInfo = useContext(TraitInfoContext);

  const label = resolveDeckLabel(current.deckLabel, unitInfo, traitInfo);
  console.log("DeckCard:", Object.keys(unitInfo).length);
  return (
    <CardShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: T.fontDisplay, fontSize: 11, letterSpacing: "0.12em", color: T.muted,
          border: `1px solid ${T.line}`, borderRadius: 999, padding: "4px 10px" }}>PATCH {current.patch}</span>
        <span style={{ fontSize: 11, color: T.muted }}>{t.deck_label}</span>
      </div>
      <div style={{ textAlign: "center", marginTop: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 20 }}>
          {label} <span style={{ color: T.muted, fontWeight: 500, fontSize: 15 }}>{t.deck_suffix}</span>
        </div>
        {current.deckAvg != null && (
          <div style={{ marginTop: 4, fontSize: 12, color: T.gold, fontFamily: T.fontDisplay }}>
            {fmt(t.deck_stat, { 
                  avg: Number(current.deckAvg).toFixed(2), 
                  n: current.deckGames?.toLocaleString(),
            })}
          </div>
        )}
        <div style={{ marginTop: 6, fontSize: 13, color: T.muted }}>{t.deck_q}</div>
      </div>

      {/* 시너지 힌트 (드롭다운, 접힘 기본 — 난이도 보존) */}
      {synergies.length > 0 && (
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <button onClick={() => setHintOpen((v) => !v)}
            style={{ appearance: "none", cursor: "pointer", background: "transparent",
              border: `1px solid ${T.line}`, borderRadius: 999, color: T.muted,
              fontFamily: T.fontKR, fontSize: 11, padding: "5px 12px",
              display: "inline-flex", alignItems: "center", gap: 5 }}>
            {t.deck_hint_syn} {hintOpen ? "▲" : "▼"}
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
                  style={{ borderRadius: 5, border: reveal && st?.is_best ? `2px solid ${T.gold}` : `1.5px solid ${costColor(costMap[opt.id]) ?? T.line}` }}
                  onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{unitInfo[opt.id]?.name ?? opt.name}</span>
              </button>
            );
          })}
        </div>
        {reveal ? (
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: reveal.correct ? T.teal : T.red, fontFamily: T.fontDisplay, marginBottom: 8 }}>
              {reveal.correct ? t.correct : t.wrong}
              <span style={{ color: T.muted, fontWeight: 500, fontSize: 12, marginLeft: 8 }}>{fmt(t.deck_best, {name: best?.name,})}</span>
            </div>
            <NextButton onNext={onNext} />
            <ReportLink puzzleId={current.id} />
          </div>
        ) : (
          <div style={{ textAlign: "center", fontSize: 12, color: T.muted }}>{t.deck_hint}</div>
        )}
      </div>
    </CardShell>
  );
}

function TraitCard({ current, chosen, reveal, onSubmit, onNext }) {
  const { t } = useContext(LangContext); 

  const [selected, setSelected] = useState([]);
  useEffect(() => { setSelected([]); }, [current.id]); // 문제 바뀌면 선택 초기화

  const answerSet = new Set(current.answer);
  const toggle = (tr) => {
    if (reveal) return;
    setSelected((s) => s.includes(tr) ? s.filter((x) => x !== tr) : [...s, tr]);
  };

  const unitInfo = useContext(UnitInfoContext);
  const traitInfo = useContext(TraitInfoContext);

  return (
    <CardShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: T.fontDisplay, fontSize: 11, letterSpacing: "0.12em", color: T.muted,
          border: `1px solid ${T.line}`, borderRadius: 999, padding: "4px 10px" }}>PATCH {current.patch}</span>
        <span style={{ fontSize: 11, color: T.muted }}>{t.trait_label}</span>
      </div>

      {/* 유닛 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 14 }}>
        <UnitHex unit={current.unit} highlight />
        <div style={{ fontWeight: 800, fontSize: 18, marginTop: 8 }}>{unitInfo[current.unit.id]?.name ?? current.unit.name}</div>
        <div style={{ marginTop: 4, fontSize: 13, color: T.muted }}>{t.trait_q}</div>
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
              {reveal && isAns ? "✓ " : ""}{traitInfo[tr]?.name ?? tr}
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
              {reveal.correct ? t.correct : t.wrong}
              <span style={{ color: T.muted, fontWeight: 500, fontSize: 12, marginLeft: 8 }}>
                {unitInfo[current.unit.id]?.name ?? current.unit.name}: {current.answer.map(a => traitInfo[a]?.name ?? a).join(", ")}
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
            {t.trait_submit} {selected.length > 0 ? fmt(t.trait_selected, {n:selected.length}) : ""}
          </button>
        )}
      </div>
    </CardShell>
  );
}

function UnitHex({ unit, highlight }) {
  const size = 52;
  const costMap = useContext(CostContext);
  const cc = unit ? costColor(costMap[unit.id]) : null;
  // 테두리: cost 색 있으면 그거, 없으면 기존 폴백
  const borderBg = cc ?? (highlight ? `linear-gradient(135deg, ${T.violet}, ${T.gold})` : T.line);

  const unitInfo = useContext(UnitInfoContext);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, width: size + 6 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <div style={{ position: "absolute", inset: -2, clipPath: HEX,
          background: borderBg }} />
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
      {unit && <span style={{ fontSize: 9, color: T.muted, maxWidth: size + 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{unitInfo[unit.id]?.name ?? unit.name}</span>}
    </div>
  );
}

function DeckTraits({ units }) {
  const { t } = useContext(LangContext); 
  const unitInfo = useContext(UnitInfoContext);
  const traitInfo = useContext(TraitInfoContext);
  const [selected, setSelected] = useState(null);  // 추가
  const traits = computeDeckTraits(units, unitInfo, traitInfo);
  if (traits.length === 0) return null;

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
          {traits.map(t => (
            <div key={t.name} onClick={() => setSelected(t.api)}
              title={`${t.name} ${t.count}`}
              style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
            <div style={{ position: "relative", width: 20, height: 20 }}>
              <div style={{ position: "absolute", inset: 0, clipPath: HEX,
                background: STYLE_COLORS[t.style] ?? "#555" }} />
              <img src={t.icon} alt="" width={20} height={20}
                style={{ position: "relative", padding: 3, boxSizing: "border-box",
                  filter: "brightness(0) invert(1)" }}
                onError={(e) => { e.currentTarget.style.display = "none"; }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700,
              color: STYLE_COLORS[t.style] ?? T.muted }}>{t.count}</span>
          </div>
        ))}
      </div>
      {selected && <TraitDetailModal traitName={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function NextButton({ onNext }) {
  const { t } = useContext(LangContext); 
  return (
    <button onClick={onNext} style={{ width: "100%", borderRadius: 14, border: "none", cursor: "pointer",
      padding: "14px", fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 15, letterSpacing: "0.03em",
      color: T.bg, background: `linear-gradient(135deg, ${T.violet}, ${T.gold})` }}>
      {t.next}
    </button>
  );
}

// 정답 공개 후 표시되는 제보 링크 (작게)
function ReportLink({ puzzleId }) {
  const { t } = useContext(LangContext);
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { if (!done) { reportPuzzle(puzzleId); setDone(true); } }}
      disabled={done}
      style={{ display: "block", margin: "10px auto 0", appearance: "none",
        background: "transparent", border: "none", cursor: done ? "default" : "pointer",
        color: T.muted, fontSize: 11, opacity: done ? 0.5 : 0.8,
        textDecoration: done ? "none" : "underline" }}>
      {done ? t.report_done : t.report_btn}
    </button>
  );
}

function SkeletonCard() {
  const { t } = useContext(LangContext);
  return <CardShell><div style={{ margin: "auto", color: T.muted, fontSize: 14 }}>{t.loading}…</div></CardShell>;
}
function SolvedCard({ reviewMode, onHome }) {
  const { t } = useContext(LangContext);
  return (
    <CardShell>
      <div style={{ margin: "auto", textAlign: "center" }}>
        <div style={{ width: 44, height: 44, clipPath: HEX, background: `linear-gradient(135deg, ${T.violet}, ${T.gold})`, margin: "0 auto 16px" }} />
        <div style={{ fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 20, marginBottom: 8 }}>
          {reviewMode ? t.done_review : t.done_all}
        </div>
        <div style={{ color: T.muted, fontSize: 13, lineHeight: 1.6 }}>
          {reviewMode
            ? <>{t.done_review_msg}</>
            : <>{t.done_all_msg}</>}
        </div>
        {onHome && (
          <button onClick={onHome} style={{ marginTop: 18, borderRadius: 12, border: `1px solid ${T.line}`,
            background: "transparent", color: T.text, padding: "10px 18px", cursor: "pointer",
            fontFamily: T.fontDisplay, fontWeight: 700 }}>{t.home}</button>
        )}
      </div>
    </CardShell>
  );
}
function ErrorCard({ msg, onRetry }) {
  const { t } = useContext(LangContext);
  return (
    <CardShell>
      <div style={{ margin: "auto", textAlign: "center", maxWidth: 260 }}>
        <div style={{ width: 40, height: 40, clipPath: HEX, background: T.red, margin: "0 auto 16px" }} />
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>{msg}</div>
        <button onClick={onRetry} style={{ marginTop: 18, borderRadius: 12, border: `1px solid ${T.line}`, background: "transparent",
          color: T.text, padding: "10px 18px", cursor: "pointer", fontFamily: T.fontDisplay, fontWeight: 700 }}>{t.retry}</button>
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