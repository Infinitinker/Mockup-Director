/** A Blob that claims a size without holding the bytes, for testing the ZIP size limits. */
export class SizedBlob extends Blob {
  constructor(private readonly claimed: number) {
    super([]);
  }

  override get size(): number {
    return this.claimed;
  }
}
