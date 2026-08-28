import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

let specialsListCache = null;
const specialsDetailCache = {};

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


const T = {
  bg: "#0B0918", bg2: "#130F26", card1: "#1C1638", card2: "#251C49",
  line: "rgba(139,108,255,0.22)", text: "#F0ECFF", muted: "#9A8FC2",
  violet: "#8B6CFF", gold: "#F6C652", teal: "#3DE0A8", red: "#FF6585",
  fontDisplay: "'Space Grotesk', system-ui, sans-serif",
  fontKR: "'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif",
};
const HEX = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";


/**
 * 유닛 아이콘 URL.
 * Set 18: id는 DA_18_Morgana인데 에셋 폴더는 TFT18_Morgana, hud/ 단계가 사라졌다.
 * 일부 정글 몬스터는 소환사의 협곡 에셋(sru_)을 그대로 쓰거나 파일명이 달라 개별 지정한다.
 */
const CDRAGON = "https://raw.communitydragon.org/latest/game/assets/characters";

const ICON_OVERRIDES = {
  DA_Krug18: `${CDRAGON}/sru_krug/hud/ancientkrug_square.png`,
  DA_Murkwolf18: `${CDRAGON}/sru_murkwolf/hud/greatermurkwolf_square.png`,
  DA_CrimsonRaptor18: `${CDRAGON}/tft18_raptor/tft18_crimsonraptor_teamplanner_splash.png`,
  DA_18_GnarSmall: `${CDRAGON}/tft18_gnar/tft18_gnar_square.png`,
};

const initial = (name) => name?.trim()?.[0] ?? "?";

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

function resolveDeckIcon(label, unitInfo, traitInfo) {
  if (!label) return null;
  const [type, id] = label.split(":");
  if (type === "trait") return traitInfo[id]?.icon ?? null;
  if (type === "unit") return unitInfo[id]?.icon ?? null;
  return null;
}

/** ms 이후에만 true. 짧은 로딩에서 스켈레톤이 깜빡이는 걸 막는다. */
function useDelayed(active, ms) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) { setOn(false); return; }
    const id = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(id);
  }, [active, ms]);
  return on;
}


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
  const SUPPORTED = {
    ko: "ko_kr", ja: "ja_jp", zh: "zh_cn", pt: "pt_br",
    es: "es_mx", fr: "fr_fr", de: "de_de", ru: "ru_ru",
    vi: "vi_vn", th: "th_th", en: "en_us",
  };

  // navigator.languages: 선호 순서 목록 ["ko-KR", "en-US", ...]
  const prefs = navigator.languages || [navigator.language || "en"];

  for (const lang of prefs) {
    const base = lang.toLowerCase().split("-")[0];  // "ko-KR" → "ko"
    if (SUPPORTED[base]) return SUPPORTED[base];
  }
  return "en_us";  // 지원 언어 없으면 영어
}

function SearchInput({ value, onChange, placeholder }) {
  return (
    <div style={{ position: "relative", marginBottom: 14 }}>
      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
        fontSize: 13, color: T.muted, pointerEvents: "none" }}>🔍</span>

      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%", boxSizing: "border-box",
          padding: "11px 34px 11px 34px",
          borderRadius: 12, border: `1px solid ${T.line}`,
          background: "rgba(255,255,255,0.04)", color: T.text,
          fontFamily: T.fontKR,
          fontSize: 16,            // 16px 미만이면 iOS가 입력 시 화면을 확대해버린다
          outline: "none",
          transition: "border-color .15s ease",
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = T.gold)}
        onBlur={(e) => (e.currentTarget.style.borderColor = T.line)}
      />

      {value && (
        <button onClick={() => onChange("")} aria-label="clear"
          style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
            appearance: "none", border: "none", background: "transparent",
            color: T.muted, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "4px 8px" }}>
          ×
        </button>
      )}
    </div>
  );
}


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

/**
 * 유닛 아이콘 URL.
 * Set 18은 id가 DA_18_Morgana인데 에셋 폴더는 TFT18_Morgana이고,
 * 경로에서 hud/ 단계가 사라졌다.
 */
