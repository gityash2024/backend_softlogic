// Export service — TODO: Implement actual PDF/Image generation
export class ExportService {
  async exportToPdf(canvasId: string, slideIds: string[]): Promise<string> {
    // TODO: Use puppeteer or @napi-rs/canvas to render
    throw new Error('PDF export not yet implemented');
  }

  async exportToImage(slideId: string, format: 'PNG' | 'JPG', quality: number): Promise<string> {
    // TODO: Render slide to image
    throw new Error('Image export not yet implemented');
  }
}

export const exportService = new ExportService();
