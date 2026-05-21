export type SupportedInputFormat = "avif" | "bmp" | "gif" | "jpeg" | "jpg" | "png" | "svg" | "webp";

export type ImageMetadata = {
  format: SupportedInputFormat;
  height: number;
  mimeType: string;
  sourceSize: number;
  width: number;
};

export type ConversionOptions = {
  scale?: number;
};

export type ConversionErrorCode =
  | "canvas-export-failed"
  | "file-too-large"
  | "image-decode-failed"
  | "image-too-large"
  | "svg-parse-failed"
  | "unsafe-svg-content"
  | "unsupported-file";

export class ConversionError extends Error {
  readonly code: ConversionErrorCode;

  constructor(code: ConversionErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ConversionError";
  }
}

export type LoadedImage = ImageMetadata & {
  fileName: string;
  image: HTMLImageElement;
  kind: "raster" | "vector";
  previewUrl: string;
  revoke: () => void;
  transparency: "supported" | "unknown";
};

const FORMAT_BY_MIME = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
} as const satisfies Record<string, SupportedInputFormat>;

const FORMAT_BY_EXTENSION = {
  avif: "avif",
  bmp: "bmp",
  gif: "gif",
  jpeg: "jpeg",
  jpg: "jpg",
  png: "png",
  svg: "svg",
  webp: "webp",
} as const satisfies Record<string, SupportedInputFormat>;

export const SUPPORTED_IMAGE_ACCEPT = Object.keys(FORMAT_BY_MIME).join(",");
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 10_000;
export const MAX_IMAGE_PIXELS = 40_000_000;

const DISALLOWED_SVG_TAGS = new Set(["script", "foreignobject", "iframe", "object", "embed", "audio", "video", "canvas"]);
const URL_REFERENCE_ATTRIBUTES = new Set(["href", "xlink:href", "src"]);

type SvgPreparation = {
  dimensions: {
    height: number;
    width: number;
  };
  markup: string;
};

type ImageDimensions = {
  height: number;
  width: number;
};

function getFormatFromFile(file: File): SupportedInputFormat | null {
  if (file.type in FORMAT_BY_MIME) {
    return FORMAT_BY_MIME[file.type as keyof typeof FORMAT_BY_MIME];
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension && extension in FORMAT_BY_EXTENSION) {
    return FORMAT_BY_EXTENSION[extension as keyof typeof FORMAT_BY_EXTENSION];
  }

  return null;
}

function readUint16BigEndian(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32BigEndian(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function readInt32LittleEndian(bytes: Uint8Array, offset: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getInt32(offset, true);
}

async function readFileHeader(file: File, maxBytes = 256 * 1024) {
  const buffer = await file.slice(0, maxBytes).arrayBuffer();
  return new Uint8Array(buffer);
}

function parsePngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    return null;
  }

  return {
    width: readUint32BigEndian(bytes, 16),
    height: readUint32BigEndian(bytes, 20),
  };
}

function parseGifDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 10 ||
    bytes[0] !== 0x47 ||
    bytes[1] !== 0x49 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x38 ||
    (bytes[4] !== 0x37 && bytes[4] !== 0x39) ||
    bytes[5] !== 0x61
  ) {
    return null;
  }

  return {
    width: readUint16LittleEndian(bytes, 6),
    height: readUint16LittleEndian(bytes, 8),
  };
}

function parseBmpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    return null;
  }

  const width = Math.abs(readInt32LittleEndian(bytes, 18));
  const height = Math.abs(readInt32LittleEndian(bytes, 22));

  return width > 0 && height > 0 ? { width, height } : null;
}

function parseWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 30 ||
    bytes[0] !== 0x52 ||
    bytes[1] !== 0x49 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x46 ||
    bytes[8] !== 0x57 ||
    bytes[9] !== 0x45 ||
    bytes[10] !== 0x42 ||
    bytes[11] !== 0x50
  ) {
    return null;
  }

  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);

  if (chunkType === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + readUint24LittleEndian(bytes, 24),
      height: 1 + readUint24LittleEndian(bytes, 27),
    };
  }

  if (chunkType === "VP8 " && bytes.length >= 30) {
    return {
      width: readUint16LittleEndian(bytes, 26) & 0x3fff,
      height: readUint16LittleEndian(bytes, 28) & 0x3fff,
    };
  }

  if (chunkType === "VP8L" && bytes.length >= 25) {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];

    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }

  return null;
}

function parseJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;

  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }

    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (offset + 1 >= bytes.length) {
      return null;
    }

    const segmentLength = readUint16BigEndian(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null;
    }

    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isStartOfFrame) {
      if (offset + 6 >= bytes.length) {
        return null;
      }

      return {
        height: readUint16BigEndian(bytes, offset + 3),
        width: readUint16BigEndian(bytes, offset + 5),
      };
    }

    offset += segmentLength;
  }

  return null;
}

async function getRasterDimensionsBeforeDecode(file: File, format: SupportedInputFormat) {
  const bytes = await readFileHeader(file);

  switch (format) {
    case "png":
      return parsePngDimensions(bytes);
    case "gif":
      return parseGifDimensions(bytes);
    case "bmp":
      return parseBmpDimensions(bytes);
    case "webp":
      return parseWebpDimensions(bytes);
    case "jpeg":
    case "jpg":
      return parseJpegDimensions(bytes);
    default:
      return null;
  }
}

function parseSvgLength(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("%")) {
    return null;
  }

  const numeric = Number.parseFloat(trimmed.replace(/[a-zA-Z]+$/, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function getSvgFallbackDimensions(svg: SVGSVGElement) {
  const width = parseSvgLength(svg.getAttribute("width"));
  const height = parseSvgLength(svg.getAttribute("height"));
  const viewBox = svg.getAttribute("viewBox");

  if (width && height) {
    return { width, height };
  }

  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map((part) => Number.parseFloat(part));

    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }

  return { width: 1200, height: 1200 };
}

function isSafeSvgReference(value: string) {
  const normalized = value.trim().replace(/^['"]|['"]$/g, "");

  if (!normalized) {
    return true;
  }

  return normalized.startsWith("#") || normalized.startsWith("data:image/");
}

function hasUnsafeCssReference(value: string) {
  if (/@import/i.test(value)) {
    return true;
  }

  const matches = value.matchAll(/url\(([^)]+)\)/gi);
  for (const match of matches) {
    if (!isSafeSvgReference(match[1] ?? "")) {
      return true;
    }
  }

  return false;
}

function assertFileSizeWithinLimits(file: File) {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new ConversionError(
      "file-too-large",
      `The file is too large. Upload files up to ${Math.floor(MAX_FILE_SIZE_BYTES / (1024 * 1024))} MB.`,
    );
  }
}

function assertImageDimensionsWithinLimits(width: number, height: number) {
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw new ConversionError(
      "image-too-large",
      `The image is too large to process safely. Keep images under ${MAX_IMAGE_DIMENSION}px per side and ${MAX_IMAGE_PIXELS.toLocaleString()} total pixels.`,
    );
  }
}

function prepareSvgMarkup(markup: string): SvgPreparation {
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(markup, "image/svg+xml");
  const parserError = documentNode.querySelector("parsererror");
  const svgRoot = documentNode.documentElement;

  if (parserError || svgRoot.tagName.toLowerCase() !== "svg") {
    throw new ConversionError("svg-parse-failed", "The SVG could not be parsed. Check that the markup is valid.");
  }

  const elements = [svgRoot, ...Array.from(svgRoot.querySelectorAll("*"))];

  for (const element of elements) {
    const tagName = element.tagName.toLowerCase();

    if (DISALLOWED_SVG_TAGS.has(tagName)) {
      throw new ConversionError(
        "unsafe-svg-content",
        "This SVG uses embedded executable or HTML-like content, which is blocked for safety.",
      );
    }

    if (tagName === "style" && hasUnsafeCssReference(element.textContent ?? "")) {
      throw new ConversionError(
        "unsafe-svg-content",
        "This SVG references external resources in CSS, which is blocked for safety.",
      );
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();

      if (name.startsWith("on")) {
        throw new ConversionError(
          "unsafe-svg-content",
          "This SVG contains event-handler attributes, which are blocked for safety.",
        );
      }

      if (URL_REFERENCE_ATTRIBUTES.has(name) && !isSafeSvgReference(value)) {
        throw new ConversionError(
          "unsafe-svg-content",
          "This SVG contains external references, which are blocked for safety.",
        );
      }

      if ((name === "style" || value.includes("url(")) && hasUnsafeCssReference(value)) {
        throw new ConversionError(
          "unsafe-svg-content",
          "This SVG contains external resource URLs, which are blocked for safety.",
        );
      }

      if (/javascript:/i.test(value)) {
        throw new ConversionError(
          "unsafe-svg-content",
          "This SVG contains scriptable URLs, which are blocked for safety.",
        );
      }
    }
  }

  const dimensions = getSvgFallbackDimensions(svgRoot as unknown as SVGSVGElement);
  assertImageDimensionsWithinLimits(dimensions.width, dimensions.height);

  return {
    dimensions,
    markup: new XMLSerializer().serializeToString(svgRoot),
  };
}

