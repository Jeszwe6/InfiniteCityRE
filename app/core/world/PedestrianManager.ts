
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

type CharacterModel = {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
};

type GraphNode = {
  id: number;
  position: THREE.Vector3;
  edges: GraphEdge[];
};

type GraphEdge = {
  id: string;
  start: GraphNode;
  end: GraphNode;
  points: THREE.Vector3[];
  length: number;
  isCrosswalk: boolean;
};

type Pedestrian = {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  action: THREE.AnimationAction;
  node: GraphNode;
  edge: GraphEdge;
  previousNode: GraphNode | null;
  distance: number;
  speed: number;
  targetSpeed: number;
  direction: 1 | -1;
  turnRate: number;
  recentEdges: string[];
};

type SidewalkEndpoint = {
  position: THREE.Vector3;
  edge: GraphEdge;
};

export class PedestrianManager {
  private static readonly CHARACTER_MODELS = [
    "a", "b", "c", "d", "e", "f",
    "i", "j", "k", "q", "r",
  ] as const;

  private static readonly MAX_PEDESTRIANS = 30;
  private static readonly MAX_DISTANCE = 90;
  private static readonly REFRESH_INTERVAL = 1;

  // آستانه اتصال دو قطعه مسیر به یکدیگر.
  private static readonly CONNECTION_DISTANCE = 0.85;

  // جلوگیری از انتخاب مکرر مسیرهای اخیر.
  private static readonly RECENT_EDGE_LIMIT = 3;

  // عابرها برای رسیدن به مقصد از حرکت نرم استفاده می‌کنند.
  private static readonly ACCELERATION = 1.8;
  private static readonly MIN_SPEED = 0.65;
  private static readonly MAX_SPEED = 1.2;

  private readonly world: THREE.Group;
  private readonly group = new THREE.Group();
  private readonly loader = new GLTFLoader();

  private readonly models = new Map<string, CharacterModel>();
  private readonly pedestrians: Pedestrian[] = [];
  private readonly lastCameraPosition = new THREE.Vector3();

  private graphNodes: GraphNode[] = [];
  private graphEdges: GraphEdge[] = [];

  private refreshTimer = 0;
  private disposed = false;
  private loading = false;
  private hasCameraPosition = false;
  private nextNodeId = 0;

  constructor(world: THREE.Group) {
    this.world = world;

    this.group.name = "PedestrianManager";
    this.world.add(this.group);

    void this.loadModels();
  }

  public update(
    cameraPosition: THREE.Vector3,
    deltaTime: number,
  ): void {
    if (this.disposed || deltaTime <= 0) return;

    // محدودکردن DeltaTime از پرش حرکتی بعد از افت فریم جلوگیری می‌کند.
    const dt = Math.min(deltaTime, 0.05);

    this.lastCameraPosition.copy(cameraPosition);
    this.hasCameraPosition = true;

    this.updatePedestrians(dt);

    this.refreshTimer -= dt;

    if (this.refreshTimer <= 0) {
      this.refreshTimer = PedestrianManager.REFRESH_INTERVAL;
      this.refreshSidewalks(cameraPosition);
    }
  }

  private async loadModels(): Promise<void> {
    if (this.loading || this.disposed) return;

    this.loading = true;

    const tasks = PedestrianManager.CHARACTER_MODELS.map(
      async (letter) => {
        const url =
          `/assets/characters/Models/GLB%20format/character-${letter}.glb`;

        try {
          const gltf = await this.loader.loadAsync(url);

          if (this.disposed) {
            this.disposeModelResources(gltf.scene);
            return;
          }

          this.models.set(letter, {
            scene: gltf.scene,
            animations: gltf.animations,
          });
        } catch (error: unknown) {
          console.error(
            `[PedestrianManager] Failed to load character-${letter}.glb`,
            error,
          );
        }
      },
    );

    await Promise.all(tasks);

    this.loading = false;

    if (!this.disposed && this.hasCameraPosition) {
      this.refreshTimer = 0;
      this.refreshSidewalks(this.lastCameraPosition);
    }
  }

