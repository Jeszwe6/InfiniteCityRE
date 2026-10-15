import * as THREE from "three";

/**
 * ==========================================
 * Road
 * ==========================================
 *
 * Road مستقل برای سیستم شهر.
 *
 * مسئولیت‌ها:
 *
 * - ساخت سطح خیابان
 * - ساخت پیاده‌رو
 * - ساخت خط‌کشی
 * - تعریف Lane
 * - ارائه Position و Direction
 * - ارائه محدوده‌های لازم برای Traffic
 *
 * جهت محلی Road همیشه روی محور +Z است.
 *
 * پیاده‌روها فقط در دو طرف خیابان و قبل از
 * محدوده‌ی چهارراه ساخته می‌شوند و وارد مرکز
 * چهارراه نمی‌شوند.
 * ==========================================
 */
export class Road {
  public static readonly WIDTH = 8;
  public static readonly LENGTH = 32;

  public static readonly LANE_COUNT = 2;
  public static readonly LANE_WIDTH = 4;

  public static readonly ASPHALT_HALF_WIDTH =
    Road.WIDTH / 2;

  public static readonly LANE_OFFSET_NEGATIVE = -2;
  public static readonly LANE_OFFSET_POSITIVE = 2;

  public static readonly DRIVING_MIN =
    -Road.ASPHALT_HALF_WIDTH;

  public static readonly DRIVING_MAX =
    Road.ASPHALT_HALF_WIDTH;

  /**
   * اندازه‌ی محدوده‌ی مرکزی چهارراه.
   */
  private static readonly INTERSECTION_SIZE = 8;

  private static readonly INTERSECTION_LINE_PADDING = 1;

  /**
   * عرض پیاده‌رو.
   */
  private static readonly SIDEWALK_WIDTH = 1.5;

  /**
   * ارتفاع پیاده‌رو.
   */
  private static readonly SIDEWALK_HEIGHT = 0.12;

  private static readonly ROAD_SURFACE_Y = 0.025;

  private static readonly CENTER_LINE_LENGTH = 1.8;

  private static readonly CENTER_LINE_GAP = 2.0;

  private static readonly CENTER_LINE_THICKNESS = 0.006;

  private static readonly CENTER_LINE_Y =
    Road.ROAD_SURFACE_Y +
    Road.CENTER_LINE_THICKNESS / 2 +
    0.0005;

  /**
   * ==========================================
   * Shared Materials
   * ==========================================
   */

  private static roadMaterial:
    THREE.MeshStandardMaterial | null = null;

  private static sidewalkMaterial:
    THREE.MeshStandardMaterial | null = null;

  private static markingMaterial:
    THREE.MeshBasicMaterial | null = null;

  /**
   * ==========================================
   * Geometry Caches
   * ==========================================
   */

  private static readonly roadGeometryCache =
    new Map<string, THREE.PlaneGeometry>();

  private static readonly sidewalkGeometryCache =
    new Map<string, THREE.BoxGeometry>();

  private static readonly centerLineGeometry =
    new THREE.BoxGeometry(
      0.12,
      Road.CENTER_LINE_THICKNESS,
      Road.CENTER_LINE_LENGTH,
    );

  /**
   * ==========================================
   * Instance Data
   * ==========================================
   */

  public readonly group: THREE.Group;

  private readonly roadWidth: number;
  private readonly roadLength: number;

  /**
   * جهت محلی Road همیشه +Z است.
   */
  public readonly localDirection =
    new THREE.Vector3(0, 0, 1);

  private readonly tempWorldOrigin =
    new THREE.Vector3();

  private readonly tempWorldDirection =
    new THREE.Vector3();

  /**
   * ==========================================
   * Constructor
   * ==========================================
   */

