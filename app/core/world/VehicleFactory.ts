import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

import { Vehicle, type VehicleModelType } from "./Vehicle";

export class VehicleFactory {
  private static readonly VEHICLE_MODELS: Record<VehicleModelType, string> = {
    taxi: "/assets/vehicles/Models/GLB%20format/taxi.glb",
    sedan: "/assets/vehicles/Models/GLB%20format/sedan.glb",
    "sedan-sports": "/assets/vehicles/Models/GLB%20format/sedan-sports.glb",
    "hatchback-sports":
      "/assets/vehicles/Models/GLB%20format/hatchback-sports.glb",
    suv: "/assets/vehicles/Models/GLB%20format/suv.glb",
    "suv-luxury": "/assets/vehicles/Models/GLB%20format/suv-luxury.glb",
    van: "/assets/vehicles/Models/GLB%20format/van.glb",
    delivery: "/assets/vehicles/Models/GLB%20format/delivery.glb",
    truck: "/assets/vehicles/Models/GLB%20format/truck.glb",
    "truck-flat": "/assets/vehicles/Models/GLB%20format/truck-flat.glb",
    police: "/assets/vehicles/Models/GLB%20format/police.glb",
    ambulance: "/assets/vehicles/Models/GLB%20format/ambulance.glb",
    firetruck: "/assets/vehicles/Models/GLB%20format/firetruck.glb",
    "garbage-truck": "/assets/vehicles/Models/GLB%20format/garbage-truck.glb",
    race: "/assets/vehicles/Models/GLB%20format/race.glb",
    "race-future": "/assets/vehicles/Models/GLB%20format/race-future.glb",
    tractor: "/assets/vehicles/Models/GLB%20format/tractor.glb",
  };

  private readonly loader: GLTFLoader;

  private readonly models = new Map<VehicleModelType, THREE.Group>();

  private readonly loading = new Map<VehicleModelType, Promise<THREE.Group>>();

  private disposed = false;
  private generation = 0;

  constructor() {
    this.loader = new GLTFLoader();
  }

  public getAllModelTypes(): VehicleModelType[] {
    return Object.keys(VehicleFactory.VEHICLE_MODELS) as VehicleModelType[];
  }

  public getModelPath(type: VehicleModelType): string {
    return VehicleFactory.VEHICLE_MODELS[type];
  }

  public isLoaded(type: VehicleModelType): boolean {
    return this.models.has(type);
  }

  public isLoading(type: VehicleModelType): boolean {
    return this.loading.has(type);
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error("VehicleFactory has already been disposed.");
    }
  }

  private disposeModelResources(root: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();

    const collectTextures = (value: unknown): void => {
      if (value instanceof THREE.Texture) {
        textures.add(value);
        return;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          collectTextures(item);
        }
      }
    };

    root.traverse((object) => {
      const mesh = object as THREE.Mesh;

      if (!mesh.isMesh) {
        return;
      }

      if (mesh.geometry) {
        geometries.add(mesh.geometry);
      }

      const meshMaterials = Array.isArray(mesh.material)
        ? mesh.material
        : mesh.material
          ? [mesh.material]
          : [];

      for (const material of meshMaterials) {
        materials.add(material);

        for (const value of Object.values(material)) {
          collectTextures(value);
        }
      }
    });

    for (const geometry of geometries) {
      geometry.dispose();
    }

    for (const material of materials) {
      material.dispose();
    }

    for (const texture of textures) {
      texture.dispose();
    }
  }

  private loadModel(type: VehicleModelType): Promise<THREE.Group> {
    this.ensureNotDisposed();

    const cached = this.models.get(type);

    if (cached) {
      return Promise.resolve(cached);
    }

    const currentLoading = this.loading.get(type);

    if (currentLoading) {
      return currentLoading;
    }

    const path = this.getModelPath(type);
    const generation = this.generation;

    let request: Promise<THREE.Group> | undefined;

    request = new Promise<THREE.Group>((resolve, reject) => {
      this.loader.load(
        path,
        (gltf) => {
          const model = gltf.scene;

          if (this.disposed || generation !== this.generation) {
            this.disposeModelResources(model);

            reject(
              new Error(
                `Loading vehicle model "${type}" was cancelled because VehicleFactory was disposed.`,
              ),
            );

            return;
          }

          model.traverse((object) => {
            const mesh = object as THREE.Mesh;

            if (!mesh.isMesh) {
              return;
            }

            mesh.castShadow = false;
            mesh.receiveShadow = false;

            const materials = Array.isArray(mesh.material)
              ? mesh.material
              : mesh.material
                ? [mesh.material]
                : [];

            for (const material of materials) {
              material.needsUpdate = true;
            }
          });

          this.models.set(type, model);

          if (this.loading.get(type) === request) {
            this.loading.delete(type);
          }

          resolve(model);
        },
        undefined,
        (error) => {
          if (this.loading.get(type) === request) {
            this.loading.delete(type);
          }

          reject(error);
        },
      );
    });

    this.loading.set(type, request);

    return request;
  }

  public async preload(type: VehicleModelType): Promise<void> {
    await this.loadModel(type);
  }

  public async preloadAll(): Promise<void> {
    this.ensureNotDisposed();

    const types = this.getAllModelTypes();

    await Promise.all(types.map((type) => this.preload(type)));
  }

  public async createVehicle(type: VehicleModelType): Promise<Vehicle> {
    this.ensureNotDisposed();

    const generation = this.generation;
    const originalModel = await this.loadModel(type);

    if (this.disposed || generation !== this.generation) {
      throw new Error(
        "Vehicle creation was cancelled because VehicleFactory was disposed.",
      );
    }

    const clonedModel = cloneSkeleton(originalModel);
    const vehicleGroup = new THREE.Group();

    vehicleGroup.add(clonedModel);

    const vehicle = new Vehicle(vehicleGroup, type);

    vehicle.reset();

    return vehicle;
  }

  public async createVehicles(
    type: VehicleModelType,
    count: number,
  ): Promise<Vehicle[]> {
    this.ensureNotDisposed();

    if (count <= 0) {
      return [];
    }

    await this.preload(type);

    const vehicles: Vehicle[] = [];

    for (let i = 0; i < count; i++) {
      this.ensureNotDisposed();

      const vehicle = await this.createVehicle(type);

      vehicles.push(vehicle);
    }

    return vehicles;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.generation++;

    for (const model of this.models.values()) {
      this.disposeModelResources(model);
    }

    this.models.clear();
    this.loading.clear();
  }
}

export default VehicleFactory;