  /**
   * ساخت گراف از قطعات پیاده‌رو و گذرگاه‌های ثبت‌شده در تقاطع‌ها.
   * مختصات همه نقاط گراف در فضای جهانی نگهداری می‌شود.
   */
  private buildNavigationGraph(): void {
    this.graphNodes = [];
    this.graphEdges = [];
    this.nextNodeId = 0;

    this.world.updateMatrixWorld(true);

    const sidewalkEndpoints: SidewalkEndpoint[] = [];
    const crossings: Array<{
      id: string;
      start: THREE.Vector3;
      end: THREE.Vector3;
    }> = [];

    // استخراج قطعات پیاده‌رو.
    this.world.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.userData.isSidewalk !== true) return;

      if (!object.geometry.boundingBox) {
        object.geometry.computeBoundingBox();
      }

      const bounds = object.geometry.boundingBox;
      if (!bounds) return;

      // تبدیل گوشه‌های محلی به فضای جهانی برای محاسبه ابعاد واقعی.
      const corners = [
        new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
        new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
        new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
        new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
        new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
        new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
        new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
        new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
      ].map((point) => point.applyMatrix4(object.matrixWorld));

      const minX = Math.min(...corners.map((point) => point.x));
      const maxX = Math.max(...corners.map((point) => point.x));
      const minY = Math.min(...corners.map((point) => point.y));
      const maxY = Math.max(...corners.map((point) => point.y));
      const minZ = Math.min(...corners.map((point) => point.z));
      const maxZ = Math.max(...corners.map((point) => point.z));

      const sizeX = maxX - minX;
      const sizeZ = maxZ - minZ;

      if (Math.max(sizeX, sizeZ) < 2) return;

      const axis: "x" | "z" = sizeX >= sizeZ ? "x" : "z";
      const y = maxY + 0.025;

      const start = axis === "x"
        ? new THREE.Vector3(minX, y, (minZ + maxZ) / 2)
        : new THREE.Vector3((minX + maxX) / 2, y, minZ);

      const end = axis === "x"
        ? new THREE.Vector3(maxX, y, (minZ + maxZ) / 2)
        : new THREE.Vector3((minX + maxX) / 2, y, maxZ);

      const edge = this.createEdge(
        `sidewalk-${object.uuid}`,
        start,
        end,
        false,
      );