  constructor(
    width: number = Road.WIDTH,
    length: number = Road.LENGTH,
  ) {
    if (!Number.isFinite(width) || width <= 0) {
      throw new Error(
        `[Road] Invalid width: ${width}`,
      );
    }

    if (!Number.isFinite(length) || length <= 0) {
      throw new Error(
        `[Road] Invalid length: ${length}`,
      );
    }

    this.roadWidth = width;
    this.roadLength = length;

    this.group = new THREE.Group();

    this.group.name = "Road";
    this.group.userData.isRoad = true;
    this.group.userData.road = this;

    this.initializeMaterials();
    this.createRoadSurface();
    this.createSidewalks();
    this.createRoadMarkings();
  }

  /**
   * ==========================================
   * Lane API
   * ==========================================
   */

  public getLaneCount(): number {
    return Road.LANE_COUNT;
  }

  public getLaneOffsets(): number[] {
    return [
      Road.LANE_OFFSET_NEGATIVE,
      Road.LANE_OFFSET_POSITIVE,
    ];
  }

  public getLaneOffset(laneIndex: number): number {
    if (
      !Number.isInteger(laneIndex) ||
      laneIndex < 0 ||
      laneIndex >= Road.LANE_COUNT
    ) {
      throw new Error(
        `[Road] Invalid lane index: ${laneIndex}`,
      );
    }

    return laneIndex === 0
      ? Road.LANE_OFFSET_NEGATIVE
      : Road.LANE_OFFSET_POSITIVE;
  }

  public getLanePosition(
    laneIndex: number,
    localDistance: number,
  ): THREE.Vector3 {
    return new THREE.Vector3(
      this.getLaneOffset(laneIndex),
      Road.ROAD_SURFACE_Y,
      localDistance,
    );
  }

  public getWorldLanePosition(
    laneIndex: number,
    localDistance: number,
  ): THREE.Vector3 {
    const position = this.getLanePosition(
      laneIndex,
      localDistance,
    );

    this.group.localToWorld(position);

    return position;
  }

  /**
   * ==========================================
   * Direction
   * ==========================================
   */

  public getLocalDirection(): THREE.Vector3 {
    return this.localDirection.clone();
  }

  public getWorldDirection(): THREE.Vector3 {
    this.tempWorldOrigin.set(0, 0, 0);

    this.tempWorldDirection.copy(
      this.localDirection,
    );

    this.group.localToWorld(
      this.tempWorldOrigin,
    );

    this.group.localToWorld(
      this.tempWorldDirection,
    );

    this.tempWorldDirection
      .sub(this.tempWorldOrigin)
      .normalize();

    return this.tempWorldDirection.clone();
  }

  /**
   * ==========================================
   * Road Dimensions
   * ==========================================
   */

  public getRoadWidth(): number {
    return this.roadWidth;
  }

  public getDrivingMin(): number {
    return -this.roadWidth / 2;
  }

  public getDrivingMax(): number {
    return this.roadWidth / 2;
  }

  public getLongitudinalMin(): number {
    return -this.roadLength / 2;
  }

  public getLongitudinalMax(): number {
    return this.roadLength / 2;
  }

  public getRoadLength(): number {
    return this.roadLength;
  }

  /**
   * ==========================================
   * Intersection Bounds
   * ==========================================
   */

  public getIntersectionMin(): number {
    return -Road.INTERSECTION_SIZE / 2;
  }

  public getIntersectionMax(): number {
    return Road.INTERSECTION_SIZE / 2;
  }

  /**
   * ==========================================
   * Materials
   * ==========================================
   */

  private initializeMaterials(): void {
    if (!Road.roadMaterial) {
      Road.roadMaterial =
        new THREE.MeshStandardMaterial({
          color: 0x3d3f42,
          roughness: 0.92,
          metalness: 0,
        });
    }

    if (!Road.sidewalkMaterial) {
      Road.sidewalkMaterial =
        new THREE.MeshStandardMaterial({
          color: 0xa6a6a1,
          roughness: 0.95,
          metalness: 0,
        });
    }

    if (!Road.markingMaterial) {
      Road.markingMaterial =
        new THREE.MeshBasicMaterial({
          color: 0xf4f0d0,
        });
    }
  }

