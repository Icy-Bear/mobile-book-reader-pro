import { NativeModule, requireNativeModule } from 'expo';

export type PdfMeta = {
  pageCount: number;
  width: number;
  height: number;
};

export type TextHitResult = {
  text: string;
  xNorm: number;
  yNorm: number;
  box?: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
};

export type PdfSkiaNativeModule = NativeModule<{}> & {
  open(path: string): Promise<PdfMeta>;
  openAsset(assetName: string): Promise<PdfMeta>;
  renderPage(pageIndex: number, targetWidth: number): Promise<string>;
  getPageText(pageIndex: number): Promise<string>;
  getTextAtPoint(pageIndex: number, xNorm: number, yNorm: number): Promise<TextHitResult>;
  copyToClipboard(text: string): boolean;
  unlockOrientation(): boolean;
  close(): void;
};

export default requireNativeModule<PdfSkiaNativeModule>('PdfSkia');
