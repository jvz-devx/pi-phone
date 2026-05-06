export type ClipboardStatus = 'idle' | 'success' | 'failure';

export class UseClipboard {
  status = $state<ClipboardStatus>('idle');

  async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.status = 'success';
    } catch {
      this.status = 'failure';
    }

    return this.status;
  }

  reset() {
    this.status = 'idle';
  }
}
