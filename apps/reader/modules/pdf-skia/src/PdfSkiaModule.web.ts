import { registerWebModule, NativeModule } from 'expo';

// PdfSkiaModule is not available on the web platform.
class PdfSkiaModule extends NativeModule<{}> {}

export default registerWebModule(PdfSkiaModule, 'PdfSkiaModule');
