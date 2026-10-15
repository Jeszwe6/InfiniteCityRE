import * as THREE from "three";
import {
  PlotGenerator,
  type PlotRole,
  type ResidentialBuildingKind,
} from "./PlotGenerator";
import type { BuildingType } from "./BuildingFactory";
import { RoadGenerator } from "./RoadGenerator";
import { Road } from "./Road";
import { Intersection } from "./Intersection";

interface PlotLayout {
  x: number;
  z: number;
  rotation: number;
  role: PlotRole;
  apartmentHasGreenArea?: boolean;
  buildingOffsetX?: number;
  buildingOffsetZ?: number;
  buildingScale?: number;
}

export class CityBlock {
  private static readonly WIDTH = 32;
  private static readonly DEPTH = 32;
  private static readonly PLOT_WIDTH = 12;
  private static readonly PLOT_DEPTH = 12;
  private static readonly PLOT_OFFSET = 10;

  private static readonly VILLA_LAYOUT: readonly PlotLayout[] = [
    {
      x: -10,
      z: -10,
      rotation: 0,
      role: "villa",
      buildingOffsetX: -0.65,
      buildingOffsetZ: 0.35,
      buildingScale: 3.9,
    },
    {
      x: 10,
      z: -10,
      rotation: 0,
      role: "villa",
      buildingOffsetX: 0.45,
      buildingOffsetZ: 0.55,
      buildingScale: 4.15,
    },
    {
      x: -10,
      z: 10,
      rotation: 0,
      role: "villa",
      buildingOffsetX: -0.45,
      buildingOffsetZ: -0.55,
      buildingScale: 4.05,
    },
    {
      x: 10,
      z: 10,
      rotation: 0,
      role: "villa",
      buildingOffsetX: 0.6,
      buildingOffsetZ: -0.35,
      buildingScale: 3.8,
    },
  ];

  private static readonly APARTMENT_LAYOUT: readonly PlotLayout[] = [
    {
      x: -10,
      z: -10,
      rotation: 0,
      role: "apartment",
      apartmentHasGreenArea: true,
      buildingOffsetX: -0.35,
      buildingOffsetZ: 0.25,
      buildingScale: 3.9,
    },
    {
      x: 10,
      z: -10,
      rotation: 0,
      role: "apartment",
      apartmentHasGreenArea: true,
      buildingOffsetX: 0.35,
      buildingOffsetZ: 0.15,
      buildingScale: 4.1,
    },
    {
      x: -10,
      z: 10,
      rotation: 0,
      role: "apartment",
      apartmentHasGreenArea: true,
      buildingOffsetX: -0.25,
      buildingOffsetZ: -0.4,
      buildingScale: 4.05,
    },
    {
      x: 10,
      z: 10,
      rotation: 0,
      role: "apartment",
      apartmentHasGreenArea: true,
      buildingOffsetX: 0.45,
      buildingOffsetZ: -0.3,
      buildingScale: 3.85,
    },
  ];

  private static readonly INDUSTRIAL_LAYOUT: readonly PlotLayout[] = [
    {
      x: -10,
      z: -10,
      rotation: 0,
      role: "industrial",
      buildingOffsetX: -0.35,
      buildingOffsetZ: 0.2,
      buildingScale: 4,
    },
    {
      x: 10,
      z: -10,
      rotation: 0,
      role: "industrial",
      buildingOffsetX: 0.4,
      buildingOffsetZ: 0.25,
      buildingScale: 4.15,
    },
  ];

  public readonly group: THREE.Group;
  private readonly plotGenerator: PlotGenerator;
  private readonly roadGenerator: RoadGenerator;
  private readonly intersection: Intersection;
  private readonly buildingType: BuildingType;
  private readonly roads: Road[] = [];
  private readonly readyPromise: Promise<void>;
  private ready = false;
  private disposed = false;
  private readonly createdPlots = new Set<THREE.Group>();

  constructor(buildingType: BuildingType = "suburban") {
    this.buildingType = buildingType;
    this.group = new THREE.Group();
    this.group.name = "CityBlock";
    this.group.userData.isCityBlock = true;
    this.group.userData.buildingType = this.buildingType;

    this.plotGenerator = new PlotGenerator();
    this.roadGenerator = new RoadGenerator();
    this.intersection = new Intersection();
    this.intersection.group.userData.isIntersection = true;

    this.createRoads();
    this.readyPromise = this.createPlots();
  }

  private createRoads(): void {
    if (this.disposed) return;

    const verticalRoad = this.roadGenerator.createVerticalRoad(CityBlock.DEPTH);
    verticalRoad.group.position.set(0, 0, 0);
    this.roads.push(verticalRoad);

    const horizontalRoad = this.roadGenerator.createHorizontalRoad(
      CityBlock.WIDTH,
    );
    horizontalRoad.group.position.set(0, 0, 0);
    this.roads.push(horizontalRoad);

    this.group.add(verticalRoad.group, horizontalRoad.group);
    this.intersection.group.position.set(0, 0, 0);
    this.group.add(this.intersection.group);
  }

  public getRoads(): readonly Road[] {
    return this.roads;
  }

  private getPlotLayout(): readonly PlotLayout[] {
    switch (this.buildingType) {
      case "suburban":
        return CityBlock.VILLA_LAYOUT;
      case "commercial":
        return CityBlock.APARTMENT_LAYOUT;
      case "industrial":
        return CityBlock.INDUSTRIAL_LAYOUT;
      default:
        return CityBlock.VILLA_LAYOUT;
    }
  }

