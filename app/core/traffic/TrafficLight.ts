import * as THREE from "three";

/**
 * وضعیت یک چراغ راهنمایی.
 */
export type TrafficLightState = "red" | "yellow" | "green";

/**
 * جهت ورود خودرو به تقاطع.
 * این جهت برای قرار دادن چراغ در سمت درست خیابان استفاده می‌شود.
 */
export type TrafficLightDirection = "north" | "south" | "east" | "west";

/**
 * چراغ راهنمایی سه‌بعدی مستقل.
 *
 * این کلاس فعلاً فقط ظاهر و وضعیت چراغ را مدیریت می‌کند.
 * تصمیم‌گیری خودروها در مرحله بعد به آن متصل خواهد شد.
 */
export class TrafficLight {
  /** Group اصلی چراغ. */
  public readonly group: THREE.Group;

  /** جهت ورودی‌ای که این چراغ کنترل می‌کند. */
  public readonly direction: TrafficLightDirection;

  /** وضعیت فعلی چراغ. */
  private state: TrafficLightState = "red";

  /** لامپ‌های سه رنگ. */
  private readonly redLight: THREE.Mesh;
  private readonly yellowLight: THREE.Mesh;
  private readonly greenLight: THREE.Mesh;

  /** مواد لامپ‌ها. */
  private readonly redMaterial: THREE.MeshStandardMaterial;
  private readonly yellowMaterial: THREE.MeshStandardMaterial;
  private readonly greenMaterial: THREE.MeshStandardMaterial;

  /**
   * سازنده چراغ.
   */
  constructor(direction: TrafficLightDirection) {
    this.direction = direction;
    this.group = new THREE.Group();
    this.group.name = `TrafficLight-${direction}`;

    // ------------------------------
    // Pole
    // ------------------------------
    const poleMaterial = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.72,
      metalness: 0.18,
    });

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.14, 3.4, 8),
      poleMaterial,
    );

    pole.position.y = 1.7;
    pole.castShadow = true;
    pole.receiveShadow = true;
    this.group.add(pole);

    // ------------------------------
    // Signal housing
    // ------------------------------
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 1.65, 0.38),
      new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.8,
        metalness: 0.05,
      }),
    );

    housing.position.y = 3.05;
    housing.castShadow = true;
    housing.receiveShadow = true;
    this.group.add(housing);

    // ------------------------------
    // Three signal lamps
    // ------------------------------
    this.redMaterial = new THREE.MeshStandardMaterial({
      color: 0x330000,
      emissive: 0x000000,
      roughness: 0.35,
    });

    this.yellowMaterial = new THREE.MeshStandardMaterial({
      color: 0x332600,
      emissive: 0x000000,
      roughness: 0.35,
    });

    this.greenMaterial = new THREE.MeshStandardMaterial({
      color: 0x003300,
      emissive: 0x000000,
      roughness: 0.35,
    });

    this.redLight = this.createLamp(this.redMaterial, 3.55);
    this.yellowLight = this.createLamp(this.yellowMaterial, 3.05);
    this.greenLight = this.createLamp(this.greenMaterial, 2.55);

    this.group.add(this.redLight);
    this.group.add(this.yellowLight);
    this.group.add(this.greenLight);

    // چراغ را طوری می‌چرخانیم که صفحه سیگنال رو به مسیر ورود باشد.
    this.group.rotation.y = this.getRotationForDirection(direction);

    this.setState("red");
  }

  /**
   * ایجاد یک لامپ کوچک با Glow بسیار سبک.
   *
   * از PointLight استفاده نمی‌کنیم تا تعداد زیاد چراغ‌ها
   * باعث افت Performance نشود.
   */
  private createLamp(
    material: THREE.MeshStandardMaterial,
    y: number,
  ): THREE.Mesh {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), material);

    lamp.position.set(0, y, -0.205);
    lamp.castShadow = false;
    lamp.receiveShadow = false;

    return lamp;
  }

  /**
   * تعیین زاویه Head چراغ نسبت به جهت ورودی.
   */
  private getRotationForDirection(direction: TrafficLightDirection): number {
    switch (direction) {
      case "north":
        return Math.PI;
      case "south":
        return 0;
      case "east":
        return -Math.PI / 2;
      case "west":
        return Math.PI / 2;
    }
  }

  /**
   * تغییر وضعیت چراغ.
   */
  public setState(state: TrafficLightState): void {
    this.state = state;

    this.redMaterial.emissive.setHex(state === "red" ? 0xff0000 : 0x000000);
    this.redMaterial.color.setHex(state === "red" ? 0xff2222 : 0x330000);

    this.yellowMaterial.emissive.setHex(
      state === "yellow" ? 0xffaa00 : 0x000000,
    );
    this.yellowMaterial.color.setHex(state === "yellow" ? 0xffcc33 : 0x332600);

    this.greenMaterial.emissive.setHex(state === "green" ? 0x00ff44 : 0x000000);
    this.greenMaterial.color.setHex(state === "green" ? 0x22ff66 : 0x003300);
  }

  /**
   * دریافت وضعیت فعلی برای Traffic Controller و CarManager.
   */
  public getState(): TrafficLightState {
    return this.state;
  }

  /**
   * آزادسازی منابع GPU مربوط به این چراغ.
   */
  public dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;

      if (!mesh.isMesh) {
        return;
      }

      mesh.geometry.dispose();

      const material = mesh.material;

      if (Array.isArray(material)) {
        material.forEach((item) => item.dispose());
      } else {
        material.dispose();
      }
    });

    this.group.removeFromParent();
  }
}

export default TrafficLight;

