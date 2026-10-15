import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { BuildingFactory, type BuildingType } from "./BuildingFactory";

import { Building } from "./Building";
import { NatureManager } from "./NatureManager";

/**
 * نوع ساختمان مسکونی.
 *
 * Villa و Apartment هر دو Residential هستند،
 * اما مدل و محیط اطراف آن‌ها متفاوت است.
 */
export type ResidentialBuildingKind = "villa" | "apartment";

/**
 * نوع کاربری واقعی Plot.
 *
 * PlotRole از BuildingType جدا است تا بتوانیم
 * رفتار محیطی هر Plot را مستقل کنترل کنیم.
 */
export type PlotRole =
  | "villa"
  | "apartment"
  | "commercial"
  | "hospital"
  | "industrial"
  | "park";

/**
 * نوع سطح Plot.
 */
type PlotSurfaceType = "grass" | "asphalt";

/**
 * نوع Parking.
 */
type ParkingType = "apartment" | "commercial" | "hospital" | "industrial";

/**
 * Loader مشترک برای Decorationها.
 */
const decorationLoader = new GLTFLoader();

/**
 * Cache مدل‌های Decoration.
 */
const decorationCache = new Map<string, THREE.Object3D>();

/**
 * Promiseهای Loading در حال اجرا.
 *
 * باعث می‌شود چند Plot همزمان یک فایل
 * یکسان را دوباره دانلود نکنند.
 */
const decorationLoading = new Map<string, Promise<THREE.Object3D>>();

/**
 * BuildingFactory مشترک.
 *
 * Cache مدل‌های ساختمان بین تمام Plotها مشترک است.
 */
const sharedBuildingFactory = new BuildingFactory();

/**
 * Generator مربوط به Plotها.
 */
export class PlotGenerator {
  /**
   * شماره Plot.
   */
  private plotIndex = 0;

  /**
   * ساختمان‌های ساخته‌شده.
   */
  private readonly buildings = new Set<Building>();

  /**
   * NatureManagerهای Villa و Park.
   */
  private readonly natureManagers = new Set<NatureManager>();

  /** Plotهایی که ساخت آن‌ها هنوز در جریان است یا به Block تحویل شده‌اند. */
  private readonly activePlots = new Set<THREE.Group>();

  /**
   * وضعیت Dispose.
   */
  private disposed = false;

