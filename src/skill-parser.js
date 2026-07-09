/* ============================================================
   TFT 스킬 설명(desc) 파서
   - @변수@ 치환 (Modified 접두사 떼고 variables 매칭, 별레벨별)
   - %i:scaleAP% 등 계수 아이콘 → 텍스트
   - <magicDamage> 등 → 색 span (HTML)
   - <br> → 줄바꿈
   - 조건부 태그(<ShowIf>, enabled=/alternate=) 제거
   출력: HTML 문자열 (dangerouslySetInnerHTML로 렌더)
   ============================================================ */

// 피해 타입별 색 (TFT 관용 색)
const DMG_COLORS = {
  magicDamage: "#3da5ff",    // 마법 파랑
  physicalDamage: "#ff8c42", // 물리 주황
  trueDamage: "#ffffff",     // 고정 흰색
  healing: "#3de0a8",        // 회복 초록
  scaleAP: "#3da5ff",
  scaleAD: "#ff8c42",
  scaleHealth: "#3de0a8",
  TFTKeyword: "#f6c652",     // 키워드 금색
  rules: "#9a8fc2",          // 규칙 회색
};

// 계수 아이콘 마커 → 표시 텍스트
const SCALE_LABELS = {
  scaleAP: "AP",
  scaleAD: "AD",
  scaleHealth: "HP",
  scaleArmor: "방어력",
  scaleMR: "마법저항력",
  scaleAS: "공격속도",
};

const KEYWORD_MAP = {
  "TFT17_SpaceGroove_TheGroove": "그루브",
  // 다음 세트 오면 여기만 갱신
};

/**
 * 변수 매칭: desc의 @Name@ → variables에서 값 찾기
 * "Modified" 접두사를 떼고도 매칭 시도.
 */
/** 변수의 별레벨 값을 "★1/★2/★3" 나열 문자열로. 매칭 실패 시 null. */
function listVarStars(varName, variables) {
  const v = matchVar(varName, variables);
  if (!v || !Array.isArray(v.value)) return null;
  // TFT value 배열은 [★1,★2,★3,...]. 앞 3개(★1~3)를 나열.
  const stars = v.value.slice(0, 3).map(fmtNum);
  // 세 값이 모두 같으면 하나만 (고정값: 지속시간 등)
  if (stars.every((x) => x === stars[0])) return stars[0];
  return stars.join("/");
}

/** 계수 마커 → 표시 span. 계수 아닌 게임 아이콘은 빈 문자열. */
function scaleLabel(key) {
  const map = { scaleAP: ["AP", "#3da5ff"], scaleAD: ["AD", "#ff8c42"],
    scaleHealth: ["HP", "#3de0a8"], scaleArmor: ["방어", "#f6c652"],
    scaleMR: ["마저", "#f6c652"], scaleAS: ["공속", "#3de0a8"] };
  const e = map[key];
  if (!e) return "";
  return `<span style="color:${e[1]};font-size:0.8em"> (${e[0]})</span>`;
}

/** 변수 매칭: 원본 → Modified 뗀 것 → 대소문자무시 → 접두/포함. */
function matchVar(varName, variables) {
  const cands = [varName];
  if (varName.startsWith("Modified")) cands.push(varName.slice(8));
  for (const c of cands) {
    const v = variables.find((x) => x.name === c);
    if (v) return v;
  }
  for (const c of cands) {
    const lc = c.toLowerCase();
    const v = variables.find((x) => x.name.toLowerCase() === lc);
    if (v) return v;
  }
  // 접두/포함 매칭 (불규칙 이름)
  for (const c of cands) {
    const lc = c.toLowerCase();
    const v = variables.find((x) => {
      const xn = x.name.toLowerCase();
      return xn.startsWith(lc) || lc.startsWith(xn);
    });
    if (v) return v;
  }
  return null;
}

/** 숫자 포맷: 정수는 정수로, 소수는 반올림 */
function fmtNum(n) {
  if (n == null) return "?";
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10) / 10);
}

