/* 음성 인식 래퍼 (크롬 Web Speech API, 한국어)
 * - 말하는 도중 중간 결과를 계속 넘겨줌 → 노래방 색칠
 * - 아이가 중간에 쉬어서 인식이 끊기면 자동으로 다시 켜서 이어 붙임
 * - 문장 끝까지 읽으면 자동으로 끝냄
 */
(function () {
  'use strict';

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  const MAX_RESTARTS = 4;     // 쉬었다 읽을 때 다시 켜는 최대 횟수
  const MAX_SECONDS = 40;     // 한 문장 최대 시간

  class Listener {
    static get supported() { return !!SR; }

    constructor() {
      this.rec = null;
      this.active = false;
    }

    /**
     * @param opts.onText(text)          중간/누적 결과
     * @param opts.isComplete(text)      true면 다 읽은 것으로 보고 자동 종료
     * @param opts.onEnd(text, reason)   reason: done | manual | silence | no-speech | not-allowed | network | error
     * @param opts.onStart()
     */
    start(opts) {
      if (this.active) return;
      this.opts = opts;
      this.active = true;
      this.committed = '';
      this.restarts = 0;
      this.startedAt = Date.now();
      this.finishReason = null;
      this.lastError = null;
      this._session();
    }

    stop() {
      if (!this.active) return;
      this.finishReason = this.finishReason || 'manual';
      try { this.rec && this.rec.stop(); } catch (e) { this._finish(); }
    }

    cancel() {
      if (!this.active) return;
      this.active = false;
      try { this.rec && this.rec.abort(); } catch (e) { /* 무시 */ }
    }

    _join(a, b) { return a && b ? a + ' ' + b : (a || b); }

    _session() {
      const rec = new SR();
      this.rec = rec;
      rec.lang = 'ko-KR';
      rec.interimResults = true;
      rec.continuous = false;   // 안드로이드에서 continuous는 결과가 중복되는 문제가 있어 끔
      rec.maxAlternatives = 1;

      let sessionFinal = '';
      let interim = '';

      rec.onstart = () => { if (this.restarts === 0 && this.opts.onStart) this.opts.onStart(); };

      rec.onresult = (ev) => {
        sessionFinal = ''; interim = '';
        for (let i = 0; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) sessionFinal += t; else interim += t;
        }
        const text = this._join(this.committed, (sessionFinal + ' ' + interim).trim());
        this.opts.onText && this.opts.onText(text);
        if (!this.finishReason && this.opts.isComplete && this.opts.isComplete(text)) {
          this.finishReason = 'done';
          try { rec.stop(); } catch (e) { /* 무시 */ }
        }
      };

      rec.onerror = (ev) => { this.lastError = ev.error; };

      rec.onend = () => {
        if (!this.active) return;
        // 마지막 중간 결과도 버리지 않음 (stop 시 확정이 안 오는 기기 대비)
        this.committed = this._join(this.committed, (sessionFinal || interim).trim());

        if (this.finishReason) return this._finish(this.finishReason);
        const err = this.lastError;
        this.lastError = null;
        if (err === 'not-allowed' || err === 'service-not-allowed') return this._finish('not-allowed');
        if (err === 'network') return this._finish('network');

        const elapsed = (Date.now() - this.startedAt) / 1000;
        if (this.restarts < MAX_RESTARTS && elapsed < MAX_SECONDS) {
          // 아직 아무 말도 안 했으면 한 번만 더 기다려 줌
          if (!this.committed && this.restarts >= 1) return this._finish('no-speech');
          this.restarts++;
          try { this._session(); return; } catch (e) { /* 아래로 */ }
        }
        this._finish(this.committed ? 'silence' : 'no-speech');
      };

      rec.start();
    }

    _finish(reason) {
      if (!this.active) return;
      this.active = false;
      this.opts.onEnd && this.opts.onEnd(this.committed || '', reason || 'error');
    }
  }

  /* 들어보기 (기계 음성) */
  function speak(text, onEnd) {
    if (!('speechSynthesis' in window)) { onEnd && onEnd(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.rate = 0.8;
    const ko = speechSynthesis.getVoices().find(v => v.lang && v.lang.startsWith('ko'));
    if (ko) u.voice = ko;
    u.onend = () => onEnd && onEnd();
    u.onerror = () => onEnd && onEnd();
    speechSynthesis.speak(u);
  }

  window.Speech = { Listener, speak };
})();
