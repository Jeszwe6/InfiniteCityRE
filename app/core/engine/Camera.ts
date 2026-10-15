import * as THREE from "three";

/**
 * Camera
 *
 * مسئول ساخت و مدیریت دوربین اصلی Three.js است.
 *
 * دوربین فعلاً از PerspectiveCamera استفاده می‌کند.
 *
 * ساختار دوربین طوری تنظیم شده که:
 * - کاملاً تراز باشد.
 * - از ارتفاع مناسب به شهر نگاه کند.
 * - محورهای X / Y / Z قابل پیش‌بینی باشند.
 */
export class Camera {
  public readonly instance: THREE.PerspectiveCamera;

  constructor(aspectRatio: number) {
    // -----------------------------
    // ساخت دوربین
    // -----------------------------

    this.instance = new THREE.PerspectiveCamera(60, aspectRatio, 0.1, 2000);

    // -----------------------------
    // موقعیت اولیه
    // -----------------------------

    // دوربین را در ارتفاع مناسب
    // و روی محور Z قرار می‌دهیم.
    this.instance.position.set(0, 12, -20);

    // -----------------------------
    // جهت اولیه
    // -----------------------------

    // دوربین دقیقاً به مرکز شهر نگاه می‌کند.
    this.instance.lookAt(0, 0, 0);

    // ترتیب چرخش دوربین
    // برای کنترل Mouse مهم است.
    this.instance.rotation.order = "YXZ";
  }

  /**
   * به‌روزرسانی نسبت تصویر دوربین
   */
  public resize(aspectRatio: number): void {
    this.instance.aspect = aspectRatio;

    this.instance.updateProjectionMatrix();
  }
}
