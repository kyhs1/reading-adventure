/* 책장 + 읽기 화면 */
(function () {
  'use strict';

  const CONFIG = {
    PASS: 0.9,            // 문장 통과 기준 (90% 일치)
    LISTEN_AFTER: 2,      // 몇 번 틀리면 🔊 들어보기 켜기
    SKIP_AFTER: 3,        // 몇 번 틀리면 ⏭ 건너뛰기 보이기
    BOOK_BONUS: 10,
    PERFECT_BONUS: 5,
    BOOK_COINS: 3,
  };

  const $ = (id) => document.getElementById(id);
  const DEBUG = /[?&]debug=1/.test(location.search);
  const { state } = Store;

  /* ================= 책장 ================= */
  function iconHTML(icon) {
    if (!icon) return '📖';
    return /\.(png|jpe?g|webp|gif|svg)$/i.test(icon)
      ? `<img src="${icon}" alt="">` : icon;
  }

  function pagesOf(id) {
    const pages = [];
    for (const row of BOOK_DATA.books[id] || []) {
      let p = pages.find(x => x.no === row.page);
      if (!p) { p = { no: row.page, lines: [] }; pages.push(p); }
      p.lines.push(row);
    }
    return pages.sort((a, b) => a.no - b.no);
  }

  function renderShelf() {
    $('shelf-stars').textContent = state.stars;
    $('shelf-coins').textContent = state.coins;
    const grid = $('book-grid');
    grid.innerHTML = '';
    for (const info of BOOK_DATA.list) {
      if (!info.open) continue;
      const pages = pagesOf(info.id);
      const b = Store.book(info.id);
      const got = Object.values(b.best).reduce((s, v) => s + v, 0);
      const resume = validResume(b, pages);
      const card = document.createElement('button');
      card.className = 'book-card' + (b.completed ? ' completed' : '');
      card.innerHTML = `
        <div class="icon">${iconHTML(info.icon)}</div>
        <div class="title">${info.title}</div>
        <div class="meta">${pages.length}쪽 · ⭐ ${got} / ${pages.length * 3}</div>
        <div class="badges">
          ${b.completed
            ? `<span class="badge coin-got">🪙 코인 받았어요</span>`
            : `<span class="badge coin-wait">🪙 다 읽으면 +${CONFIG.BOOK_COINS}</span>`}
          ${resume ? `<span class="badge resume">🔖 ${resume.page + 1}쪽 읽는 중</span>` : ''}
          ${b.reads ? `<span class="badge">📖 ${b.reads}번 읽었어요</span>` : ''}
        </div>`;
      card.onclick = () => openBook(info);
      grid.appendChild(card);
    }
  }

  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  }

  /* ================= 읽기 ================= */
  const listener = Speech.Listener.supported ? new Speech.Listener() : null;
  let R = null; // 현재 읽기 상태

  /* ---------- 읽던 곳 저장 ---------- */
  function validResume(b, pages) {
    const r = b.resume;
    if (!r || r.page < 0 || r.page >= pages.length) return null;
    if (r.page === 0 && r.line === 0) return null;
    if (r.line >= pages[r.page].lines.length) return null;
    return r;
  }

  function saveResume(page, line, fails) {
    const b = Store.book(R.info.id);
    b.resume = { page, line, fails };
    Store.save();
  }

  function openBook(info) {
    R = { info, pages: pagesOf(info.id) };
    $('book-icon').innerHTML = iconHTML(info.icon);
    $('book-title').textContent = info.title;
    $('reader-stars').textContent = state.stars;
    show('reader');
    const resume = validResume(Store.book(info.id), R.pages);
    if (!resume) { startPage(0); return; }
    startPage(resume.page, resume.line, resume.fails);
    overlay('🔖 읽던 곳이 있어요', '📖',
      `지난번에 ${resume.page + 1}쪽 ${resume.line + 1}번째 줄 앞에서 멈췄어요.<br>거기서부터 이어서 읽을까요?`,
      '이어서 읽기 ▶', () => {},
      '처음부터', () => { saveResume(0, 0, 0); startPage(0); });
  }

  function startPage(idx, startLine, fails) {
    startLine = startLine || 0;
    R.pageIdx = idx;
    const page = R.pages[idx];
    R.lineIdx = startLine;
    R.pageFails = fails || 0;
    R.lines = page.lines.map((row, i) => ({
      row,
      sent: Matcher.prepare(row.text, row.reading),
      fails: 0,
      shown: 0,
      wrongWords: new Set(),
      passed: i < startLine,
    }));
    $('page-no').textContent = `${idx + 1} / ${R.pages.length}쪽`;
    renderLines();
    setLineControls();
    say(startLine ? '이어서 읽어 볼까요? 🎤' : '🎤를 누르고 소리 내어 읽어 보세요');
  }

  function renderLines() {
    const box = $('lines');
    box.innerHTML = '';
    R.lines.forEach((L, i) => {
      const div = document.createElement('div');
      div.className = 'line ' + (i < R.lineIdx ? 'past' : i === R.lineIdx ? 'current' : 'future');
      if (L.passed) div.classList.add('passed');
      L.el = div;
      L.charEls = [];
      let wordEl = null, w = -1;
      [...L.row.text].forEach((ch, ci) => {
        const wi = L.sent.wordOf[ci];
        if (/\s/.test(ch)) { div.appendChild(document.createTextNode(ch)); wordEl = null; L.charEls.push(null); return; }
        if (!wordEl || wi !== w) {
          wordEl = document.createElement('span');
          wordEl.className = 'w';
          wordEl.dataset.w = wi;
          div.appendChild(wordEl);
          w = wi;
        }
        const c = document.createElement('span');
        c.className = 'c';
        c.textContent = ch;
        wordEl.appendChild(c);
        L.charEls.push(c);
      });
      box.appendChild(div);
    });
    paint();
    const cur = R.lines[R.lineIdx];
    if (cur && cur.el) cur.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /** 현재 줄 색칠 (노래방) + 틀린 단어 밑줄 */
  function paint() {
    const L = R.lines[R.lineIdx];
    if (!L) return;
    const map = L.sent.disp.map;
    const last = L.passed ? Infinity : (L.shown > 0 ? map[L.shown - 1] : -1);
    L.charEls.forEach((c, i) => { if (c) c.classList.toggle('on', i <= last); });
    L.el.querySelectorAll('.w').forEach(w => {
      w.classList.toggle('wrong', L.wrongWords.has(Number(w.dataset.w)));
    });
  }

  function setLineControls() {
    const L = R.lines[R.lineIdx];
    const listenOn = !!L && (L.fails >= CONFIG.LISTEN_AFTER || DEBUG);
    $('btn-listen').disabled = !listenOn;
    $('btn-listen').classList.toggle('hint', !!L && L.fails === CONFIG.LISTEN_AFTER);
    $('btn-skip').classList.toggle('hidden', !L || L.fails < CONFIG.SKIP_AFTER);
  }

  function say(text, tone) {
    const m = $('message');
    m.textContent = text;
    m.className = 'message' + (tone ? ' ' + tone : '');
  }

  function debug(text) {
    if (!DEBUG) return;
    const d = $('debug');
    d.classList.remove('hidden');
    d.textContent = text;
  }

  /* ---------- 마이크 ----------
   * 🎤 한 번 누르면 이어 듣기 시작 → 통과할 때마다 다음 줄 자동으로 듣기
   * 틀렸을 때 / 10초쯤 조용할 때 / ⏹ 정지를 눌렀을 때 멈춤 → 🎤로 다시 시작
   */
  let running = false;   // 이어 듣기 중
  let timer = null;

  function setRunning(on) {
    running = on;
    const b = $('btn-mic');
    b.textContent = on ? '⏹' : '🎤';
    b.classList.toggle('running', on);
    b.setAttribute('aria-label', on ? '멈추기' : '읽기 시작');
    if (!on) { clearTimeout(timer); b.classList.remove('listening'); }
  }

  function micToggle() {
    if (!listener) { say('이 브라우저는 음성 인식이 안 돼요. 크롬에서 열어 주세요.', 'warn'); return; }
    if (running) { stopReading('멈췄어요. 🎤를 누르면 다시 시작해요'); return; }
    setRunning(true);
    listenLine();
  }

  /** ⏹ 정지: 지금 듣던 것은 판정하지 않고 멈춤 */
  function stopReading(msg) {
    setRunning(false);
    if (listener) listener.cancel();
    const L = R && R.lines[R.lineIdx];
    if (L && !L.passed) { L.shown = 0; paint(); }
    if (msg) say(msg);
  }

  function listenLine() {
    if (!running || listener.active) return;
    const L = R.lines[R.lineIdx];
    if (!L || L.passed) return;
    L.shown = 0;
    L.wrongWords = new Set();
    paint();
    if ('speechSynthesis' in window) speechSynthesis.cancel();

    listener.start({
      onStart: () => { $('btn-mic').classList.add('listening'); say('듣고 있어요… 👂'); },
      onText: (text) => {
        const p = Matcher.progress(L.sent, text);
        if (p > L.shown) { L.shown = p; paint(); }  // 앞으로만 진행
        debug(`인식: ${text}\n진행: ${L.shown}/${L.sent.disp.chars.length}`);
      },
      isComplete: () => L.shown >= L.sent.disp.chars.length,
      onEnd: (text, reason) => {
        $('btn-mic').classList.remove('listening');
        finishLine(L, text, reason);
      },
    });
  }

  function finishLine(L, text, reason) {
    if (reason === 'not-allowed') { stopReading(); say('마이크를 쓸 수 있게 허락해 주세요 (주소창 옆 🔒)', 'warn'); return; }
    if (reason === 'network') { stopReading(); say('인터넷 연결을 확인해 주세요', 'warn'); return; }
    if (!text.trim()) { stopReading(); say('목소리가 안 들려서 잠깐 멈췄어요. 🎤를 누르면 다시 들을게요', 'warn'); return; }

    const g = Matcher.grade(L.sent, text);
    debug(`인식: ${text}\n정확도: ${Math.round(g.accuracy * 100)}%  (${reason})`);

    if (g.accuracy >= CONFIG.PASS) {
      if (g.wrongWords.size) passLine(L, '잘 읽었어요! 주황색 단어만 조심해요 ⭐', g.wrongWords);
      else passLine(L, '참 잘 읽었어요! ⭐');
    } else {
      L.fails++;
      R.pageFails++;
      L.shown = 0;
      L.wrongWords = g.wrongWords;
      setRunning(false);   // 틀리면 멈춤 → 주황 단어 확인 후 🎤로 다시
      paint();
      if (L.fails >= CONFIG.LISTEN_AFTER) say('🔊를 눌러 들어 보고, 🎤를 눌러 따라 읽어 볼까?', 'warn');
      else say('주황색 단어를 잘 보고 🎤를 눌러 다시 읽어 볼까?', 'warn');
      setLineControls();
    }
  }

  function passLine(L, msg, wrongWords) {
    L.passed = true;
    L.wrongWords = wrongWords || new Set();
    paint();
    say(msg, 'good');
    const lock = $('btn-mic');
    if (!running) lock.disabled = true;   // 넘어가는 동안 🎤 중복 누름 방지 (⏹ 정지는 가능)
    setTimeout(() => {
      lock.disabled = false;
      L.wrongWords = new Set();
      R.lineIdx++;
      if (R.lineIdx < R.lines.length) saveResume(R.pageIdx, R.lineIdx, R.pageFails);
      if (R.lineIdx >= R.lines.length) { setRunning(false); pageDone(); return; }
      renderLines(); setLineControls();
      if (running) listenLine();
      else say('다음 줄도 읽어 볼까요? 🎤');
    }, wrongWords && wrongWords.size ? 2200 : 1100);
  }

  /* ---------- 쪽 완료 / 책 완료 ---------- */
  function starsFor(fails) { return fails === 0 ? 3 : fails <= 2 ? 2 : 1; }

  function starRow(n) {
    return [1, 2, 3].map(i => `<span class="${i <= n ? '' : 'off'}" style="animation-delay:${i * .15}s">⭐</span>`).join('');
  }

  function pageDone() {
    const page = R.pages[R.pageIdx];
    const b = Store.book(R.info.id);
    const stars = starsFor(R.pageFails);
    const prev = b.best[page.no] || 0;
    const gain = Math.max(0, stars - prev);
    if (stars > prev) b.best[page.no] = stars;
    state.stars += gain;
    const last = R.pageIdx === R.pages.length - 1;
    if (!last) saveResume(R.pageIdx + 1, 0, 0);   // 다음 쪽 처음부터 이어 읽기
    Store.save();
    $('reader-stars').textContent = state.stars;

    let detail = gain ? `별 ${gain}개를 받았어요!` : `지난번에도 ⭐ ${prev}개였어요. 더 잘 읽으면 별이 늘어나요!`;
    overlay(stars === 3 ? '최고예요!' : '잘했어요!', starRow(stars), detail,
      last ? '책 다 읽었다! 🎉' : '다음 쪽 ▶',
      () => {
        if (last) { bookDone(); return; }
        startPage(R.pageIdx + 1);
        if (listener) { setRunning(true); listenLine(); }   // [다음 쪽] = 바로 듣기 시작
      });
  }

  function bookDone() {
    const b = Store.book(R.info.id);
    const lines = [];
    b.reads++;
    b.resume = null;
    if (!b.completed) {
      b.completed = true;
      state.stars += CONFIG.BOOK_BONUS;
      state.coins += CONFIG.BOOK_COINS;
      lines.push(`처음 다 읽은 보너스 ⭐ +${CONFIG.BOOK_BONUS}`);
      lines.push(`미니게임 코인 🪙 +${CONFIG.BOOK_COINS}`);
    }
    const allThree = R.pages.every(p => (b.best[p.no] || 0) === 3);
    if (allThree && !b.perfect) {
      b.perfect = true;
      state.stars += CONFIG.PERFECT_BONUS;
      lines.push(`모든 쪽 ⭐⭐⭐ 보너스 +${CONFIG.PERFECT_BONUS}`);
    }
    lines.push(`이 책을 ${b.reads}번 읽었어요 📖`);
    Store.save();
    $('reader-stars').textContent = state.stars;
    overlay(`「${R.info.title}」 완독!`, '🏆', lines.join('<br>'), '책장으로', () => { show('shelf'); renderShelf(); });
  }

  function overlay(title, stars, detail, btnText, onClick, btn2Text, onClick2) {
    $('ov-title').textContent = title;
    $('ov-stars').innerHTML = stars;
    $('ov-detail').innerHTML = detail;
    $('ov-btn').textContent = btnText;
    $('ov-btn').onclick = () => { $('overlay').classList.add('hidden'); onClick(); };
    $('ov-btn2').classList.toggle('hidden', !btn2Text);
    $('ov-btn2').textContent = btn2Text || '';
    $('ov-btn2').onclick = () => { $('overlay').classList.add('hidden'); onClick2 && onClick2(); };
    $('overlay').classList.remove('hidden');
  }

  /* ---------- 버튼 연결 ---------- */
  $('btn-mic').onclick = micToggle;
  $('btn-listen').onclick = () => {
    const L = R.lines[R.lineIdx];
    if (!L || L.passed) return;
    if (running) stopReading();
    say('잘 듣고 따라 읽어 보세요 👂');
    Speech.speak(L.row.reading ? L.row.reading.split('|')[0] : L.row.text,() => say('이제 🎤를 누르고 읽어 볼까?'));
  };
  $('btn-skip').onclick = () => {
    const L = R.lines[R.lineIdx];
    if (!L || L.passed) return;
    if (running) stopReading();
    R.pageFails = Math.max(R.pageFails, 3);
    passLine(L, '다음엔 꼭 읽어 보자! 👍');
  };
  $('btn-back').onclick = () => {
    stopReading();
    show('shelf');
    renderShelf();
  };

  if (!listener) say('이 브라우저는 음성 인식이 안 돼요. 크롬에서 열어 주세요.', 'warn');
  if ('speechSynthesis' in window) speechSynthesis.getVoices(); // 음성 목록 미리 불러오기
  renderShelf();

  // 테스트용
  window.App = { CONFIG, get R() { return R; }, get running() { return running; }, finishLine, openBook, micToggle };
})();
