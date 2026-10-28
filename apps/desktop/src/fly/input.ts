import { NO_INPUT, type FlyInput } from '@odc/core';

export type FlyAction = 'waypoint' | 'poi' | 'togglePath' | 'exit';

/** Keyboard layout shown in the HUD legend. */
export const KEY_HELP: [string, string][] = [
  ['W / S', 'forward / back'],
  ['A / D', 'left / right'],
  ['R / F', 'climb / descend'],
  ['Q / E', 'yaw'],
  ['↑ / ↓ · wheel', 'gimbal tilt'],
  ['drag', 'look around'],
  ['Shift', 'sport speed'],
  ['Space', 'drop waypoint'],
  ['P', 'POI at crosshair'],
  ['L', 'record path on/off'],
  ['Esc', 'exit fly mode'],
];

export const PAD_HELP: [string, string][] = [
  ['Left stick', 'climb / yaw'],
  ['Right stick', 'fly'],
  ['LT / RT', 'gimbal tilt'],
  ['A', 'drop waypoint'],
  ['B', 'POI at crosshair'],
  ['X', 'record path'],
  ['RB (hold)', 'sport speed'],
];

const KEY_ACTIONS: Record<string, FlyAction> = {
  Space: 'waypoint',
  KeyP: 'poi',
  KeyL: 'togglePath',
  Escape: 'exit',
};

// Standard-mapping gamepad buttons: A=0, B=1, X=2.
const PAD_ACTIONS: Record<number, FlyAction> = { 0: 'waypoint', 1: 'poi', 2: 'togglePath' };
const DEADZONE = 0.12;

const dz = (v: number) =>
  Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);

/**
 * Collects keyboard, mouse-wheel and gamepad input for the fly loop. Continuous axes are polled
 * each frame; discrete presses (waypoint, POI, ...) are queued as actions.
 */
export class FlyInputSource {
  private keys = new Set<string>();
  private actions: FlyAction[] = [];
  private wheel = 0;
  private padButtons: boolean[] = [];
  /** Accumulated mouse-drag look, applied directly to yaw/gimbal in degrees. */
  look = { yaw: 0, pitch: 0 };
  gamepadName?: string;

  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest?.('input, select, textarea')) return;
    const action = KEY_ACTIONS[e.code];
    if (action && !e.repeat) this.actions.push(action);
    if (action || /^(Key[WASDQERF]|Arrow(Up|Down)|Shift(Left|Right))$/.test(e.code)) {
      e.preventDefault();
      e.stopPropagation();
    }
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => this.keys.clear();

  constructor(private readonly surface: HTMLElement) {
    // Capture phase so fly keys win over the app's global shortcuts (Space = play, P = POI tool).
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
    surface.addEventListener('wheel', this.onWheel, { passive: false });
    surface.addEventListener('pointerdown', this.onPointerDown);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.wheel += -e.deltaY * 0.02;
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const el = this.surface;
    el.setPointerCapture(e.pointerId);
    let lx = e.clientX;
    let ly = e.clientY;
    const move = (m: PointerEvent) => {
      this.look.yaw += (m.clientX - lx) * 0.15;
      this.look.pitch -= (m.clientY - ly) * 0.12;
      lx = m.clientX;
      ly = m.clientY;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  /** Current stick state plus any queued discrete actions. */
  poll(): { input: FlyInput; actions: FlyAction[]; wheelDeg: number } {
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    const input: FlyInput = {
      ...NO_INPUT,
      forward: k('KeyW') - k('KeyS'),
      right: k('KeyD') - k('KeyA'),
      up: k('KeyR') - k('KeyF'),
      yaw: k('KeyE') - k('KeyQ'),
      gimbal: k('ArrowUp') - k('ArrowDown'),
      boost: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
    };

    const pad = navigator.getGamepads?.().find((g) => g?.connected);
    this.gamepadName = pad?.id;
    if (pad) {
      const ax = (i: number) => dz(pad.axes[i] ?? 0);
      const btn = (i: number) => pad.buttons[i]?.value ?? 0;
      // Mode 2: left stick = yaw (x) / throttle (y), right stick = roll (x) / pitch (y).
      input.yaw = clampUnit(input.yaw + ax(0));
      input.up = clampUnit(input.up - ax(1));
      input.right = clampUnit(input.right + ax(2));
      input.forward = clampUnit(input.forward - ax(3));
      input.gimbal = clampUnit(input.gimbal + btn(7) - btn(6));
      input.boost ||= pad.buttons[5]?.pressed ?? false;
      pad.buttons.forEach((b, i) => {
        const action = PAD_ACTIONS[i];
        if (action && b.pressed && !this.padButtons[i]) this.actions.push(action);
        this.padButtons[i] = b.pressed;
      });
    }

    const actions = this.actions;
    this.actions = [];
    const wheelDeg = this.wheel;
    this.wheel = 0;
    return { input, actions, wheelDeg };
  }

  takeLook() {
    const l = this.look;
    this.look = { yaw: 0, pitch: 0 };
    return l;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    this.surface.removeEventListener('wheel', this.onWheel);
    this.surface.removeEventListener('pointerdown', this.onPointerDown);
  }
}

const clampUnit = (v: number) => Math.max(-1, Math.min(1, v));