  /**
   * ساخت یک Plot کامل.
   *
   * Villa:
   * - Grass
   * - Nature
   * - Path
   * - Hedge Fence
   * - بدون Parking
   *
   * Apartment:
   * - Asphalt
   * - Parking
   * - Green Area اختیاری
   * - Short Fence
   *
   * Commercial:
   * - Asphalt
   * - Parking
   *
   * Hospital:
   * - Asphalt
   * - Parking
   *
   * Industrial:
   * - Asphalt
   * - Parking
   */
  public async createPlot(
    width = 12,
    depth = 12,
    buildingType: BuildingType = "suburban",
    rotation = 0,
    residentialKind: ResidentialBuildingKind = "villa",
    plotRole: PlotRole = "villa",
    apartmentHasGreenArea = false,
  ): Promise<THREE.Group> {
    /**
     * اگر Generator Dispose شده باشد،
     * Plot خالی برمی‌گردانیم.
     */
    if (this.disposed) {
      return new THREE.Group();
    }

    const currentPlotIndex = this.plotIndex++;

    /**
     * تشخیص نوع Plot.
     */
    const isVilla = plotRole === "villa";

    const isApartment = plotRole === "apartment";

    const isPark = plotRole === "park";

    const isResidential = isVilla || isApartment;

    /**
     * Villa و Park فقط Grass دارند.
     *
     * Apartment / Commercial / Hospital /
     * Industrial دارای Asphalt هستند.
     */
    const surfaceType: PlotSurfaceType =
      isVilla || isPark ? "grass" : "asphalt";

    /**
     * Group اصلی Plot.
     */
    const plot = new THREE.Group();

    plot.name = `Plot_${currentPlotIndex}`;
    this.activePlots.add(plot);

    /**
     * Metadata مربوط به Plot.
     */
    plot.userData.isPlot = true;
    plot.userData.plotRole = plotRole;
    plot.userData.buildingType = buildingType;
    plot.userData.surfaceType = surfaceType;
    plot.userData.isResidential = isResidential;

    /**
     * نوع ساختمان مسکونی.
     */
    if (isResidential) {
      plot.userData.residentialKind = residentialKind;
    }

    /**
     * اطلاعات فضای سبز Apartment.
     */
    if (isApartment) {
      plot.userData.hasGreenArea = apartmentHasGreenArea;
    }

    /**
     * ساخت سطح اصلی Plot.
     */
    this.createPlotSurface(plot, width, depth, surfaceType);

    /**
     * Apartment می‌تواند فضای سبز محدود داشته باشد.
     *
     * سطح اصلی همچنان Asphalt باقی می‌ماند.
     */
    if (isApartment && apartmentHasGreenArea) {
      this.createApartmentGreenArea(plot, width, depth);
    }

    /**
     * فقط Villa و Park طبیعت دارند.
     *
     * Apartment / Commercial / Hospital /
     * Industrial طبیعت ندارند.
     */
    if (isVilla || isPark) {
      const natureManager = new NatureManager();

      this.natureManagers.add(natureManager);

      /**
       * Nature داخل فضای محلی Plot ساخته می‌شود.
       */
      natureManager.populatePlot(0, 0, 0);
      natureManager.group.userData.isNatureManager = true;

      plot.add(natureManager.group);
    }

    /**
     * ساخت ساختمان.
     *
     * Villa:
     * suburban
     *
     * Apartment:
     * commercial
     *
     * Commercial:
     * commercial
     *
     * Industrial:
     * industrial
     */
    const building = await sharedBuildingFactory.createBuilding(
      buildingType,
      4,
    );

    /**
     * اگر در زمان Load، Generator
     * Dispose شده باشد، ساختمان اضافه نمی‌شود.
     */
    if (this.disposed) {
      // Geometry و Material مدل ساختمان ممکن است از cache مشترک آمده باشند.
      // با علامت‌گذاری ریشه، پاک‌سازی Plot آن منابع مشترک را آزاد نمی‌کند.
      building.group.userData.isBuilding = true;
      plot.add(building.group);
      this.disposePlotResources(plot);
      this.activePlots.delete(plot);
      return plot;
    }

    /**
     * ساختمان در مرکز Plot قرار می‌گیرد.
     *
     * مهم:
     * خود ساختمان مستقل است.
     */
    building.group.position.set(0, 0, 0);

    /**
     * در حالت فعلی ساختمان را کج نمی‌کنیم.
     *
     * rotation صفر باعث می‌شود ساختمان‌ها
     * نسبت به خیابان صاف بمانند.
     *
     * اگر بعداً بخواهیم تنوع ایجاد کنیم،
     * فقط خود Building را می‌چرخانیم،
     * نه کل Plot و حصار را.
     */
    building.group.rotation.y = 0;

    /**
     * Metadata ساختمان.
     */
    building.group.userData.isBuilding = true;

    building.group.userData.plotRole = plotRole;

    building.group.userData.isResidential = isResidential;

    /**
     * فقط Villa و Apartment قابل کلیک هستند.
     */
    building.group.userData.isClickable = isResidential;

    /**
     * نوع ساختمان مسکونی.
     */
    if (isResidential) {
      building.group.userData.buildingKind = residentialKind;
    }

    /**
     * Hospital فعلاً از مدل Commercial استفاده می‌کند.
     */
    if (plotRole === "hospital") {
      building.group.userData.buildingKind = "hospital";

      building.group.userData.factoryBuildingType = "commercial";
    }

    /**
     * اتصال ساختمان به Plot.
     */
    plot.add(building.group);

    /**
     * ذخیره برای Lifecycle.
     */
    this.buildings.add(building);

    /**
     * جزئیات Villa.
     *
     * بدون Parking و بدون Asphalt اضافه.
     */
    if (isVilla) {
      await this.createResidentialDetails(plot, width, depth);
      if (this.disposed) {
        this.disposePlotResources(plot);
        this.activePlots.delete(plot);
        return plot;
      }
    }

    /**
     * جزئیات Commercial.
     */
    if (plotRole === "commercial") {
      await this.createCommercialDetails(plot, width, depth, rotation);
      if (this.disposed) {
        this.disposePlotResources(plot);
        this.activePlots.delete(plot);
        return plot;
      }
      this.createParkingDetails(plot, width, depth, "commercial");
    }

    /**
     * Hospital.
     */
    if (plotRole === "hospital") {
      this.createParkingDetails(plot, width, depth, "hospital");
    }

    /**
     * Industrial / Factory.
     */
    if (plotRole === "industrial") {
      await this.createIndustrialDetails(plot, width, depth, rotation);
      if (this.disposed) {
        this.disposePlotResources(plot);
        this.activePlots.delete(plot);
        return plot;
      }
      this.createParkingDetails(plot, width, depth, "industrial");
    }

    /**
     * Apartment.
     *
     * - Asphalt
     * - Parking
     * - Green Area اختیاری
     * - Short Fence
     *
     * Nature ندارد.
     */
    if (isApartment) {
      this.createParkingDetails(plot, width, depth, "apartment");

      this.createApartmentFence(plot, width, depth);
    }

    if (this.disposed) {
      this.disposePlotResources(plot);
      this.activePlots.delete(plot);
    }

    return plot;
  }

