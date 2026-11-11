/* 입장 비밀번호 화면
 * 비밀번호 자체는 코드에 적지 않고, 암호화 해시(SHA-256)만 비교
 * 한 번 맞히면 그 기기에서는 다시 묻지 않음
 */
(function () {
  'use strict';
  const HASH = '864e761e834395dc6662a7ec157f7550329e433666e0923b89e99f0a5da374d2';
  const KEY = 'reading-game-unlock';

  const lock = document.getElementById('lock');
  const shelf = document.getElementById('shelf');

  function unlock() {
    lock.classList.remove('active');
    shelf.classList.add('active');
  }

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* 무시 */ }
  if (saved === HASH) { unlock(); return; }

  lock.classList.add('active');
  shelf.classList.remove('active');

  const input = document.getElementById('lock-input');
  const msg = document.getElementById('lock-msg');

  async function tryUnlock() {
    const h = await sha256(input.value.trim());
    if (h === HASH) {
      try { localStorage.setItem(KEY, HASH); } catch (e) { /* 무시 */ }
      unlock();
    } else {
      msg.textContent = '비밀번호가 달라요';
      input.value = '';
      lock.querySelector('.lock-card').classList.remove('shake');
      void lock.offsetWidth;
      lock.querySelector('.lock-card').classList.add('shake');
    }
  }

  document.getElementById('lock-btn').onclick = tryUnlock;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
})();
