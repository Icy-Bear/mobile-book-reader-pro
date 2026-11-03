import { NativeModule, requireNativeModule } from 'expo';

export type PdfMeta = {
  pageCount: number;
  width: number;
  height: number;
};

export type PdfSkiaNativeModule = NativeModule<{}> & {
  open(path: string): Promise<PdfMeta>;
  openAsset(assetName: string): Promise<PdfMeta>;
  renderPage(pageIndex: number, targetWidth: number): Promise<string>;
  close(): void;
};

export default requireNativeModule<PdfSkiaNativeModule>('PdfSkia');