  /**
   * ==========================================
   * Road Surface
   * ==========================================
   */

  private createRoadSurface(): void {
    const geometryKey =
      `${this.roadWidth}_${this.roadLength}`;

    let geometry =
      Road.roadGeometryCache.get(geometryKey);

    if (!geometry) {
      geometry = new THREE.PlaneGeometry(
        this.roadWidth,
        this.roadLength,
      );

      geometry.rotateX(-Math.PI / 2);

      Road.roadGeometryCache.set(
        geometryKey,
        geometry,
      );
    }

    const mesh = new THREE.Mesh(
      geometry,
      Road.roadMaterial!,
    );

    mesh.name = "RoadSurface";

    mesh.position.y =
      Road.ROAD_SURFACE_Y;

    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.frustumCulled = true;

    mesh.userData.isRoadSurface = true;
    mesh.userData.road = this;

    this.group.add(mesh);
  }

  /**
   * ==========================================
   * Sidewalks
   * ==========================================
   *
   * پیاده‌روها روی لبه‌ی جاده قرار می‌گیرند.
   *
   * هر طرف Road دو قطعه دارد:
   *
   *       پیاده‌رو
   * ────────────
   *       جاده
   * ────────────
   *       پیاده‌رو
   *
   * و در محدوده‌ی چهارراه قطع می‌شوند.
   *
   * بنابراین پیاده‌رو:
   *
   * - روی خود Road قرار دارد
   * - از دو طرف خیابان خارج نمی‌شود
   * - وارد مرکز چهارراه نمی‌شود
   * ==========================================
   */

  private createSidewalks(): void {
    const intersectionMin =
      this.getIntersectionMin();

    const intersectionMax =
      this.getIntersectionMax();

    const roadMin =
      this.getLongitudinalMin();

    const roadMax =
      this.getLongitudinalMax();

    /**
     * قسمت قبل از چهارراه.
     */
    const beforeLength =
      intersectionMin - roadMin;

    if (beforeLength > 0) {
      const beforeCenter =
        roadMin + beforeLength / 2;

      this.createSidewalkSegment(
        beforeCenter,
        beforeLength,
        "BeforeIntersection",
      );
    }

    /**
     * قسمت بعد از چهارراه.
     */
    const afterLength =
      roadMax - intersectionMax;

    if (afterLength > 0) {
      const afterCenter =
        intersectionMax + afterLength / 2;

      this.createSidewalkSegment(
        afterCenter,
        afterLength,
        "AfterIntersection",
      );
    }
  }

  /**
   * ==========================================
   * Create Sidewalk Segment
   * ==========================================
   *
   * یک قطعه پیاده‌رو در هر دو طرف Road می‌سازد.
   *
   * پیاده‌رو عملاً روی لبه‌ی آسفالت قرار می‌گیرد
   * و بخش زیادی از عرض آن روی خود محدوده‌ی جاده
   * قرار دارد تا ظاهر طبیعی‌تری ایجاد شود.
   */