  public async waitUntilReady(): Promise<void> {
    await this.readyPromise;
  }

  public isReady(): boolean {
    return this.ready;
  }

  private async createPlots(): Promise<void> {
    if (this.disposed) return;

    const layouts = this.getPlotLayout();
    const plotPromises = layouts.map(async (layout) => {
      if (this.disposed) return;

      let plot: THREE.Group | undefined;
      try {
        const resolvedBuildingType = this.resolveBuildingType(layout.role);
        const residentialKind: ResidentialBuildingKind =
          layout.role === "apartment" ? "apartment" : "villa";

        plot = await this.plotGenerator.createPlot(
          CityBlock.PLOT_WIDTH,
          CityBlock.PLOT_DEPTH,
          resolvedBuildingType,
          layout.rotation,
          residentialKind,
          layout.role,
          layout.apartmentHasGreenArea ?? false,
        );

        // اگر Block حین await حذف شده، Plot را به صحنه اضافه نکن.
        if (this.disposed) {
          this.disposeDetachedPlot(plot);
          return;
        }

        plot.userData.isPlot = true;
        plot.userData.plotRole = layout.role;
        plot.userData.buildingType = resolvedBuildingType;

        const isResidential =
          layout.role === "villa" || layout.role === "apartment";
        plot.userData.isResidential = isResidential;

        if (isResidential) {
          plot.userData.residentialKind = residentialKind;
          plot.userData.isClickable = true;
        }

        if (layout.role === "apartment") {
          plot.userData.hasGreenArea = layout.apartmentHasGreenArea ?? false;
          plot.userData.isApartmentGroupMember = true;
          plot.userData.apartmentGroup = "apartment-neighborhood";
        }

        if (layout.role === "villa") plot.userData.isVillaPlot = true;

        plot.position.set(layout.x, 0, layout.z);
        plot.rotation.y = layout.rotation;
        this.applyBuildingVariation(plot, layout);

        // بررسی نهایی درست پیش از اضافه‌کردن به Group.
        if (this.disposed) {
          this.disposeDetachedPlot(plot);
          return;
        }

        this.group.add(plot);
        this.createdPlots.add(plot);
      } catch (error) {
        if (plot && this.disposed) this.disposeDetachedPlot(plot);
        console.error(
          `[CityBlock] Failed to create ${layout.role} plot:`,
          error,
        );
      }
    });

    await Promise.all(plotPromises);
    if (!this.disposed) this.ready = true;
  }

  private applyBuildingVariation(plot: THREE.Group, layout: PlotLayout): void {
    let building: THREE.Object3D | undefined;
    plot.traverse((object) => {
      if (building === undefined && object.userData.isBuilding === true)
        building = object;
    });
    if (!building) return;

    const buildingObject = building;
    buildingObject.position.x *= layout.buildingOffsetX ?? 0;
    buildingObject.position.z *= layout.buildingOffsetZ ?? 0;

    if (layout.buildingScale !== undefined) {
      buildingObject.scale.multiplyScalar(layout.buildingScale / 4);
    }

    buildingObject.rotation.set(0, 0, 0);
    buildingObject.userData.blockOffsetX = layout.buildingOffsetX ?? 0;
    buildingObject.userData.blockOffsetZ = layout.buildingOffsetZ ?? 0;
    buildingObject.userData.blockScale = layout.buildingScale ?? 4;
  }

  private resolveBuildingType(role: PlotRole): BuildingType {
    switch (role) {
      case "villa":
        return "suburban";
      case "apartment":
        return "commercial";
      case "commercial":
        return "commercial";
      case "hospital":
        return "commercial";
      case "industrial":
        return "industrial";
      case "park":
        return "suburban";
      default:
        return "suburban";
    }
  }

  public getWidth(): number {
    return CityBlock.WIDTH;
  }
  public getDepth(): number {
    return CityBlock.DEPTH;
  }

  public update(_deltaTime: number): void {
    if (this.disposed) return;
  }

  /** پاک‌سازی فقط منابع اختصاصی Plot؛ منابع مدل‌های cacheشده را دست‌نخورده می‌گذارد. */
  private disposeDetachedPlot(plot: THREE.Group): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    plot.traverse((object) => {
      // منابع ساختمان، طبیعت و مسیر ممکن است بین چند Plot مشترک باشند.
      // بررسی والدها لازم است چون Meshهای داخلی معمولاً metadata ندارند.
      let parent: THREE.Object3D | null = object;
      while (parent && parent !== plot) {
        if (
          parent.userData.isBuilding === true ||
          parent.userData.isNatureManager === true ||
          parent.name === "ResidentialPath" ||
          parent.name === "NatureManager"
        ) {
          return;
        }
        parent = parent.parent;
      }

      const mesh = object as THREE.Mesh;
      if (mesh.geometry?.isBufferGeometry) geometries.add(mesh.geometry);
      const material = mesh.material;
      if (Array.isArray(material))
        material.forEach((item) => materials.add(item));
      else if (material?.isMaterial) materials.add(material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    plot.clear();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;

    this.plotGenerator.dispose();
    this.intersection.dispose();

    for (const plot of this.createdPlots) this.disposeDetachedPlot(plot);
    this.createdPlots.clear();

    // Roadها از این Block جدا می‌شوند؛ shared cacheهای Road را آزاد نکن.
    for (const road of this.roads) road.dispose();
    this.roads.length = 0;
    this.group.clear();
  }
}
