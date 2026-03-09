declare module "qrcode-svg" {
  interface QRCodeSVGOptions {
    content: string;
    width?: number;
    height?: number;
    padding?: number;
    color?: string;
    background?: string;
    ecl?: "L" | "M" | "Q" | "H";
  }
  class QRCodeSVG {
    constructor(options: QRCodeSVGOptions);
    svg(): string;
  }
  export = QRCodeSVG;
}
