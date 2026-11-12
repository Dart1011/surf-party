import { sanitizeInput } from './protocol.js';

export class Controls {
  constructor(onChange) {
    this.onChange = onChange;
    this.state = sanitizeInput();
    this.enabled = false;
    this.keys = new Set();
    this.buttons = new Map();
    this.abort = new AbortController();
    const options = { signal: this.abort.signal };
    window.addEventListener('keydown', event => this.key(event, true), options);
    window.addEventListener('keyup', event => this.key(event, false), options);
    window.addEventListener('blur', () => this.reset(), options);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    }, options);
    document.querySelectorAll('[data-control]').forEach(button => {
      const control = button.dataset.control;
      const press = event => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        this.buttons.set(event.pointerId, control);
        this.update();
      };
      const release = event => {
        this.buttons.delete(event.pointerId);
        this.update();
      };
      button.addEventListener('pointerdown', press, options);
      button.addEventListener('pointerup', release, options);
      button.addEventListener('pointercancel', release, options);
      button.addEventListener('lostpointercapture', release, options);
      button.addEventListener('contextmenu', event => event.preventDefault(), options);
    });
  }

  key(event, pressed) {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (!this.enabled && target instanceof HTMLButtonElement)) return;
    const supported = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's', 'A', 'D', 'W', 'S', ' ', 'f', 'F'];
    if (!supported.includes(event.key)) return;
    if (this.enabled) event.preventDefault();
    if (pressed) this.keys.add(event.key.toLowerCase());
    else this.keys.delete(event.key.toLowerCase());
    this.update();
  }

  update() {
    const held = control => [...this.buttons.values()].includes(control);
    const next = sanitizeInput({
      left: this.keys.has('arrowleft') || this.keys.has('a') || held('left'),
      right: this.keys.has('arrowright') || this.keys.has('d') || held('right'),
      up: this.keys.has('arrowup') || this.keys.has('w') || held('up'),
      down: this.keys.has('arrowdown') || this.keys.has('s') || held('down'),
      boost: this.keys.has(' ') || this.keys.has('f') || held('boost'),
    });
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.onChange(next);
  }

  reset() {
    this.keys.clear();
    this.buttons.clear();
    if (Object.values(this.state).some(Boolean)) {
      this.state = sanitizeInput();
      this.onChange(this.state);
    }
  }

  destroy() {
    this.abort.abort();
  }
}
