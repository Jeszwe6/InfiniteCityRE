import * as THREE from "three";

import { Vehicle } from "./Vehicle";
import type { VehicleDirection } from "./Vehicle";

import VehicleFactory from "./VehicleFactory";
import type { VehicleModelType } from "./Vehicle";

import { Road } from "../world/Road";

import TrafficLightController from "../traffic/TrafficLightController";

/**

==========================================

Traffic Transition

==========================================



اطلاعات حرکت خودرو بین دو Road.
*/
interface TrafficTransition {
  fromRoad: Road;
  toRoad: Road;

  fromLaneIndex: number;
  toLaneIndex: number;

  start: THREE.Vector3;
  control: THREE.Vector3;
  end: THREE.Vector3;

  finalDirection: VehicleDirection;
  finalDistance: number;

  /** فاصله واقعی طی‌شده روی منحنی، مستقل از تعداد فریم‌ها. */
  distanceTravelled: number;

  /** جدول طول قوس برای تبدیل مسافت طی‌شده به پارامتر Bezier. */
  arcLength: number;
  arcLengthSamples: number[];

  /** اگر Collision Guard فریم قبل مانع حرکت شده باشد، فریم بعد ترمز نرم می‌شود. */
  blockedLastFrame: boolean;
}

/**

==========================================

Active Vehicle Data

==========================================
*/
interface ActiveVehicleData {
  vehicle: Vehicle;

  road: Road;
  laneIndex: number;
  roadDistance: number;

  trafficTransition: TrafficTransition | null;

  /**

سرعت طبیعی این خودرو.



این مقدار در طول عمر خودرو ثابت می‌ماند تا هنگام

عبور از Roadهای مختلف، سرعت ناگهان عوض نشود.
*/
  cruiseSpeed: number;

  /**

سرعت واقعی مورد استفاده برای حرکت Transform خودرو.



این مقدار هر Frame به‌صورت نرم به targetSpeed نزدیک می‌شود.
*/
  motionSpeed: number;

  /**

سرعت هدف Traffic.



Traffic فقط این مقدار را تغییر می‌دهد؛ خود حرکت با

acceleration/deceleration نرم انجام می‌شود.
*/
  targetSpeed: number;

  /**

زمان انتظار خودرو قبل از تقاطع.
*/
  intersectionWaitTime: number;

  /**

آیا خودرو در صف تقاطع قرار دارد؟
*/
  waitingAtIntersection: boolean;

  /**

پنجره کوتاه عبور اجباری برای جلوگیری از Deadlock در تقاطع.
*/
  intersectionReleaseTime: number;

  /** آخرین موقعیت ثبت‌شده برای تشخیص گیرکردن خودرو. */
  lastProgressPosition: THREE.Vector3;

  /** Snapshot حرکت در ابتدای فریم برای Collision Guard پایدار. */
  frameStartPosition: THREE.Vector3;
  frameStartMotionSpeed: number;
  frameStartDirection: VehicleDirection;
  frameStartTrafficTransition: TrafficTransition | null;

  /** مدت‌زمانی که خودرو بدون پیشرفت مانده است. */
  stalledTime: number;
}

/**

==========================================

Vehicle Profile

==========================================
*/
interface VehicleProfile {
  type: VehicleModelType;
  weight: number;
}

export default class CarManager {
  /**

==========================================

Pool / Spawn

==========================================
*/

  private static readonly POOL_SIZE = 160;

  /**

تعداد خودروهای اولیه داخل شهر.
*/
  private static readonly INITIAL_CARS = 60;

  /**

حداقل فاصله برای Spawn.
*/
  private static readonly MIN_SPAWN_DISTANCE = 8;

  /**

حداقل فاصله خودرو از دوربین هنگام Spawn/Reposition.
*/
  private static readonly SPAWN_MIN_CAMERA_DISTANCE = 24;

  /**

حداکثر فاصله ترجیحی برای Spawn/Reposition.
*/
  private static readonly SPAWN_MAX_CAMERA_DISTANCE = 72;

  /**

تعداد نمونه‌های بررسی‌شده برای پیدا کردن نقطه امن روی هر Road.
*/
  private static readonly SPAWN_POSITION_SAMPLES: number = 7;

  /**

==========================================

Camera Frustum Vehicle Fade

==========================================

خودرو تا وقتی واقعاً داخل محدوده دید Camera است کاملاً واضح می‌ماند.
Fade فقط بعد از خروج خودرو از محدوده دید شروع می‌شود.
این Fade هیچ اثری روی Recycle یا Traffic ندارد.
*/
  private static readonly VEHICLE_FADE_MIN_OPACITY = 0.18;

  /**
   * میزان فاصله خارج‌شدن از لبه تصویر که طی آن Fade کامل می‌شود.
   * این مقدار بر اساس NDC است و به فاصله خودرو از Camera وابسته نیست.
   */
  private static readonly VEHICLE_FADE_NDC_RANGE = 0.18;

  /**

==========================================

Continuous Traffic

==========================================
*/

  private static readonly TARGET_ACTIVE_CARS = 60;

  private static readonly REFILL_INTERVAL = 0.25;

  /**

==========================================

Vehicle Following

==========================================
*/

  private static readonly FRONT_DETECTION_DISTANCE = 10;

  private static readonly SAFE_FOLLOW_DISTANCE = 5.5;

  /** زمان لازم برای تشخیص گیرکردن خودروی خارج از دید. */
  private static readonly STALLED_VEHICLE_RECOVERY_SECONDS = 8;

  /** فاصله زمانی بین تلاش‌های بازیابی ناموفق. */
  private static readonly STALLED_VEHICLE_RETRY_SECONDS = 3;

  /** سرعت محدود برای آزادکردن یک خودرو از بن‌بست طولانی. */
  private static readonly DEADLOCK_RELEASE_SPEED = 1.35;

  /** مدت مجاز حرکت اضطراری برای بازکردن گره ترافیک. */
  private static readonly DEADLOCK_RELEASE_DURATION = 2.25;

  /** حداقل جابه‌جایی لازم برای تشخیص پیشرفت. */
  private static readonly VEHICLE_PROGRESS_EPSILON = 0.01;

  /**

==========================================

Physical Vehicle Collision

==========================================
*/

  private static readonly VEHICLE_COLLISION_DISTANCE = 4.0;

  private static readonly VEHICLE_PREDICTION_TIME = 0.12;

  /**

==========================================

Lane Safety

==========================================
*/

  private static readonly TRAFFIC_LANE_SAFETY_OFFSET = 0.5;

  private static readonly VEHICLE_Y = 0.16;

  /**

==========================================

Speed

==========================================
*/

  private static readonly MIN_SPEED = 1.8;
  private static readonly MAX_SPEED = 3.4;

  /**

==========================================

Smooth Vehicle Motion

==========================================
*/

  private static readonly ACCELERATION = 1.65;
  private static readonly DECELERATION = 2.1;
  private static readonly TRAFFIC_LIGHT_APPROACH_DECELERATION = 1.65;

  /**

==========================================

Road / Transition

==========================================
*/

  private static readonly ROAD_CONNECTION_DISTANCE = 5;

  private static readonly TRANSITION_TRIGGER_DISTANCE = 1.0;

  private static readonly TRANSITION_EXIT_DISTANCE = 3.5;

  private static readonly TURN_RADIUS = 3.25;

  /** دقت نمونه‌برداری قوس برای ثابت‌ماندن سرعت در پیچ‌ها. */
  private static readonly TRANSITION_ARC_LENGTH_SAMPLES = 32;

  /**
   * فاصله امن نزدیک انتهای Road برای Retry کردن Transition.
   * شکست موقت در پیدا کردن Road بعدی نباید باعث حذف خودرو شود.
   */
  private static readonly ROAD_END_SAFETY_DISTANCE = 0.08;

  /**

==========================================

Intersection Rules

==========================================



این بخش عمداً نسبت به نسخه قبلی محدودتر شده است.



مشکل نسخه قبلی این بود که:





INTERSECTION_OCCUPANCY_DISTANCE = 6



و Priority Blocker تقریباً هر خودروی دیگری را که نزدیک

همان نقطه بود، مانع محسوب می‌کرد.



نتیجه:





خودرو A → توقف



خودرو B → به خاطر A توقف



خودرو C → به خاطر B توقف



و در نهایت بخش بزرگی از Traffic متوقف می‌شد.



اکنون فقط ناحیه واقعاً مرکزی تقاطع به‌عنوان Occupied در نظر

گرفته می‌شود و Priority فقط بین مسیرهای متعارض اعمال می‌شود.
*/

  /**

چند متر آخر قبل از شروع واقعی محدوده تقاطع.

این فاصله نسبت به خط توقف سنجیده می‌شود، نه انتهای Road.
*/
  private static readonly INTERSECTION_APPROACH_DISTANCE = 10;

  /**

==========================================

Intersection Stop Line

==========================================



محل توقف خودرو را نسبت به انتهای واقعی Road تعیین می‌کند.



در Road فعلی، آخرین خط وسطِ مسیر ورودی تقریباً 2.5 متر

قبل از انتهای Road قرار دارد. بنابراین خودرو باید در همان

محدوده متوقف شود؛ نه چند متر عقب‌تر روی لبه هندسی Intersection.



این مقدار مستقل از INTERSECTION_SIZE است تا CarManager به عضو

private کلاس Road وابسته نباشد.
*/
  private static readonly INTERSECTION_STOP_DISTANCE_FROM_CENTER = 5.25;

  /**

فاصله خودرو از لبه واقعی تقاطع.



مثبت بودن این مقدار یعنی خودرو چند سانتی‌متر قبل از

شروع محدوده تقاطع می‌ایستد.
*/
  private static readonly INTERSECTION_CONFLICT_ZONE_HALF_LENGTH = 6.5;

  /**

حداکثر فاصله‌ای که برای رسیدن دقیق خودرو به خط توقف

اجازه Snap نهایی می‌دهیم. این مقدار فقط چند سانتی‌متر است.
*/
  private static readonly INTERSECTION_STOP_SNAP_DISTANCE = 0.12;

  /**

بعد از حداکثر انتظار، خودرو برای مدت کوتاهی اجازه عبور دارد

تا Conflict/Occupancy نتواند آن را دوباره در همان نقطه قفل کند.
*/
  private static readonly INTERSECTION_RELEASE_DURATION = 1.8;

  /**

حداکثر زمانی که خودرو به دلیل Conflict/Occupancy

در تقاطع منتظر می‌ماند.



بعد از این زمان، خودرو دوباره حرکت می‌کند.
*/
  private static readonly INTERSECTION_MAX_WAIT_TIME = 1.8;

  /**

شعاع واقعی‌تر برای خودروهایی که واقعاً داخل مرکز تقاطع هستند.
*/
  private static readonly INTERSECTION_OCCUPANCY_DISTANCE = 1.0;

  /**

شعاع کمی بزرگ‌تر برای Transitionهایی که هنوز در حال عبور هستند.
*/
  private static readonly INTERSECTION_TRANSITION_DISTANCE = 1.0;

  /**

فاصله تقریبی برای تشخیص اینکه دو Approach متعلق به یک تقاطع هستند.



این مقدار فقط برای مقایسه Approachها است و باعث توقف خودروها نمی‌شود.
*/
  private static readonly INTERSECTION_MATCH_DISTANCE = 4.5;

  /**

حداقل اختلاف فاصله برای اینکه خودروی نزدیک‌تر Priority قطعی داشته باشد.
*/
  private static readonly INTERSECTION_PRIORITY_MARGIN = 0.25;

  /**

==========================================

Vehicle Profiles

==========================================
*/

  private readonly vehicleProfiles: VehicleProfile[] = [
    { type: "taxi", weight: 10 },
    { type: "sedan", weight: 18 },
    { type: "sedan-sports", weight: 8 },
    { type: "hatchback-sports", weight: 8 },
    { type: "suv", weight: 10 },
    { type: "suv-luxury", weight: 5 },
    { type: "van", weight: 7 },
    { type: "delivery", weight: 7 },
    { type: "truck", weight: 4 },
    { type: "truck-flat", weight: 3 },
    { type: "police", weight: 2 },
    { type: "ambulance", weight: 1 },
    { type: "firetruck", weight: 1 },
    { type: "garbage-truck", weight: 2 },
    { type: "tractor", weight: 1 },
  ];

  /**

==========================================

Runtime

==========================================
*/

  private readonly vehicleFactory: VehicleFactory;

  private readonly availableVehicles: Vehicle[] = [];

  private readonly activeVehicles: ActiveVehicleData[] = [];

  private readonly pendingRecycleVehicles = new Set<ActiveVehicleData>();

  private readonly roads: Road[] = [];

  private scene: THREE.Scene | null = null;

  /** Camera واقعی برای تشخیص Frustum. */
  private camera: THREE.Camera | null = null;

  private initialCarsSpawned = false;

  private initialized = false;

  private initializing = false;

  private refillTimer = 0;

  private readonly lastCameraPosition = new THREE.Vector3();

  private hasCameraPosition = false;

  /**
   * Materialهای هر خودرو Clone می‌شوند تا Fade یک خودرو
   * روی خودروهای دیگر اثر نگذارد.
   */
  private readonly vehicleFadeMaterials = new WeakMap<
    Vehicle,
    THREE.Material[]
  >();

  /**

==========================================

Reusable Vectors

==========================================
*/

  private readonly tempLocalPosition = new THREE.Vector3();

  private readonly tempWorldPosition = new THREE.Vector3();

  /** موقعیت پیش‌بینی‌شده Transition؛ جدا از tempWorldPosition که helperها تغییرش می‌دهند. */
  private readonly tempTransitionCandidatePosition = new THREE.Vector3();

  private readonly tempDirection = new THREE.Vector3();

  private readonly tempIncoming = new THREE.Vector3();

  private readonly tempOutgoing = new THREE.Vector3();

  private readonly tempControl = new THREE.Vector3();

  private readonly tempOtherPosition = new THREE.Vector3();

  private readonly tempToOther = new THREE.Vector3();

  private readonly tempOtherDirection = new THREE.Vector3();

  private readonly tempRelativeVelocity = new THREE.Vector3();

  private readonly tempPredictedPosition = new THREE.Vector3();

  private readonly tempOtherPredictedPosition = new THREE.Vector3();

  private readonly tempProjectedPosition = new THREE.Vector3();

  constructor() {
    this.vehicleFactory = new VehicleFactory();
  }

  /**

==========================================

Initialize

==========================================
*/