/**
 * HTML 이스케이프 (원본 desc의 안전하지 않은 문자, 근데 태그는 우리가 처리)
 * — 여기선 태그를 살리므로 최소 처리
 */
function escapeText(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 메인 파서
 * @param {string} desc - 원본 설명 (변수/태그 포함)
 * @param {Array} variables - [{name, value:[...]}]
 * @param {number} star - 별 레벨 (1,2,3)
 * @returns {string} HTML 문자열
 */
export function parseSkillDesc(desc, variables = []) {
  if (!desc) return "";
  let s = desc;

  // ── 1. 조건부/제어 태그 제거 (내용은 유지, 태그만) ──
  s = s.replace(/<\/?ShowIf[^>]*>/g, "");
  s = s.replace(/<\/?ShowIfNot[^>]*>/g, "");
  // 속성 제거 (enabled=, alternate=) — 태그명만 남김
  s = s.replace(/\s+enabled=[^\s>]+/g, "");
  s = s.replace(/\s+alternate=[^\s>]+/g, "");

  // ── 2. 여는/닫는 태그를 각각 변환 (중첩 보존) ──
  // 여는 <magicDamage> → <span color>, 닫는 </magicDamage> → </span>.
  // 색 없는 태그(mainText 등)는 여닫기 모두 제거하고 내용만 유지.
  // 열림/닫힘을 개별 변환하므로 중첩이 안 깨짐.
  s = s.replace(/<(\/?)(\w+)([^>]*)>/g, (m, slash, tag) => {
    if (tag === "br") return "<br/>";
    const color = DMG_COLORS[tag];
    if (color) {
      return slash ? "</span>" : `<span style="color:${color};font-weight:600">`;
    }
    return ""; // 색 없는 태그: 제거 (내용 유지)
  });

  // ── 2.5. 특수 변수 패턴 먼저 처리 ──
  // (a) @Name*100@ 형태: 변수값 × 배수 (예: 0.44*100 = 44)
  s = s.replace(/@(\w+)\*(\d+(?:\.\d+)?)@/g, (m, name, mult) => {
    const v = matchVar(name, variables);
    if (!v || !Array.isArray(v.value)) return "";
    const factor = parseFloat(mult);
    const stars = v.value.slice(0, 3).map((x) => fmtNum(x * factor));
    if (stars.every((x) => x === stars[0])) return `<b>${stars[0]}</b>`;
    return `<b>${stars.join("/")}</b>`;
  });
  // (b) @TFTUnitProperty.:XXX@ 등 런타임 유닛 속성: 값 못 구함 → 생략
  //     앞에 붙은 외로운 "+" 기호도 함께 정리 ("체력 +@X@" → "체력")
  s = s.replace(/\s*\+\s*@TFTUnitProperty[^@]*@/g, "");
  s = s.replace(/@TFTUnitProperty[^@]*@/g, "");
  // (c) 기타 점/콜론 포함 특수 참조 → 생략 (variables에 없음)
  s = s.replace(/@[\w.]*[.:][\w.:]*@/g, "");

  // ── 3. @변수@ + 계수 마커를 [★1/★2/★3] 나열로 ──
  // 계산 안 함: variables 원본 값을 별레벨 나열 (틀릴 일 없음).
  // "@Var@(%i:scaleAP%)" → "250/450/525 (AP)"
  const scaleAfter = /@(\w+)@\s*\(?%i:(scale\w+)%\)?/g;
  s = s.replace(scaleAfter, (m, name, scale) => {
    const nums = listVarStars(name, variables);
    if (!nums) return ""; // 매칭 실패(특수 계산 변수 등) → 생략
    const coef = scaleLabel(scale);
    return `<b>${nums}</b>${coef}`;
  });

  // ── 4. 남은 @변수@ (계수 마커 없는 것) 나열 ──
  s = s.replace(/@(\w+)@/g, (m, name) => {
    const nums = listVarStars(name, variables);
    return nums ? `<b>${nums}</b>` : "";
  });

  // ── 5. 남은 %i:XXX% 마커 (변수와 안 붙은 것) ──
  s = s.replace(/\s*\(?%i:(\w+)%\)?/g, (m, key) => scaleLabel(key));

  // ── 5. 남은 정체불명 태그 제거 (br/b/span 제외) ──
  s = s.replace(/<\/?(?!br\b|b\b|span\b)[a-zA-Z][^>]*>/g, "");
  // 과도한 줄바꿈 정리
  s = s.replace(/(<br\/>){3,}/g, "<br/><br/>");

  // 키워드 제거
  s = s.replace(/\{\{([^}]*)\}\}/g, (m, key) => KEYWORD_MAP[key] ?? "");
  return s;
}

