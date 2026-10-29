import { describe, expect, it, vi } from 'vitest';
import { Cartesian2 } from 'cesium';
import { MissionScene } from '../src/scene';

// Exercise input scheduling without constructing a WebGL viewer.
function dragScene() {
  const scene = Object.create(MissionScene.prototype) as {
    dragging?: { kind: 'takeoff' };
    axisDrag?: object;
    onMove(pos: Cartesian2): void;
    flushMove(): void;
    onUp(): void;
    applyMove(pos: Cartesian2): void;
    viewer: object;
    events: object;
  };
  const apply = vi.fn();
  const end = vi.fn();
  const controller = { enableInputs: false };
  scene.dragging = { kind: 'takeoff' };
  scene.viewer = { scene: { requestRender: vi.fn(), screenSpaceCameraController: controller } };
  scene.events = { onDragEnd: end };
  scene.applyMove = apply;
  return { scene, apply, end, controller };
}

describe('drag input scheduling', () => {
  it('applies only the latest mouse position once per frame, copying the event coordinates', () => {
    const { scene, apply } = dragScene();
    scene.onMove(new Cartesian2(1, 2));
    const last = new Cartesian2(3, 4);
    scene.onMove(last);
    last.x = 99;
    expect(apply).not.toHaveBeenCalled();
    scene.flushMove();
    scene.flushMove();
    expect(apply).toHaveBeenCalledExactlyOnceWith(new Cartesian2(3, 4));
  });

  it('flushes the final position before ending the drag and restores camera controls', () => {
    const { scene, apply, end, controller } = dragScene();
    scene.onMove(new Cartesian2(5, 6));
    scene.onUp();
    expect(apply).toHaveBeenCalledExactlyOnceWith(new Cartesian2(5, 6));
    expect(end).toHaveBeenCalledExactlyOnceWith({ kind: 'takeoff' });
    expect(apply.mock.invocationCallOrder[0]).toBeLessThan(end.mock.invocationCallOrder[0]!);
    expect(controller.enableInputs).toBe(true);
    expect(scene.dragging).toBeUndefined();
    scene.flushMove();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('does no drag work for ordinary mouse movement', () => {
    const { scene, apply } = dragScene();
    scene.dragging = undefined;
    scene.onMove(new Cartesian2(1, 2));
    scene.flushMove();
    expect(apply).not.toHaveBeenCalled();
  });
});
