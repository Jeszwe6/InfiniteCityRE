import * as THREE from "three";

import { CityBlock } from "./CityBlock";
import type { BuildingType } from "./BuildingFactory";
import { Road } from "./Road";

type ZoneType = "residential" | "commercial" | "industrial";

export class ChunkManager {
  private static readonly CHUNK_SIZE = 32;
  private static readonly VIEW_DISTANCE = 3;
  private static readonly MAX_PREPARING_CHUNKS = 2;
  private static readonly MAX_ACTIVATIONS_PER_UPDATE = 2;

  public readonly group: THREE.Group;

  private readonly activeChunks = new Map<string, CityBlock>();
  private readonly preparingChunks = new Map<string, Promise<CityBlock>>();
  private readonly pendingChunks: CityBlock[] = [];

  private readonly chunkPool: Record<ZoneType, CityBlock[]> = {
    residential: [],
    commercial: [],
    industrial: [],
  };

  private readonly pendingKeys = new Set<string>();

  private currentChunkX = Number.NaN;
  private currentChunkZ = Number.NaN;

  private initialized = false;
  private disposed = false;
  private processingPending = false;
  private pendingProcessRequested = false;

  private createdCount = 0;
  private reusedCount = 0;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = "ChunkManager";
    this.group.userData.isChunkManager = true;
  }

  public async initialize(cameraPosition?: THREE.Vector3): Promise<void> {
    if (this.disposed) return;

    if (cameraPosition) {
      this.update(cameraPosition, 0, 0);
    }

    await this.waitUntilReady();
  }

  public update(
    cameraPosition: THREE.Vector3,
    _cameraDistance: number,
    _deltaTime: number,
  ): void {
    if (this.disposed || !cameraPosition) return;

    const chunkX = this.worldToChunk(cameraPosition.x);
    const chunkZ = this.worldToChunk(cameraPosition.z);

    const changed =
      !this.initialized ||
      chunkX !== this.currentChunkX ||
      chunkZ !== this.currentChunkZ;

    if (!changed) {
      this.requestPendingProcessing();
      this.updateRequiredChunks(chunkX, chunkZ);
      return;
    }

    this.initialized = true;
    this.currentChunkX = chunkX;
    this.currentChunkZ = chunkZ;

    this.removeUnusedChunks(chunkX, chunkZ);
    this.updateRequiredChunks(chunkX, chunkZ);
    this.requestPendingProcessing();
  }

  public getActiveRoads(): Road[] {
    const roads: Road[] = [];

    for (const block of this.activeChunks.values()) {
      roads.push(...block.getRoads());
    }

    return roads;
  }

  public getActiveCityBlocks(): CityBlock[] {
    return Array.from(this.activeChunks.values());
  }

  public async waitUntilReady(): Promise<void> {
    if (this.disposed) return;

    while (!this.disposed) {
      const preparing = Array.from(this.preparingChunks.values());

      this.requestPendingProcessing();

      if (preparing.length === 0) {
        await Promise.resolve();

        if (
          this.preparingChunks.size === 0 &&
          this.pendingChunks.length === 0 &&
          !this.processingPending
        ) {
          return;
        }

        if (this.pendingChunks.length > 0) continue;

        if (this.preparingChunks.size === 0 && !this.processingPending) {
          return;
        }

        continue;
      }

      await Promise.allSettled(preparing);
    }
  }

  public getStats() {
    return {
      active: this.activeChunks.size,
      preparing: this.preparingChunks.size,
      pending: this.pendingChunks.length,
      residentialPool: this.chunkPool.residential.length,
      commercialPool: this.chunkPool.commercial.length,
      industrialPool: this.chunkPool.industrial.length,
      created: this.createdCount,
      reused: this.reusedCount,
    };
  }

  private worldToChunk(value: number): number {
    return Math.floor(value / ChunkManager.CHUNK_SIZE);
  }

  private getChunkKey(chunkX: number, chunkZ: number): string {
    return `${chunkX}:${chunkZ}`;
  }

  private updateRequiredChunks(centerX: number, centerZ: number): void {
    if (this.disposed) return;

    const requiredCoordinates: Array<{
      x: number;
      z: number;
      distance: number;
    }> = [];

    for (
      let z = -ChunkManager.VIEW_DISTANCE;
      z <= ChunkManager.VIEW_DISTANCE;
      z++
    ) {
      for (
        let x = -ChunkManager.VIEW_DISTANCE;
        x <= ChunkManager.VIEW_DISTANCE;
        x++
      ) {
        requiredCoordinates.push({
          x: centerX + x,
          z: centerZ + z,
          distance: Math.abs(x) + Math.abs(z),
        });
      }
    }

    requiredCoordinates.sort((a, b) => a.distance - b.distance);

    for (const coordinate of requiredCoordinates) {
      if (
        this.preparingChunks.size >=
        ChunkManager.MAX_PREPARING_CHUNKS
      ) {
        break;
      }

      const key = this.getChunkKey(coordinate.x, coordinate.z);

      if (
        this.activeChunks.has(key) ||
        this.preparingChunks.has(key) ||
        this.pendingKeys.has(key)
      ) {
        continue;
      }

      this.prepareChunk(coordinate.x, coordinate.z);
    }
  }

  private prepareChunk(chunkX: number, chunkZ: number): void {
    if (
      this.disposed ||
      this.preparingChunks.size >= ChunkManager.MAX_PREPARING_CHUNKS
    ) {
      return;
    }

    const key = this.getChunkKey(chunkX, chunkZ);

    if (
      this.activeChunks.has(key) ||
      this.preparingChunks.has(key) ||
      this.pendingKeys.has(key)
    ) {
      return;
    }

    const zoneType = this.getZoneType(chunkX, chunkZ);
    const promise = this.createBlock(zoneType);

    this.preparingChunks.set(key, promise);

    promise
      .then((block) => {
        if (this.disposed) {
          this.disposeBlock(block);
          return;
        }

        if (this.preparingChunks.get(key) !== promise) {
          this.disposeBlock(block);
          return;
        }

        this.positionBlock(block, chunkX, chunkZ);

        block.group.userData.chunkX = chunkX;
        block.group.userData.chunkZ = chunkZ;
        block.group.userData.chunkKey = key;
        block.group.userData.zoneType = zoneType;

        this.pendingChunks.push(block);
        this.pendingKeys.add(key);
      })
      .catch((error: unknown) => {
        if (!this.disposed) {
          console.error(
            `[ChunkManager] Failed to prepare chunk ${key}:`,
            error,
          );
        }
      })
      .finally(() => {
        if (this.preparingChunks.get(key) === promise) {
          this.preparingChunks.delete(key);
        }

        if (!this.disposed) {
          this.requestPendingProcessing();
          this.updateRequiredChunks(
            this.currentChunkX,
            this.currentChunkZ,
          );
        }
      });
  }

  private async createBlock(zoneType: ZoneType): Promise<CityBlock> {
    if (this.disposed) {
      throw new Error("ChunkManager has been disposed.");
    }

    const pool = this.chunkPool[zoneType];
    const pooledBlock = pool.pop();

    if (pooledBlock) {
      this.reusedCount++;

      try {
        await pooledBlock.waitUntilReady();

        if (this.disposed) {
          this.disposeBlock(pooledBlock);
          throw new Error("ChunkManager has been disposed.");
        }

        return pooledBlock;
      } catch (error) {
        this.disposeBlock(pooledBlock);
        throw error;
      }
    }

    const buildingType: BuildingType =
      zoneType === "residential" ? "suburban" : zoneType;

    const block = new CityBlock(buildingType);
    this.createdCount++;

    try {
      await block.waitUntilReady();

      if (this.disposed) {
        this.disposeBlock(block);
        throw new Error("ChunkManager has been disposed.");
      }

      return block;
    } catch (error) {
      this.disposeBlock(block);
      throw error;
    }
  }

  private requestPendingProcessing(): void {
    if (this.disposed) return;

    this.pendingProcessRequested = true;

    if (!this.processingPending) {
      void this.processPendingChunks();
    }
  }

  private async processPendingChunks(): Promise<void> {
    if (this.disposed || this.processingPending) return;

    this.processingPending = true;

    try {
      do {
        this.pendingProcessRequested = false;

        let activated = 0;

        while (
          !this.disposed &&
          this.pendingChunks.length > 0 &&
          activated < ChunkManager.MAX_ACTIVATIONS_PER_UPDATE
        ) {
          const block = this.pendingChunks.shift();

          if (!block) break;

          const chunkX = Number(block.group.userData.chunkX);
          const chunkZ = Number(block.group.userData.chunkZ);
          const key = this.getChunkKey(chunkX, chunkZ);

          this.pendingKeys.delete(key);

          if (!this.isChunkRequired(chunkX, chunkZ)) {
            this.returnBlockToPool(block);
            continue;
          }

          if (this.activeChunks.has(key)) {
            this.returnBlockToPool(block);
            continue;
          }

          this.activeChunks.set(key, block);
          this.group.add(block.group);

          activated++;
        }
      } while (
        !this.disposed &&
        this.pendingProcessRequested
      );
    } finally {
      this.processingPending = false;

      if (!this.disposed && this.pendingProcessRequested) {
        this.requestPendingProcessing();
      }
    }
  }

  private isChunkRequired(chunkX: number, chunkZ: number): boolean {
    return (
      Math.abs(chunkX - this.currentChunkX) <=
        ChunkManager.VIEW_DISTANCE &&
      Math.abs(chunkZ - this.currentChunkZ) <=
        ChunkManager.VIEW_DISTANCE
    );
  }

  private removeUnusedChunks(centerX: number, centerZ: number): void {
    for (const [key, block] of this.activeChunks) {
      const chunkX = Number(block.group.userData.chunkX);
      const chunkZ = Number(block.group.userData.chunkZ);

      if (
        Math.abs(chunkX - centerX) > ChunkManager.VIEW_DISTANCE ||
        Math.abs(chunkZ - centerZ) > ChunkManager.VIEW_DISTANCE
      ) {
        this.activeChunks.delete(key);
        this.group.remove(block.group);
        this.returnBlockToPool(block);
      }
    }
  }

  private returnBlockToPool(block: CityBlock): void {
    this.group.remove(block.group);

    if (this.disposed) {
      this.disposeBlock(block);
      return;
    }

    const zoneType = this.getBlockZoneType(block);
    this.chunkPool[zoneType].push(block);
  }

  private getBlockZoneType(block: CityBlock): ZoneType {
    const value = block.group.userData.zoneType;

    if (
      value === "residential" ||
      value === "commercial" ||
      value === "industrial"
    ) {
      return value;
    }

    return "residential";
  }

  private positionBlock(
    block: CityBlock,
    chunkX: number,
    chunkZ: number,
  ): void {
    block.group.position.set(
      chunkX * ChunkManager.CHUNK_SIZE,
      0,
      chunkZ * ChunkManager.CHUNK_SIZE,
    );
  }

  private getZoneType(chunkX: number, chunkZ: number): ZoneType {
    if (chunkX === 0 && chunkZ === 0) {
      return "residential";
    }

    const value =
      Math.abs(chunkX * 73856093 + chunkZ * 19349663) % 10;

    if (value <= 5) return "residential";
    if (value <= 7) return "commercial";

    return "industrial";
  }

  private disposeBlock(block: CityBlock): void {
    try {
      block.dispose();
    } catch (error) {
      console.warn(
        "[ChunkManager] Error while disposing CityBlock:",
        error,
      );
    }
  }

  private disposePool(pool: CityBlock[]): void {
    for (const block of pool) {
      this.disposeBlock(block);
    }

    pool.length = 0;
  }

  public dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.pendingProcessRequested = false;

    for (const block of this.activeChunks.values()) {
      this.disposeBlock(block);
    }

    this.activeChunks.clear();

    for (const block of this.pendingChunks) {
      this.disposeBlock(block);
    }

    this.pendingChunks.length = 0;
    this.pendingKeys.clear();

    this.disposePool(this.chunkPool.residential);
    this.disposePool(this.chunkPool.commercial);
    this.disposePool(this.chunkPool.industrial);

    this.group.clear();
    this.group.removeFromParent();
  }
}