export function parseTraitDesc(desc, effects = []) {
  if (!desc) return "";

  function commonVar(name) {
    for (const e of effects) { const v = e?.variables?.[name]; if (v != null) return v; }
    return null;
  }
  function subVars(text, effect) {
    let r = text;
    if (effect) r = r.replace(/@MinUnits@/g, `<b>${effect.minUnits}</b>`);
    r = r.replace(/@(\w+)\*(\d+(?:\.\d+)?)@/g, (m, name, mult) => {
      const v = effect?.variables?.[name] ?? commonVar(name);
      return v == null ? "" : `<b>${fmtNum(v * parseFloat(mult))}</b>`;
    });
    r = r.replace(/@(\w+)@/g, (m, name) => {
      const v = effect?.variables?.[name] ?? commonVar(name);
      return v == null ? "" : `<b>${fmtNum(v)}</b>`;
    });
    return r;
  }

  const rowCount = [...desc.matchAll(/<(row|expandRow)>[\s\S]*?<\/\1>/g)].length;

  let s;
  if (rowCount === 1 && effects.length > 1) {
    s = desc.replace(/<(row|expandRow)>([\s\S]*?)<\/\1>/g, (m, tag, inner) =>
      effects.map(eff => subVars(inner, eff)).join("<br/>")
    );
  } else {
    let rowIdx = 0;
    s = desc.replace(/<(row|expandRow)>([\s\S]*?)<\/\1>/g, (m, tag, inner) => {
      const eff = effects[rowIdx]; rowIdx++;
      return subVars(inner, eff);  // <br/> 안 붙임!
    });
  }
  s = subVars(s, null);
  return parseSkillDesc(s, []);
}

/* ── 테스트 ── */
if (typeof process !== "undefined" && process.argv[1]?.includes("skill-parser")) {
  const desc = "대상에게 정령유성을 떨어뜨려 <magicDamage>@ModifiedDamage@(%i:scaleAP%)</magicDamage>의 마법 피해를 입힙니다.<br><br><mainText enabled=TFT17_Astronaut_IsActive alternate=rules><spellActive enabled=TFT17_Astronaut_IsActive alternate=rules>정령 추가 효과:</spellActive><TFTBonus><ShowIfNot.TFT17_Astronaut_IsActive></ShowIfNot.TFT17_Astronaut_IsActive><ShowIf.TFT17_Astronaut_IsActive></ShowIf.TFT17_Astronaut_IsActive></TFTBonus> 주변 대상에게 미니 정령유성 <TFTBonus>@ModifiedMiniMeeps@(%i:set14AmpIcon%)</TFTBonus>개를 떨어뜨려 각각 <magicDamage>@ModifiedMiniDamage@(%i:scaleAP%)</magicDamage>의 마법 피해를 입힙니다.</mainText>";
  const variables = [
    { name: "Damage", value: [250, 330, 495, 750, 1200, 825, 825] },
    { name: "MiniMeepsPerAstro", value: [2, 2, 2, 2, 2, 2, 2] },
    { name: "MiniDamage", value: [40, 31, 47, 70, 130, 120, 120] },
  ];
  for (const star of [1, 2, 3]) {
    console.log(`\n=== ★${star} ===`);
    console.log(parseSkillDesc(desc, variables, star));
  }
}