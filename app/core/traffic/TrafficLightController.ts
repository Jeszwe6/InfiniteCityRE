import * as THREE from "three";

import { Road } from "../world/Road";
import { CentralTrafficLight, type TrafficLightState } from "./TrafficLight";

export type IntersectionPhase =
  | "north-green"
  | "east-green"
  | "south-green"
  | "west-green"
  | "all-red";

interface IntersectionData {
  center: THREE.Vector3;
  lights: CentralTrafficLight;
  phaseTime: number;
  phase: IntersectionPhase;
}

export class TrafficLightController {
  public readonly group: THREE.Group;

  private intersections: IntersectionData[] = [];
  private registeredRoads: Road[] = [];

  private static activeController: TrafficLightController | null = null;

  private static readonly DIRECTION_GREEN_DURATION = 4;
  private static readonly ALL_RED_DURATION = 0.2;

  private static readonly LIGHT_Y = 0;
  private static readonly INTERSECTION_MATCH_DISTANCE = 0.5;

  public constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.group.name = "TrafficLights";
    scene.add(this.group);
    TrafficLightController.activeController = this;
  }

  public static getActiveController(): TrafficLightController | null {
    return TrafficLightController.activeController;
  }

  public setRoadNetwork(roads: Road[]): void {
    const validRoads = roads.filter((road) => road instanceof Road);

    if (this.sameRoadNetwork(validRoads)) {
      return;
    }

    this.registeredRoads = validRoads.slice();
    this.rebuildIntersections();
  }

  public update(deltaTime: number): void {
    if (this.intersections.length === 0) {
      return;
    }

    const safeDelta = THREE.MathUtils.clamp(deltaTime, 0, 0.05);
    const cycleDuration = this.getCycleDuration();

    for (const intersection of this.intersections) {
      intersection.phaseTime += safeDelta;

      while (intersection.phaseTime >= cycleDuration) {
        intersection.phaseTime -= cycleDuration;
      }

      this.applyPhase(intersection);
    }
  }

  private sameRoadNetwork(roads: Road[]): boolean {
    if (roads.length !== this.registeredRoads.length) {
      return false;
    }

    for (let index = 0; index < roads.length; index++) {
      if (roads[index] !== this.registeredRoads[index]) {
        return false;
      }
    }

    return true;
  }

  private rebuildIntersections(): void {
    this.disposeIntersections();

    if (this.registeredRoads.length === 0) {
      return;
    }

    const clusters: Array<{ center: THREE.Vector3; roads: Road[] }> = [];

    for (const road of this.registeredRoads) {
      const center = new THREE.Vector3();
      road.group.getWorldPosition(center);

      let targetCluster: { center: THREE.Vector3; roads: Road[] } | undefined;

      for (const cluster of clusters) {
        if (
          cluster.center.distanceTo(center) <=
          TrafficLightController.INTERSECTION_MATCH_DISTANCE
        ) {
          targetCluster = cluster;
          break;
        }
      }

      if (targetCluster) {
        targetCluster.roads.push(road);
      } else {
        clusters.push({ center, roads: [road] });
      }
    }

    for (const cluster of clusters) {
      if (!this.isValidIntersection(cluster.roads)) {
        continue;
      }

      const intersection: IntersectionData = {
        center: cluster.center.clone(),
        lights: this.createIntersectionLights(cluster.center),
        phaseTime: 0,
        phase: "all-red",
      };

      this.intersections.push(intersection);
      this.applyPhase(intersection);
    }
  }

  private isValidIntersection(roads: Road[]): boolean {
    if (roads.length < 2) {
      return false;
    }

    const directions: THREE.Vector3[] = [];

    for (const road of roads) {
      const direction = road.getWorldDirection().clone();
      direction.y = 0;

      if (direction.lengthSq() < 0.0001) {
        continue;
      }

      directions.push(direction.normalize());
    }

    for (let i = 0; i < directions.length; i++) {
      const directionA = directions[i];
      if (!directionA) continue;

      for (let j = i + 1; j < directions.length; j++) {
        const directionB = directions[j];
        if (!directionB) continue;

        if (Math.abs(directionA.dot(directionB)) < 0.25) {
          return true;
        }
      }
    }

    return false;
  }

  /** یک سازهٔ مرکزی چهاروجهی برای کنترل هر چهار جهت تقاطع. */
  private createIntersectionLights(center: THREE.Vector3): CentralTrafficLight {
    const central = new CentralTrafficLight();
    central.group.position.set(
      center.x,
      TrafficLightController.LIGHT_Y,
      center.z,
    );
    this.group.add(central.group);
    return central;
  }

  private applyPhase(intersection: IntersectionData): void {
    const greenDuration = TrafficLightController.DIRECTION_GREEN_DURATION;
    const clearanceDuration = TrafficLightController.ALL_RED_DURATION;
    const slotDuration = greenDuration + clearanceDuration;
    const time = intersection.phaseTime % this.getCycleDuration();

    let northState: TrafficLightState = "red";
    let eastState: TrafficLightState = "red";
    let southState: TrafficLightState = "red";
    let westState: TrafficLightState = "red";

    const phaseIndex = Math.floor(time / slotDuration);
    const phaseTime = time % slotDuration;

    // North -> East -> South -> West. Each direction gets 4 seconds;
    // a short all-red interval lets the previous movement clear safely.
    if (phaseTime < greenDuration) {
      switch (phaseIndex) {
        case 0:
          northState = "green";
          intersection.phase = "north-green";
          break;
        case 1:
          eastState = "green";
          intersection.phase = "east-green";
          break;
        case 2:
          southState = "green";
          intersection.phase = "south-green";
          break;
        default:
          westState = "green";
          intersection.phase = "west-green";
          break;
      }
    } else {
      intersection.phase = "all-red";
    }

    intersection.lights.setDirectionStates(
      northState,
      eastState,
      southState,
      westState,
    );
  }

  private getCycleDuration(): number {
    return (
      (TrafficLightController.DIRECTION_GREEN_DURATION +
        TrafficLightController.ALL_RED_DURATION) *
      4
    );
  }

  public getIntersectionPhase(center: THREE.Vector3): IntersectionPhase | null {
    const intersection = this.findIntersection(center);
    return intersection?.phase ?? null;
  }

  public getIntersectionLightState(
    center: THREE.Vector3,
    direction?: "north" | "east" | "south" | "west",
  ): TrafficLightState | null {
    const intersection = this.findIntersection(center);
    if (!intersection) return null;

    if (direction) {
      return intersection.phase === `${direction}-green` ? "green" : "red";
    }

    return intersection.phase.endsWith("-green") ? "green" : "red";
  }

  private findIntersection(center: THREE.Vector3): IntersectionData | null {
    let closest: IntersectionData | null = null;
    let closestDistanceSq =
      TrafficLightController.INTERSECTION_MATCH_DISTANCE ** 2;

    for (const intersection of this.intersections) {
      const distanceSq = intersection.center.distanceToSquared(center);
      if (distanceSq <= closestDistanceSq) {
        closest = intersection;
        closestDistanceSq = distanceSq;
      }
    }

    return closest;
  }

  private disposeIntersections(): void {
    for (const intersection of this.intersections) {
      intersection.lights.dispose();
    }

    this.intersections = [];
  }

  public dispose(): void {
    this.disposeIntersections();
    this.registeredRoads = [];
    this.group.removeFromParent();

    if (TrafficLightController.activeController === this) {
      TrafficLightController.activeController = null;
    }
  }
}

export default TrafficLightController;