  public async initialize(scene: THREE.Scene): Promise<void> {
    if (this.initialized || this.initializing) {
      return;
    }

    this.initializing = true;

    this.scene = scene;

    await this.buildVehiclePool();

    this.initialized = true;

    this.initializing = false;

    if (this.roads.length > 0) {
      this.spawnInitialCars();
    }
  }

  /**

==========================================

Build Vehicle Pool

==========================================
*/

  private async buildVehiclePool(): Promise<void> {
    if (!this.scene) {
      return;
    }

    while (this.availableVehicles.length < CarManager.POOL_SIZE) {
      const vehicleType = this.getRandomVehicleType();

      const vehicle = await this.vehicleFactory.createVehicle(vehicleType);

      vehicle.reset();

      this.scene.add(vehicle.group);

      vehicle.group.visible = false;

      this.availableVehicles.push(vehicle);
    }

    if (this.roads.length > 0 && !this.initialCarsSpawned) {
      this.spawnInitialCars();
    }
  }

  /**

==========================================

Set Road Network

==========================================
*/

  public setRoadNetwork(roads: Road[]): void {
    const validRoads = roads.filter(
      (road): road is Road => road instanceof Road,
    );

    let changed = validRoads.length !== this.roads.length;

    if (!changed) {
      for (let index = 0; index < validRoads.length; index++) {
        if (validRoads[index] !== this.roads[index]) {
          changed = true;
          break;
        }
      }
    }

    if (!changed) {
      return;
    }

    this.roads.length = 0;

    this.roads.push(...validRoads);

    /**
     * اگر World شبکه Road را بازسازی کرده باشد، هیچ Active Vehicle نباید
     * روی Road حذف‌شده باقی بماند. در صورت نیاز آن را روی یک نقطه امن از
     * شبکه جدید Reposition می‌کنیم؛ Count و Lifecycle حفظ می‌شود.
     */
    if (this.roads.length > 0 && this.activeVehicles.length > 0) {
      this.reconcileActiveVehiclesWithRoadNetwork();
    }

    if (this.initialized && !this.initialCarsSpawned && this.roads.length > 0) {
      this.spawnInitialCars();
    }

    if (this.roads.length === 0) {
      for (const active of this.activeVehicles) {
        active.vehicle.stop();
      }
    }
  }

  /**

==========================================

Reconcile Active Vehicles With Road Network

==========================================
*/

  private reconcileActiveVehiclesWithRoadNetwork(): void {
    for (const active of this.activeVehicles) {
      if (this.roads.includes(active.road)) {
        if (
          active.trafficTransition &&
          !this.roads.includes(active.trafficTransition.toRoad)
        ) {
          active.trafficTransition = null;
          active.targetSpeed = active.cruiseSpeed;
          active.intersectionWaitTime = 0;
          active.waitingAtIntersection = false;
          active.intersectionReleaseTime = 0;
        }

        continue;
      }

      const candidate = this.findRecycleCandidateWithoutCamera(active);

      if (!candidate) {
        /**
         * اگر شبکه در همان لحظه هیچ نقطه امنی نداشت، خودرو را حذف نمی‌کنیم.
         * Frameهای بعدی دوباره این وضعیت را بررسی خواهند کرد.
         */
        active.targetSpeed = 0;
        active.motionSpeed = 0;
        active.trafficTransition = null;
        continue;
      }

      this.applyRecycleCandidate(active, candidate);
    }
  }

  /**

==========================================

Update

==========================================
*/

  public update(
    cameraPosition: THREE.Vector3,
    deltaTime: number,
    camera?: THREE.Camera,
  ): void {
    const safeDeltaTime = THREE.MathUtils.clamp(
      Number.isFinite(deltaTime) ? deltaTime : 0,
      0,
      0.1,
    );

    this.lastCameraPosition.copy(cameraPosition);

    this.hasCameraPosition = true;

    if (camera) {
      this.camera = camera;
      this.camera.updateMatrixWorld();
    }

    if (!this.initialized) {
      return;
    }

    if (!this.initialCarsSpawned && this.roads.length > 0) {
      this.spawnInitialCars();
    }

    if (this.roads.length === 0) {
      return;
    }

    for (const active of this.activeVehicles) {
      active.intersectionReleaseTime = Math.max(
        0,
        active.intersectionReleaseTime - safeDeltaTime,
      );
    }

    /**
     * ========================================
     * Continuous Traffic
     * ========================================
     */

    this.refillTimer += Math.max(0, safeDeltaTime);

    this.processPendingRecycles();

    if (this.refillTimer >= CarManager.REFILL_INTERVAL) {
      this.refillTimer = 0;

      this.refillTraffic();
    }

    /**
     * ابتدا وضعیت Traffic تمام خودروها مشخص می‌شود.
     */
    this.updateTrafficState(safeDeltaTime);

    /**
     * سرعت همهٔ خودروهای عادی پیش از محاسبهٔ موقعیت‌ها به‌روز می‌شود.
     * سپس Snapshot مشترک ابتدای فریم ثبت می‌شود تا Collision Guard
     * برای خودروهای مختلف از موقعیت‌های یکسان و قابل‌مقایسه استفاده کند.
     */
    for (const active of this.activeVehicles) {
      // Transition هم باید سرعت واقعی را با شتاب مجاز تغییر دهد؛
      // مسیر پیچ دیگر با زمان ثابت خودرو را ناگهان تند یا کند نمی‌کند.
      this.updateSmoothMotionSpeed(active, safeDeltaTime);

      active.frameStartPosition.copy(active.vehicle.group.position);
      active.frameStartMotionSpeed = active.motionSpeed;
      active.frameStartDirection = active.vehicle.getDirection();
      active.frameStartTrafficTransition = active.trafficTransition;
    }

    /**
     * سپس موقعیت واقعی خودروها محاسبه می‌شود.
     */
    for (let index = this.activeVehicles.length - 1; index >= 0; index--) {
      const active = this.activeVehicles[index];

      if (!active) {
        continue;
      }

      /**
       * ======================================
       * Transition
       * ======================================
       */

      if (active.trafficTransition) {
        this.updateTransition(active, safeDeltaTime);

        continue;
      }

      /**
       * ======================================
       * Normal Road Motion
       * ======================================
       */

      this.setDirectionVector(
        active.vehicle.getDirection(),
        this.tempDirection,
      );

      const speed = active.motionSpeed;

      if (speed > 0.001) {
        const movementDistance = speed * Math.max(0, safeDeltaTime);

        this.tempPredictedPosition
          .copy(active.vehicle.group.position)
          .addScaledVector(this.tempDirection, movementDistance);

        /**
         * ======================================
         * Physical Vehicle Collision Guard
         * ======================================
         *
         * قبل از ثبت موقعیت جدید، بررسی می‌کنیم که خودرو وارد محدوده
         * برخورد خودروی دیگری نشود. حق‌تقدم تقاطع همچنان رعایت می‌شود.
         * اگر مسیر حرکت باعث برخورد قطعی شود، ترمز اضطراری اعمال می‌شود؛
         * به محض آزادشدن مسیر، خودرو در فریم‌های بعدی دوباره حرکت می‌کند.
         */
        let safeMovementFraction = 1;
        const currentPosition = active.frameStartPosition;
        const collisionMargin = 0.08;
        const minimumSafeDistance =
          CarManager.VEHICLE_COLLISION_DISTANCE + collisionMargin;

        for (const other of this.activeVehicles) {
          if (other === active) {
            continue;
          }

          // اگر Transition دقیقاً در همین فریم تمام شده باشد، stateهای قدیم و جدید
          // با هم مخلوط نمی‌کنیم؛ Collision Guard اصلی فریم بعدی آن را بررسی می‌کند.
          if (other.frameStartTrafficTransition !== other.trafficTransition) {
            continue;
          }

          if (this.shouldIgnoreRedApproachForGreenTraffic(active, other)) {
            continue;
          }

          // خودروهای عادی در دو لاین جدا از یک Road، حتی با جهت مخالف،
          // نباید وارد Collision Guard فیزیکی یکدیگر شوند.
          // در غیر این صورت فاصلهٔ جانبی لاین‌ها به‌اشتباه برخورد محسوب می‌شود.
          if (
            active.road === other.road &&
            active.laneIndex !== other.laneIndex &&
            !active.frameStartTrafficTransition &&
            !other.frameStartTrafficTransition
          ) {
            continue;
          }

          if (!this.shouldCheckRoadCollisionPair(active, other)) {
            continue;
          }

          const otherPosition = other.frameStartPosition;
          this.tempOtherPredictedPosition.copy(otherPosition);

          if (
            !other.frameStartTrafficTransition &&
            other.frameStartMotionSpeed > 0.001
          ) {
            this.setDirectionVector(
              other.frameStartDirection,
              this.tempOtherDirection,
            );
            this.tempOtherPredictedPosition.addScaledVector(
              this.tempOtherDirection,
              other.frameStartMotionSpeed *
                Math.min(safeDeltaTime, CarManager.VEHICLE_PREDICTION_TIME),
            );
          }

          const currentDistance = currentPosition.distanceTo(otherPosition);
          this.tempPredictedPosition
            .copy(currentPosition)
            .addScaledVector(this.tempDirection, movementDistance);
          const proposedDistance = this.tempPredictedPosition.distanceTo(
            this.tempOtherPredictedPosition,
          );

          // اگر خودرو در حال دورشدن از خودروی دیگر است، حتی اگر فاصله فعلی
          // کمی کمتر از حاشیه ایمنی باشد، نباید حرکت امن آن را محدود کنیم.
          if (
            proposedDistance >= minimumSafeDistance ||
            proposedDistance + 0.015 >= currentDistance
          ) {
            continue;
          }

          // به‌جای قفل‌کردن کامل موقعیت خودرو، حداکثر مسافت امن همین فریم را پیدا می‌کنیم.
          let low = 0;
          let high = safeMovementFraction;

          for (let iteration = 0; iteration < 8; iteration++) {
            const middle = (low + high) * 0.5;
            this.tempPredictedPosition
              .copy(currentPosition)
              .addScaledVector(this.tempDirection, movementDistance * middle);

            const distanceAtMiddle = this.tempPredictedPosition.distanceTo(
              this.tempOtherPredictedPosition,
            );

            if (distanceAtMiddle >= minimumSafeDistance) {
              low = middle;
            } else {
              high = middle;
            }
          }

          safeMovementFraction = Math.min(safeMovementFraction, low);
        }

        // جابه‌جایی مجاز را یک بار محاسبه می‌کنیم تا سرعت داخلی با حرکت واقعی
        // هماهنگ بماند. در نسخه قبلی موقعیت محدود می‌شد ولی motionSpeed بالا می‌ماند؛
        // خودرو سپس چند فریم می‌ایستاد و با همان سرعت قبلی دوباره حرکت می‌کرد.
        const actualMovementDistance = movementDistance * safeMovementFraction;

        this.tempPredictedPosition
          .copy(currentPosition)
          .addScaledVector(this.tempDirection, actualMovementDistance);

        active.vehicle.group.position.copy(this.tempPredictedPosition);
        active.vehicle.group.position.y = CarManager.VEHICLE_Y;

        // فقط وقتی محافظ برخورد واقعاً حرکت را محدود کرده است، سرعت با سرعت جابه‌جایی
        // همین فریم هماهنگ می‌شود. ترمز پیش‌بینانه باید باعث شود این مسیر اضطراری نادر باشد.
        if (safeMovementFraction < 0.999 && safeDeltaTime > 0.0001) {
          const realizedSpeed = Math.max(
            0,
            actualMovementDistance / safeDeltaTime,
          );

          active.motionSpeed = Math.min(active.motionSpeed, realizedSpeed);
          active.targetSpeed = Math.min(active.targetSpeed, active.motionSpeed);
        }
      }

      /**
       * اگر خودرو در حال انتظار برای عبور از تقاطع است،
       * موقعیت آن را دقیقاً روی خط توقف نگه می‌داریم.
       *
       * این فقط زمانی فعال می‌شود که خودرو واقعاً در حالت
       * waitingAtIntersection باشد و به خط توقف رسیده باشد.
       */
      if (active.waitingAtIntersection) {
        this.clampVehicleToIntersectionStopLine(active);
      }

      /**
       * Animation داخلی Vehicle نیز با سرعت واقعی هماهنگ می‌شود.
       */
      active.vehicle.setTargetSpeed(active.motionSpeed);
    }

    /**
     * Road progress / recycling تغییر state ایجاد می‌کند، بنابراین پس از اینکه
     * تمام خودروها موقعیت خود را حساب کردند اجرا می‌شود؛ در غیر این صورت guard
     * خودروهای بعدی داده‌های مربوط به فریم دیگری را می‌دید.
     */
    for (let index = this.activeVehicles.length - 1; index >= 0; index--) {
      const active = this.activeVehicles[index];
      if (!active) continue;

      // خودروهایی که در ابتدای همین فریم Transition داشتند، مثل قبل
      // فقط Transition خود را به‌روزرسانی می‌کنند و Road progress را تکرار نمی‌کنند.
      if (!active.frameStartTrafficTransition) {
        this.updateRoadProgress(active);
      }

      this.updateVehicleProgressWatchdog(active, safeDeltaTime);
      this.updateVehicleDistanceFade(active.vehicle);
    }
  }

