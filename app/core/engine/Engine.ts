import * as THREE from "three";

import { Scene } from "./Scene";
import { Camera } from "./Camera";
import { Renderer } from "./Renderer";
import { CameraController } from "./CameraController";

import { World } from "../world/World";
import CarManager from "../world/CarManager";
import { Road } from "../world/Road";

import TrafficLightController from "../traffic/TrafficLightController";

/**
 * ==========================================
 * Engine
 * ==========================================
 *
 * هسته اجرای بازی:
 * - Scene / Camera / Renderer
 * - World
 * - CameraController
 * - Traffic
 * - Traffic Lights
 *
 * توجه:
 * منطق Road، World، ChunkManager و حرکت فعلی خودروها
 * در این مرحله تغییر نکرده است.
 */
export class Engine {
  public readonly scene: Scene;
  public readonly camera: Camera;
  public readonly renderer: Renderer;
  public readonly world: World;

  private readonly carManager: CarManager;
  private readonly trafficLightController: TrafficLightController;
  private readonly cameraController: CameraController;
  private readonly clock: THREE.Clock;

  private animationFrameId: number | null = null;
  private trafficInitialized = false;
  private trafficInitializing = false;
  private registeredRoads: Road[] = [];
  private disposed = false;

  constructor() {
    this.clock = new THREE.Clock();

    this.scene = new Scene();
    this.world = new World();

    this.scene.instance.add(this.world.group);

    this.camera = new Camera(
      window.innerWidth / window.innerHeight,
    );

    this.cameraController = new CameraController(
      this.camera.instance,
    );

    this.renderer = new Renderer();
    this.carManager = new CarManager();

    // چراغ‌ها در یک Group مستقل ساخته می‌شوند تا Road/World دست‌نخورده بمانند.
    this.trafficLightController = new TrafficLightController(
      this.scene.instance,
    );

    window.addEventListener("resize", this.handleResize);
  }

  /**
   * ==========================================
   * Start
   * ==========================================
   */
  public start(): void {
    if (
      this.disposed ||
      this.animationFrameId !== null
    ) {
      return;
    }

    this.clock.start();
    this.animate();
  }

  /**
   * ==========================================
   * Initialize Traffic
   * ==========================================
   */
  private async initializeTraffic(): Promise<void> {
    if (
      this.disposed ||
      this.trafficInitialized ||
      this.trafficInitializing
    ) {
      return;
    }

    const roads = this.collectRoads();

    if (roads.length === 0) {
      return;
    }

    this.trafficInitializing = true;

    try {
      await this.carManager.initialize(
        this.scene.instance,
      );

      if (this.disposed) {
        this.carManager.dispose();
        return;
      }

      const currentRoads = this.collectRoads();

      this.carManager.setRoadNetwork(
        currentRoads,
      );

      // چراغ‌ها از همان Road Network استفاده می‌کنند.
      this.trafficLightController.setRoadNetwork(
        currentRoads,
      );

      this.registeredRoads = currentRoads;
      this.trafficInitialized = true;
    } finally {
      this.trafficInitializing = false;
    }
  }

  /**
   * ==========================================
   * Collect Roads
   * ==========================================
   */
  private collectRoads(): Road[] {
    const roads: Road[] = [];
    const roadSet = new Set<Road>();

    this.world.group.traverse((object) => {
      if (object.userData.isRoad !== true) {
        return;
      }

      const road = object.userData.road;

      if (!(road instanceof Road)) {
        return;
      }

      if (roadSet.has(road)) {
        return;
      }

      roadSet.add(road);
      roads.push(road);
    });

    return roads;
  }

  /**
   * ==========================================
   * Update Road Network
   * ==========================================
   */
  private updateRoadNetwork(): void {
    if (this.disposed) {
      return;
    }

    if (!this.trafficInitialized) {
      void this.initializeTraffic();
      return;
    }

    const currentRoads = this.collectRoads();

    let networkChanged =
      currentRoads.length !== this.registeredRoads.length;

    if (!networkChanged) {
      for (let index = 0; index < currentRoads.length; index++) {
        if (currentRoads[index] !== this.registeredRoads[index]) {
          networkChanged = true;
          break;
        }
      }
    }

    if (!networkChanged) {
      return;
    }

    this.carManager.setRoadNetwork(
      currentRoads,
    );

    this.trafficLightController.setRoadNetwork(
      currentRoads,
    );

    this.registeredRoads = currentRoads;
  }

  /**
   * ==========================================
   * Animation Loop
   * ==========================================
   */
  private animate = (): void => {
    if (this.disposed) {
      return;
    }

    this.animationFrameId =
      requestAnimationFrame(this.animate);

    const deltaTime = Math.min(
      this.clock.getDelta(),
      0.05,
    );

    this.cameraController.update();

    const cameraDistance =
      this.cameraController.getDistance();

    this.world.update(
      this.camera.instance.position,
      cameraDistance,
      deltaTime,
    );

    this.updateRoadNetwork();

    if (this.trafficInitialized) {
      /**
       * چراغ‌ها مستقل از CarManager آپدیت می‌شوند.
       * در این مرحله فقط ظاهر/فاز چراغ کنترل می‌شود.
       */
      this.trafficLightController.update(
        deltaTime,
      );

      /**
       * خود Camera به CarManager داده می‌شود تا Spawn/Reposition
       * فقط بر اساس فاصله نباشد و واقعاً خارج از Frustum انجام شود.
       */
      this.carManager.update(
        this.camera.instance.position,
        deltaTime,
        this.camera.instance,
      );
    }

    this.renderer.render(
      this.scene.instance,
      this.camera.instance,
    );
  };

  /**
   * ==========================================
   * Resize
   * ==========================================
   */
  private handleResize = (): void => {
    if (this.disposed) {
      return;
    }

    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.resize(width / height);
    this.renderer.resize(width, height);
  };

  /**
   * ==========================================
   * Stop
   * ==========================================
   */
  public stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(
        this.animationFrameId,
      );

      this.animationFrameId = null;
    }

    this.clock.stop();
  }

  /**
   * ==========================================
   * Dispose
   * ==========================================
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.stop();

    window.removeEventListener(
      "resize",
      this.handleResize,
    );

    this.cameraController.dispose();
    this.renderer.instance.dispose();
    this.world.dispose();
    this.carManager.dispose();
    this.trafficLightController.dispose();

    this.registeredRoads = [];
  }
}
