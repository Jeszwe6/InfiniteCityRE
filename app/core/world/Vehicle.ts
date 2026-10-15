import * as THREE from "three";

export type VehicleDirection = "north" | "south" | "east" | "west";

export type VehicleState = "freeFlow" | "slowing" | "stopped";

export type VehicleModelType =
  | "taxi"
  | "sedan"
  | "sedan-sports"
  | "hatchback-sports"
  | "suv"
  | "suv-luxury"
  | "van"
  | "delivery"
  | "truck"
  | "truck-flat"
  | "police"
  | "ambulance"
  | "firetruck"
  | "garbage-truck"
  | "tractor";

export class Vehicle {
  private speed = 0;
  private targetSpeed = 0;
  private desiredSpeed = 0;
  private direction: VehicleDirection = "north";
  private state: VehicleState = "stopped";
  private active = false;

  private readonly vehicleType: VehicleModelType;

  public readonly group: THREE.Group;

  private static readonly MAX_SPEED = 5.5;
  private static readonly ACCELERATION = 2.5;
  private static readonly BRAKING = 4.5;
  private static readonly MIN_MOVING_SPEED = 0.05;
  private static readonly MAX_DELTA_TIME = 0.05;

  constructor(group: THREE.Group, vehicleType: VehicleModelType) {
    this.group = group;
    this.vehicleType = vehicleType;

    this.group.name = `Vehicle_${vehicleType}`;
    this.group.userData.isVehicle = true;
    this.group.userData.vehicle = this;
    this.group.userData.vehicleType = vehicleType;

    this.reset();
  }

  public activate(
    position: THREE.Vector3,
    direction: VehicleDirection,
    speed: number,
  ): void {
    this.active = true;
    this.group.visible = true;
    this.group.position.copy(position);

    this.setDirection(direction);

    const safeSpeed = this.sanitizeSpeed(speed);

    this.speed = safeSpeed;
    this.targetSpeed = safeSpeed;
    this.desiredSpeed = safeSpeed;
    this.state = "freeFlow";
  }

  public deactivate(): void {
    this.active = false;
    this.speed = 0;
    this.targetSpeed = 0;
    this.desiredSpeed = 0;
    this.state = "stopped";
    this.group.visible = false;
  }

  public stop(): void {
    this.state = "stopped";
    this.targetSpeed = 0;
  }

  public resume(): void {
    this.state = "freeFlow";
    this.targetSpeed = this.sanitizeSpeed(this.desiredSpeed);
  }

  public slowDown(): void {
    this.state = "slowing";
    this.targetSpeed = Math.min(
      this.sanitizeSpeed(this.desiredSpeed),
      this.speed,
    );
  }

  public setDirection(direction: VehicleDirection): void {
    this.direction = direction;

    switch (direction) {
      case "north":
        this.group.rotation.y = Math.PI;
        break;

      case "south":
        this.group.rotation.y = 0;
        break;

      case "east":
        this.group.rotation.y = Math.PI / 2;
        break;

      case "west":
        this.group.rotation.y = -Math.PI / 2;
        break;
    }
  }

  public getDirection(): VehicleDirection {
    return this.direction;
  }

  public setTargetSpeed(speed: number): void {
    const safeSpeed = this.sanitizeSpeed(speed);

    this.desiredSpeed = safeSpeed;

    if (this.state !== "stopped") {
      this.targetSpeed = safeSpeed;
    }
  }

  public getSpeed(): number {
    return this.speed;
  }

  public update(deltaTime: number): void {
    if (!this.active) {
      return;
    }

    if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
      return;
    }

    const dt = Math.min(deltaTime, Vehicle.MAX_DELTA_TIME);

    const safeTargetSpeed =
      this.state === "stopped"
        ? 0
        : this.sanitizeSpeed(this.targetSpeed);

    const difference = safeTargetSpeed - this.speed;

    if (difference > 0) {
      this.speed = Math.min(
        safeTargetSpeed,
        this.speed + Vehicle.ACCELERATION * dt,
      );
    } else if (difference < 0) {
      this.speed = Math.max(
        safeTargetSpeed,
        this.speed - Vehicle.BRAKING * dt,
      );
    }

    this.speed = this.sanitizeSpeed(this.speed);

    if (
      this.speed < Vehicle.MIN_MOVING_SPEED &&
      safeTargetSpeed === 0
    ) {
      this.speed = 0;
    }

    const movement = this.speed * dt;

    switch (this.direction) {
      case "north":
        this.group.position.z -= movement;
        break;

      case "south":
        this.group.position.z += movement;
        break;

      case "east":
        this.group.position.x += movement;
        break;

      case "west":
        this.group.position.x -= movement;
        break;
    }
  }

  public reset(): void {
    this.active = false;
    this.speed = 0;
    this.targetSpeed = 0;
    this.desiredSpeed = 0;
    this.state = "stopped";

    this.group.position.set(0, -100, 0);
    this.group.visible = false;
  }

  public getVehicleType(): VehicleModelType {
    return this.vehicleType;
  }

  public isActive(): boolean {
    return this.active;
  }

  public getState(): VehicleState {
    return this.state;
  }

  private sanitizeSpeed(speed: number): number {
    if (!Number.isFinite(speed)) {
      return 0;
    }

    return Math.min(Math.max(speed, 0), Vehicle.MAX_SPEED);
  }

  // منابع گرافیکی ممکن است بین چند خودرو مشترک باشند.
  // آزادسازی آن‌ها بر عهده مالک منابع است.
  public dispose(): void {
    this.active = false;
    this.group.visible = false;
    this.group.removeFromParent();
    this.group.clear();

    delete this.group.userData.vehicle;
  }
}