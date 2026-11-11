/* 음절 단위 비교·판정 로직
 * - 띄어쓰기·문장부호는 무시하고 한글 음절/숫자/영문만 비교
 * - progress(): 읽는 중 "어디까지 읽었나" (노래방 색칠용)
 * - grade():    다 읽은 뒤 정확도와 틀린 단어 위치
 */
(function () {
  'use strict';

  function isKeep(ch) {
    const c = ch.charCodeAt(0);
    return (c >= 0xAC00 && c <= 0xD7A3) || // 한글 음절
           (c >= 0x30 && c <= 0x39) ||      // 숫자
           (c >= 0x61 && c <= 0x7A);        // 영문 소문자
  }

  /** 문자열 → 비교용 음절 배열. map[i] = 원문에서의 위치 */
  function normalize(str) {
    const chars = [];
    const map = [];
    const s = String(str || '').toLowerCase();
    for (let i = 0; i < s.length; i++) {
      if (isKeep(s[i])) { chars.push(s[i]); map.push(i); }
    }
    return { chars, map };
  }

  /* ---------- 숫자 읽기 변형 (음성 인식이 "세 개"를 "3개"로 받아쓰는 경우 대비) ---------- */
  const SINO = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  function sino(n) {
    if (n === 0) return '영';
    const units = [[1000, '천'], [100, '백'], [10, '십']];
    let out = '';
    for (const [u, name] of units) {
      const d = Math.floor(n / u);
      if (d) { out += (d === 1 ? '' : SINO[d]) + name; n %= u; }
    }
    return out + SINO[n];
  }
  const NATIVE_ONES = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉'];
  const NATIVE_ONES_B = ['', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉'];
  const NATIVE_TENS = ['', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔'];
  function native(n, basic) {
    if (n < 1 || n > 99) return null;
    const t = Math.floor(n / 10), o = n % 10;
    let tens = NATIVE_TENS[t];
    if (n === 20 && !basic) tens = '스무';
    return tens + (basic ? NATIVE_ONES_B : NATIVE_ONES)[o];
  }
  function numberVariants(text) {
    if (!/\d/.test(text)) return [text];
    const variants = new Set([text]);
    variants.add(text.replace(/\d+/g, m => sino(parseInt(m, 10))));
    variants.add(text.replace(/\d+/g, m => native(parseInt(m, 10), false) || sino(parseInt(m, 10))));
    variants.add(text.replace(/\d+/g, m => native(parseInt(m, 10), true) || sino(parseInt(m, 10))));
    return [...variants];
  }

  /* ---------- 편집 거리 ---------- */
  function dpTable(T, E) {
    const n = T.length, m = E.length;
    const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 0; i <= n; i++) D[i][0] = i;
    for (let j = 0; j <= m; j++) D[0][j] = j;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const sub = D[i - 1][j - 1] + (T[i - 1] === E[j - 1] ? 0 : 1);
        D[i][j] = Math.min(sub, D[i - 1][j] + 1, D[i][j - 1] + 1);
      }
    }
    return D;
  }

  /** 받아쓴 글 T가 원문 E의 몇 번째 음절까지 왔는지 (0..m) */
  function progressOne(T, E) {
    if (!T.length) return { pos: 0, cost: 0 };
    const D = dpTable(T, E);
    const n = T.length;
    let best = 0, bestCost = Infinity;
    for (let j = 0; j <= E.length; j++) {
      if (D[n][j] <= bestCost) { bestCost = D[n][j]; best = j; } // 동점이면 더 앞으로
    }
    return { pos: best, cost: bestCost };
  }

  /** 전체 비교: 정확도 + 원문 음절별 맞음/틀림 */
  function gradeOne(T, E) {
    const m = E.length;
    if (!m) return { accuracy: 1, wrong: [] };
    const D = dpTable(T, E);
    const dist = D[T.length][m];
    const wrong = new Array(m).fill(false);
    let i = T.length, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (T[i - 1] === E[j - 1] ? 0 : 1)) {
        if (T[i - 1] !== E[j - 1]) wrong[j - 1] = true;
        i--; j--;
      } else if (j > 0 && D[i][j] === D[i][j - 1] + 1) {
        wrong[j - 1] = true; // 빠뜨림
        j--;
      } else {
        // 덧붙여 읽음 → 근처 음절 표시
        wrong[Math.min(Math.max(j - 1, 0), m - 1)] = true;
        i--;
      }
    }
    return { accuracy: Math.max(0, 1 - dist / m), wrong };
  }

  /* ---------- 문장 단위 래퍼 ---------- */
  /**
   * 문장 준비
   * @param text    화면에 보여줄 글
   * @param reading 읽는 법 (없으면 text). "|"로 나누면 여러 개 모두 정답
   *                예: "얘들아 엄마 왔다|애들아 엄마 왔다"
   */
  function prepare(text, reading) {
    const disp = normalize(text);
    const targets = [disp.chars];
    if (reading && reading.trim()) {
      for (const r of reading.split('|')) {
        const chars = normalize(r).chars;
        if (chars.length && !targets.some(t => t.join('') === chars.join(''))) targets.unshift(chars);
      }
    }
    // 화면 글자별 어절(단어) 번호
    const wordOf = [];
    let w = 0;
    for (let i = 0; i < text.length; i++) {
      if (/\s/.test(text[i])) { if (i > 0 && !/\s/.test(text[i - 1])) w++; }
      wordOf.push(w);
    }
    return { text, disp, targets, wordOf };
  }

  // 기준 문장 위치 → 화면 음절 위치 (읽는 법이 다를 때는 비율로 환산)
  function toDisp(sent, target, pos) {
    if (target === sent.disp.chars) return pos;
    return Math.round(pos / target.length * sent.disp.chars.length);
  }

  /** 읽는 중: 화면 음절 몇 개까지 색칠할지 */
  function progress(sent, transcript) {
    let best = 0;
    for (const v of numberVariants(transcript)) {
      const T = normalize(v).chars;
      for (const E of sent.targets) {
        const p = progressOne(T, E);
        best = Math.max(best, toDisp(sent, E, p.pos));
      }
    }
    return best; // 0..disp.chars.length
  }

  /** 다 읽은 뒤: { accuracy, wrongWords:Set(어절번호) } */
  function grade(sent, transcript) {
    let best = null, bestE = null;
    for (const v of numberVariants(transcript)) {
      const T = normalize(v).chars;
      for (const E of sent.targets) {
        const g = gradeOne(T, E);
        if (!best || g.accuracy > best.accuracy) { best = g; bestE = E; }
      }
    }
    const wrongWords = new Set();
    best.wrong.forEach((isWrong, k) => {
      if (!isWrong) return;
      const dIdx = Math.min(toDisp(sent, bestE, k), sent.disp.chars.length - 1);
      wrongWords.add(sent.wordOf[sent.disp.map[dIdx]]);
    });
    return { accuracy: best.accuracy, wrongWords };
  }

  window.Matcher = { normalize, prepare, progress, grade, numberVariants, _gradeOne: gradeOne };
})();