  /**
   * منابع اختصاصی Plot را آزاد می‌کند و منابع مشترک مدل‌ها را دست‌نخورده می‌گذارد.
   */
  private disposePlotResources(plot: THREE.Group): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();

    plot.traverse((object) => {
      // منابع مدل‌های cacheشده و فرزندان آن‌ها shared هستند.
      let parent: THREE.Object3D | null = object;
      while (parent && parent !== plot) {
        if (
          parent.userData.isBuilding === true ||
          parent.userData.isNatureManager === true ||
          parent.name === "ResidentialPath"
        )
          return;
        parent = parent.parent;
      }

      const mesh = object as THREE.Mesh;
      if (mesh.geometry?.isBufferGeometry) geometries.add(mesh.geometry);
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const item of material) materials.add(item);
      } else if (material?.isMaterial) {
        materials.add(material);
      }
    });

    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    plot.clear();
  }

  /**
   * ایجاد سطح اصلی Plot.
   *
   * Villa / Park:
   * Grass
   *
   * Apartment / Commercial / Hospital /
   * Industrial:
   * Asphalt
   */
  private createPlotSurface(
    plot: THREE.Group,
    width: number,
    depth: number,
    surfaceType: PlotSurfaceType,
  ): void {
    /**
     * فضای داخلی Plot.
     *
     * این مقدار باعث می‌شود سطح Plot
     * به مرز پیاده‌رو نچسبد.
     */
    const sidewalkWidth = 1.2;

    const surfaceWidth = Math.max(1, width - sidewalkWidth * 2);

    const surfaceDepth = Math.max(1, depth - sidewalkWidth * 2);

    const isGrass = surfaceType === "grass";

    /**
     * Geometry سبک.
     */
    const geometry = new THREE.BoxGeometry(surfaceWidth, 0.2, surfaceDepth);

    /**
     * رنگ سطح Plot.
     *
     * Grass:
     * 0x88c273
     *
     * Asphalt:
     * 0x3f4247
     */
    const material = new THREE.MeshStandardMaterial({
      color: isGrass ? 0x88c273 : 0x3f4247,
      roughness: 1,
      metalness: 0,
    });

    const surface = new THREE.Mesh(geometry, material);

    surface.position.y = 0.1;

    surface.name = isGrass ? "PlotGrass" : "PlotAsphalt";

    surface.castShadow = false;
    surface.receiveShadow = true;
    surface.frustumCulled = true;

    plot.add(surface);
  }

  /**
   * ایجاد فضای سبز محدود Apartment.
   *
   * سطح اصلی همچنان Asphalt است.
   */
  private createApartmentGreenArea(
    plot: THREE.Group,
    width: number,
    depth: number,
  ): void {
    const grassWidth = Math.min(width * 0.62, 7.6);

    const grassDepth = Math.min(depth * 0.52, 6.2);

    const geometry = new THREE.BoxGeometry(grassWidth, 0.12, grassDepth);

    const material = new THREE.MeshStandardMaterial({
      color: 0x8bc34a,
      roughness: 1,
      metalness: 0,
    });

    const grass = new THREE.Mesh(geometry, material);

    /**
     * کمی عقب‌تر قرار می‌گیرد
     * تا Parking جلو دیده شود.
     */
    grass.position.set(0, 0.16, -0.9);

    grass.name = "ApartmentGreenArea";

    grass.castShadow = false;
    grass.receiveShadow = true;
    grass.frustumCulled = true;

    plot.add(grass);
  }

  /**
   * ایجاد Parking.
   *
   * فقط خطوط هندسی سبک ایجاد می‌شود.
   */
  private createParkingDetails(
    plot: THREE.Group,
    width: number,
    depth: number,
    type: ParkingType,
  ): void {
    const parkingGroup = new THREE.Group();

    parkingGroup.name = "Parking";

    /**
     * Parking در قسمت جلویی Plot.
     */
    const parkingZ = depth * 0.27;

    /**
     * تعداد جای پارک.
     */
    const parkingCount =
      type === "apartment"
        ? 4
        : type === "hospital"
          ? 5
          : type === "commercial"
            ? 4
            : 3;

    /**
     * ابعاد هر جای پارک.
     */
    const slotWidth = 1.65;
    const slotDepth = 2.5;

    const totalWidth = parkingCount * slotWidth;

    const startX = -totalWidth / 2 + slotWidth / 2;

    /**
     * Geometry مشترک خطوط.
     */
    const lineGeometry = new THREE.PlaneGeometry(0.07, slotDepth);

    const lineMaterial = new THREE.MeshBasicMaterial({
      color: 0xe8e8e8,
      side: THREE.DoubleSide,
    });

    /**
     * خطوط بین جای پارک‌ها.
     */
    for (let i = 0; i <= parkingCount; i++) {
      const line = new THREE.Mesh(lineGeometry, lineMaterial);

      line.rotation.x = -Math.PI / 2;

      line.position.set(startX - slotWidth / 2 + i * slotWidth, 0.22, parkingZ);

      line.name = `ParkingLine_${i}`;

      line.frustumCulled = true;

      parkingGroup.add(line);
    }

    /**
     * خط انتهایی Parking.
     */
    const endLineGeometry = new THREE.PlaneGeometry(totalWidth, 0.07);

    const endLine = new THREE.Mesh(endLineGeometry, lineMaterial);

    endLine.rotation.x = -Math.PI / 2;

    endLine.position.set(0, 0.22, parkingZ + slotDepth / 2);

    endLine.name = "ParkingEndLine";

    endLine.frustumCulled = true;

    parkingGroup.add(endLine);

    /**
     * جلوگیری از خارج شدن Parking
     * از محدوده Plot.
     */
    parkingGroup.scale.x = Math.min(1, (width - 2) / Math.max(totalWidth, 1));

    plot.add(parkingGroup);
  }

  /**
   * جزئیات Villa.
   *
   * فقط:
   * - Path
   * - Hedge Fence
   *
   * بدون Parking.
   */
  private async createResidentialDetails(
    plot: THREE.Group,
    width: number,
    depth: number,
  ): Promise<void> {
    /**
     * مسیر ورودی Villa.
     */
    await this.createPath(plot, width, depth);

    /**
     * حصار بوته‌ای.
     */
    this.createVillaHedgeFence(plot, width, depth);
  }

  /**
   * ایجاد حصار بوته‌ای Villa.
   *
   * نکته مهم:
   *
   * حصار کاملاً داخل Plot ساخته می‌شود.
   *
   * حریم داخلی:
   *
   * 1.25 واحد از لبه Plot
   *
   * این فاصله باعث می‌شود حصار
   * وارد پیاده‌رو نشود.
   */
  private createVillaHedgeFence(
    plot: THREE.Group,
    width: number,
    depth: number,
  ): void {
    const fenceGroup = new THREE.Group();

    fenceGroup.name = "VillaHedgeFence";

    /**
     * ابعاد بوته‌ها.
     */
    const hedgeSize = 0.55;
    const hedgeHeight = 0.65;

    /**
     * فاصله بین بوته‌ها.
     */
    const spacing = 0.8;

    /**
     * Material مشترک.
     */
    const hedgeMaterial = new THREE.MeshStandardMaterial({
      color: 0x4f8f3a,
      roughness: 1,
      metalness: 0,
    });

    /**
     * Geometry مشترک.
     */
    const hedgeGeometry = new THREE.BoxGeometry(
      hedgeSize,
      hedgeHeight,
      hedgeSize,
    );

    /**
     * حریم امن داخلی Plot.
     *
     * این مقدار عمداً بزرگ‌تر از نسخه قبلی است.
     */
    const inset = 1.25;

    const halfWidth = Math.max(0.5, width / 2 - inset);

    const halfDepth = Math.max(0.5, depth / 2 - inset);

    /**
     * ساخت یک ردیف حصار.
     */
    const addHedgeRow = (
      horizontal: boolean,
      fixedPosition: number,
      start: number,
      end: number,
    ): void => {
      if (end < start) {
        return;
      }

      for (let position = start; position <= end; position += spacing) {
        const hedge = new THREE.Mesh(hedgeGeometry, hedgeMaterial);

        if (horizontal) {
          hedge.position.set(position, hedgeHeight / 2, fixedPosition);
        } else {
          hedge.position.set(fixedPosition, hedgeHeight / 2, position);
        }

        hedge.castShadow = false;
        hedge.receiveShadow = true;
        hedge.frustumCulled = true;

        fenceGroup.add(hedge);
      }
    };

    /**
     * پشت Villa.
     */
    addHedgeRow(true, -halfDepth, -halfWidth, halfWidth);

    /**
     * سمت چپ.
     */
    addHedgeRow(false, -halfWidth, -halfDepth, halfDepth);

    /**
     * سمت راست.
     */
    addHedgeRow(false, halfWidth, -halfDepth, halfDepth);

    /**
     * جلوی Villa.
     *
     * وسط کاملاً باز است
     * تا ورودی دیده شود.
     */
    const entranceGap = 2.4;

    addHedgeRow(true, halfDepth, -halfWidth, -entranceGap);

    addHedgeRow(true, halfDepth, entranceGap, halfWidth);

    /**
     * حصار عمداً rotation نمی‌گیرد.
     *
     * چون Plotها فعلاً صاف هستند و
     * نمی‌خواهیم حصار باعث کج دیده شدن
     * محوطه شود.
     */
    fenceGroup.rotation.y = 0;

    fenceGroup.position.y = 0;

    plot.add(fenceGroup);
  }

  /**
   * ایجاد حصار Apartment.
   *
   * حصار کوتاه است و فضای کافی برای
   * Parking و ورودی باقی می‌گذارد.
   */
  private createApartmentFence(
    plot: THREE.Group,
    width: number,
    depth: number,
  ): void {
    const fenceGroup = new THREE.Group();

    fenceGroup.name = "ApartmentShortFence";

    /**
     * فعلاً حصار فلزی.
     */
    const useMetalFence = true;

    /**
     * ابعاد پایه‌ها.
     */
    const postHeight = 0.65;
    const postWidth = 0.08;
    const railHeight = 0.06;
    const railDepth = 0.06;
    const spacing = 0.7;

    /**
     * Material.
     */
    const fenceMaterial = new THREE.MeshStandardMaterial({
      color: useMetalFence ? 0x555b5e : 0x8a633f,
      roughness: 0.85,
      metalness: useMetalFence ? 0.25 : 0,
    });

    /**
     * Geometry پایه.
     */
    const postGeometry = new THREE.BoxGeometry(
      postWidth,
      postHeight,
      postWidth,
    );

    /**
     * Geometry ریل افقی.
     */
    const horizontalRailGeometry = new THREE.BoxGeometry(
      1,
      railHeight,
      railDepth,
    );

    /**
     * Geometry پایه عمودی.
     */
    const verticalRailGeometry = new THREE.BoxGeometry(
      railDepth,
      postHeight,
      railDepth,
    );

    /**
     * حریم داخلی Apartment.
     *
     * این مقدار باعث می‌شود حصار
     * از پیاده‌رو فاصله داشته باشد.
     */
    const inset = 1.35;

    const halfWidth = Math.max(0.5, width / 2 - inset);

    const halfDepth = Math.max(0.5, depth / 2 - inset);

    /**
     * ساخت ضلع افقی.
     */
    const addHorizontalFence = (
      z: number,
      startX: number,
      endX: number,
    ): void => {
      const length = endX - startX;

      if (length <= 0) {
        return;
      }

      const rail = new THREE.Mesh(horizontalRailGeometry, fenceMaterial);

      rail.scale.x = length;

      rail.position.set((startX + endX) / 2, postHeight * 0.72, z);

      rail.castShadow = false;
      rail.receiveShadow = false;
      rail.frustumCulled = true;

      fenceGroup.add(rail);

      for (let x = startX; x <= endX; x += spacing) {
        const post = new THREE.Mesh(postGeometry, fenceMaterial);

        post.position.set(x, postHeight / 2, z);

        post.castShadow = false;
        post.receiveShadow = false;
        post.frustumCulled = true;

        fenceGroup.add(post);
      }
    };

    /**
     * ساخت ضلع عمودی.
     */
    const addVerticalFence = (
      x: number,
      startZ: number,
      endZ: number,
    ): void => {
      const length = endZ - startZ;

      if (length <= 0) {
        return;
      }

      const rail = new THREE.Mesh(horizontalRailGeometry, fenceMaterial);

      rail.rotation.y = Math.PI / 2;

      rail.scale.x = length;

      rail.position.set(x, postHeight * 0.72, (startZ + endZ) / 2);

      rail.castShadow = false;
      rail.receiveShadow = false;
      rail.frustumCulled = true;

      fenceGroup.add(rail);

      for (let z = startZ; z <= endZ; z += spacing) {
        const post = new THREE.Mesh(verticalRailGeometry, fenceMaterial);

        post.position.set(x, postHeight / 2, z);

        post.castShadow = false;
        post.receiveShadow = false;
        post.frustumCulled = true;

        fenceGroup.add(post);
      }
    };

    /**
     * پشت Apartment.
     */
    addHorizontalFence(-halfDepth, -halfWidth, halfWidth);

    /**
     * سمت چپ.
     */
    addVerticalFence(-halfWidth, -halfDepth, halfDepth);

    /**
     * سمت راست.
     */
    addVerticalFence(halfWidth, -halfDepth, halfDepth);

    /**
     * جلوی Apartment.
     *
     * ورودی باز می‌ماند.
     */
    const entranceGap = 3.2;

    addHorizontalFence(halfDepth, -halfWidth, -entranceGap);

    addHorizontalFence(halfDepth, entranceGap, halfWidth);

    /**
     * فعلاً حصار صاف است.
     */
    fenceGroup.rotation.y = 0;

    fenceGroup.position.y = 0;

    plot.add(fenceGroup);
  }

  /**
   * جزئیات Commercial.
   */
  private async createCommercialDetails(
    plot: THREE.Group,
    width: number,
    depth: number,
    rotation: number,
  ): Promise<void> {
    await this.createAwning(plot, width, depth, rotation);

    await this.createOverhang(plot, width, depth, rotation);

    await this.createParasol(plot, width, depth, rotation);
  }

  /**
   * جزئیات Industrial.
   */
  private async createIndustrialDetails(
    plot: THREE.Group,
    width: number,
    depth: number,
    rotation: number,
  ): Promise<void> {
    await this.createChimney(plot, width, depth, rotation);

    await this.createTank(plot, width, depth, rotation);
  }

  /**
   * Load کردن Decoration با Cache.
   */
  private async loadDecoration(path: string): Promise<THREE.Object3D> {
    /**
     * Cache.
     */
    const cached = decorationCache.get(path);

    if (cached) {
      return cached;
    }

    /**
     * Loading قبلی.
     */
    const existingLoading = decorationLoading.get(path);

    if (existingLoading) {
      return existingLoading;
    }

    /**
     * شروع Load.
     */
    const loadingPromise = new Promise<THREE.Object3D>((resolve, reject) => {
      decorationLoader.load(
        path,
        (gltf) => {
          const model = gltf.scene;

          /**
           * تنظیمات مشترک Decoration.
           */
          model.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              object.castShadow = false;

              object.receiveShadow = true;

              object.frustumCulled = true;
            }
          });

          decorationCache.set(path, model);

          decorationLoading.delete(path);

          resolve(model);
        },
        undefined,
        (error) => {
          decorationLoading.delete(path);

          reject(error);
        },
      );
    });

    decorationLoading.set(path, loadingPromise);

    return loadingPromise;
  }

  /**
   * ایجاد مسیر Villa.
   *
   * مسیر هم داخل محدوده Plot قرار دارد
   * و نباید وارد خیابان شود.
   */
  private async createPath(
    plot: THREE.Group,
    _width: number,
    depth: number,
  ): Promise<void> {
    const longPath =
      "/assets/buildings/suburban/Models/GLB format/path-long.glb";

    const shortPath =
      "/assets/buildings/suburban/Models/GLB format/path-short.glb";

    const model = await this.loadDecoration(depth > 10 ? longPath : shortPath);

    /**
     * Clone فقط hierarchy را می‌سازد.
     */
    const path = model.clone(true);

    /**
     * مسیر از لبه Plot فاصله دارد.
     */
    path.position.set(0, 0.03, depth / 2 - 2.2);

    /**
     * مسیر صاف باقی می‌ماند.
     */
    path.rotation.y = 0;

    path.name = "ResidentialPath";

    plot.add(path);
  }

  /**
   * این متد برای سازگاری با API قبلی
   * نگه داشته شده است.
   *
   * حصار Villa اکنون با Geometry ساخته می‌شود.
   */
  private async createFence(
    plot: THREE.Group,
    width: number,
    depth: number,
    _rotation: number,
  ): Promise<void> {
    this.createVillaHedgeFence(plot, width, depth);
  }

  /**
   * Awning فروشگاه.
   */
  private async createAwning(
    plot: THREE.Group,
    _width: number,
    _depth: number,
    rotation: number,
  ): Promise<void> {
    void plot;
    void rotation;
  }

  /**
   * Overhang فروشگاه.
   */
  private async createOverhang(
    plot: THREE.Group,
    _width: number,
    _depth: number,
    rotation: number,
  ): Promise<void> {
    void plot;
    void rotation;
  }

  /**
   * Parasol فروشگاه.
   */
  private async createParasol(
    plot: THREE.Group,
    _width: number,
    _depth: number,
    rotation: number,
  ): Promise<void> {
    void plot;
    void rotation;
  }

  /**
   * Chimney کارخانه.
   */
  private async createChimney(
    plot: THREE.Group,
    _width: number,
    _depth: number,
    rotation: number,
  ): Promise<void> {
    void plot;
    void rotation;
  }

  /**
   * Tank کارخانه.
   */
  private async createTank(
    plot: THREE.Group,
    _width: number,
    _depth: number,
    rotation: number,
  ): Promise<void> {
    void plot;
    void rotation;
  }

  /**
   * Update.
   *
   * NatureManager Static است و Update نمی‌خواهد.
   */
  public update(deltaTime: number): void {
    if (this.disposed) {
      return;
    }

    for (const building of this.buildings) {
      building.update(deltaTime);
    }
  }

  /**
   * Dispose.
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    // Plotهای در حال ساخت را نیز پاک می‌کنیم؛ ادامه async آن‌ها guard دارد.
    for (const plot of this.activePlots) {
      this.disposePlotResources(plot);
    }
    this.activePlots.clear();

    // حذف referenceها به‌تنهایی کافی نیست؛ هر Building مالک منابع خودش است.
    // برای جلوگیری از آزادسازی اشتباه منابع مشترک، مدل‌های cacheشده را dispose نمی‌کنیم.
    this.buildings.clear();

    /**
     * NatureManagerهای Villa/Park.
     */
    for (const natureManager of this.natureManagers) {
      natureManager.dispose();
    }

    this.natureManagers.clear();

    /**
     * Reset index.
     */
    this.plotIndex = 0;
  }
}
