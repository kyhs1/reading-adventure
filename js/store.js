/* 진행 상황 저장 (태블릿 브라우저에 보관) */
(function () {
  'use strict';
  const KEY = 'reading-game-v1';

  function blank() { return { stars: 0, coins: 0, books: {} }; }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign(blank(), JSON.parse(raw));
    } catch (e) { /* 저장소 사용 불가 시 새로 시작 */ }
    return blank();
  }

  const state = load();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ }
  }

  function book(id) {
    if (!state.books[id]) state.books[id] = { best: {}, reads: 0, completed: false, perfect: false };
    return state.books[id];
  }

  window.Store = { state, save, book };
})();
