import * as T from "three";
import { sectionCap } from "./section";
export type InspectionPart = {
  installedComponentId: string;
  name: string;
  solid?: boolean;
  role?: string;
  explode?: { translation: number[]; rotation: number[]; pivot: number[] };
};
export type InspectionState = {
  opacity?: number;
  immediate?: boolean;
  explode: number;
  scope: string | null;
  section: "off" | "X" | "Y" | "Z";
  cut: number;
  flip: boolean;
  ghost: boolean;
  covers: boolean;
  guides: boolean;
  hidden: string[];
  isolated: string | null;
  selected: string | null;
};
export const defaultInspection: InspectionState = {
  explode: 0,
  scope: null,
  section: "off",
  cut: 50,
  flip: false,
  ghost: false,
  covers: false,
  guides: false,
  opacity: 1,
  hidden: [],
  isolated: null,
  selected: null,
};
export const descends = (node: T.Object3D, root: T.Object3D): boolean =>
  node === root || (!!node.parent && descends(node.parent, root));
export function applyExplosion(
  node: T.Object3D,
  base: T.Matrix4,
  part: InspectionPart,
  amount: number,
) {
  const e = part.explode;
  if (!e) {
    base.decompose(node.position, node.quaternion, node.scale);
    return;
  }
  const pivot = new T.Vector3().fromArray(e.pivot),
    offset = new T.Vector3().fromArray(e.translation).multiplyScalar(amount);
  const q = new T.Quaternion().setFromEuler(
    new T.Euler(
      ...(e.rotation.map((n) => n * amount) as [number, number, number]),
    ),
  );
  new T.Matrix4()
    .makeTranslation(pivot.clone().add(offset))
    .multiply(new T.Matrix4().makeRotationFromQuaternion(q))
    .multiply(new T.Matrix4().makeTranslation(pivot.negate()))
    .multiply(base)
    .decompose(node.position, node.quaternion, node.scale);
}
/** Own viewer choreography and geometric sections. No application service dependency. */
export class InspectionScene {
  private baseline = new Map<T.Object3D, T.Matrix4>();
  private bounds: T.Box3;
  private animation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private amount = 0;
  private caps = new T.Group();
  private guides = new T.Group();
  private guideLine = new T.LineSegments(
    new T.BufferGeometry(),
    new T.LineBasicMaterial({
      color: 0x829ab1,
      transparent: true,
      opacity: 0.28,
    }),
  );
  private owners = new Map<T.Mesh, InspectionPart | undefined>();
  private capKey = "";
  private state = { ...defaultInspection };
  readonly plane = new T.Plane();
  openContours = 0;
  tangentContacts = 0;
  degenerateContours = 0;
  constructor(
    private model: T.Group,
    private scene: T.Scene,
    private nodes: Map<string, T.Object3D>,
    private parts: InspectionPart[],
    private render: () => void,
  ) {
    model.updateMatrixWorld(true);
    this.bounds = new T.Box3().setFromObject(model);
    nodes.forEach((n) => {
      n.updateMatrix();
      this.baseline.set(n, n.matrix.clone());
    });
    const partsById = new Map(parts.map((p) => [p.installedComponentId, p]));
    const materials = new Map<string, Map<T.Material, T.Material>>();
    model.traverse((o) => {
      const mesh = o as T.Mesh;
      if (!mesh.isMesh) return;
      let n: T.Object3D | null = o,
        owner: InspectionPart | undefined;
      while (n && !owner) {
        owner = partsById.get(n.userData.installedComponentId);
        n = n.parent;
      }
      this.owners.set(mesh, owner);
      const key = owner?.installedComponentId ?? "unmapped";
      if (!materials.has(key)) materials.set(key, new Map());
      const cache = materials.get(key)!;
      const clone = (m: T.Material) => {
        if (!cache.has(m)) cache.set(m, m.clone());
        return cache.get(m)!;
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(clone)
        : clone(mesh.material);
    });
    this.guideLine.geometry.setAttribute(
      "position",
      new T.BufferAttribute(new Float32Array(parts.length * 6), 3),
    );
    this.guides.add(this.guideLine);
    scene.add(this.caps, this.guides);
  }
  private clear(group: T.Group) {
    for (const o of [...group.children]) {
      const m = o as T.Mesh;
      group.remove(o);
      m.geometry?.dispose();
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((m) =>
        m?.dispose(),
      );
    }
  }
  private visible(o: T.Object3D): boolean {
    return o.visible && (!o.parent || this.visible(o.parent));
  }
  private pose(
    amount: number,
    starts?: Map<
      T.Object3D,
      { position: T.Vector3; quaternion: T.Quaternion; scale: T.Vector3 }
    >,
    progress = 1,
  ) {
    const scope = this.state.scope ? this.nodes.get(this.state.scope) : null;
    for (const p of this.parts) {
      const n = this.nodes.get(p.installedComponentId);
      if (n) {
        applyExplosion(
          n,
          this.baseline.get(n)!,
          p,
          !scope || descends(n, scope) ? amount : 0,
        );
        const start = starts?.get(n);
        if (start) {
          n.position.lerpVectors(start.position, n.position, progress);
          n.quaternion.slerpQuaternions(
            start.quaternion,
            n.quaternion,
            progress,
          );
          n.scale.lerpVectors(start.scale, n.scale, progress);
        }
      }
    }
    this.model.updateMatrixWorld(true);
    const positions = this.guideLine.geometry.getAttribute(
      "position",
    ) as T.BufferAttribute;
    let count = 0;
    if (this.state.guides && amount > 0.001)
      for (const p of this.parts) {
        const n = this.nodes.get(p.installedComponentId);
        if (!n || !this.visible(n) || !p.explode || p.role !== "group")
          continue;
        const end = new T.Box3().setFromObject(n).getCenter(new T.Vector3()),
          offset = new T.Vector3()
            .fromArray(p.explode.translation)
            .multiplyScalar(amount);
        if (offset.length() < 0.025) continue;
        positions.setXYZ(
          count++,
          end.x - offset.x,
          end.y - offset.y,
          end.z - offset.z,
        );
        positions.setXYZ(count++, end.x, end.y, end.z);
      }
    positions.needsUpdate = true;
    this.guideLine.geometry.setDrawRange(0, count);
    this.guideLine.visible = count > 0;
    this.render();
  }
  set(state: InspectionState) {
    const changed =
      state.explode !== this.state.explode || state.scope !== this.state.scope;
    this.state = state;
    cancelAnimationFrame(this.animation);
    const capKey = JSON.stringify([
      state.explode,
      state.scope,
      state.section,
      state.cut,
      state.flip,
      state.ghost,
      state.covers,
      state.hidden,
      state.isolated,
    ]);
    const recut = capKey !== this.capKey;
    this.capKey = capKey;
    if (recut) this.clear(this.caps);
    this.model.traverse((o) => {
      const m = o as T.Mesh;
      if (!m.material) return;
      const owner = this.owners.get(m);
      const ghost =
        state.ghost && (owner?.role === "housing" || owner?.role === "cover");
      if (state.covers && owner?.role === "cover") o.visible = false;
      for (const material of Array.isArray(m.material)
        ? m.material
        : [m.material]) {
        const opacity = ghost ? 0.15 : (state.opacity ?? 1),
          transparent = opacity < 1,
          clipped = state.section !== "off";
        const update =
          material.transparent !== transparent ||
          !!material.clippingPlanes?.length !== clipped;
        material.opacity = opacity;
        material.transparent = transparent;
        material.depthWrite = !transparent;
        material.clippingPlanes = clipped ? [this.plane] : [];
        material.clipShadows = true;
        const standard = material as T.MeshStandardMaterial;
        if (standard.emissive) {
          const selected = state.selected
            ? this.nodes.get(state.selected)
            : null;
          const emphasis =
            selected &&
            selected !== this.model.children[0] &&
            selected.parent !== null &&
            owner &&
            descends(m, selected);
          standard.emissive.setHex(emphasis ? 0x153749 : 0);
          standard.emissiveIntensity = emphasis ? 0.22 : 0;
        }
        if (update) material.needsUpdate = true;
      }
    });
    const starts = new Map(
      [...this.nodes.values()].map((n) => [
        n,
        {
          position: n.position.clone(),
          quaternion: n.quaternion.clone(),
          scale: n.scale.clone(),
        },
      ]),
    );
    this.pose(state.explode / 100);
    this.bounds = new T.Box3().setFromObject(this.model);
    const axis = state.section === "X" ? 0 : state.section === "Y" ? 1 : 2;
    const value =
      this.bounds.min.getComponent(axis) +
      ((this.bounds.max.getComponent(axis) -
        this.bounds.min.getComponent(axis)) *
        state.cut) /
        100;
    this.plane.normal.set(0, 0, 0).setComponent(axis, state.flip ? -1 : 1);
    this.plane.constant = -value * (state.flip ? -1 : 1);
    const target = state.explode / 100;
    if (changed && !state.immediate) {
      const start = this.amount,
        time = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - time) / 360),
          ease = t * t * (3 - 2 * t);
        this.amount = start + (target - start) * ease;
        this.pose(target, starts, ease);
        if (t < 1) this.animation = requestAnimationFrame(step);
        else this.cap();
      };
      this.animation = requestAnimationFrame(step);
    } else {
      this.amount = target;
      this.pose(target);
      if (recut && !this.timer)
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.cap();
        }, 80);
    }
  }
  private cap() {
    this.clear(this.caps);
    this.openContours = 0;
    this.tangentContacts = 0;
    this.degenerateContours = 0;
    if (this.state.section === "off") return;
    this.model.updateMatrixWorld(true);
    this.model.traverse((o) => {
      const mesh = o as T.Mesh;
      if (!mesh.isMesh || !this.visible(mesh)) return;
      let owner: T.Object3D | null = mesh;
      while (owner && !owner.userData.installedComponentId)
        owner = owner.parent;
      const p = this.parts.find(
        (p) => p.installedComponentId === owner?.userData.installedComponentId,
      );
      if (
        !p?.solid ||
        (this.state.ghost && (p.role === "housing" || p.role === "cover"))
      )
        return;
      const result = sectionCap(mesh.geometry, mesh.matrixWorld, this.plane);
      if (result.open) this.openContours++;
      if (result.tangent) this.tangentContacts++;
      if (result.degenerate) this.degenerateContours++;
      if (result.geometry) {
        const cap = new T.Mesh(
          result.geometry,
          new T.MeshStandardMaterial({
            color: 0xe3ab65,
            roughness: 0.72,
            metalness: 0.15,
            side: T.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }),
        );
        cap.userData.installedComponentId = p.installedComponentId;
        this.caps.add(cap);
      }
    });
    this.render();
  }
  accepts(point: T.Vector3) {
    return (
      this.state.section === "off" || this.plane.distanceToPoint(point) >= -1e-5
    );
  }
  get pickObjects() {
    return this.caps;
  }
  diagnostics() {
    let error = 0;
    if (this.amount === 0)
      this.nodes.forEach((n) => {
        n.updateMatrix();
        n.matrix.elements.forEach(
          (v, i) =>
            (error = Math.max(
              error,
              Math.abs(v - this.baseline.get(n)!.elements[i]),
            )),
        );
      });
    return {
      explode: this.amount,
      section: this.state.section,
      caps: this.caps.children.length,
      openContours: this.openContours,
      tangentContacts: this.tangentContacts,
      degenerateContours: this.degenerateContours,
      ghost: this.state.ghost,
      covers: this.state.covers,
      isolated: !!this.state.isolated,
      restorationError: error,
    };
  }
  dispose() {
    cancelAnimationFrame(this.animation);
    clearTimeout(this.timer);
    this.clear(this.caps);
    this.clear(this.guides);
    this.scene.remove(this.caps, this.guides);
  }
}