  /**

==========================================

Vehicle Camera Frustum Fade

==========================================

Fade فقط وقتی شروع می‌شود که خودرو واقعاً از محدوده دید Camera
خارج شده باشد؛ فاصله از Camera به‌تنهایی هیچ نقشی ندارد.
خودرو هرگز به‌خاطر این Fade حذف یا Recycle نمی‌شود.
*/
  private updateVehicleDistanceFade(vehicle: Vehicle): void {
    /**
     * Fade نباید بر اساس فاصله از Camera باشد.
     * تا وقتی خودرو داخل محدوده واقعی تصویر است، opacity دقیقاً 1 است.
     */
    if (!this.camera) {
      return;
    }

    this.camera.updateMatrixWorld();

    this.tempProjectedPosition
      .copy(vehicle.group.position)
      .project(this.camera);

    const ndc = this.tempProjectedPosition;

    /**
     * فاصله خودرو از مرز محدوده دید در فضای NDC.
     * مقدار صفر یعنی داخل تصویر یا دقیقاً روی لبه تصویر هستیم.
     */
    const outsideX = Math.max(0, Math.abs(ndc.x) - 1);

    const outsideY = Math.max(0, Math.abs(ndc.y) - 1);

    const outsideZ = ndc.z < -1 ? -1 - ndc.z : ndc.z > 1 ? ndc.z - 1 : 0;

    const outsideAmount = Math.max(outsideX, outsideY, outsideZ);

    let opacity = 1;

    if (outsideAmount > 0) {
      const t = THREE.MathUtils.clamp(
        outsideAmount / Math.max(CarManager.VEHICLE_FADE_NDC_RANGE, 0.001),
        0,
        1,
      );

      opacity = THREE.MathUtils.lerp(1, CarManager.VEHICLE_FADE_MIN_OPACITY, t);
    }

    let materials = this.vehicleFadeMaterials.get(vehicle);

    if (!materials) {
      materials = [];

      vehicle.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) {
          return;
        }

        const source = object.material;

        if (Array.isArray(source)) {
          const cloned = source.map((material) => material.clone());

          object.material = cloned;
          materials!.push(...cloned);
        } else {
          const cloned = source.clone();

          object.material = cloned;
          materials!.push(cloned);
        }
      });

      this.vehicleFadeMaterials.set(vehicle, materials);
    }

    for (const material of materials) {
      material.transparent = true;
      material.opacity = opacity;
      material.needsUpdate = true;
    }
  }

  /**

==========================================

Smooth Motion Speed

==========================================
*/

  private updateSmoothMotionSpeed(
    active: ActiveVehicleData,
    deltaTime: number,
  ): void {
    const dt = THREE.MathUtils.clamp(
      Number.isFinite(deltaTime) ? deltaTime : 0,
      0,
      0.1,
    );

    if (dt <= 0) {
      return;
    }

    const current = Math.max(0, active.motionSpeed);
    const target = THREE.MathUtils.clamp(
      active.targetSpeed,
      0,
      CarManager.MAX_SPEED,
    );
    const difference = target - current;

    if (Math.abs(difference) < 0.01) {
      active.motionSpeed = target;
      return;
    }

    // حرکت با شتاب محدود انجام می‌شود؛ تغییر targetSpeed در یک فریم،
    // سرعت واقعی خودرو را مستقیم تغییر نمی‌دهد.
    const rate =
      difference > 0 ? CarManager.ACCELERATION : CarManager.DECELERATION;

    const maxSpeedChange = rate * dt;
    const speedChange = THREE.MathUtils.clamp(
      difference,
      -maxSpeedChange,
      maxSpeedChange,
    );

    active.motionSpeed = Math.max(0, current + speedChange);
  }

  /**

==========================================

Continuous Traffic Refill

==========================================
*/

  private refillTraffic(): void {
    if (this.roads.length === 0 || this.availableVehicles.length === 0) {
      return;
    }

    const targetCount = Math.min(
      CarManager.TARGET_ACTIVE_CARS,
      CarManager.POOL_SIZE,
    );

    const missing = targetCount - this.activeVehicles.length;

    if (missing <= 0) {
      return;
    }

    let attempts = 0;

    const maxAttempts = Math.max(20, missing * 8);

    while (
      this.activeVehicles.length < targetCount &&
      this.availableVehicles.length > 0 &&
      attempts < maxAttempts
    ) {
      attempts++;

      // Spawn مستقل از Camera انجام می‌شود؛ Camera فقط برای Recycle استفاده می‌شود.
      this.spawnCar();
    }

    if (this.activeVehicles.length > 0) {
      this.initialCarsSpawned = true;
    }
  }

  /**

==========================================

Initial Cars

==========================================
*/

  private spawnInitialCars(): void {
    if (
      this.initialCarsSpawned ||
      this.roads.length === 0 ||
      this.availableVehicles.length === 0
    ) {
      return;
    }

    const targetCount = Math.min(
      CarManager.INITIAL_CARS,
      this.availableVehicles.length,
    );

    let spawned = 0;
    let attempts = 0;

    const maxAttempts = Math.max(targetCount * 80, 160);

    while (
      spawned < targetCount &&
      attempts < maxAttempts &&
      this.availableVehicles.length > 0
    ) {
      attempts++;

      if (this.spawnInitialCar()) {
        spawned++;
      }
    }

    if (spawned > 0) {
      this.initialCarsSpawned = true;
    }
  }

  /**

==========================================

Initial Spawn Car

==========================================
*/

  private spawnInitialCar(): boolean {
    if (this.availableVehicles.length === 0 || this.roads.length === 0) {
      return false;
    }

    const roadIndex = Math.floor(Math.random() * this.roads.length);

    const road = this.roads[roadIndex];

    if (!road) {
      return false;
    }

    const laneIndex = Math.floor(Math.random() * Road.LANE_COUNT);

    const direction = this.getDirectionForRoad(road, laneIndex);

    const roadDistance = this.getRandomSpawnDistance(road);

    if (!this.canSpawnCar(road, laneIndex, direction, roadDistance)) {
      return false;
    }

    return this.activateVehicleAt(road, laneIndex, direction, roadDistance);
  }

  /**

==========================================

Spawn Car

==========================================
*/

  private spawnCar(): boolean {
    if (this.availableVehicles.length === 0 || this.roads.length === 0) {
      return false;
    }

    const maxAttempts = Math.min(24, Math.max(8, this.roads.length * 2));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const roadIndex = Math.floor(Math.random() * this.roads.length);

      const road = this.roads[roadIndex];

      if (!road) {
        continue;
      }

      const laneIndex = Math.floor(Math.random() * Road.LANE_COUNT);

      const direction = this.getDirectionForRoad(road, laneIndex);

      const roadDistance = this.getRandomSpawnDistance(road);

      if (!this.canSpawnCar(road, laneIndex, direction, roadDistance)) {
        continue;
      }

      if (this.activateVehicleAt(road, laneIndex, direction, roadDistance)) {
        return true;
      }
    }

    return false;
  }

  /**

==========================================

Activate Vehicle At

==========================================
*/

  private activateVehicleAt(
    road: Road,
    laneIndex: number,
    direction: VehicleDirection,
    roadDistance: number,
  ): boolean {
    const vehicle = this.availableVehicles.pop();

    if (!vehicle) {
      return false;
    }

    const position = this.getVehicleWorldPosition(
      road,
      laneIndex,
      roadDistance,
    );

    const cruiseSpeed = this.getRandomSpeed();

    vehicle.activate(position, direction, cruiseSpeed);

    vehicle.group.visible = true;

    this.updateVehicleDistanceFade(vehicle);

    this.activeVehicles.push({
      vehicle,
      road,
      laneIndex,
      roadDistance,
      trafficTransition: null,
      cruiseSpeed,
      motionSpeed: cruiseSpeed,
      targetSpeed: cruiseSpeed,
      intersectionWaitTime: 0,
      waitingAtIntersection: false,
      intersectionReleaseTime: 0,
      lastProgressPosition: position.clone(),
      frameStartPosition: position.clone(),
      frameStartMotionSpeed: cruiseSpeed,
      frameStartDirection: direction,
      frameStartTrafficTransition: null,
      stalledTime: 0,
    });

    return true;
  }

  /**

==========================================

Random Spawn Distance

==========================================
*/

  private getRandomSpawnDistance(road: Road): number {
    const min = road.getLongitudinalMin() + CarManager.TRANSITION_EXIT_DISTANCE;
    const max = road.getLongitudinalMax() - CarManager.TRANSITION_EXIT_DISTANCE;
    const safeCenterGap =
      CarManager.INTERSECTION_STOP_DISTANCE_FROM_CENTER + 1.25;

    const negativeEnd = Math.min(max, -safeCenterGap);
    const positiveStart = Math.max(min, safeCenterGap);
    const negativeLength = Math.max(0, negativeEnd - min);
    const positiveLength = Math.max(0, max - positiveStart);
    const totalLength = negativeLength + positiveLength;

    if (totalLength <= 0) {
      return (min + max) / 2;
    }

    const value = Math.random() * totalLength;
    if (value < negativeLength) {
      return min + value;
    }

    return positiveStart + (value - negativeLength);
  }

  /**
   * Safe spawn/recycle points are sampled only on the two outer road sections.
   * No pooled car is placed directly inside the central intersection.
   */
  private getSafeRoadDistances(road: Road): number[] {
    const min = road.getLongitudinalMin() + CarManager.TRANSITION_EXIT_DISTANCE;
    const max = road.getLongitudinalMax() - CarManager.TRANSITION_EXIT_DISTANCE;
    const centerGap = CarManager.INTERSECTION_STOP_DISTANCE_FROM_CENTER + 1.25;
    const samplesPerSide = Math.max(
      3,
      Math.ceil(CarManager.SPAWN_POSITION_SAMPLES / 2),
    );
    const distances: number[] = [];

    const addSegment = (start: number, end: number): void => {
      if (end < start) {
        return;
      }

      for (let i = 0; i < samplesPerSide; i++) {
        const t = i / (samplesPerSide - 1);
        distances.push(THREE.MathUtils.lerp(start, end, t));
      }
    };

    addSegment(min, Math.min(max, -centerGap));
    addSegment(Math.max(min, centerGap), max);

    return distances;
  }

  /**

==========================================

Vehicle World Position

==========================================
*/

  private getVehicleWorldPosition(
    road: Road,
    laneIndex: number,
    roadDistance: number,
  ): THREE.Vector3 {
    const lanePosition = road.getLanePosition(laneIndex, roadDistance);

    this.tempLocalPosition.copy(lanePosition);

    if (laneIndex === 0) {
      this.tempLocalPosition.x += CarManager.TRAFFIC_LANE_SAFETY_OFFSET;
    } else if (laneIndex === 1) {
      this.tempLocalPosition.x -= CarManager.TRAFFIC_LANE_SAFETY_OFFSET;
    }

    this.tempWorldPosition.copy(this.tempLocalPosition);

    road.group.localToWorld(this.tempWorldPosition);

    this.tempWorldPosition.y = CarManager.VEHICLE_Y;

    return this.tempWorldPosition;
  }

  /**

==========================================

Spawn Validation

==========================================
*/

  private canSpawnCar(
    road: Road,
    laneIndex: number,
    direction: VehicleDirection,
    roadDistance: number,
    ignoredVehicle?: ActiveVehicleData,
  ): boolean {
    for (const active of this.activeVehicles) {
      if (active === ignoredVehicle) {
        continue;
      }

      if (active.road === road && active.laneIndex === laneIndex) {
        const distance = this.getForwardDistance(
          road,
          roadDistance,
          active.roadDistance,
          direction,
        );

        if (distance >= 0 && distance < CarManager.MIN_SPAWN_DISTANCE) {
          return false;
        }

        if (
          Math.abs(roadDistance - active.roadDistance) <
          CarManager.MIN_SPAWN_DISTANCE
        ) {
          return false;
        }
      }

      const transition = active.trafficTransition;

      if (
        transition &&
        transition.toRoad === road &&
        transition.toLaneIndex === laneIndex
      ) {
        const distance = this.getForwardDistance(
          road,
          roadDistance,
          transition.finalDistance,
          direction,
        );

        if (distance >= 0 && distance < CarManager.MIN_SPAWN_DISTANCE) {
          return false;
        }
      }
    }

    return true;
  }

  /**

==========================================

Physical Collision Guard

==========================================



این Guard فعلاً مانند نسخه قبلی حفظ شده است.



نکته مهم:

updateTrafficState() از این متد برای توقف عادی Traffic استفاده

نمی‌کند. بنابراین منطق Smooth Motion و جریان اصلی Traffic تحت تأثیر

این Guard قرار نمی‌گیرد.
*/
  private shouldCheckRoadCollisionPair(
    active: ActiveVehicleData,
    other: ActiveVehicleData,
  ): boolean {
    const sameLane =
      active.road === other.road && active.laneIndex === other.laneIndex;

    if (sameLane) {
      // در مسیر مستقیم، فقط خودروی جلویی می‌تواند مانع این خودرو باشد.
      // خودروی عقب نباید باعث توقف خودروی جلویی شود.
      const forwardGap = this.getForwardDistance(
        active.road,
        active.roadDistance,
        other.roadDistance,
        active.vehicle.getDirection(),
      );

      if (Math.abs(forwardGap) < 0.05) {
        // اگر دو خودرو قبلاً دقیقاً روی هم افتاده‌اند، یک برنده ثابت انتخاب می‌شود.
        return (
          this.activeVehicles.indexOf(active) >
          this.activeVehicles.indexOf(other)
        );
      }

      return forwardGap > 0;
    }

    const mergingIntoLane =
      other.trafficTransition !== null &&
      other.trafficTransition.toRoad === active.road &&
      other.trafficTransition.toLaneIndex === active.laneIndex;

    // فقط خودروی هم‌لاین یا خودرویی که واقعاً وارد همین Lane می‌شود،
    // به‌صورت مستقیم مانع محسوب می‌شود. Transition به‌تنهایی به معنی برخورد نیست.
    if (sameLane || mergingIntoLane) {
      return true;
    }

    // خودروی در حال Transition فقط وقتی مانع است که مسیرش با مسیر فعال
    // در محدوده تقاطع تعارض واقعی داشته باشد؛ عبور از کنار هم کافی نیست.
    if (!this.isIntersectionConflictWith(active, other)) {
      return false;
    }

    // اگر چراغ فعالی وجود ندارد، حق تقدم بدون چرخه مشخص می‌کند چه کسی باید صبر کند.
    const phase = this.getTrafficLightPhase(active);
    if (!phase) {
      return this.hasIntersectionPriorityBlocker(active);
    }

    // با وجود فاز چراغ، تصادف واقعی بین دو مسیر متعارض همچنان بررسی می‌شود.
    return true;
  }

  private isVehicleMovementBlocked(
    active: ActiveVehicleData,
    deltaTime: number,
  ): boolean {
    const dt = THREE.MathUtils.clamp(
      Number.isFinite(deltaTime) ? deltaTime : 0,
      0,
      0.1,
    );

    if (dt <= 0) {
      return false;
    }

    // پیش‌بینی باید سرعت بعد از ترمز همین فریم را در نظر بگیرد، نه سرعت قبلی.
    const currentSpeed = Math.max(0, active.motionSpeed);
    const targetSpeed = THREE.MathUtils.clamp(
      active.targetSpeed,
      0,
      CarManager.MAX_SPEED,
    );
    const speedRate =
      targetSpeed < currentSpeed
        ? CarManager.DECELERATION
        : CarManager.ACCELERATION;
    const predictedSpeed = Math.max(
      0,
      currentSpeed +
        THREE.MathUtils.clamp(
          targetSpeed - currentSpeed,
          -speedRate * dt,
          speedRate * dt,
        ),
    );

    if (predictedSpeed <= 0.001) {
      return false;
    }

    this.setDirectionVector(active.vehicle.getDirection(), this.tempDirection);

    const predictionTime = Math.min(dt, CarManager.VEHICLE_PREDICTION_TIME);

    const currentPosition = active.vehicle.group.position;
    this.tempPredictedPosition
      .copy(currentPosition)
      .addScaledVector(this.tempDirection, predictedSpeed * predictionTime);

    for (const other of this.activeVehicles) {
      if (other === active) {
        continue;
      }

      if (this.shouldIgnoreRedApproachForGreenTraffic(active, other)) {
        continue;
      }

      if (!this.shouldCheckRoadCollisionPair(active, other)) {
        continue;
      }

      const otherPosition = other.vehicle.group.position;
      this.tempOtherPredictedPosition.copy(otherPosition);

      const otherCurrentSpeed = Math.max(0, other.motionSpeed);
      const otherTargetSpeed = THREE.MathUtils.clamp(
        other.targetSpeed,
        0,
        CarManager.MAX_SPEED,
      );
      const otherRate =
        otherTargetSpeed < otherCurrentSpeed
          ? CarManager.DECELERATION
          : CarManager.ACCELERATION;
      const otherPredictedSpeed = Math.max(
        0,
        otherCurrentSpeed +
          THREE.MathUtils.clamp(
            otherTargetSpeed - otherCurrentSpeed,
            -otherRate * predictionTime,
            otherRate * predictionTime,
          ),
      );

      if (!other.trafficTransition && otherPredictedSpeed > 0.001) {
        this.setDirectionVector(
          other.vehicle.getDirection(),
          this.tempOtherDirection,
        );
        this.tempOtherPredictedPosition.addScaledVector(
          this.tempOtherDirection,
          otherPredictedSpeed * predictionTime,
        );
      }

      const currentDistance = currentPosition.distanceTo(otherPosition);
      const predictedDistance = this.tempPredictedPosition.distanceTo(
        this.tempOtherPredictedPosition,
      );

      // فقط وقتی مسیر در حال نزدیک‌شدن به ناحیه برخورد است، Guard اضطراری فعال شود.
      if (
        predictedDistance < CarManager.VEHICLE_COLLISION_DISTANCE &&
        predictedDistance + 0.015 < currentDistance
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * سرعت امن برای جلوگیری از نزدیک‌شدن ناگهانی به خودروی دیگر.
   * ترمز از فاصله توقف شروع می‌شود؛ Collision Guard نهایی همچنان
   * مسئول جلوگیری قطعی از برخورد است.
   */
  private getCollisionBrakingSpeed(
    active: ActiveVehicleData,
    deltaTime: number,
  ): number {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
      return active.cruiseSpeed;
    }

    let safeTargetSpeed = active.cruiseSpeed;
    const currentPosition = active.vehicle.group.position;

    this.setDirectionVector(active.vehicle.getDirection(), this.tempDirection);

    for (const other of this.activeVehicles) {
      if (other === active) {
        continue;
      }

      if (this.shouldIgnoreRedApproachForGreenTraffic(active, other)) {
        continue;
      }

      // دو خودرو در لاین‌های جداگانهٔ یک خیابان، مانع فیزیکی یکدیگر نیستند؛
      // حتی اگر جهت حرکتشان مخالف باشد، نباید با نزدیک‌شدن از سرعتشان کم شود.
      if (
        active.road === other.road &&
        active.laneIndex !== other.laneIndex &&
        !active.trafficTransition &&
        !other.trafficTransition
      ) {
        continue;
      }

      if (!this.shouldCheckRoadCollisionPair(active, other)) {
        continue;
      }

      // برای صف مستقیم، منطق Follow فاصله ترمز را دقیق‌تر محاسبه می‌کند.
      // این بخش مخصوص ادغام مسیرها و مسیرهای متعارض در تقاطع است.
      if (active.road === other.road && active.laneIndex === other.laneIndex) {
        continue;
      }

      const otherPosition = other.vehicle.group.position;
      const currentDistance = currentPosition.distanceTo(otherPosition);

      if (currentDistance <= 0.001) {
        safeTargetSpeed = 0;
        continue;
      }

      this.setDirectionVector(
        other.vehicle.getDirection(),
        this.tempOtherDirection,
      );

      // سرعت نسبی در راستای خط دید، مشخص می‌کند فاصله در حال کم‌شدن است یا نه.
      this.tempToOther.copy(otherPosition).sub(currentPosition);

      this.tempRelativeVelocity
        .copy(this.tempOtherDirection)
        .multiplyScalar(Math.max(0, other.motionSpeed))
        .addScaledVector(this.tempDirection, -Math.max(0, active.motionSpeed));

      const distanceRate =
        this.tempToOther.dot(this.tempRelativeVelocity) / currentDistance;

      if (distanceRate >= -0.025) {
        continue;
      }

      const closingSpeed = -distanceRate;

      // خودروِ متحرک مقابل نیز در زمان واکنش فاصله را می‌پوشاند؛
      // این فاصله اضافه ترمز را قبل از فعال‌شدن Guard سخت آغاز می‌کند.
      // حاشیه واکنش کمی بزرگ‌تر است تا ترمز قبل از رسیدن خودرو به محافظ
      // سخت شروع شود و حرکت در فریم آخر مجبور به محدودشدن ناگهانی نشود.
      const reactionBuffer =
        0.9 + Math.min(closingSpeed, CarManager.MAX_SPEED * 2) * 0.5;

      const availableBrakingDistance = Math.max(
        0,
        currentDistance -
          CarManager.VEHICLE_COLLISION_DISTANCE -
          reactionBuffer,
      );

      const safeSpeed = Math.sqrt(
        2 * CarManager.DECELERATION * availableBrakingDistance,
      );

      safeTargetSpeed = Math.min(safeTargetSpeed, safeSpeed);
    }

    return safeTargetSpeed;
  }

  /**
   * ==========================================
   * Follow + Traffic Light
   * ==========================================
   *
   * چراغ تقاطع فقط روی خودروهایی اثر می‌گذارد که هنوز به Stop Line
   * نرسیده‌اند. Follow و Collision Guard نهایی حفظ می‌شوند.
   *
   * خودرویی که وارد Transition شده یا از Stop Line عبور کرده باشد،
   * به خاطر چراغ متوقف نمی‌شود.
   */
  private updateTrafficState(_deltaTime: number): void {
    /*
چراغ قرمز، محدوده توقف و فاصله امن خودروها حفظ می‌شود.
خودرو از فاصله مناسب پیش از خط توقف سرعتش را کم می‌کند و در چراغ
قرمز/زرد یا فاز ایمنی تقاطع پشت خط عابر منتظر می‌ماند.
*/
    for (const active of this.activeVehicles) {
      if (active.trafficTransition) {
        /*

Transition مستقل است و باید با سرعت طبیعی خودرو ادامه پیدا کند.
*/
        active.waitingAtIntersection = false;
        active.intersectionWaitTime = 0;
        active.targetSpeed = active.trafficTransition.blockedLastFrame
          ? 0
          : active.cruiseSpeed;
        continue;
      }

      /**

Pending recycle نباید باعث ایستادن خودرو شود.

خودرو تا زمانی که خارج از محدوده دید قرار بگیرد، حرکت طبیعی خود را

ادامه می‌دهد.
*/
      if (this.pendingRecycleVehicles.has(active)) {
        active.waitingAtIntersection = false;
        active.intersectionWaitTime = 0;
        active.targetSpeed = active.cruiseSpeed;
        continue;
      }

      const vehicle = active.vehicle;

      /**

حالت پایه: حرکت با سرعت Cruise.
*/
      active.targetSpeed = active.cruiseSpeed;
      active.waitingAtIntersection = false;

      /**
       * ======================================
       * Traffic Light
       * ======================================
       *
       * فقط خودروهای نزدیک Stop Line بررسی می‌شوند.
       * خودروهای داخل تقاطع یا Transition، اینجا متوقف نمی‌شوند.
       */
      const trafficLightBlocked = this.isTrafficLightBlocking(active);

      let trafficLightTargetSpeed = active.cruiseSpeed;

      if (trafficLightBlocked) {
        const approach = this.getIntersectionApproachInfo(active);

        // ترمزگیری از فاصله مناسب شروع می‌شود تا خودرو نزدیک خط توقف بایستد.
        const usableStoppingDistance = Math.max(
          0,
          (approach?.remaining ?? 0) - 0.45,
        );
        trafficLightTargetSpeed = approach
          ? Math.min(
              active.cruiseSpeed,
              Math.sqrt(
                2 *
                  CarManager.TRAFFIC_LIGHT_APPROACH_DECELERATION *
                  usableStoppingDistance,
              ),
            )
          : 0;

        active.targetSpeed = trafficLightTargetSpeed;
        active.waitingAtIntersection = true;
        active.intersectionWaitTime += Math.max(0, _deltaTime);
      }

      let nearestFrontDistance = Infinity;
      let nearestFrontSpeed = active.cruiseSpeed;

      /**



خودروی جلویی روی همان Road و همان Lane



*/
      for (const other of this.activeVehicles) {
        if (other === active || other.trafficTransition) {
          continue;
        }

        if (
          other.road !== active.road ||
          other.laneIndex !== active.laneIndex
        ) {
          continue;
        }

        const distance = this.getForwardDistance(
          active.road,
          active.roadDistance,
          other.roadDistance,
          vehicle.getDirection(),
        );

        if (distance >= 0 && distance < nearestFrontDistance) {
          nearestFrontDistance = distance;
          nearestFrontSpeed = Math.max(0, other.motionSpeed);
        }
      }

      /**



خودرویی که از Transition وارد همین Lane می‌شود



*/
      for (const other of this.activeVehicles) {
        if (other === active || !other.trafficTransition) {
          continue;
        }

        const transition = other.trafficTransition;

        if (
          transition.toRoad !== active.road ||
          transition.toLaneIndex !== active.laneIndex
        ) {
          continue;
        }

        const distance = this.getForwardDistance(
          active.road,
          active.roadDistance,
          transition.finalDistance,
          vehicle.getDirection(),
        );

        if (distance >= 0 && distance < nearestFrontDistance) {
          nearestFrontDistance = distance;
          nearestFrontSpeed = Math.max(0, other.motionSpeed);
        }
      }

      /**
       * Smooth Following
       * سرعت هدف از فاصلهٔ ترمز و سرعت خودروی جلویی محاسبه می‌شود تا
       * با عبور از یک آستانهٔ ثابت، فرمان سرعت ناگهان از Cruise به صفر نپرد.
       */
      if (nearestFrontDistance <= CarManager.FRONT_DETECTION_DISTANCE) {
        // محدودیت سرعت بر اساس فاصلهٔ لازم برای ترمز، نه یک آستانهٔ ناگهانی.
        // اگر خودروی جلو آهسته یا متوقف باشد، سرعت امن متناسب با فاصله کم می‌شود.
        const availableBrakingDistance = Math.max(
          0,
          nearestFrontDistance - CarManager.SAFE_FOLLOW_DISTANCE,
        );
        const frontSpeed = Math.max(0, nearestFrontSpeed);
        const safeFollowingSpeed = Math.sqrt(
          frontSpeed * frontSpeed +
            2 * CarManager.DECELERATION * availableBrakingDistance,
        );

        active.targetSpeed = Math.min(active.targetSpeed, safeFollowingSpeed);
      }

      /**

اگر Collision واقعی/پیش‌بینی‌شده باشد، برای جلوگیری از برخورد

توقف مجاز است. این بخش مربوط به چراغ یا تقاطع نیست.
*/
      /**
       * اگر Collision واقعی/پیش‌بینی‌شده باشد، برای جلوگیری از برخورد
       * توقف مجاز است. این بخش مربوط به چراغ یا تقاطع نیست.
       *
       * فقط همان Collision Guard موجود در همین فایل دوباره فعال می‌شود؛
       * هیچ مقدار، تعداد خودرو، Spawn یا منطق Transition دیگری تغییر نمی‌کند.
       */
      const collisionBrakingSpeed = this.getCollisionBrakingSpeed(
        active,
        _deltaTime,
      );
      active.targetSpeed = Math.min(active.targetSpeed, collisionBrakingSpeed);

      if (this.isVehicleMovementBlocked(active, _deltaTime)) {
        // پیش‌بینی برخورد نباید فرمان سرعت را در یک فریم از Cruise به صفر بپراند.
        // هر فریم فقط یک گام ترمز فیزیکی درخواست می‌کنیم؛ محافظ موقعیت پایین‌تر
        // همچنان از برخورد واقعی جلوگیری می‌کند.
        const emergencyBrakeDelta = THREE.MathUtils.clamp(
          Number.isFinite(_deltaTime) ? _deltaTime : 0,
          0,
          0.1,
        );
        const progressiveBrakeTarget = Math.max(
          0,
          active.motionSpeed - CarManager.DECELERATION * emergencyBrakeDelta,
        );

        active.targetSpeed = Math.min(
          active.targetSpeed,
          progressiveBrakeTarget,
        );
      }

      // بدون چراغ فعال، حق‌تقدم حفظ می‌شود؛ اما خودرو از فاصلهٔ توقف امن
      // سرعتش را کم می‌کند، نه اینکه با دیدن مانع فوراً هدف سرعتش صفر شود.
      const activePhase = this.getTrafficLightPhase(active);
      const priorityApproach = this.getIntersectionApproachInfo(active);
      const priorityBlocked = Boolean(
        !activePhase &&
        priorityApproach &&
        priorityApproach.remaining >= 0 &&
        this.hasIntersectionPriorityBlocker(active),
      );

      if (priorityBlocked && priorityApproach) {
        const priorityBrakingDistance = Math.max(
          0,
          priorityApproach.remaining - 0.35,
        );
        const priorityTargetSpeed = Math.sqrt(
          2 *
            CarManager.TRAFFIC_LIGHT_APPROACH_DECELERATION *
            priorityBrakingDistance,
        );
        active.targetSpeed = Math.min(active.targetSpeed, priorityTargetSpeed);
        active.waitingAtIntersection = true;
      }

      // تایمر فقط وقتی جلو می‌رود که خودرو واقعاً نزدیک خط توقف، تقریباً ایستاده
      // و بدون چراغ فعال باشد؛ بنابراین صف عادی یا چراغ قرمز دور زده نمی‌شود.
      const waitingAtUncontrolledIntersection = Boolean(
        !activePhase &&
        priorityApproach &&
        priorityApproach.remaining >= 0 &&
        priorityApproach.remaining <= 2.0 &&
        active.motionSpeed <= 0.5,
      );

      if (waitingAtUncontrolledIntersection && priorityApproach) {
        active.intersectionWaitTime += Math.max(0, _deltaTime);

        // اگر چند خودرو به‌خاطر حق‌تقدم یکدیگر را قفل کرده باشند،
        // پس از انتظار محدود فقط یک خودرو با ترتیب قطعی آزاد می‌شود.
        if (
          active.intersectionWaitTime >=
            CarManager.INTERSECTION_MAX_WAIT_TIME &&
          this.isIntersectionDeadlockReleaseLeader(active, priorityApproach) &&
          !this.hasNearbyIntersectionRelease(active, priorityApproach)
        ) {
          active.intersectionReleaseTime =
            CarManager.INTERSECTION_RELEASE_DURATION;
          active.intersectionWaitTime = 0;
          active.waitingAtIntersection = false;
          active.targetSpeed = Math.min(
            active.cruiseSpeed,
            CarManager.DEADLOCK_RELEASE_SPEED,
          );
        }
      } else if (!trafficLightBlocked) {
        active.intersectionWaitTime = 0;
      }

      // Deadlock recovery lowers speed only when the current signal permits movement.
      if (active.intersectionReleaseTime > 0 && !trafficLightBlocked) {
        active.targetSpeed = Math.min(
          active.targetSpeed,
          CarManager.DEADLOCK_RELEASE_SPEED,
        );
      }

      /**
       * Follow و Collision ممکن است targetSpeed را دوباره تغییر داده باشند؛
       * اگر چراغ هنوز قرمز/زرد است، تصمیم چراغ باید در نهایت برنده باشد.
       */
      if (trafficLightBlocked) {
        active.targetSpeed = Math.min(
          active.targetSpeed,
          trafficLightTargetSpeed,
        );
      }

      active.targetSpeed = THREE.MathUtils.clamp(
        active.targetSpeed,
        0,
        CarManager.MAX_SPEED,
      );
    }
  }

  /**
   * ==========================================
   * Traffic Light Blocker
   * ==========================================
   *
   * وضعیت منطقی چراغ از TrafficLightController گرفته می‌شود.
   * چراغ فیزیکی فقط نمایش‌دهنده است؛ تصمیم حرکت خودرو بر اساس Phase
   * منطقی همان تقاطع انجام می‌شود.
   */
  private getTrafficLightPhase(
    active: ActiveVehicleData,
  ): ReturnType<TrafficLightController["getIntersectionPhase"]> {
    const controller = TrafficLightController.getActiveController();
    if (!controller) {
      return null;
    }

    const center = this.tempWorldPosition;
    active.road.group.getWorldPosition(center);
    return controller.getIntersectionPhase(center);
  }

  /**
   * TrafficLightController direction یعنی سمتی که خودرو از آن وارد تقاطع می‌شود؛
   * VehicleDirection یعنی سمتی که خودرو در آن حرکت می‌کند. این دو معکوس‌اند.
   */
  private getIncomingTrafficDirection(
    direction: VehicleDirection,
  ): VehicleDirection {
    const incomingDirection: Record<VehicleDirection, VehicleDirection> = {
      north: "south",
      south: "north",
      east: "west",
      west: "east",
    };

    return incomingDirection[direction];
  }

  /** وضعیت چراغ مخصوص سمتی که این خودرو از آن به تقاطع نزدیک می‌شود. */
  private getTrafficLightStateForVehicle(
    active: ActiveVehicleData,
  ): ReturnType<TrafficLightController["getIntersectionLightState"]> {
    const controller = TrafficLightController.getActiveController();
    if (!controller) {
      return null;
    }

    const center = this.tempWorldPosition;
    active.road.group.getWorldPosition(center);
    const incomingDirection = this.getIncomingTrafficDirection(
      active.vehicle.getDirection(),
    );

    return controller.getIntersectionLightState(center, incomingDirection);
  }

  /**
   * اگر active چراغ سبز دارد و خودروی عمود بر آن پشت چراغ قرمز منتظر است،
   * خودروی قرمز را مانع نمی‌شماریم. خودروهای دارای Transition مستثنا هستند.
   */
  private shouldIgnoreRedApproachForGreenTraffic(
    active: ActiveVehicleData,
    other: ActiveVehicleData,
  ): boolean {
    if (other.trafficTransition) {
      return false;
    }

    if (
      active.intersectionReleaseTime > 0 &&
      other.waitingAtIntersection &&
      other.motionSpeed <= 0.5 &&
      this.isIntersectionConflictWith(active, other)
    ) {
      const phase = this.getTrafficLightPhase(active);
      const activeHasGreen =
        this.getTrafficLightStateForVehicle(active) === "green";
      // Deadlock recovery may bypass a stopped blocker only for a permitted movement.
      if (activeHasGreen || !phase) {
        return true;
      }
    }

    if (!this.isIntersectionConflictWith(active, other)) {
      return false;
    }

    const activePhase = this.getTrafficLightPhase(active);
    const otherPhase = this.getTrafficLightPhase(other);

    if (!activePhase || !otherPhase) {
      return false;
    }

    if (
      this.isTrafficLightBlocking(active) ||
      !this.isTrafficLightBlocking(other)
    ) {
      return false;
    }

    const otherApproach = this.getIntersectionApproachInfo(other);
    if (!otherApproach) {
      return false;
    }

    // فقط وقتی خودروی مسیر قرمز نزدیک خط توقف و تقریباً متوقف است،
    // اجازه می‌دهیم مسیر سبز به‌خاطر آن در Collision Guard قفل نشود.
    return otherApproach.remaining <= 1.25 && other.motionSpeed <= 1.5;
  }

  private isTrafficLightBlocking(active: ActiveVehicleData): boolean {
    if (active.trafficTransition) {
      return false;
    }

    const approach = this.getIntersectionApproachInfo(active);
    if (!approach) {
      return false;
    }

    // Once past the stop line, clear the intersection instead of stopping on a phase change.
    if (approach.remaining < -0.25) {
      return false;
    }

    const phase = this.getTrafficLightPhase(active);
    if (!phase) {
      return false;
    }

    // The signal direction is the approach side, not the vehicle's travel heading.
    // Vehicles already past the stop line are allowed to clear the intersection.
    return this.getTrafficLightStateForVehicle(active) !== "green";
  }

  /**
   * ==========================================
   * Clamp Vehicle To Intersection Stop Line
   * ==========================================
   *
   * خودرو فقط وقتی به خط توقف خیلی نزدیک شده باشد Snap می‌شود.
   * این Snap کوچک است و فقط برای جلوگیری از عبور میلی‌متری از خط است.
   */
  private clampVehicleToIntersectionStopLine(active: ActiveVehicleData): void {
    const approach = this.getIntersectionApproachInfo(active);

    if (!approach) {
      return;
    }

    const stopLineDistance = this.getIntersectionStopDistance(active);

    const distanceToStopLine = Math.abs(active.roadDistance - stopLineDistance);

    /**
     * فقط وقتی خودرو خیلی نزدیک خط توقف است Snap می‌کنیم.
     * این کار جلوی رد شدن چند سانتی‌متری از خط را می‌گیرد،
     * بدون اینکه حرکت عادی خودرو را Teleport کند.
     */
    // اصلاح نقطه فقط وقتی مجاز است که خودرو عملاً متوقف شده باشد؛
    // Snap در سرعت قابل‌توجه باعث پرش موقعیت و توقف ظاهری ناگهانی می‌شد.
    if (
      distanceToStopLine > CarManager.INTERSECTION_STOP_SNAP_DISTANCE ||
      active.motionSpeed > 0.12
    ) {
      return;
    }

    active.roadDistance = stopLineDistance;

    const position = this.getVehicleWorldPosition(
      active.road,
      active.laneIndex,
      stopLineDistance,
    );

    active.vehicle.group.position.copy(position);
    active.vehicle.group.position.y = CarManager.VEHICLE_Y;
  }

  /**

==========================================

Intersection Priority Blocker

==========================================



نسخه قبلی اینجا یک مشکل مهم داشت:





if (otherRemaining < activeRemaining)



    return true;



بدون اینکه بررسی کند آیا مسیر دو خودرو واقعاً با هم

برخورد می‌کند یا خیر.



بنابراین مثلاً:





   ← A



   │



   │



   B



   ↑



ممکن بود A صرفاً به خاطر نزدیک‌تر بودن B متوقف شود،

در حالی که مسیر مستقیم آن‌ها لزوماً یک مسیر مشترک نیست.



اکنون فقط Approachهای عمود بر هم به‌عنوان Conflict بررسی می‌شوند.
*/
  private hasIntersectionPriorityBlocker(active: ActiveVehicleData): boolean {
    if (active.intersectionReleaseTime > 0) {
      return false;
    }

    const approach = this.getIntersectionApproachInfo(active);

    if (!approach || approach.remaining < 0) {
      return false;
    }

    const activeDirection = active.vehicle.getDirection();

    /**
     * وقتی تقاطع فاز چراغ دارد، همان فاز منبع اصلی حق عبور است.
     * این جلوی چرخه‌ای را می‌گیرد که خودروهای چهار جهت همگی منتظر هم می‌مانند.
     */
    const phase = this.getTrafficLightPhase(active);
    if (phase) {
      return this.getTrafficLightStateForVehicle(active) !== "green";
    }

    /**
     * بدون فاز چراغ: خودروی نزدیک‌تر اولویت دارد؛ اگر فاصله‌ها تقریباً برابر
     * باشند، ترتیب ثابت north → east → south → west تساوی را می‌شکند.
     * این قانون نمی‌تواند چرخهٔ حق‌تقدم چهارجهته بسازد.
     */
    for (const other of this.activeVehicles) {
      if (other === active || other.trafficTransition) {
        continue;
      }

      const otherDirection = other.vehicle.getDirection();
      const isCrossingDirection =
        activeDirection === "north" || activeDirection === "south"
          ? otherDirection === "east" || otherDirection === "west"
          : otherDirection === "north" || otherDirection === "south";

      if (!isCrossingDirection) {
        continue;
      }

      const otherApproach = this.getIntersectionApproachInfo(other);

      if (!otherApproach) {
        continue;
      }

      if (
        approach.connectionPoint.distanceTo(otherApproach.connectionPoint) >
        CarManager.INTERSECTION_MATCH_DISTANCE
      ) {
        continue;
      }

      if (
        otherApproach.remaining <
        approach.remaining - CarManager.INTERSECTION_PRIORITY_MARGIN
      ) {
        return true;
      }

      if (
        Math.abs(otherApproach.remaining - approach.remaining) <=
          CarManager.INTERSECTION_PRIORITY_MARGIN &&
        this.hasIntersectionTiePriority(otherDirection, activeDirection)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * بررسی می‌کند که دو خودرو واقعاً در Conflict یک تقاطع هستند.
   * فقط مسیرهای عمود بر هم Conflict دارند؛ مسیرهای موازی ندارند.
   */
  private isIntersectionConflictWith(
    active: ActiveVehicleData,
    other: ActiveVehicleData,
  ): boolean {
    const activeApproach = this.getIntersectionApproachInfo(active);
    const otherApproach = this.getIntersectionApproachInfo(other);

    if (!activeApproach || !otherApproach) {
      return false;
    }

    const sameIntersection =
      activeApproach.connectionPoint.distanceTo(
        otherApproach.connectionPoint,
      ) <= CarManager.INTERSECTION_MATCH_DISTANCE;

    if (!sameIntersection) {
      return false;
    }

    const activeDirection = active.vehicle.getDirection();
    const otherDirection = other.vehicle.getDirection();

    return activeDirection === "north" || activeDirection === "south"
      ? otherDirection === "east" || otherDirection === "west"
      : otherDirection === "north" || otherDirection === "south";
  }

  /**
   * فقط یک خودرو در هر تقاطع اجازهٔ بازیابی بن‌بست دارد.
   * انتخاب بر اساس نزدیک‌ترین Approach، سپس ترتیب ثابت جهت و در نهایت
   * ترتیب داخلی خودروهاست تا چند خودرو هم‌زمان آزاد نشوند.
   */
  private isIntersectionDeadlockReleaseLeader(
    active: ActiveVehicleData,
    activeApproach: { remaining: number; connectionPoint: THREE.Vector3 },
  ): boolean {
    const activeDirection = active.vehicle.getDirection();
    const activeDirectionPriority: Record<VehicleDirection, number> = {
      north: 0,
      east: 1,
      south: 2,
      west: 3,
    };
    const activeIndex = this.activeVehicles.indexOf(active);

    for (const other of this.activeVehicles) {
      if (other === active || other.trafficTransition) {
        continue;
      }

      const otherApproach = this.getIntersectionApproachInfo(other);
      if (
        !otherApproach ||
        otherApproach.remaining < 0 ||
        activeApproach.connectionPoint.distanceTo(
          otherApproach.connectionPoint,
        ) > CarManager.INTERSECTION_MATCH_DISTANCE
      ) {
        continue;
      }

      if (
        otherApproach.remaining <
        activeApproach.remaining - CarManager.INTERSECTION_PRIORITY_MARGIN
      ) {
        return false;
      }

      if (
        Math.abs(otherApproach.remaining - activeApproach.remaining) <=
        CarManager.INTERSECTION_PRIORITY_MARGIN
      ) {
        const otherDirection = other.vehicle.getDirection();
        const otherPriority = activeDirectionPriority[otherDirection];
        const activePriority = activeDirectionPriority[activeDirection];

        if (
          otherPriority < activePriority ||
          (otherPriority === activePriority &&
            this.activeVehicles.indexOf(other) < activeIndex)
        ) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * بررسی می‌کند که خودروی دیگری در همین محدودهٔ تقاطع در حال بازیابی نباشد.
   */
  private hasNearbyIntersectionRelease(
    active: ActiveVehicleData,
    approach: { remaining: number; connectionPoint: THREE.Vector3 },
  ): boolean {
    return this.activeVehicles.some((other) => {
      if (other === active || other.intersectionReleaseTime <= 0) {
        return false;
      }

      const otherApproach = this.getIntersectionApproachInfo(other);
      if (otherApproach) {
        return (
          approach.connectionPoint.distanceTo(otherApproach.connectionPoint) <=
          CarManager.INTERSECTION_MATCH_DISTANCE
        );
      }

      return (
        other.vehicle.group.position.distanceTo(approach.connectionPoint) <= 12
      );
    });
  }

  /**

==========================================

Intersection Tie Priority

==========================================



Priority ثابت برای زمانی که دو خودرو تقریباً دقیقاً

همزمان به یک تقاطع می‌رسند.



ترتیب:



north → east → south → west



این ترتیب فقط Tie را حل می‌کند و در حالت عادی

وارد تصمیم Traffic نمی‌شود.
*/
  private hasIntersectionTiePriority(
    otherDirection: VehicleDirection,
    activeDirection: VehicleDirection,
  ): boolean {
    const priority: Record<VehicleDirection, number> = {
      north: 0,
      east: 1,
      south: 2,
      west: 3,
    };

    return priority[otherDirection] < priority[activeDirection];
  }

  /**

==========================================

Intersection Occupancy

==========================================



این تابع دیگر شعاع 6 متری قبلی را استفاده نمی‌کند.



فقط خودروهایی که واقعاً نزدیک مرکز اتصال هستند،

تقاطع را Occupied می‌کنند.



این تغییر مهم است چون یک خودرو که هنوز چند متر قبل

از تقاطع است نباید باعث توقف چهار خودروی دیگر شود.
*/
  private isIntersectionOccupied(active: ActiveVehicleData): boolean {
    const approach = this.getIntersectionApproachInfo(active);

    if (!approach) {
      return false;
    }

    for (const other of this.activeVehicles) {
      if (other === active) {
        continue;
      }

      /**
       * --------------------------------------
       * Normal Vehicle
       * --------------------------------------
       */

      const position = other.vehicle.group.position;

      const distance = approach.connectionPoint.distanceTo(position);

      if (distance <= CarManager.INTERSECTION_OCCUPANCY_DISTANCE) {
        /**
         * خودرویی که هنوز Approach خودش را طی می‌کند
         * نباید صرفاً به خاطر نزدیکی نقطه‌ای Occupied
         * حساب شود.
         *
         * اگر خودرو واقعاً روی همین مرکز تقاطع است،
         * Occupied معتبر است.
         */
        const otherApproach = this.getIntersectionApproachInfo(other);

        if (!otherApproach) {
          return true;
        }
      }

      /**
       * --------------------------------------
       * Transition
       * --------------------------------------
       */

      const transition = other.trafficTransition;

      if (transition) {
        const transitionDistance = approach.connectionPoint.distanceTo(
          transition.end,
        );

        if (transitionDistance <= CarManager.INTERSECTION_TRANSITION_DISTANCE) {
          return true;
        }
      }
    }

    return false;
  }

  /**

==========================================

Intersection Approach Info

==========================================
*/

  /**

==========================================

Intersection Stop Distance

==========================================



Stop Line واقعی همان نقطه‌ای است که آخرین Dash ورودی Road قرار می‌گیرد.



در Road فعلی این نقطه حدود 2.5m قبل از endpoint قرار دارد.

تمام محاسبات Approach، Braking و Clamp از همین تابع استفاده می‌کنند

تا دیگر بین توابع اختلاف فاصله وجود نداشته باشد.
*/
  private getIntersectionStopDistance(active: ActiveVehicleData): number {
    // The crossing is centered on the Road group; local longitudinal zero is its center.
    return this.isMovingPositive(active.vehicle.getDirection())
      ? -CarManager.INTERSECTION_STOP_DISTANCE_FROM_CENTER
      : CarManager.INTERSECTION_STOP_DISTANCE_FROM_CENTER;
  }

  private getIntersectionApproachInfo(active: ActiveVehicleData): {
    remaining: number;
    connectionPoint: THREE.Vector3;
  } | null {
    const movingPositive = this.isMovingPositive(active.vehicle.getDirection());
    const stopLineDistance = this.getIntersectionStopDistance(active);
    const remaining = movingPositive
      ? stopLineDistance - active.roadDistance
      : active.roadDistance - stopLineDistance;

    const approaching =
      remaining >= 0 && remaining <= CarManager.INTERSECTION_APPROACH_DISTANCE;
    const occupyingIntersection =
      Math.abs(active.roadDistance) <=
      CarManager.INTERSECTION_CONFLICT_ZONE_HALF_LENGTH;

    if (!approaching && !occupyingIntersection) {
      return null;
    }

    // Both perpendicular Roads use the same world-space center for this intersection.
    const connectionPoint = new THREE.Vector3();
    active.road.group.getWorldPosition(connectionPoint);

    return { remaining, connectionPoint };
  }

  /**

==========================================

Forward Distance

==========================================
*/

  private getForwardDistance(
    _road: Road,
    currentDistance: number,
    otherDistance: number,
    direction: VehicleDirection,
  ): number {
    /**
     * Roadها finite هستند.
     *
     * north / west:
     *     حرکت روی محور طولی در جهت منفی
     *
     * south / east:
     *     حرکت روی محور طولی در جهت مثبت
     */
    return direction === "south" || direction === "east"
      ? otherDistance - currentDistance
      : currentDistance - otherDistance;
  }

  /**

==========================================

Road Progress

==========================================
*/

  private updateRoadProgress(active: ActiveVehicleData): void {
    const vehicle = active.vehicle;

    const road = active.road;

    this.tempLocalPosition.copy(vehicle.group.position);

    road.group.worldToLocal(this.tempLocalPosition);

    active.roadDistance = this.tempLocalPosition.z;

    const movingPositive = this.isMovingPositive(vehicle.getDirection());

    const roadEnd = movingPositive
      ? road.getLongitudinalMax()
      : road.getLongitudinalMin();

    const remaining = movingPositive
      ? roadEnd - active.roadDistance
      : active.roadDistance - roadEnd;

    if (
      !active.waitingAtIntersection &&
      active.targetSpeed > 0.1 &&
      remaining <= CarManager.TRANSITION_TRIGGER_DISTANCE
    ) {
      const transitioned = this.tryStartRoadTransition(active, movingPositive);

      if (transitioned) {
        return;
      }

      /**
       * اگر Transition در این Frame پیدا نشد،
       * خودرو تا رسیدن واقعی به انتهای Road
       * همچنان Lifecycle عادی خود را حفظ می‌کند.
       *
       * به محض رسیدن به انتهای واقعی Road، Recycle
       * تلاش می‌شود. اگر خودرو هنوز داخل دید Camera
       * باشد، recycleVehicle آن را Pending نگه می‌دارد
       * تا Teleport جلوی چشم کاربر انجام نشود.
       */
      const hardEndDistance = 0.05;

      if (remaining <= hardEndDistance) {
        const index = this.activeVehicles.indexOf(active);

        if (index >= 0) {
          this.recycleVehicle(index);
        }
      }
    }
  }

  /**

==========================================

Road Transition

==========================================
*/

  private tryStartRoadTransition(
    active: ActiveVehicleData,
    movingPositive: boolean,
  ): boolean {
    const candidates = this.findConnectedRoads(
      active.road,
      movingPositive,
      active.vehicle.getDirection(),
    );

    if (candidates.length === 0) {
      return false;
    }

    const selected = this.selectConnectedRoad(
      candidates,
      active.vehicle.getDirection(),
    );

    if (!selected) {
      return false;
    }

    const nextDirection = this.getDirectionForEndpoint(
      selected.road,
      selected.endpointIsMin,
    );

    const nextLaneIndex = this.getLaneIndexForDirection(
      selected.road,
      nextDirection,
    );

    const nextDistance = selected.endpointIsMin
      ? selected.road.getLongitudinalMin() + CarManager.TRANSITION_EXIT_DISTANCE
      : selected.road.getLongitudinalMax() -
        CarManager.TRANSITION_EXIT_DISTANCE;

    const start = active.vehicle.group.position.clone();

    const end = this.getVehicleWorldPosition(
      selected.road,
      nextLaneIndex,
      nextDistance,
    );

    const control = this.createTransitionControlPoint(
      selected.connectionPoint,
      active.vehicle.getDirection(),
      nextDirection,
    );

    const arcLengthSamples = this.createTransitionArcLengthSamples(
      start,
      control,
      end,
    );
    const arcLength =
      arcLengthSamples[arcLengthSamples.length - 1] ?? start.distanceTo(end);

    active.trafficTransition = {
      fromRoad: active.road,
      toRoad: selected.road,
      fromLaneIndex: active.laneIndex,
      toLaneIndex: nextLaneIndex,
      start: start.clone(),
      control: control.clone(),
      end: end.clone(),
      finalDirection: nextDirection,
      finalDistance: nextDistance,
      distanceTravelled: 0,
      arcLength,
      arcLengthSamples,
      blockedLastFrame: false,
    };

    active.targetSpeed = active.cruiseSpeed;

    active.vehicle.setTargetSpeed(active.cruiseSpeed);

    return true;
  }

  /**

==========================================

Find Connected Roads

==========================================
*/

  private findConnectedRoads(
    fromRoad: Road,
    movingPositive: boolean,
    currentDirection: VehicleDirection,
  ): Array<{
    road: Road;
    endpointIsMin: boolean;
    connectionPoint: THREE.Vector3;
  }> {
    const candidates: Array<{
      road: Road;
      endpointIsMin: boolean;
      connectionPoint: THREE.Vector3;
    }> = [];

    const endpointDistance = movingPositive
      ? fromRoad.getLongitudinalMax()
      : fromRoad.getLongitudinalMin();

    const fromLane = this.getLaneIndexForDirection(fromRoad, currentDirection);

    const sourcePoint = this.getVehicleWorldPosition(
      fromRoad,
      fromLane,
      endpointDistance,
    ).clone();

    for (const road of this.roads) {
      if (road === fromRoad) {
        continue;
      }

      for (const endpointIsMin of [true, false]) {
        const nextDirection = this.getDirectionForEndpoint(road, endpointIsMin);

        if (this.isUTurn(currentDirection, nextDirection)) {
          continue;
        }

        const nextLane = this.getLaneIndexForDirection(road, nextDirection);

        const endpointDistance = endpointIsMin
          ? road.getLongitudinalMin()
          : road.getLongitudinalMax();

        const endpointPoint = this.getVehicleWorldPosition(
          road,
          nextLane,
          endpointDistance,
        ).clone();

        if (
          sourcePoint.distanceTo(endpointPoint) <=
          CarManager.ROAD_CONNECTION_DISTANCE
        ) {
          candidates.push({
            road,
            endpointIsMin,
            connectionPoint: sourcePoint.clone().lerp(endpointPoint, 0.5),
          });
        }
      }
    }

    return candidates;
  }

  /**

==========================================

Select Connected Road

==========================================
*/

  private selectConnectedRoad(
    candidates: Array<{
      road: Road;
      endpointIsMin: boolean;
      connectionPoint: THREE.Vector3;
    }>,
    currentDirection: VehicleDirection,
  ): {
    road: Road;
    endpointIsMin: boolean;
    connectionPoint: THREE.Vector3;
  } | null {
    // Experimental traffic is straight-through only. Never fall back to turns or U-turns.
    return (
      candidates.find(
        (candidate) =>
          this.getDirectionForEndpoint(
            candidate.road,
            candidate.endpointIsMin,
          ) === currentDirection,
      ) ?? null
    );
  }

  /**

==========================================

Endpoint Direction

==========================================
*/

  private getDirectionForEndpoint(
    road: Road,
    endpointIsMin: boolean,
  ): VehicleDirection {
    const worldDirection = road.getWorldDirection();
    const horizontal = Math.abs(worldDirection.x) >= Math.abs(worldDirection.z);

    // This is the direction entering the Road from the selected endpoint.
    if (horizontal) {
      if (worldDirection.x >= 0) {
        return endpointIsMin ? "east" : "west";
      }
      return endpointIsMin ? "west" : "east";
    }

    if (worldDirection.z >= 0) {
      return endpointIsMin ? "south" : "north";
    }
    return endpointIsMin ? "north" : "south";
  }

  /**

==========================================

Lane Index From Direction

==========================================
*/

  private getLaneIndexForDirection(
    road: Road,
    direction: VehicleDirection,
  ): number {
    const worldDirection = road.getWorldDirection();

    const horizontal = Math.abs(worldDirection.x) >= Math.abs(worldDirection.z);

    if (horizontal) {
      return direction === "east" ? 0 : 1;
    }

    return direction === "north" ? 0 : 1;
  }

  /**

==========================================

Direction From Road

==========================================
*/

  private getDirectionForRoad(road: Road, laneIndex: number): VehicleDirection {
    const worldDirection = road.getWorldDirection();

    const horizontal = Math.abs(worldDirection.x) >= Math.abs(worldDirection.z);

    if (horizontal) {
      return laneIndex === 0 ? "east" : "west";
    }

    return laneIndex === 0 ? "north" : "south";
  }

  /**

==========================================

Transition Control Point

==========================================
*/

  private createTransitionControlPoint(
    connectionPoint: THREE.Vector3,
    incomingDirection: VehicleDirection,
    outgoingDirection: VehicleDirection,
  ): THREE.Vector3 {
    this.setDirectionVector(incomingDirection, this.tempIncoming);

    this.setDirectionVector(outgoingDirection, this.tempOutgoing);

    const directionDot = this.tempIncoming.dot(this.tempOutgoing);

    // مسیر مستقیم باید نقطه کنترل روی همان خط داشته باشد.
    // از نصف شدن مختصات جهانی connectionPoint جلوگیری می‌کنیم.
    if (directionDot > 0.9) {
      return this.tempControl.copy(connectionPoint);
    }

    if (directionDot < -0.9) {
      return this.tempControl
        .copy(connectionPoint)
        .addScaledVector(this.tempIncoming, -CarManager.TURN_RADIUS);
    }

    // فقط برای تغییر جهت، نقطه کنترل منحنی ساخته می‌شود.
    return this.tempControl
      .copy(connectionPoint)
      .addScaledVector(this.tempIncoming, CarManager.TURN_RADIUS)
      .addScaledVector(this.tempOutgoing, CarManager.TURN_RADIUS);
  }

  /**

==========================================

Transition Collision Guard

==========================================

Transition دیگر بدون بررسی برخورد جلو نمی‌رود.

نکته مهم:

- مسیر منحنی Transition با Follow معمولی Road یکی نیست.
- بنابراین Collision Guard عادیِ Road به‌تنهایی برای این بخش کافی نیست.
- قبل از ثبت موقعیت جدید، نقطه بعدی Transition با خودروهای دیگر
  مقایسه می‌شود.
- اگر خودرو دیگری خیلی نزدیک باشد، Transition همان Frame متوقف می‌شود
  و در Frame بعد دوباره تلاش می‌کند.
- برای جلوگیری از Deadlock بین دو Transition هم‌زمان، وقتی هر دو
  Transition در محدوده برخورد باشند، ترتیب activeVehicles تعیین می‌کند
  کدام خودرو عبور کند.
*/
  private isTransitionMovementBlocked(
    active: ActiveVehicleData,
    nextPosition: THREE.Vector3,
    deltaTime: number,
  ): boolean {
    const transition = active.trafficTransition;
    if (!transition) {
      return false;
    }

    const activeIndex = this.activeVehicles.indexOf(active);
    const predictionTime = Math.min(
      Math.max(deltaTime, 0),
      CarManager.VEHICLE_PREDICTION_TIME,
    );

    for (const other of this.activeVehicles) {
      if (other === active) {
        continue;
      }

      // یک خودرو که روی مسیر متعارض پشت چراغ قرمز ایستاده، نباید حرکت سبز را قفل کند.
      if (this.shouldIgnoreRedApproachForTransition(active, other)) {
        continue;
      }

      // خودروهای مسیر عادی در لاین مجاور همان خیابان، مخصوصاً در جهت مخالف،
      // مانع Transition نیستند؛ بررسی فاصلهٔ صرفاً سه‌بعدی باعث ترمز کاذب می‌شود.
      if (!other.trafficTransition) {
        const sameFromRoad = other.road === transition.fromRoad;
        const sameToRoad = other.road === transition.toRoad;
        const transitionLane = sameToRoad
          ? transition.toLaneIndex
          : transition.fromLaneIndex;

        if (
          (sameFromRoad || sameToRoad) &&
          other.laneIndex !== transitionLane
        ) {
          continue;
        }
      }

      const otherPosition = other.vehicle.group.position;
      this.tempOtherPredictedPosition.copy(otherPosition);

      if (!other.trafficTransition && other.motionSpeed > 0.001) {
        this.setDirectionVector(
          other.vehicle.getDirection(),
          this.tempOtherDirection,
        );
        this.tempOtherPredictedPosition.addScaledVector(
          this.tempOtherDirection,
          other.motionSpeed * predictionTime,
        );
      }

      const currentDistance =
        active.vehicle.group.position.distanceTo(otherPosition);
      const predictedDistance = nextPosition.distanceTo(
        this.tempOtherPredictedPosition,
      );

      if (
        predictedDistance >= CarManager.VEHICLE_COLLISION_DISTANCE ||
        predictedDistance + 0.015 >= currentDistance
      ) {
        continue;
      }

      if (other.trafficTransition) {
        const otherIndex = this.activeVehicles.indexOf(other);
        // فقط یک Transition اجازه پیشروی دارد؛ ترتیب ثابت بن‌بست هم‌زمان را می‌شکند.
        if (activeIndex >= 0 && otherIndex >= 0 && activeIndex < otherIndex) {
          continue;
        }
      }

      // در بازهٔ بازیابی، خودرو با اولویت می‌تواند از کنار خودروی ثابتِ معطل عبور کند.
      if (
        active.intersectionReleaseTime > 0 &&
        !other.trafficTransition &&
        other.waitingAtIntersection &&
        other.motionSpeed <= 0.5
      ) {
        continue;
      }

      return true;
    }

    return false;
  }

  private shouldIgnoreRedApproachForTransition(
    active: ActiveVehicleData,
    other: ActiveVehicleData,
  ): boolean {
    const transition = active.trafficTransition;
    if (
      !transition ||
      other.trafficTransition ||
      !other.waitingAtIntersection ||
      other.motionSpeed > 0.5 ||
      !this.isTrafficLightBlocking(other)
    ) {
      return false;
    }

    const phase = this.getTrafficLightPhase(active);
    if (!phase) {
      return false;
    }

    const greenForActive =
      this.getTrafficLightStateForVehicle(active) === "green";

    if (!greenForActive) {
      return false;
    }

    const otherApproach = this.getIntersectionApproachInfo(other);
    if (!otherApproach) {
      return false;
    }

    const distanceToTransition = Math.min(
      transition.start.distanceTo(otherApproach.connectionPoint),
      transition.control.distanceTo(otherApproach.connectionPoint),
      transition.end.distanceTo(otherApproach.connectionPoint),
    );

    return distanceToTransition <= 9;
  }

  /**

==========================================

Update Transition

==========================================
*/

  /**
   * جدول طول قوس منحنی Bezier را می‌سازد.
   * نمونه‌ها با فاصله پارامتری مساوی‌اند و طول تجمعی آن‌ها برای حرکت با سرعت واقعی استفاده می‌شود.
   */
  private createTransitionArcLengthSamples(
    start: THREE.Vector3,
    control: THREE.Vector3,
    end: THREE.Vector3,
  ): number[] {
    const sampleCount = CarManager.TRANSITION_ARC_LENGTH_SAMPLES;
    const samples = new Array<number>(sampleCount + 1);
    const previousPoint = start.clone();
    const currentPoint = new THREE.Vector3();
    let cumulativeLength = 0;

    samples[0] = 0;

    for (let index = 1; index <= sampleCount; index++) {
      const t = index / sampleCount;
      const oneMinusT = 1 - t;

      currentPoint
        .copy(start)
        .multiplyScalar(oneMinusT * oneMinusT)
        .addScaledVector(control, 2 * oneMinusT * t)
        .addScaledVector(end, t * t);

      cumulativeLength += currentPoint.distanceTo(previousPoint);
      samples[index] = cumulativeLength;
      previousPoint.copy(currentPoint);
    }

    return samples;
  }

  /** مسافت طی‌شده روی قوس را به پارامتر t منحنی Bezier تبدیل می‌کند. */
  private getTransitionParameterAtDistance(
    transition: TrafficTransition,
    distance: number,
  ): number {
    const samples = transition.arcLengthSamples;
    const finalIndex = samples.length - 1;

    if (finalIndex <= 0 || distance <= 0) {
      return 0;
    }

    if (distance >= transition.arcLength) {
      return 1;
    }

    let upperIndex = 1;
    while (
      upperIndex < finalIndex &&
      (samples[upperIndex] ?? transition.arcLength) < distance
    ) {
      upperIndex++;
    }

    const lowerIndex = upperIndex - 1;
    const lowerDistance = samples[lowerIndex] ?? 0;
    const upperDistance = samples[upperIndex] ?? transition.arcLength;
    const segmentLength = upperDistance - lowerDistance;
    const segmentAlpha =
      segmentLength > 0.000001 ? (distance - lowerDistance) / segmentLength : 0;

    return (
      (lowerIndex + THREE.MathUtils.clamp(segmentAlpha, 0, 1)) / finalIndex
    );
  }

  private updateTransition(active: ActiveVehicleData, deltaTime: number): void {
    const transition = active.trafficTransition;

    if (!transition) {
      return;
    }

    const dt = THREE.MathUtils.clamp(
      Number.isFinite(deltaTime) ? deltaTime : 0,
      0,
      0.1,
    );

    const totalLength = Math.max(transition.arcLength, 0.001);

    // پیشرفت مسیر بر اساس سرعت واقعی خودروست، نه مدت‌زمان ثابت و smoothstep.
    // بنابراین شتاب و ترمز فقط از یک منبع (motionSpeed) می‌آیند.
    const nextDistanceTravelled = Math.min(
      totalLength,
      transition.distanceTravelled + Math.max(0, active.motionSpeed) * dt,
    );

    const t = this.getTransitionParameterAtDistance(
      transition,
      nextDistanceTravelled,
    );
    const oneMinusT = 1 - t;

    this.tempTransitionCandidatePosition
      .copy(transition.start)
      .multiplyScalar(oneMinusT * oneMinusT)
      .addScaledVector(transition.control, 2 * oneMinusT * t)
      .addScaledVector(transition.end, t * t);

    /**
     * ======================================
     * Transition Collision Guard
     * ======================================
     *
     * مهم: Transition قبلاً بدون هیچ بررسی Collision حرکت می‌کرد.
     * همین باعث می‌شد دو خودرو هنگام عبور از منحنی وارد هم شوند.
     */
    if (
      this.isTransitionMovementBlocked(
        active,
        this.tempTransitionCandidatePosition,
        deltaTime,
      )
    ) {
      transition.blockedLastFrame = true;
      return;
    }

    // پس از بازشدن مسیر، حرکت از سرعت فعلی و با شتاب مجاز ادامه پیدا می‌کند.
    transition.blockedLastFrame = false;

    // فقط بعد از عبور موفق از Collision Guard، مسافت Transition جلو می‌رود.
    transition.distanceTravelled = nextDistanceTravelled;

    active.vehicle.group.position.copy(this.tempTransitionCandidatePosition);

    active.vehicle.group.position.y = CarManager.VEHICLE_Y;

    this.tempDirection
      .copy(transition.control)
      .sub(transition.start)
      .multiplyScalar(2 * (1 - t))
      .add(
        this.tempOutgoing
          .copy(transition.end)
          .sub(transition.control)
          .multiplyScalar(2 * t),
      );

    this.tempDirection.y = 0;

    if (this.tempDirection.lengthSq() > 0.0001) {
      this.tempDirection.normalize();

      const targetRotation = Math.atan2(
        this.tempDirection.x,
        this.tempDirection.z,
      );
      const currentRotation = active.vehicle.group.rotation.y;
      const rotationDifference = Math.atan2(
        Math.sin(targetRotation - currentRotation),
        Math.cos(targetRotation - currentRotation),
      );
      const rotationAlpha = 1 - Math.exp(-12 * Math.max(0, deltaTime));

      active.vehicle.group.rotation.y =
        currentRotation + rotationDifference * rotationAlpha;
    }

    if (nextDistanceTravelled >= totalLength - 0.001) {
      this.finishTransition(active);
    }
  }

  /**

==========================================

Finish Transition

==========================================
*/

  private finishTransition(active: ActiveVehicleData): void {
    const transition = active.trafficTransition;

    if (!transition) {
      return;
    }

    /**
     * ======================================
     * تثبیت کامل خودرو روی Road مقصد
     * ======================================
     *
     * ابتدا Road و Lane مقصد ثبت می‌شوند، سپس Transition بسته می‌شود.
     * ترتیب مهم است: تا وقتی Transition باز است، خودرو هنوز بین دو Road
     * قرار دارد و نباید منطق عادی Road Progress روی آن اجرا شود.
     */
    active.road = transition.toRoad;

    active.laneIndex = transition.toLaneIndex;

    active.trafficTransition = null;

    this.pendingRecycleVehicles.delete(active);

    active.vehicle.setDirection(transition.finalDirection);

    /**
     * نقطه پایانی Transition دقیقاً نقطه‌ای است که برای Road مقصد
     * محاسبه شده است. آن را دوباره روی Vehicle اعمال می‌کنیم تا هیچ
     * خطای کوچک ناشی از محاسبات منحنی باقی نماند.
     */
    active.vehicle.group.position.copy(transition.end);

    active.vehicle.group.position.y = CarManager.VEHICLE_Y;

    /**
     * Road Distance را از موقعیت واقعی Vehicle دوباره محاسبه می‌کنیم.
     * این کار باعث می‌شود state داخلی CarManager دقیقاً با موقعیت سه‌بعدی
     * خودرو یکی باشد و Frame بعدی Transition/Recycle را اشتباه تشخیص ندهد.
     */
    this.tempLocalPosition.copy(active.vehicle.group.position);

    active.road.group.worldToLocal(this.tempLocalPosition);

    active.roadDistance = this.tempLocalPosition.z;

    active.intersectionWaitTime = 0;

    active.waitingAtIntersection = false;

    active.intersectionReleaseTime = 0;

    active.targetSpeed = active.cruiseSpeed;

    active.vehicle.setTargetSpeed(active.motionSpeed);
  }

  /**

==========================================

Direction Vector

==========================================
*/

  private setDirectionVector(
    direction: VehicleDirection,
    target: THREE.Vector3,
  ): void {
    target.set(0, 0, 0);

    switch (direction) {
      case "north":
        target.z = -1;
        break;

      case "south":
        target.z = 1;
        break;

      case "east":
        target.x = 1;
        break;

      case "west":
        target.x = -1;
        break;
    }
  }

  /**

==========================================

Moving Positive

==========================================
*/

  private isMovingPositive(direction: VehicleDirection): boolean {
    return direction === "south" || direction === "east";
  }

  /**

==========================================

U-Turn Detection

==========================================
*/

  private isUTurn(
    incoming: VehicleDirection,
    outgoing: VehicleDirection,
  ): boolean {
    return (
      (incoming === "north" && outgoing === "south") ||
      (incoming === "south" && outgoing === "north") ||
      (incoming === "east" && outgoing === "west") ||
      (incoming === "west" && outgoing === "east")
    );
  }

  /**

==========================================

Same Axis

==========================================
*/

  private isSameAxis(
    first: VehicleDirection,
    second: VehicleDirection,
  ): boolean {
    const firstHorizontal = first === "east" || first === "west";

    const secondHorizontal = second === "east" || second === "west";

    return firstHorizontal === secondHorizontal;
  }

  /**

==========================================

Random Vehicle Type

==========================================
*/

  private getRandomVehicleType(): VehicleModelType {
    let totalWeight = 0;

    for (const profile of this.vehicleProfiles) {
      totalWeight += profile.weight;
    }

    let random = Math.random() * totalWeight;

    for (const profile of this.vehicleProfiles) {
      random -= profile.weight;

      if (random <= 0) {
        return profile.type;
      }
    }

    const fallback = this.vehicleProfiles[this.vehicleProfiles.length - 1];

    return fallback ? fallback.type : "sedan";
  }

  /**

==========================================

Random Speed

==========================================
*/

  private getRandomSpeed(): number {
    return (
      CarManager.MIN_SPEED +
      Math.random() * (CarManager.MAX_SPEED - CarManager.MIN_SPEED)
    );
  }

  /**

==========================================

Recycle Vehicle

==========================================
*/

  private recycleVehicle(index: number): void {
    const active = this.activeVehicles[index];

    if (!active || this.roads.length === 0) {
      return;
    }

    /**
     * ======================================
     * Transition Safety Guard
     * ======================================
     *
     * یک خودرو در حالت Transition هنوز بین دو Road قرار دارد
     * و موقعیت نهایی آن هنوز روی Road مقصد تثبیت نشده است.
     *
     * بنابراین Recycle نباید در این لحظه بتواند خودرو را از چرخه
     * Transition خارج کند یا آن را به یک نقطه دیگر Teleport کند.
     *
     * در حالت عادی updateRoadProgress هنگام Transition اجرا نمی‌شود،
     * اما این Guard عمداً این قرارداد را در خود Recycle نیز حفظ می‌کند
     * تا Lifecycle خودرو در برابر تغییرات آینده مقاوم بماند.
     */
    if (active.trafficTransition) {
      return;
    }

    /**
     * اگر Camera هنوز در دسترس نباشد،
     * یک نقطه امن روی شبکه پیدا می‌کنیم.
     * Count خودروها ثابت می‌ماند و Vehicle از Pool خارج نمی‌شود.
     */
    if (!this.hasCameraPosition) {
      const candidate = this.findRecycleCandidateWithoutCamera(active);

      if (candidate) {
        this.applyRecycleCandidate(active, candidate);
      } else {
        this.pendingRecycleVehicles.add(active);
      }

      return;
    }

    /**
     * اگر این خودرو قبلاً Pending شده است،
     * دوباره همان Frame آن را جابه‌جا نمی‌کنیم.
     * processPendingRecycles در Frameهای بعدی تصمیم می‌گیرد.
     */
    if (this.pendingRecycleVehicles.has(active)) {
      return;
    }

    /**
     * هرگز خودرویی که هنوز داخل محدوده امن Camera است
     * ناگهان به نقطه دیگری Teleport نمی‌کنیم.
     */
    if (this.isPositionInsideCameraSafetyZone(active.vehicle.group.position)) {
      this.pendingRecycleVehicles.add(active);

      // تا زمان خروج از محدوده دید، حرکت طبیعی خودرو حفظ می‌شود.
      active.targetSpeed = active.cruiseSpeed;

      active.vehicle.setTargetSpeed(active.cruiseSpeed);

      return;
    }

    /**
     * خودرو از محدوده امن Camera خارج شده است؛
     * حالا می‌توانیم آن را بدون Pop بصری به یک نقطه امن
     * دیگر از شبکه منتقل کنیم.
     */
    const candidate = this.findOffscreenRecycleCandidate(
      this.lastCameraPosition,
      active,
    );

    if (!candidate) {
      /**
       * اگر در این Frame نقطه مناسبی پیدا نشد،
       * خودرو حذف نمی‌شود و در Pending باقی می‌ماند.
       */
      this.pendingRecycleVehicles.add(active);

      return;
    }

    this.applyRecycleCandidate(active, candidate);
  }

  /**

==========================================

Find Recycle Candidate Without Camera

==========================================
*/

  private findRecycleCandidateWithoutCamera(
    ignoredVehicle?: ActiveVehicleData,
  ): {
    road: Road;
    laneIndex: number;
    direction: VehicleDirection;
    distance: number;
  } | null {
    for (const road of this.roads) {
      for (const distance of this.getSafeRoadDistances(road)) {
        for (let laneIndex = 0; laneIndex < Road.LANE_COUNT; laneIndex++) {
          const direction = this.getDirectionForRoad(road, laneIndex);

          if (
            this.canSpawnCar(
              road,
              laneIndex,
              direction,
              distance,
              ignoredVehicle,
            )
          ) {
            return { road, laneIndex, direction, distance };
          }
        }
      }
    }

    return null;
  }

  /**

==========================================

Find Offscreen Recycle Candidate

==========================================
*/

  private findOffscreenRecycleCandidate(
    cameraPosition: THREE.Vector3,
    ignoredVehicle?: ActiveVehicleData,
    preferNearCamera = false,
  ): {
    road: Road;
    laneIndex: number;
    direction: VehicleDirection;
    distance: number;
    cameraDistance: number;
  } | null {
    const candidates: Array<{
      road: Road;
      laneIndex: number;
      direction: VehicleDirection;
      distance: number;
      cameraDistance: number;
    }> = [];

    for (const road of this.roads) {
      for (const distance of this.getSafeRoadDistances(road)) {
        for (let laneIndex = 0; laneIndex < Road.LANE_COUNT; laneIndex++) {
          const direction = this.getDirectionForRoad(road, laneIndex);
          const position = this.getVehicleWorldPosition(
            road,
            laneIndex,
            distance,
          ).clone();
          const cameraDistance = position.distanceTo(cameraPosition);

          if (cameraDistance < CarManager.SPAWN_MIN_CAMERA_DISTANCE) {
            continue;
          }
          if (this.isPositionInsideCameraSafetyZone(position)) {
            continue;
          }
          if (
            !this.canSpawnCar(
              road,
              laneIndex,
              direction,
              distance,
              ignoredVehicle,
            )
          ) {
            continue;
          }

          candidates.push({
            road,
            laneIndex,
            direction,
            distance,
            cameraDistance,
          });
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    const preferred = candidates.filter(
      (candidate) =>
        candidate.cameraDistance <= CarManager.SPAWN_MAX_CAMERA_DISTANCE,
    );
    const pool = preferred.length > 0 ? preferred : candidates;

    if (preferNearCamera) {
      pool.sort((a, b) => a.cameraDistance - b.cameraDistance);
      return pool[0] ?? null;
    }

    // Randomize among safe off-screen locations so cars don't accumulate on a single road.
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  }

  /**

==========================================

Camera Safety Check

==========================================
*/

  private isPositionInsideCameraSafetyZone(position: THREE.Vector3): boolean {
    if (!this.camera) {
      return false;
    }

    this.tempProjectedPosition.copy(position).project(this.camera);

    const ndc = this.tempProjectedPosition;

    if (ndc.z < -1 || ndc.z > 1) {
      return false;
    }

    const safetyMargin = 1.18;

    return Math.abs(ndc.x) <= safetyMargin && Math.abs(ndc.y) <= safetyMargin;
  }

  /**

==========================================

Stalled Vehicle Recovery

==========================================
*/

  /**
   * Stop behind a valid red light or directly behind a stopped leader is intentional.
   */
  private isWaitingForTrafficToMove(active: ActiveVehicleData): boolean {
    if (active.motionSpeed > 0.15 || active.targetSpeed > 0.15) {
      return false;
    }

    if (active.waitingAtIntersection && this.isTrafficLightBlocking(active)) {
      return true;
    }

    for (const other of this.activeVehicles) {
      if (
        other === active ||
        other.trafficTransition ||
        other.road !== active.road ||
        other.laneIndex !== active.laneIndex
      ) {
        continue;
      }

      const gap = this.getForwardDistance(
        active.road,
        active.roadDistance,
        other.roadDistance,
        active.vehicle.getDirection(),
      );

      if (
        gap > 0 &&
        gap <= CarManager.FRONT_DETECTION_DISTANCE &&
        (other.motionSpeed <= 0.2 || other.targetSpeed <= 0.2)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * اگر خودرو خارج از میدان دید برای مدت طولانی پیشرفت نکند، همان خودرو
   * به نقطه‌ای امن از شبکه منتقل می‌شود. تعداد خودروها افزایش پیدا نمی‌کند
   * و جابه‌جایی فقط خارج از محدودهٔ دید دوربین انجام می‌شود.
   */
  private updateVehicleProgressWatchdog(
    active: ActiveVehicleData,
    deltaTime: number,
  ): void {
    const position = active.vehicle.group.position;
    const moved =
      position.distanceToSquared(active.lastProgressPosition) >=
      CarManager.VEHICLE_PROGRESS_EPSILON * CarManager.VEHICLE_PROGRESS_EPSILON;

    if (moved) {
      active.lastProgressPosition.copy(position);
      active.stalledTime = 0;
      return;
    }

    // A red light or a stopped car directly ahead is a valid wait, not a deadlock.
    if (this.isWaitingForTrafficToMove(active)) {
      active.lastProgressPosition.copy(position);
      active.stalledTime = 0;
      return;
    }

    const safeDelta = THREE.MathUtils.clamp(
      Number.isFinite(deltaTime) ? deltaTime : 0,
      0,
      0.25,
    );
    active.stalledTime += safeDelta;

    if (active.stalledTime < CarManager.STALLED_VEHICLE_RECOVERY_SECONDS) {
      return;
    }

    if (!this.camera) {
      return;
    }

    // خارج از تصویر، همان خودرو را به جایگاهی امن نزدیک دوربین برگردان.
    if (!this.isPositionInsideCameraSafetyZone(position)) {
      const candidate = this.findOffscreenRecycleCandidate(
        this.lastCameraPosition,
        active,
        true,
      );

      if (candidate) {
        this.applyRecycleCandidate(active, candidate);
        return;
      }

      active.stalledTime = Math.max(
        0,
        CarManager.STALLED_VEHICLE_RECOVERY_SECONDS -
          CarManager.STALLED_VEHICLE_RETRY_SECONDS,
      );
      return;
    }

    // خودرو داخل دید دوربین جابه‌جا نمی‌شود؛ فقط به یک خودرو نزدیک اجازه عبور کوتاه می‌دهیم.
    const hasNearbyRelease = this.activeVehicles.some(
      (other) =>
        other !== active &&
        other.intersectionReleaseTime > 0 &&
        other.vehicle.group.position.distanceTo(position) < 12,
    );

    if (hasNearbyRelease || !this.isDeadlockReleaseLeader(active)) {
      active.stalledTime = Math.max(
        0,
        CarManager.STALLED_VEHICLE_RECOVERY_SECONDS -
          CarManager.STALLED_VEHICLE_RETRY_SECONDS,
      );
      return;
    }

    active.intersectionReleaseTime = CarManager.DEADLOCK_RELEASE_DURATION;
    active.targetSpeed = Math.min(
      active.cruiseSpeed,
      CarManager.DEADLOCK_RELEASE_SPEED,
    );
    active.vehicle.setTargetSpeed(active.targetSpeed);
    active.stalledTime = Math.max(
      0,
      CarManager.STALLED_VEHICLE_RECOVERY_SECONDS -
        CarManager.STALLED_VEHICLE_RETRY_SECONDS,
    );
  }

  /**
   * اولویت بازیابی در یک صف: خودروی جلویی یا نزدیک‌تر به تقاطع زودتر آزاد شود.
   * این انتخاب باعث نمی‌شود همه خودروهای اطراف هم‌زمان از چراغ عبور کنند.
   */
  private isDeadlockReleaseLeader(active: ActiveVehicleData): boolean {
    const activePosition = active.vehicle.group.position;
    const activeApproach = this.getIntersectionApproachInfo(active);
    const activeIndex = this.activeVehicles.indexOf(active);

    for (const other of this.activeVehicles) {
      if (
        other === active ||
        other.stalledTime < CarManager.STALLED_VEHICLE_RECOVERY_SECONDS ||
        other.vehicle.group.position.distanceTo(activePosition) > 12
      ) {
        continue;
      }

      const otherApproach = this.getIntersectionApproachInfo(other);
      if (
        activeApproach &&
        otherApproach &&
        activeApproach.connectionPoint.distanceTo(
          otherApproach.connectionPoint,
        ) <= CarManager.INTERSECTION_MATCH_DISTANCE
      ) {
        if (
          otherApproach.remaining <
          activeApproach.remaining - CarManager.INTERSECTION_PRIORITY_MARGIN
        ) {
          return false;
        }
        if (
          Math.abs(otherApproach.remaining - activeApproach.remaining) <=
            CarManager.INTERSECTION_PRIORITY_MARGIN &&
          this.activeVehicles.indexOf(other) < activeIndex
        ) {
          return false;
        }
        continue;
      }

      if (other.road === active.road && other.laneIndex === active.laneIndex) {
        const gap = this.getForwardDistance(
          active.road,
          active.roadDistance,
          other.roadDistance,
          active.vehicle.getDirection(),
        );
        if (gap > 0 && gap < 12) {
          return false;
        }
        continue;
      }

      // برای بن‌بست‌های مشترک که به یک Lane یا تقاطع تعلق ندارند، ترتیب ثابت حفظ می‌شود.
      if (this.activeVehicles.indexOf(other) < activeIndex) {
        return false;
      }
    }

    return true;
  }

  /**

==========================================

Apply Recycle Candidate

==========================================
*/
  private applyRecycleCandidate(
    active: ActiveVehicleData,
    candidate: {
      road: Road;
      laneIndex: number;
      direction: VehicleDirection;
      distance: number;
    },
  ): void {
    const position = this.getVehicleWorldPosition(
      candidate.road,
      candidate.laneIndex,
      candidate.distance,
    );

    active.road = candidate.road;

    active.laneIndex = candidate.laneIndex;

    active.roadDistance = candidate.distance;

    active.trafficTransition = null;

    active.intersectionWaitTime = 0;

    active.waitingAtIntersection = false;

    active.intersectionReleaseTime = 0;

    active.vehicle.group.position.copy(position);

    active.vehicle.group.position.y = CarManager.VEHICLE_Y;

    active.lastProgressPosition.copy(position);
    active.stalledTime = 0;
    active.intersectionReleaseTime = 0;

    active.vehicle.setDirection(candidate.direction);

    active.targetSpeed = active.cruiseSpeed;

    active.vehicle.setTargetSpeed(active.motionSpeed);

    this.pendingRecycleVehicles.delete(active);
  }

  /**

==========================================

Process Pending Recycles

==========================================
*/

  private processPendingRecycles(): void {
    if (
      this.roads.length === 0 ||
      !this.hasCameraPosition ||
      this.pendingRecycleVehicles.size === 0
    ) {
      return;
    }

    const pending = Array.from(this.pendingRecycleVehicles);

    for (const active of pending) {
      if (!this.activeVehicles.includes(active)) {
        this.pendingRecycleVehicles.delete(active);

        continue;
      }

      if (
        this.isPositionInsideCameraSafetyZone(active.vehicle.group.position)
      ) {
        active.targetSpeed = active.cruiseSpeed;

        active.vehicle.setTargetSpeed(active.cruiseSpeed);

        continue;
      }

      const candidate = this.findOffscreenRecycleCandidate(
        this.lastCameraPosition,
        active,
      );

      if (!candidate) {
        continue;
      }

      this.applyRecycleCandidate(active, candidate);
    }
  }

  /**

==========================================

Release Vehicle

==========================================



این تابع برای Lifecycle Pool حفظ شده است.
*/
  private releaseVehicle(index: number): void {
    const active = this.activeVehicles[index];

    if (!active) {
      return;
    }

    this.pendingRecycleVehicles.delete(active);

    active.vehicle.reset();

    const fadeMaterials = this.vehicleFadeMaterials.get(active.vehicle);

    if (fadeMaterials) {
      for (const material of fadeMaterials) {
        material.opacity = 1;
      }
    }

    active.vehicle.group.visible = false;

    this.availableVehicles.push(active.vehicle);

    this.activeVehicles.splice(index, 1);
  }

  /**

==========================================

Stats

==========================================
*/

  public getStats(): {
    active: number;
    pooled: number;
    maxActive: number;
    ready: boolean;
  } {
    return {
      active: this.activeVehicles.length,

      pooled: this.availableVehicles.length,

      maxActive: CarManager.POOL_SIZE,

      ready: this.initialized,
    };
  }

  /**

==========================================

Dispose

==========================================
*/

  public dispose(): void {
    for (const active of this.activeVehicles) {
      active.vehicle.dispose();
    }

    for (const vehicle of this.availableVehicles) {
      vehicle.dispose();
    }

    this.pendingRecycleVehicles.clear();

    this.activeVehicles.length = 0;

    this.availableVehicles.length = 0;

    this.roads.length = 0;

    this.initialCarsSpawned = false;

    this.initialized = false;

    this.initializing = false;

    this.refillTimer = 0;

    this.scene = null;

    this.camera = null;

    this.vehicleFactory.dispose();
  }
}
