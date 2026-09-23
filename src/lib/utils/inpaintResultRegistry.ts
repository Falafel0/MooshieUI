export interface InpaintResultSnapshot {
  sourceVersion: number;
  maskUrl: string | null;
  sequence: number;
  valid: boolean;
  claimed: boolean;
  accepted: boolean;
  rasterLayerIds: string[];
}

/** Tracks both queued prompts and asynchronous result preparation. */
export class InpaintResultRegistry {
  private sequence = 0;
  private acceptedSequence = 0;
  private pending = new Set<InpaintResultSnapshot>();
  private prompts = new Map<string, InpaintResultSnapshot>();

  capture(sourceVersion: number, maskUrl: string | null, rasterLayerIds: string[] = []): InpaintResultSnapshot {
    const snapshot = { sourceVersion, maskUrl, rasterLayerIds: [...rasterLayerIds], sequence: ++this.sequence, valid: true, claimed: false, accepted: false };
    this.pending.add(snapshot);
    return snapshot;
  }

  register(promptId: string, snapshot: InpaintResultSnapshot) {
    if (snapshot.valid) this.prompts.set(promptId, snapshot);
  }

  claim(promptId: string, sourceVersion: number): InpaintResultSnapshot | null {
    const snapshot = this.prompts.get(promptId);
    if (!snapshot || snapshot.claimed || !snapshot.valid || snapshot.sourceVersion !== sourceVersion) return null;
    snapshot.claimed = true;
    return snapshot;
  }

  accept(snapshot: InpaintResultSnapshot, sourceVersion: number): boolean {
    if (!snapshot.valid || snapshot.sourceVersion !== sourceVersion || snapshot.sequence < this.acceptedSequence) return false;
    this.acceptedSequence = snapshot.sequence;
    snapshot.accepted = true;
    return true;
  }

  finish(snapshot: InpaintResultSnapshot) {
    snapshot.valid = false;
    this.pending.delete(snapshot);
    for (const [id, candidate] of this.prompts) if (candidate === snapshot) this.prompts.delete(id);
  }

  invalidate(promptIds?: string[]) {
    if (promptIds) {
      for (const id of promptIds) {
        const snapshot = this.prompts.get(id);
        if (snapshot) this.finish(snapshot);
      }
    } else {
      for (const snapshot of this.pending) snapshot.valid = false;
      this.pending.clear();
      this.prompts.clear();
    }
  }
}