function unitIcon(id) {
  if (!id) return null;
  if (ICON_OVERRIDES[id]) return ICON_OVERRIDES[id];

  let asset;
  if (id.startsWith("DA_18_")) {
    asset = "TFT18_" + id.slice("DA_18_".length);
  } else if (id.startsWith("DA_")) {
    asset = "TFT18_" + id.slice(3).replace("18", "");
  } else {
    asset = id;
  }

  // 역할 접미(_AD, _AP)는 매치 데이터의 변형 구분일 뿐 에셋은 하나다
  asset = asset.replace(/_(AD|AP)$/, "");

  const low = asset.toLowerCase();
  return `${CDRAGON}/${low}/${low}_square.png`;
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
  const [showSpecials, setShowSpecials] = useState(false);
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
  const [reviewGroup, setReviewGroup] = useState(null);
  const [returnToStats, setReturnToStats] = useState(false);
  

  const current = queue[0];

  const TABS = [
    { key: "item_combine", label: t.tab_item },
    { key: "deck_complete", label: t.tab_deck },
    { key: "trait_quiz", label: t.tab_trait },
  ];

  
  const exitQuiz = () => {
    setMode(null);
    setReviewGroup(null);
    if (returnToStats) {
      setShowStats(true);        // 통계로 복귀
      setReturnToStats(false);
    } else {
      setShowStats(false);       // 홈으로
    }
  };

  useEffect(() => {
    if (!mode) return;
    setStreak(0); setSolved(0);
    loadNext(tab, reviewMode, reviewGroup);
  }, [tab, mode, reviewMode, reviewGroup]);

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

  async function deckSubmit(optName, optId) {
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

  async function itemComboSubmit(combo) {
    if (reveal) return;
    setChosen(combo);
    try {
      const r = await fetch(`${API_BASE}/api/quiz/${current.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": getUserId() },
        body: JSON.stringify({ chosen: combo }),   // combo 문자열
      });
      const d = await r.json();
      finishReveal(d.correct);   // 통계는 카드에 이미 있음 (아래 설명)
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
        body: JSON.stringify({ chosen: [...selected].sort().join(","), correct }),
      });
    } catch (e) {
      // 기록 실패해도 채점은 진행 (학습 우선)
    }
    setChosen(selected); // 선택한 특성 배열 저장 (채점 표시용)
    finishReveal(correct, current.answer.join(", "), null);
  }

  const loadNext = useCallback(async (forType, isReview, forGroup) => {
    const t = forType || tab;
    const rev = isReview ?? reviewMode;
    setReveal(null); setChosen(null); setAllSolved(false); setLoading(true);
    if (USE_MOCK) { setLoading(false); return; }
    try {
      const modeParam = rev ? `&mode=review${forGroup ? `&group=${encodeURIComponent(forGroup)}` : ""}` : "";
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
          options: (p.options ?? []).map((o) => ({
            combo: o.combo,
            items: o.items,           // ← items 보존 (핵심!)
            picks: o.picks,
            is_best: o.is_best,
            avg_placement: o.avg_placement,
            top_deck: o.top_deck,
            top_deck_ratio: o.top_deck_ratio,
          })),
          hidden: p.stats?.hidden_pick
            ? {
                combo: p.stats.hidden_pick.combo,
                items: p.stats.hidden_pick.items,   // ← 히든픽도 items
                avg: p.stats.hidden_pick.avg_placement,
                n: p.stats.hidden_pick.sample_size ?? p.stats.hidden_pick.picks,
              }
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


  // 통계 화면
  if (!mode && showStats) {
    return (
      <StatsScreen onBack={() => setShowStats(false)} onReset={handleReset} 
        onReview={(m, grp) => { setShowStats(false); setReviewMode(true); setTab(m);
          setMode(m); setReviewGroup(grp ?? null); setReturnToStats(true); }} 
      />
    );
  }

  // 메타 목록 화면
  if (!mode && showMeta) {
    return <MetaListScreen onBack={() => setShowMeta(false)} />;
  }

  // 특수템 화면
  if (!mode && showSpecials) {
    return <SpecialsScreen onBack={() => setShowSpecials(false)} />;
  }

  // 홈 화면
  if (!mode) {
    return (
      <Home
        reviewCounts={reviewCounts}
        onSelect={(m) => { setReviewMode(false); setTab(m); setMode(m); setReturnToStats(false); }}
        onReview={(m) => { setReviewMode(true); setTab(m); setMode(m); setReviewGroup(null); setReturnToStats(false)}}
        onStats={() => setShowStats(true)}
        onMeta={() => setShowMeta(true)}
        onSpecials={() => setShowSpecials(true)}
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
          <button onClick={exitQuiz} title={t.home}
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
          <DeckCard current={current} chosen={chosen} reveal={reveal} onPick={deckSubmit} onNext={() => loadNext(tab)} />
        ) : current.type === "trait_quiz" ? (
          <TraitCard current={current} chosen={chosen} reveal={reveal} onSubmit={submitTraits} onNext={() => loadNext(tab)} />
        ) : (
          <ItemCard current={current} chosen={chosen} reveal={reveal} onPick={itemComboSubmit} onNext={() => loadNext(tab)} />
        )}
      </div>
    </div>
  );
}

function Home({ onSelect, onReview, reviewCounts, onStats, onMeta, onSpecials }) {
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
                className="pressable">
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
            display: "flex", alignItems: "center", gap: 6 }} 
          className="pressable">
          {t.home_meta}
        </button>

        {/* 특수템 버튼 */}
        <button onClick={onSpecials}
          style={{ appearance: "none", cursor: "pointer",
            borderRadius: 12, border: `1px solid ${T.red}`,
            background: "rgba(255,101,133,0.1)", color: T.red,
            fontFamily: T.fontKR, fontWeight: 600, fontSize: 13, padding: "10px 18px",
            display: "flex", alignItems: "center", gap: 6 }}
          className="pressable">
          💎 {t.home_specials ?? "특수 아이템"}
        </button>

        <button onClick={onStats}
          style={{ appearance: "none", cursor: "pointer",
            borderRadius: 12, border: `1px solid ${T.gold}`,
            background: "rgba(246,198,82,0.1)", color: T.gold,
            fontFamily: T.fontKR, fontWeight: 600, fontSize: 13, padding: "10px 18px",
            display: "flex", alignItems: "center", gap: 6 }}
          className="pressable">
          {t.home_stats}
        </button>
      </div>
      <div style={{ fontSize: 11, color: T.muted, marginTop: 16, textAlign: "center", lineHeight: 1.6 }}>
        {t.home_hint}
      </div>

      {/* 데이터 출처 — 이 앱의 정체성이자, 타 사이트와 순위가 다른 이유 */}
      <div style={{
        marginTop: 18, padding: "12px 16px", maxWidth: 360,
        borderRadius: 12, border: `1px solid ${T.line}`,
        background: "rgba(255,255,255,0.025)",
        fontSize: 11.5, color: T.muted, lineHeight: 1.7, textAlign: "center",
      }}>
        <div style={{ color: T.gold, fontWeight: 700, marginBottom: 5 }}>
          🇰🇷 {t.home_source_title}
        </div>
        {t.home_source_desc}
      </div>

      {/* 피드백 창구 */}
      <div style={{ fontSize: 11, color: T.muted, marginTop: 16, textAlign: "center" }}>
        {t.home_feedback}{" "}
        <a href="mailto:tftiq.dev@gmail.com"
          style={{ color: T.teal, textDecoration: "none", borderBottom: `1px solid ${T.teal}44` }}>
          tftiq.dev@gmail.com
        </a>
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

  const unitInfo = useContext(UnitInfoContext);
  const traitInfo = useContext(TraitInfoContext);

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
              {fmt(t.stats_count, { correct: stats.correct, total: stats.total })}
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
                {stats.weak.map((w, i) => {
                  const icon = w.type === "deck_complete" ? traitInfo[w.group]?.icon 
                              : w.type === "item_combine" ? unitInfo[w.group]?.icon 
                              : null;
                  const name = w.type === "deck_complete" ? resolveDeckLabel(w.group, unitInfo, traitInfo)
                              : w.type === "item_combine" ? unitInfo[w.group]?.name ?? w.group
                              : null;

                  return <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    borderRadius: 12, border: `1px solid ${T.line}`, padding: "10px 14px",
                    background: "rgba(255,101,133,0.06)" }}>
                    <div>
                      <span style={{ fontSize: 11, color: T.muted, marginRight: 6 }}>
                        {t_emoji(w.type)}
                      </span>
                      {icon && (
                        <img src={icon} alt="" width={20} height={20}
                          style={w.type === "deck_complete" 
                            ? { filter: "brightness(0) invert(1)" }  
                            : { borderRadius: 4 }                    
                          }
                          onError={(e) => { e.currentTarget.style.display = "none"; }}
                        />
                      )}
                      <span style={{ fontWeight: 600, fontSize: 14 }}>
                         {name}
                      </span>
                      <span style={{ fontSize: 11, color: T.muted, marginLeft: 8 }}>
                        {fmt(t.stats_weak_rate, {
                          rate: w.rate,
                          total: w.total,
                        })}
                      </span>
                    </div>
                    <button onClick={() => onReview(w.type, w.group)}
                      style={{ appearance: "none", cursor: "pointer", borderRadius: 8,
                        border: `1px solid ${T.teal}`, background: "transparent", color: T.teal,
                        fontFamily: T.fontKR, fontSize: 11, fontWeight: 600, padding: "5px 10px" }}>
                      {t.stats_review}
                    </button>
                  </div>
                })}
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

        {/* 3성을 목표로 만드는 유닛 (리롤 대상) */}
        {unit.star3_ratio && (
          <span style={{
            position: "absolute", top: -7, left: "50%", transform: "translateX(-50%)",
            fontSize: 8.5, letterSpacing: -0.5, color: T.gold, lineHeight: 1,
            textShadow: "0 1px 3px rgba(0,0,0,0.95)", whiteSpace: "nowrap",
            pointerEvents: "none",
          }} title={`3성 ${unit.star3_ratio}%`}>
            ★★★
          </span>
        )}
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

function SpecialsScreen({ onBack }) {
  const { t } = useContext(LangContext);
  const unitInfo = useContext(UnitInfoContext);
  const itemInfo = useContext(ItemInfoContext);

  const [query, setQuery] = useState("");

  const [carryIds, setCarryIds] = useState(specialsListCache ?? []);
  const [selected, setSelected] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(specialsListCache === null);
  const [detailLoading, setDetailLoading] = useState(false);

  const filtered = useMemo(() => {
  const q = query.trim().toLowerCase();
  if (!q) return carryIds;
  return carryIds.filter((cid) =>
    (unitInfo[cid]?.name ?? "").toLowerCase().includes(q) ||
    cid.toLowerCase().includes(q)
  );
}, [carryIds, query, unitInfo]);

  // 캐리 목록 — 캐시 없을 때만 fetch
  useEffect(() => {
    if (specialsListCache !== null) return;   // 이미 캐싱됨 → 스킵
    fetch(`${API_BASE}/api/carry/specials-list`)
      .then((r) => r.json())
      .then((ids) => { specialsListCache = ids; setCarryIds(ids); })
      .catch(() => setCarryIds([]))
      .finally(() => setLoading(false));
  }, []);

  // 캐리 선택 — 캐시 히트면 즉시, 아니면 fetch 후 캐싱
  function selectCarry(cid) {
    setSelected(cid);
    if (specialsDetailCache[cid]) {
      setData(specialsDetailCache[cid]);   // 캐시 히트 → 재요청 없음
      return;
    }
    setDetailLoading(true);
    fetch(`${API_BASE}/api/carry/${cid}/specials`)
      .then((r) => r.json())
      .then((d) => { specialsDetailCache[cid] = d; setData(d); })
      .catch(() => setData(null))
      .finally(() => setDetailLoading(false));
  }

  const renderItems = (items) => {
    if (!items || items.length === 0) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((it) => (
          <div key={it.item_id} style={{ display: "flex", alignItems: "center", gap: 12,
            padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.03)",
            border: `1px solid ${T.line}` }}>
            <img src={it.icon} alt={it.name} width={36} height={36}
              style={{ borderRadius: 8, border: `1px solid ${T.line}` }}
              onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
            <span style={{ fontFamily: T.fontDisplay, flex: 1, fontSize: 14, fontWeight: 600 }}>{itemInfo[it.item_id] ?? it.name}</span>
            <span style={{ fontFamily: T.fontDisplay, fontSize: 15, fontWeight: 700, color: T.gold }}>
              {it.avg_placement.toFixed(2)}
            </span>
            <span style={{ fontSize: 11, color: T.muted }}>({it.picks})</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{
      minHeight: "100%",
      background: `radial-gradient(120% 80% at 50% -10%, ${T.bg2}, ${T.bg})`,
      color: T.text, fontFamily: T.fontKR, padding: "40px 20px",
    }}>
      <StyleInject />
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <button onClick={onBack} style={{ appearance: "none", background: "none",
            border: `1px solid ${T.line}`, borderRadius: 10, color: T.text,
            padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>
            &larr;
          </button>
          <h2 style={{ fontFamily: T.fontDisplay, fontSize: 16, fontWeight: 800, margin: 0 }}>
            {t.specials_title ?? "캐리별 특수 아이템"}
          </h2>
        </div>

        {loading ? (
          <div style={{ fontFamily: T.fontDisplay, textAlign: "center", color: T.muted, padding: 40 }}>...</div>
        ) : selected ? (
          <div>
            <button onClick={() => { setSelected(null); setData(null); }}
              style={{ appearance: "none", background: "none", border: "none",
                color: T.muted, cursor: "pointer", fontSize: 13, marginBottom: 16 }}>
              ← {t.specials_all ?? "전체 캐리"}
            </button>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
              {unitIcon(selected) && (
                <img src={unitIcon(selected)} alt="" width={72} height={72}
                  style={{ borderRadius: 12, objectFit: "cover" }} />
              )}
              <div style={{ marginTop: 10, fontWeight: 800, fontSize: 20 }}>
                {unitInfo[selected]?.name ?? selected}
              </div>
            </div>

            {detailLoading ? (
              <div style={{ textAlign: "center", color: T.muted, padding: 20 }}>...</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {data?.artifacts?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.violet, marginBottom: 8 }}>
                      💎 {t.specials_artifact ?? "유물"}
                    </div>
                    {renderItems(data.artifacts)}
                  </div>
                )}
                {data?.emblems?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.teal, marginBottom: 8 }}>
                      🔮 {t.specials_emblem ?? "상징"}
                    </div>
                    {renderItems(data.emblems)}
                  </div>
                )}
                {!data?.artifacts?.length && !data?.emblems?.length && (
                  <div style={{ textAlign: "center", color: T.muted, padding: 20, fontSize: 13 }}>
                    {t.specials_none ?? "표본이 충분한 특수 아이템이 없습니다"}
                  </div>
                )}
              </div>
            )}
          </div>
    ) : (
      <>
        <SearchInput value={query} onChange={setQuery}
          placeholder={t.search_carry ?? "캐리 검색"} />

        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", color: T.muted, padding: "32px 0", fontSize: 13 }}>
            {t.search_none ?? "검색 결과가 없습니다"}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 10 }}>
            {filtered.map((cid) => (
              <button key={cid} onClick={() => selectCarry(cid)}
                style={{ appearance: "none", cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                  padding: "10px 4px", borderRadius: 12, border: `1px solid ${T.line}`,
                  background: "rgba(255,255,255,0.03)", color: T.text }}>
                {unitIcon(cid) ? (
                  <img src={unitIcon(cid)} alt="" width={44} height={44}
                    style={{ borderRadius: 8, objectFit: "cover" }} />
                ) : (
                  <span style={{ width: 44, height: 44 }} />
                )}
                <span style={{ fontSize: 10, color: T.muted, textAlign: "center",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
                  {unitInfo[cid]?.name ?? cid}
                </span>
              </button>
            ))}
          </div>
        )}
      </>
    )}
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
    <div style={{ minHeight: 540, borderRadius: 24, padding: 22,
      background: `linear-gradient(160deg, ${T.card2}, ${T.card1})`, border: `1px solid ${T.line}`,
      boxShadow: "0 30px 60px -20px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)",
      display: "flex", flexDirection: "column" }}>
      {children}
    </div>
  );
}

function ItemCard({ current, chosen, reveal, onPick, onNext }) {
  const { t } = useContext(LangContext);
  const costMap = useContext(CostContext);
  const carryCost = costColor(costMap[current.carry.id]);
  const unitInfo = useContext(UnitInfoContext);
  const traitInfo = useContext(TraitInfoContext);

  const carryName = unitInfo[current.carry.id]?.name ?? current.carry.name;

  // 정답/선택 조합 찾기 (reveal 시)
  const best   = current.options?.find((o) => o.is_best);
  const yours  = current.options?.find((o) => o.combo === chosen);
  const hidden = current.hidden;

  const topTrait = best?.top_deck?.replace("trait:", "");
  const topTraitIcon = topTrait ? traitInfo[topTrait]?.icon : null;


  // 3템 조합 아이콘 렌더 헬퍼
  const renderComboIcons = (items, highlight) => {
    if (!Array.isArray(items)) return null;
    return (
      <span style={{ 
        display: "flex", 
        alignItems: "center", 
        justifyContent: "center",   // 가운데 정렬
        gap: 8,                      // 아이콘 간격 (4→8)
        width: "100%"                // 버튼 안에서 꽉 차게
      }}>
        {items.map((it, i) => (
          <img
            key={i}
            src={it.icon}
            alt={it.name}
            title={it.name}           // 이름은 hover로만
            width={40}                // 28→40 (크게)
            height={40}
            style={{
              borderRadius: 8,
              border: highlight ? `2px solid ${T.gold}` : `1px solid ${T.line}`,
            }}
            onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
          />
        ))}
      </span>
    );
  };

  return (
    <CardShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: T.fontDisplay, fontSize: 11, letterSpacing: "0.12em", color: T.muted,
          border: `1px solid ${T.line}`, borderRadius: 999, padding: "4px 10px" }}>PATCH {current.patch}</span>
        <span style={{ fontSize: 11, color: T.muted }}>{t.item_pick}</span>
      </div>

      {/* 캐리 유닛 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 18, marginBottom: 6 }}>
        <div style={{ position: "relative", width: 92, height: 92 }}>
          <div style={{ position: "absolute", inset: -3, clipPath: HEX, background: carryCost ?? `linear-gradient(135deg, ${T.violet}, ${T.gold})` }} />
          <div style={{ position: "absolute", inset: 0, clipPath: HEX, overflow: "hidden",
            background: `linear-gradient(160deg, ${T.card2}, ${T.bg2})`,
            display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 34 }}>
            {unitIcon(current.carry.id) ? (
              <img src={unitIcon(current.carry.id)} alt="" width={92} height={92} style={{ objectFit: "cover" }}
                onError={(e) => { e.currentTarget.style.display = "none"; e.currentTarget.parentNode.textContent = initial(carryName); }} />
            ) : initial(carryName)}
          </div>
        </div>
        <div style={{ marginTop: 14, fontWeight: 800, fontSize: 22 }}>{carryName}</div>
        <div style={{ marginTop: 4, fontSize: 13, color: T.muted }}>{t.item_q}</div>
      </div>

      {/* 선택지 — reveal이면 각 조합에 평균순위/BEST 배지 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 14 }}>
        {current.options.map((opt, idx) => {
          let border = T.line, bg = "rgba(255,255,255,0.03)", glow = "none", badge = null;
          let anim = "none";
          if (reveal) {
            if (opt.is_best) { border = T.gold; bg = "rgba(246,198,82,0.12)"; glow = `0 0 0 1px ${T.gold}`; badge = "BEST"; anim = "rv-glow .45s ease-out both"; }
            else if (opt.combo === chosen) { border = T.red; bg = "rgba(255,101,133,0.12)"; anim = "rv-shake .28s ease-in-out";}
          }
          return (
            <button key={opt.combo} disabled={!!reveal}
              onClick={() => onPick(opt.combo)}
              style={{
                appearance: "none", cursor: reveal ? "default" : "pointer",
                borderRadius: 14, border: `1px solid ${border}`, background: bg, boxShadow: glow,
                animation: anim,
                padding: "13px 15px", color: T.text,
                display: "flex", alignItems: "center",
                justifyContent: reveal ? "space-between" : "center",
              }}
              className="pressable">
              {renderComboIcons(opt.items, reveal && opt.is_best)}
              {reveal && (
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, animation: `rv-in .3s ease-out ${0.15 + idx * 0.04}s both`, }}>
                  {badge && <span style={{ fontFamily: T.fontDisplay, fontSize: 10, fontWeight: 700, color: T.gold }}>{badge}</span>}
                  <span style={{ fontFamily: T.fontDisplay, fontSize: 14, fontWeight: 700, color: opt.is_best ? T.gold : T.muted }}>
                    {opt.avg_placement?.toFixed(2)}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 결과 영역 */}
      <div style={{ marginTop: "auto", paddingTop: 16 }}>
        {reveal ? (
          <div>
            {/* 정답/오답 문구 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
              fontWeight: 800, fontSize: 16, color: reveal.correct ? T.teal : T.red }}>
              <span style={{ fontFamily: T.fontDisplay, animation: "rv-in .3s ease-out .3s both",}}>{reveal.correct ? t.correct : t.wrong}</span>
            </div>

            {/* 히든픽 */}
            {current.hidden && (
              <div style={{ marginBottom: 12, padding: "11px 13px", borderRadius: 12,
                background: "rgba(139,108,255,0.1)", border: `1px solid ${T.line}`,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: T.violet, fontWeight: 700, animation: "rv-in .35s ease-out .45s both", }}>💎 {t.hidden_pick}  </span>
                {renderComboIcons(current.hidden.items, false)}
                <span style={{ fontFamily: T.fontDisplay, fontSize: 13, fontWeight: 700, color: T.violet }}>
                  {current.hidden.avg?.toFixed(2)}
                </span>
                <span style={{ fontSize: 11, color: T.muted }}>({current.hidden.n})</span>
              </div>
            )}


            {/* 최빈덱 맥락 — 이 조합이 주로 어떤 덱에서 쓰였는지 */}
            {topTrait && (
              <div style={{
                display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap",
                marginBottom: 12, fontSize: 12, color: T.muted,
              }}>
                <span>{t.item_mostly_in}</span>
                {topTraitIcon && (
                  <img src={topTraitIcon} alt="" width={16} height={16}
                    style={{ filter: "brightness(0) invert(1)", flexShrink: 0, opacity: 0.85 }}
                    onError={(e) => { e.currentTarget.style.display = "none"; }} />
                )}
                <b style={{ color: T.text }}>{traitInfo[topTrait]?.name ?? topTrait}</b>
                <span>{fmt(t.item_deck_ratio, { r: best.top_deck_ratio })}</span>
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
            let anim = "none";
            if (reveal) {
              if (st?.is_best) { border = T.gold; bg = "rgba(246,198,82,0.12)"; anim = "rv-glow .45s ease-out both"; }
              else if (opt.id === chosen) { border = T.red; bg = "rgba(255,101,133,0.12)"; anim = "rv-shake .28s ease-in-out"; }
            }
            return (
              <button key={opt.id} disabled={!!reveal} onClick={() => onPick(opt.name, opt.id)}
                style={{ appearance: "none", cursor: reveal ? "default" : "pointer",
                  borderRadius: 12, border: `1px solid ${border}`, background: bg,
                  padding: "8px 10px", color: T.text, fontFamily: T.fontKR, fontSize: 13, fontWeight: 600,
                  display: "flex", alignItems: "center", gap: 8 }}
                className="pressable">
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
            <div style={{ fontWeight: 800, fontSize: 15, color: reveal.correct ? T.teal : T.red, 
            fontFamily: T.fontDisplay, marginBottom: 8, animation: "rv-in .3s ease-out .3s both", }}>
              {reveal.correct ? t.correct : t.wrong}
              <span style={{ color: T.muted, fontWeight: 500, fontSize: 12, marginLeft: 8 }}>{fmt(t.deck_best, {name: unitInfo[best?.id]?.name ?? best?.name,})}</span>
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
          let anim = "none";
          if (reveal) {
            if (isAns) { border = T.teal; bg = "rgba(61,224,168,0.12)"; color = T.teal; anim = "rv-glow .45s ease-out both"; }       // 정답
            else if (isSel) { border = T.red; bg = "rgba(255,101,133,0.12)"; color = T.red; anim = "rv-shake .28s ease-in-out"; }    // 틀리게 고름
          } else if (isSel) {
            border = T.violet; bg = "rgba(139,108,255,0.15)"; color = T.violet;                  // 선택 중
          }

          const icon = traitInfo[tr]?.icon;

          return (
            <button key={tr} disabled={!!reveal} onClick={() => toggle(tr)}
              style={{ appearance: "none", cursor: reveal ? "default" : "pointer", gap: 8,
                borderRadius: 999, border: `1.5px solid ${border}`, background: bg, color,
                padding: "8px 14px", fontFamily: T.fontKR, fontSize: 13, fontWeight: 600 }}
              className="pressable">
              {/* 특성 아이콘 */}
              {icon && (
                <img src={icon} alt="" width={18} height={18}
                  style={{ filter: "brightness(0) invert(1)", flexShrink: 0 }}
                  onError={(e) => { e.currentTarget.style.display = "none"; }} />
              )}
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
              fontFamily: T.fontDisplay, marginBottom: 6, animation: "rv-in .35s ease-out .45s both", }}>
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
              padding: "13px", fontFamily: T.fontDisplay, fontWeight: 700, fontSize: 15 }}
            className="pressable">
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

/** 회색 블록 하나. shimmer가 위를 훑고 지나간다. */
function SkBlock({ w, h, r = 8, style }) {
  return (
    <div style={{
      position: "relative", overflow: "hidden",
      width: w, height: h, borderRadius: r,
      background: "rgba(255,255,255,0.055)",
      ...style,
    }}>
      <div className="sk-shimmer" style={{
        position: "absolute", inset: 0,
        background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)`,
        animation: "sk-shimmer 1.6s ease-in-out infinite",
      }} />
    </div>
  );
}

function SkeletonCard() {
  const { t } = useContext(LangContext);
  // 콜드 스타트(2~3초)처럼 유독 길어질 때만 안내 문구를 띄운다.
  const showSlowHint = useDelayed(true, 2500);

  return (
    <CardShell>
      {/* 상단: 패치 배지 + 라벨 자리 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <SkBlock w={92} h={24} r={999} />
        <SkBlock w={54} h={12} />
      </div>

      {/* 가운데: 육각 주체 + 이름 + 부제 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
        marginTop: 18, marginBottom: 6 }}>
        <div style={{
          position: "relative", overflow: "hidden",
          width: 92, height: 92, clipPath: HEX,
          background: "rgba(255,255,255,0.055)",
        }}>
          <div className="sk-shimmer" style={{
            position: "absolute", inset: 0,
            background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent)`,
            animation: "sk-shimmer 1.6s ease-in-out infinite",
          }} />
        </div>
        <SkBlock w={132} h={22} style={{ marginTop: 14 }} />
        <SkBlock w={168} h={13} style={{ marginTop: 10 }} />
      </div>

      {/* 선택지 자리 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 14 }}>
        {[0, 1, 2, 3].map((i) => (
          <SkBlock key={i} w="100%" h={52} r={14} />
        ))}
      </div>

      {/* 하단: 평소엔 비어 있고, 오래 걸릴 때만 안내 */}
      <div style={{ marginTop: "auto", paddingTop: 16, textAlign: "center",
        fontSize: 12, color: T.muted, minHeight: 18 }}>
        {showSlowHint && (
          <span style={{ animation: "sk-fadein .3s ease-out both" }}>
            {t.loading_slow ?? "서버를 깨우는 중입니다…"}
          </span>
        )}
      </div>
    </CardShell>
  );
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

      /* 정답 카드가 켜지는 순간 — 골드 글로우가 번졌다 잦아든다 */
      @keyframes rv-glow {
        0%   { box-shadow: 0 0 0 0 rgba(246,198,82,0); }
        40%  { box-shadow: 0 0 0 3px rgba(246,198,82,0.35); }
        100% { box-shadow: 0 0 0 1px rgba(246,198,82,1); }
      }

      /* 통계·히든픽이 따라 나오는 등장 */
      @keyframes rv-in {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: none; }
      }

      /* 내가 고른 오답이 살짝 흔들린다 (짧게, 한 번만) */
      @keyframes rv-shake {
        0%, 100% { transform: translateX(0); }
        25%      { transform: translateX(-3px); }
        75%      { transform: translateX(3px); }
      }
      @media (prefers-reduced-motion: reduce) {
        .rv-glow, .rv-in, .rv-shake { animation: none !important; }
      }

      .pressable { transition: transform .1s ease; }
      .pressable:active:not(:disabled) { transform: scale(0.985); }
      @media (prefers-reduced-motion: reduce) {
        .pressable:active { transform: none; }
      }
    `}</style>
  );
}