  private createSidewalkSegment(
    centerZ: number,
    length: number,
    suffix: string,
  ): void {
    if (length <= 0) {
      return;
    }

    const geometry =
      this.getSidewalkGeometry(length);

    const leftSidewalk = new THREE.Mesh(
      geometry,
      Road.sidewalkMaterial!,
    );

    const rightSidewalk = new THREE.Mesh(
      geometry,
      Road.sidewalkMaterial!,
    );

    leftSidewalk.name =
      `RoadSidewalk_Left_${suffix}`;

    rightSidewalk.name =
      `RoadSidewalk_Right_${suffix}`;

    /**
     * پیاده‌روها کمی داخل محدوده‌ی Road قرار
     * می‌گیرند تا روی لبه‌ی خیابان بنشینند.
     *
     * مرکز پیاده‌رو نسبت به مرکز Road:
     *
     * ±(WIDTH / 2 - WIDTH_SIDEWALK / 2)
     */
    const sidewalkOffset =
      this.roadWidth / 2 -
      Road.SIDEWALK_WIDTH / 2;

    leftSidewalk.position.set(
      -sidewalkOffset,
      Road.SIDEWALK_HEIGHT / 2,
      centerZ,
    );

    rightSidewalk.position.set(
      sidewalkOffset,
      Road.SIDEWALK_HEIGHT / 2,
      centerZ,
    );

    leftSidewalk.castShadow = false;
    leftSidewalk.receiveShadow = false;

    rightSidewalk.castShadow = false;
    rightSidewalk.receiveShadow = false;

    leftSidewalk.frustumCulled = true;
    rightSidewalk.frustumCulled = true;

    leftSidewalk.userData.isSidewalk = true;
    rightSidewalk.userData.isSidewalk = true;

    leftSidewalk.userData.road = this;
    rightSidewalk.userData.road = this;

    this.group.add(
      leftSidewalk,
      rightSidewalk,
    );
  }

  /**
   * ==========================================
   * Sidewalk Geometry
   * ==========================================
   */

  private getSidewalkGeometry(
    length: number,
  ): THREE.BoxGeometry {
    const geometryKey =
      `${Road.SIDEWALK_WIDTH}_${Road.SIDEWALK_HEIGHT}_${length}`;

    let geometry =
      Road.sidewalkGeometryCache.get(
        geometryKey,
      );

    if (!geometry) {
      geometry = new THREE.BoxGeometry(
        Road.SIDEWALK_WIDTH,
        Road.SIDEWALK_HEIGHT,
        length,
      );

      Road.sidewalkGeometryCache.set(
        geometryKey,
        geometry,
      );
    }

    return geometry;
  }

  /**
   * ==========================================
   * Road Markings
   * ==========================================
   */

  private createRoadMarkings(): void {
    const start =
      this.getLongitudinalMin() +
      Road.INTERSECTION_LINE_PADDING;

    const end =
      this.getLongitudinalMax() -
      Road.INTERSECTION_LINE_PADDING;

    const intersectionMin =
      this.getIntersectionMin();

    const intersectionMax =
      this.getIntersectionMax();

    this.createMarkingSegment(
      start,
      intersectionMin,
    );

    this.createMarkingSegment(
      intersectionMax,
      end,
    );
  }

  private createMarkingSegment(
    start: number,
    end: number,
  ): void {
    if (end <= start) {
      return;
    }

    const step =
      Road.CENTER_LINE_LENGTH +
      Road.CENTER_LINE_GAP;

    const halfLine =
      Road.CENTER_LINE_LENGTH / 2;

    for (
      let distance = start + halfLine;
      distance <= end - halfLine;
      distance += step
    ) {
      const line = new THREE.Mesh(
        Road.centerLineGeometry,
        Road.markingMaterial!,
      );

      line.name = "RoadCenterLine";

      line.position.set(
        0,
        Road.CENTER_LINE_Y,
        distance,
      );

      line.castShadow = false;
      line.receiveShadow = false;
      line.frustumCulled = true;

      line.userData.isRoadMarking = true;
      line.userData.road = this;

      this.group.add(line);
    }
  }

  /**
   * ==========================================
   * Traffic Helpers
   * ==========================================
   */

  public isDistanceInsideRoad(
    distance: number,
  ): boolean {
    return (
      distance >=
        this.getLongitudinalMin() &&
      distance <=
        this.getLongitudinalMax()
    );
  }

  public isDistanceInsideIntersection(
    distance: number,
  ): boolean {
    return (
      distance >=
        this.getIntersectionMin() &&
      distance <=
        this.getIntersectionMax()
    );
  }

  /**
   * ==========================================
   * Dispose
   * ==========================================
   */

  public dispose(): void {
    this.group.clear();
  }
}