      sidewalkEndpoints.push(
        { position: start, edge },
        { position: end, edge },
      );
    });

    // استخراج مسیرهای عبور از خط‌کشی‌های Intersection.
    this.world.traverse((object) => {
      if (!(object instanceof THREE.Group)) return;

      const definitions = object.userData.pedestrianCrossings;

      if (!Array.isArray(definitions)) return;

      for (const definition of definitions) {
        if (
          !definition ||
          !Array.isArray(definition.start) ||
          !Array.isArray(definition.end)
        ) {
          continue;
        }

        const startData = definition.start;
        const endData = definition.end;

        if (
          startData.length < 2 ||
          endData.length < 2 ||
          !startData.every(Number.isFinite) ||
          !endData.every(Number.isFinite)
        ) {
          continue;
        }

        // مختصات تعریف گذرگاه محلی هستند؛ آن‌ها را به فضای جهانی ببریم.
        const start = new THREE.Vector3(
          startData[0],
          0,
          startData[1],
        );

        const end = new THREE.Vector3(
          endData[0],
          0,
          endData[1],
        );

        object.localToWorld(start);
        object.localToWorld(end);

        // ارتفاع مسیر با سطح بالایی پیاده‌رو هماهنگ می‌شود.
        start.y = this.findSidewalkHeight(start, sidewalkEndpoints);
        end.y = this.findSidewalkHeight(end, sidewalkEndpoints);

        crossings.push({
          id: `${object.uuid}-${definition.id}`,
          start,
          end,
        });
      }
    });

    // اتصال پیاده‌روهای مجاور به انتهای مسیرهای یکدیگر.
    for (let i = 0; i < sidewalkEndpoints.length; i++) {
      const a = sidewalkEndpoints[i];
      if (!a) continue;

      for (let j = i + 1; j < sidewalkEndpoints.length; j++) {
        const b = sidewalkEndpoints[j];
        if (!b || a.edge === b.edge) continue;

        if (this.isConnected(a.position, b.position)) {
          this.connectEdges(a.edge, b.edge, a.position, b.position);
        }
      }
    }

    // اتصال انتهای پیاده‌روها به ابتدا و انتهای گذرگاه‌ها.
    for (const crossing of crossings) {
      const crossingEdge = this.createEdge(
        `crosswalk-${crossing.id}`,
        crossing.start,
        crossing.end,
        true,
      );

      for (const endpoint of sidewalkEndpoints) {
        if (this.isConnected(endpoint.position, crossing.start)) {
          this.connectEdges(
            endpoint.edge,
            crossingEdge,
            endpoint.position,
            crossing.start,
          );
        }

        if (this.isConnected(endpoint.position, crossing.end)) {
          this.connectEdges(
            endpoint.edge,
            crossingEdge,
            endpoint.position,
            crossing.end,
          );
        }
      }
    }
  }

  private findSidewalkHeight(
    position: THREE.Vector3,
    endpoints: SidewalkEndpoint[],
  ): number {
    let nearestDistance = Infinity;
    let height = 0.145;

    for (const endpoint of endpoints) {
      const distance = Math.hypot(
        position.x - endpoint.position.x,
        position.z - endpoint.position.z,
      );

      if (distance < nearestDistance) {
        nearestDistance = distance;
        height = endpoint.position.y;
      }
    }

    return height;
  }

  private createNode(position: THREE.Vector3): GraphNode {
    const node: GraphNode = {
      id: this.nextNodeId++,
      position: position.clone(),
      edges: [],
    };

    this.graphNodes.push(node);
    return node;
  }

  private createEdge(
    id: string,
    startPosition: THREE.Vector3,
    endPosition: THREE.Vector3,
    isCrosswalk: boolean,
  ): GraphEdge {
    const start = this.createNode(startPosition);
    const end = this.createNode(endPosition);

    const edge: GraphEdge = {
      id,
      start,
      end,
      points: [start.position, end.position],
      length: start.position.distanceTo(end.position),
      isCrosswalk,
    };

    start.edges.push(edge);
    end.edges.push(edge);
    this.graphEdges.push(edge);

    return edge;
  }

  /**
   * اتصال دو مسیر به هم در نزدیک‌ترین انتهای آن‌ها.
   * اتصال فقط وقتی انجام می‌شود که مختصات افقی به‌اندازه کافی نزدیک باشند.
   */
  private connectEdges(
    first: GraphEdge,
    second: GraphEdge,
    firstPosition: THREE.Vector3,
    secondPosition: THREE.Vector3,
  ): void {
    const firstNode = this.nearestNode(first, firstPosition);
    const secondNode = this.nearestNode(second, secondPosition);

    if (firstNode === secondNode) return;

    // یال کوتاه اتصال، شکاف کوچک بین پیاده‌رو و گذرگاه را می‌پوشاند.
    const connectorId =
      `connector-${Math.min(firstNode.id, secondNode.id)}-${Math.max(firstNode.id, secondNode.id)}`;

    if (this.graphEdges.some((edge) => edge.id === connectorId)) return;

    const connector: GraphEdge = {
      id: connectorId,
      start: firstNode,
      end: secondNode,
      points: [firstNode.position, secondNode.position],
      length: firstNode.position.distanceTo(secondNode.position),
      isCrosswalk: first.isCrosswalk || second.isCrosswalk,
    };

    firstNode.edges.push(connector);
    secondNode.edges.push(connector);
    this.graphEdges.push(connector);
  }

  private nearestNode(
    edge: GraphEdge,
    position: THREE.Vector3,
  ): GraphNode {
    return edge.start.position.distanceToSquared(position) <=
      edge.end.position.distanceToSquared(position)
      ? edge.start
      : edge.end;
  }

  private isConnected(
    a: THREE.Vector3,
    b: THREE.Vector3,
  ): boolean {
    const horizontalDistance = Math.hypot(
      a.x - b.x,
      a.z - b.z,
    );

    return (
      horizontalDistance <= PedestrianManager.CONNECTION_DISTANCE &&
      Math.abs(a.y - b.y) <= 0.3
    );
  }

  private refreshSidewalks(cameraPosition: THREE.Vector3): void {
    if (this.disposed) return;

    this.buildNavigationGraph();

    // نگه‌داشتن عابرهایی که هنوز در محدوده دوربین هستند.
    for (let i = this.pedestrians.length - 1; i >= 0; i--) {
      const pedestrian = this.pedestrians[i];
      if (!pedestrian) continue;

      if (
        pedestrian.root.position.distanceTo(cameraPosition) >
        PedestrianManager.MAX_DISTANCE
      ) {
        this.removePedestrian(i);
      }
    }

    if (this.models.size === 0) return;

    const candidates = this.graphNodes
      .filter((node) => node.edges.length > 0)
      .map((node) => ({
        node,
        distance: node.position.distanceTo(cameraPosition),
      }))
      .filter(({ distance }) => distance <= PedestrianManager.MAX_DISTANCE)
      .sort((a, b) => a.distance - b.distance);

    while (
      this.pedestrians.length < PedestrianManager.MAX_PEDESTRIANS &&
      candidates.length > 0
    ) {
      const index = Math.floor(Math.random() * candidates.length);
      const candidate = candidates.splice(index, 1)[0];

      if (!candidate) continue;

      // جلوگیری از تجمع چند عابر دقیقاً در یک نقطه.
      const occupied = this.pedestrians.some(
        (pedestrian) =>
          pedestrian.root.position.distanceTo(candidate.node.position) < 2,
      );

      if (occupied) continue;

      this.createPedestrian(candidate.node);
    }
  }

  private createPedestrian(startNode: GraphNode): void {
    const availableModels = Array.from(this.models.values());
    if (availableModels.length === 0) return;

    const character =
      availableModels[Math.floor(Math.random() * availableModels.length)];

    if (!character) return;

    const walkClip = character.animations.find(
      (clip) => clip.name.toLowerCase() === "walk",
    );

    const idleClip = character.animations.find(
      (clip) => clip.name.toLowerCase() === "idle",
    );

    const selectedClip = walkClip ?? idleClip;
    if (!selectedClip) {
      console.warn("[PedestrianManager] No walk/idle animation found.");
      return;
    }

    const model = cloneSkeleton(character.scene);
    model.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(model);
    const modelSize = bounds.getSize(new THREE.Vector3());

    if (modelSize.y <= 0) return;

    // مقیاس مدل‌ها برای داشتن قدی نزدیک به یک انسان معمولی.
    const targetHeight = THREE.MathUtils.randFloat(1, 1.25);
    const scale = targetHeight / modelSize.y;

    model.scale.setScalar(scale);
    model.position.y = -bounds.min.y * scale;

    const root = new THREE.Group();
    root.name = "Pedestrian";
    root.add(model);
    root.position.copy(startNode.position);

    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(selectedClip);
    action.play();

    const speed = THREE.MathUtils.randFloat(
      PedestrianManager.MIN_SPEED,
      PedestrianManager.MAX_SPEED,
    );

    const pedestrian: Pedestrian = {
      root,
      mixer,
      action,
      node: startNode,
      edge: startNode.edges[
        Math.floor(Math.random() * startNode.edges.length)
      ]!,
      previousNode: null,
      distance: 0,
      speed,
      targetSpeed: speed,
      direction: 1,
      turnRate: THREE.MathUtils.randFloat(3, 5),
      recentEdges: [],
    };

    this.group.add(root);
    this.pedestrians.push(pedestrian);

    this.chooseNextEdge(pedestrian);
  }

  /**
   * انتخاب مسیر بعدی با اولویت یال‌هایی که اخیراً طی نشده‌اند.
   */
  private chooseNextEdge(pedestrian: Pedestrian): void {
    const currentNode = pedestrian.node;

    let options = currentNode.edges.filter(
      (edge) =>
        edge !== pedestrian.edge &&
        !pedestrian.recentEdges.includes(edge.id),
    );

    if (options.length === 0) {
      options = currentNode.edges.filter(
        (edge) => edge !== pedestrian.edge,
      );
    }

    // اگر مسیر جایگزینی وجود نداشت، عابر در همین مسیر ادامه می‌دهد.
    if (options.length === 0) {
      const edge = pedestrian.edge;

      if (edge.start === currentNode) {
        pedestrian.direction = 1;
      } else {
        pedestrian.direction = -1;
      }

      return;
    }

    // ترجیح مسیرهای جدید و انتخاب تصادفی برای تنوع حرکت.
    const nextEdge =
      options[Math.floor(Math.random() * options.length)];

    if (!nextEdge) return;

    pedestrian.recentEdges.push(pedestrian.edge.id);

    if (
      pedestrian.recentEdges.length >
      PedestrianManager.RECENT_EDGE_LIMIT
    ) {
      pedestrian.recentEdges.shift();
    }

    pedestrian.edge = nextEdge;
    pedestrian.distance = 0;

    pedestrian.direction =
      nextEdge.start === currentNode ? 1 : -1;

    pedestrian.previousNode = currentNode;
  }

  private updatePedestrians(deltaTime: number): void {
    for (const pedestrian of this.pedestrians) {
      let remainingDistance = pedestrian.speed * deltaTime;

      // پشتیبانی از عبور از چند یال در یک فریم، بدون توقف ناگهانی.
      for (let step = 0; step < 4 && remainingDistance > 0; step++) {
        const edge = pedestrian.edge;
        const distanceLeft = Math.max(0, edge.length - pedestrian.distance);
        const travelled = Math.min(remainingDistance, distanceLeft);

        pedestrian.distance += travelled;
        remainingDistance -= travelled;

        const t = edge.length > 0
          ? THREE.MathUtils.clamp(
              pedestrian.distance / edge.length,
              0,
              1,
            )
          : 1;

        const start = pedestrian.direction > 0
          ? edge.start.position
          : edge.end.position;

        const end = pedestrian.direction > 0
          ? edge.end.position
          : edge.start.position;

        pedestrian.root.position.lerpVectors(start, end, t);

        this.updateHeading(pedestrian, end, deltaTime);
        pedestrian.mixer.update(deltaTime);

        if (pedestrian.distance >= edge.length - 0.0001) {
          pedestrian.node = end === edge.start.position
            ? edge.start
            : edge.end;

          this.chooseNextEdge(pedestrian);
        } else {
          break;
        }
      }

      // تغییر سرعت تدریجی باعث جلوگیری از تغییر سرعت ناگهانی می‌شود.
      const speedDifference =
        pedestrian.targetSpeed - pedestrian.speed;

      pedestrian.speed += THREE.MathUtils.clamp(
        speedDifference,
        -PedestrianManager.ACCELERATION * deltaTime,
        PedestrianManager.ACCELERATION * deltaTime,
      );
    }
  }

  /**
   * چرخش نرم مدل به جهت حرکت.
   */
  private updateHeading(
    pedestrian: Pedestrian,
    target: THREE.Vector3,
    deltaTime: number,
  ): void {
    const position = pedestrian.root.position;

    const dx = target.x - position.x;
    const dz = target.z - position.z;

    if (Math.hypot(dx, dz) < 0.0001) return;

    // جهت پیش‌فرض مدل در این پروژه در راستای +Z در نظر گرفته شده است.
    const targetRotation = Math.atan2(dx, dz);
    const current = pedestrian.root.rotation.y;

    const difference =
      THREE.MathUtils.euclideanModulo(
        targetRotation - current + Math.PI,
        Math.PI * 2,
      ) - Math.PI;

    pedestrian.root.rotation.y +=
      difference *
      Math.min(1, pedestrian.turnRate * deltaTime);
  }

  private removePedestrian(index: number): void {
    const pedestrian = this.pedestrians[index];
    if (!pedestrian) return;

    this.group.remove(pedestrian.root);

    pedestrian.mixer.stopAllAction();
    pedestrian.mixer.uncacheRoot(pedestrian.mixer.getRoot());

    this.pedestrians.splice(index, 1);
  }

  private disposeModelResources(root: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();

    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      geometries.add(object.geometry);

      const meshMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];

      for (const material of meshMaterials) {
        materials.add(material);

        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) {
            textures.add(value);
          }
        }
      }
    });

    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
  }

  public dispose(): void {
    if (this.disposed) return;

    this.disposed = true;

    for (let i = this.pedestrians.length - 1; i >= 0; i--) {
      this.removePedestrian(i);
    }

    this.world.remove(this.group);

    const disposedScenes = new Set<THREE.Group>();

    for (const model of this.models.values()) {
      if (disposedScenes.has(model.scene)) continue;

      disposedScenes.add(model.scene);
      this.disposeModelResources(model.scene);
    }

    this.models.clear();
    this.graphNodes = [];
    this.graphEdges = [];
  }
}