interface CentralSignalMaterials {
  red: THREE.MeshStandardMaterial;
  yellow: THREE.MeshStandardMaterial;
  green: THREE.MeshStandardMaterial;
}

/**
 * یک سازهٔ مرکزی با چهار نمای چراغ مستقل برای هر جهت حرکت.
 */
export class CentralTrafficLight {
  public readonly group = new THREE.Group();

  private readonly poleGeometry = new THREE.CylinderGeometry(
    0.055,
    0.075,
    3.5,
    8,
  );
  private readonly housingGeometry = new THREE.BoxGeometry(0.36, 1.08, 0.19);
  private readonly lampGeometry = new THREE.SphereGeometry(0.095, 10, 10);

  private readonly poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x303438,
    roughness: 0.82,
    metalness: 0.12,
  });
  private readonly housingMaterial = new THREE.MeshStandardMaterial({
    color: 0x171a1c,
    roughness: 0.9,
    metalness: 0.02,
  });

  private readonly northMaterials: CentralSignalMaterials =
    this.createSignalMaterials();
  private readonly eastMaterials: CentralSignalMaterials =
    this.createSignalMaterials();
  private readonly southMaterials: CentralSignalMaterials =
    this.createSignalMaterials();
  private readonly westMaterials: CentralSignalMaterials =
    this.createSignalMaterials();

  public constructor() {
    this.group.name = "CentralTrafficLight";
    this.group.userData.isTrafficLight = true;

    const pole = new THREE.Mesh(this.poleGeometry, this.poleMaterial);
    pole.position.y = 1.75;
    pole.castShadow = false;
    pole.receiveShadow = false;
    this.group.add(pole);

    this.createFace("north", 0, 0.22, Math.PI, this.northMaterials);
    this.createFace("south", 0, -0.22, 0, this.southMaterials);
    this.createFace("east", 0.22, 0, -Math.PI / 2, this.eastMaterials);
    this.createFace("west", -0.22, 0, Math.PI / 2, this.westMaterials);

    this.setDirectionStates("red", "red", "red", "red");
  }

  private createSignalMaterials(): CentralSignalMaterials {
    return {
      red: new THREE.MeshStandardMaterial({
        color: 0x330000,
        emissive: 0x000000,
        roughness: 0.35,
      }),
      yellow: new THREE.MeshStandardMaterial({
        color: 0x332600,
        emissive: 0x000000,
        roughness: 0.35,
      }),
      green: new THREE.MeshStandardMaterial({
        color: 0x003300,
        emissive: 0x000000,
        roughness: 0.35,
      }),
    };
  }

  private createFace(
    direction: TrafficLightDirection,
    x: number,
    z: number,
    rotation: number,
    materials: CentralSignalMaterials,
  ): void {
    const face = new THREE.Group();
    face.name = `CentralTrafficLightFace-${direction}`;
    face.position.set(x, 2.65, z);
    face.rotation.y = rotation;

    const housing = new THREE.Mesh(this.housingGeometry, this.housingMaterial);
    housing.castShadow = true;
    housing.receiveShadow = true;
    face.add(housing);

    const red = new THREE.Mesh(this.lampGeometry, materials.red);
    red.position.set(0, 0.32, -0.105);
    red.name = `TrafficSignalRed-${direction}`;

    const yellow = new THREE.Mesh(this.lampGeometry, materials.yellow);
    yellow.position.set(0, 0, -0.105);
    yellow.name = `TrafficSignalYellow-${direction}`;

    const green = new THREE.Mesh(this.lampGeometry, materials.green);
    green.position.set(0, -0.32, -0.105);
    green.name = `TrafficSignalGreen-${direction}`;

    for (const lamp of [red, yellow, green]) {
      lamp.castShadow = false;
      lamp.receiveShadow = false;
      face.add(lamp);
    }

    this.group.add(face);
  }

  private applyState(
    state: TrafficLightState,
    materials: CentralSignalMaterials,
  ): void {
    materials.red.emissive.setHex(state === "red" ? 0xff0000 : 0x000000);
    materials.red.color.setHex(state === "red" ? 0xff2222 : 0x330000);

    materials.yellow.emissive.setHex(state === "yellow" ? 0xffaa00 : 0x000000);
    materials.yellow.color.setHex(state === "yellow" ? 0xffcc33 : 0x332600);

    materials.green.emissive.setHex(state === "green" ? 0x00ff44 : 0x000000);
    materials.green.color.setHex(state === "green" ? 0x22ff66 : 0x003300);
  }

  /**
   * سازگاری با کدهای قدیمی که دو محور را هم‌زمان کنترل می‌کنند.
   */
  public setStates(
    northSouth: TrafficLightState,
    eastWest: TrafficLightState,
  ): void {
    this.setDirectionStates(northSouth, eastWest, northSouth, eastWest);
  }

  /** وضعیت مستقل چراغ‌های شمال، شرق، جنوب و غرب. */
  public setDirectionStates(
    north: TrafficLightState,
    east: TrafficLightState,
    south: TrafficLightState,
    west: TrafficLightState,
  ): void {
    this.applyState(north, this.northMaterials);
    this.applyState(east, this.eastMaterials);
    this.applyState(south, this.southMaterials);
    this.applyState(west, this.westMaterials);
  }

  public dispose(): void {
    this.group.removeFromParent();

    this.poleGeometry.dispose();
    this.housingGeometry.dispose();
    this.lampGeometry.dispose();

    this.poleMaterial.dispose();
    this.housingMaterial.dispose();

    for (const materials of [
      this.northMaterials,
      this.eastMaterials,
      this.southMaterials,
      this.westMaterials,
    ]) {
      materials.red.dispose();
      materials.yellow.dispose();
      materials.green.dispose();
    }

    this.group.clear();
  }
}