async function loadHtmlImage(url: string) {
  const image = new Image();
  image.decoding = "async";

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => {
      reject(new ConversionError("image-decode-failed", "The browser could not decode that image."));
    };
    image.src = url;
  });

  if (typeof image.decode === "function") {
    await image.decode().catch(() => undefined);
  }

  return image;
}

async function resolveLoadedImage(file: File): Promise<LoadedImage> {
  assertFileSizeWithinLimits(file);

  const format = getFormatFromFile(file);

  if (!format) {
    throw new ConversionError(
      "unsupported-file",
      "Unsupported file type. Upload PNG, JPG, WebP, GIF, BMP, AVIF, or SVG.",
    );
  }

  if (format !== "svg") {
    const dimensions = await getRasterDimensionsBeforeDecode(file, format);
    if (dimensions) {
      assertImageDimensionsWithinLimits(dimensions.width, dimensions.height);
    }
  }

  let previewUrl = URL.createObjectURL(file);

  try {
    let fallback = { width: 0, height: 0 };

    if (format === "svg") {
      const markup = await file.text();
      const preparedSvg = prepareSvgMarkup(markup);
      fallback = preparedSvg.dimensions;
      URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(new Blob([preparedSvg.markup], { type: "image/svg+xml" }));
    }

    const image = await loadHtmlImage(previewUrl);
    const width = format === "svg" ? fallback.width || image.naturalWidth : image.naturalWidth || fallback.width;
    const height = format === "svg" ? fallback.height || image.naturalHeight : image.naturalHeight || fallback.height;

    if (!width || !height) {
      throw new ConversionError("image-decode-failed", "The image dimensions could not be determined.");
    }

    assertImageDimensionsWithinLimits(width, height);

    return {
      fileName: file.name,
      format,
      height,
      image,
      kind: format === "svg" ? "vector" : "raster",
      mimeType: file.type || `image/${format === "jpg" ? "jpeg" : format}`,
      previewUrl,
      revoke: () => URL.revokeObjectURL(previewUrl),
      sourceSize: file.size,
      transparency: format === "svg" || format === "png" || format === "webp" || format === "gif" ? "supported" : "unknown",
      width,
    };
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    throw error;
  }
}

export async function loadSource(file: File) {
  return resolveLoadedImage(file);
}

export async function getImageMetadata(file: File): Promise<ImageMetadata> {
  const loaded = await resolveLoadedImage(file);
  loaded.revoke();

  return {
    format: loaded.format,
    height: loaded.height,
    mimeType: loaded.mimeType,
    sourceSize: loaded.sourceSize,
    width: loaded.width,
  };
}

export async function convertToPng(input: LoadedImage, options?: ConversionOptions) {
  const scale = options?.scale && options.scale > 0 ? options.scale : 1;
  const width = Math.max(1, Math.round(input.width * scale));
  const height = Math.max(1, Math.round(input.height * scale));
  assertImageDimensionsWithinLimits(width, height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new ConversionError("canvas-export-failed", "A 2D canvas context could not be created.");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(input.image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((nextBlob) => resolve(nextBlob), "image/png");
  });

  if (!blob) {
    throw new ConversionError("canvas-export-failed", "PNG export failed before a Blob could be created.");
  }

  return blob;
}

export function getConversionErrorMessage(error: unknown) {
  if (error instanceof ConversionError) {
    return error.message;
  }

  if (error instanceof Error) {
    if (error.message.includes("Failed to fetch")) {
      return "Failed to fetch. Please upload the image again.";
    }
    return error.message;
  }

  return "Something went wrong while processing the image.";
}
