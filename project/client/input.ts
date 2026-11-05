import type { InputState } from '../shared/types.js';

type Control = 'left' | 'right' | 'down' | 'jump' | 'pickup' | 'attack' | 'dash' | 'skill1' | 'skill2';
const DEFAULT_BINDINGS: Record<Control, string> = {
  left: 'KeyA', right: 'KeyD', down: 'KeyS', jump: 'Space', pickup: 'KeyF',
  attack: 'KeyJ', dash: 'KeyK', skill1: 'KeyI', skill2: 'KeyL',
};
const STORAGE_KEY = 'pixel-brawl-bindings-v1';
const CONTROLS = Object.keys(DEFAULT_BINDINGS) as Control[];

export interface GameInput {
  read(): InputState;
  clear(): void;
  destroy(): void;
  bindings: Record<string, string>;
  setBinding(action: string, code: string): void;
}

function editable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable="true"],[contenteditable=""]');
}

export function createInput(canvas: HTMLElement, onInteraction?: () => void): GameInput {
  const bindings: Record<string, string> = { ...DEFAULT_BINDINGS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const action of CONTROLS) {
      if (typeof saved[action] === 'string' && /^[A-Za-z][A-Za-z0-9]{1,31}$/.test(saved[action])) bindings[action] = saved[action];
    }
  } catch { /* A private browsing session can refuse storage. */ }

  const keys = new Set<string>();
  const pulses = new Set<Control>();
  const pointers = new Map<number, { control: Control; target: HTMLElement }>();
  const previousTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = 'none';
  let destroyed = false;

  function held(control: Control): boolean {
    return keys.has(bindings[control]) || [...pointers.values()].some(pointer => pointer.control === control);
  }
  function releasePointer(pointerId: number): void {
    const pointer = pointers.get(pointerId);
    if (!pointer) return;
    pointers.delete(pointerId);
    if (![...pointers.values()].some(other => other.target === pointer.target)) {
      pointer.target.classList.remove('is-pressed');
      pointer.target.removeAttribute('data-pressed');
    }
    try { if (pointer.target.hasPointerCapture(pointerId)) pointer.target.releasePointerCapture(pointerId); } catch { /* The browser may already have cancelled capture. */ }
  }
  function clear(): void {
    keys.clear();
    pulses.clear();
    for (const pointerId of [...pointers.keys()]) releasePointer(pointerId);
  }
  function keydown(event: KeyboardEvent): void {
    if (destroyed || editable(event.target) || editable(document.activeElement)) return;
    const action = CONTROLS.find(control => bindings[control] === event.code);
    if (!action) return;
    event.preventDefault();
    if (!keys.has(event.code)) pulses.add(action);
    keys.add(event.code);
    onInteraction?.();
  }
  function keyup(event: KeyboardEvent): void {
    keys.delete(event.code);
    if (!editable(event.target) && CONTROLS.some(control => bindings[control] === event.code)) event.preventDefault();
  }
  function pointerdown(event: PointerEvent): void {
    if (destroyed || !(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>('[data-control]');
    const control = target?.dataset.control as Control | undefined;
    if (!target || !control || !CONTROLS.includes(control)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    releasePointer(event.pointerId);
    target.style.touchAction = 'none';
    pointers.set(event.pointerId, { control, target });
    pulses.add(control);
    target.classList.add('is-pressed');
    target.setAttribute('data-pressed', 'true');
    try { target.setPointerCapture(event.pointerId); } catch { /* Synthetic pointers do not always support capture. */ }
    onInteraction?.();
  }
  function pointerup(event: PointerEvent): void { releasePointer(event.pointerId); }
  function visibility(): void { if (document.hidden) clear(); }
  function focusin(event: FocusEvent): void { if (editable(event.target)) clear(); }
  function contextmenu(event: Event): void { event.preventDefault(); }

  window.addEventListener('keydown', keydown, { passive: false });
  window.addEventListener('keyup', keyup, { passive: false });
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('focusin', focusin);
  document.addEventListener('pointerdown', pointerdown, { passive: false });
  document.addEventListener('pointerup', pointerup);
  document.addEventListener('pointercancel', pointerup);
  document.addEventListener('lostpointercapture', pointerup);
  canvas.addEventListener('contextmenu', contextmenu);

  return {
    bindings,
    read(): InputState {
      if (destroyed || editable(document.activeElement)) return { move: 0, down: false, jump: false, pickup: false, attack: false, dash: false, skill1: false, skill2: false };
      const active = (control: Control) => held(control) || pulses.has(control);
      const state: InputState = {
        move: Number(active('right')) - Number(active('left')),
        down: active('down'), jump: active('jump'), pickup: active('pickup'),
        attack: active('attack'), dash: active('dash'), skill1: active('skill1'), skill2: active('skill2'),
      };
      pulses.clear();
      return state;
    },
    clear,
    setBinding(action: string, code: string): void {
      if (!CONTROLS.includes(action as Control) || !/^[A-Za-z][A-Za-z0-9]{1,31}$/.test(code)) return;
      const prior = bindings[action];
      const conflict = CONTROLS.find(control => control !== action && bindings[control] === code);
      if (conflict) bindings[conflict] = prior;
      bindings[action] = code;
      clear();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch { /* Rebinding still works for this session. */ }
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      clear();
      canvas.style.touchAction = previousTouchAction;
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('focusin', focusin);
      document.removeEventListener('pointerdown', pointerdown);
      document.removeEventListener('pointerup', pointerup);
      document.removeEventListener('pointercancel', pointerup);
      document.removeEventListener('lostpointercapture', pointerup);
      canvas.removeEventListener('contextmenu', contextmenu);
    },
  };
}
