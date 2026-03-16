import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState, startTransition } from "react";
import {
  SUPPORTED_IMAGE_ACCEPT,
  type LoadedImage,
  type SupportedInputFormat,
  convertToPng,
  getConversionErrorMessage,
  loadSource,
} from "@image-converter/image-core";
import {
  ActionButton,
  ErrorMessage,
  Panel,
  PreviewFrame,
  StatusRow,
  UploadSurface,
} from "@image-converter/ui";

type DownloadState = {
  fileName: string;
  sizeLabel: string;
  url: string;
};

const formatLabels: Record<SupportedInputFormat, string> = {
  avif: "AVIF",
  bmp: "BMP",
  gif: "GIF",
  jpeg: "JPEG",
  jpg: "JPG",
  png: "PNG",
  svg: "SVG",
  webp: "WebP",
};

function makeFileName(name: string) {
  const trimmed = name
    .replace(/\.[^.]+$/, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${trimmed || "converted-image"}.png`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function triggerDownload(url: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
}

export function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadRequestIdRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [loadedImage, setLoadedImage] = useState<LoadedImage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [download, setDownload] = useState<DownloadState | null>(null);

  useEffect(() => {
    return () => {
      loadedImage?.revoke();
    };
  }, [loadedImage]);

  useEffect(() => {
    return () => {
      if (download) {
        URL.revokeObjectURL(download.url);
      }
    };
  }, [download]);

  const details = useMemo(() => {
    if (!loadedImage) {
      return [];
    }

    return [
      { label: "Source", value: formatLabels[loadedImage.format] ?? loadedImage.format.toUpperCase() },
      { label: "Canvas", value: `${loadedImage.width} × ${loadedImage.height}` },
      { label: "Input size", value: formatSize(loadedImage.sourceSize) },
      { label: "Mode", value: loadedImage.kind === "vector" ? "Vector to raster" : "Raster passthrough" },
      { label: "Transparency", value: loadedImage.transparency === "supported" ? "Preserved" : "Unknown" },
    ];
  }, [loadedImage]);

  async function handleFile(file: File) {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setIsLoading(true);
    setErrorMessage(null);

    if (download) {
      URL.revokeObjectURL(download.url);
      setDownload(null);
    }

    try {
      const nextLoaded = await loadSource(file);

      if (requestId !== loadRequestIdRef.current) {
        nextLoaded.revoke();
        return;
      }

      startTransition(() => {
        setLoadedImage(nextLoaded);
      });
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) {
        return;
      }

      setLoadedImage(null);
      setErrorMessage(getConversionErrorMessage(error));
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setIsDragging(false);
        setIsLoading(false);
      }
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0];

    if (nextFile) {
      void handleFile(nextFile);
    }

    event.target.value = "";
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);

    const nextFile = event.dataTransfer.files?.[0];
    if (nextFile) {
      void handleFile(nextFile);
    }
  }

  async function handleConvert() {
    if (!loadedImage) {
      return;
    }

    setIsConverting(true);
    setErrorMessage(null);

    try {
      const pngBlob = await convertToPng(loadedImage);
      const nextUrl = URL.createObjectURL(pngBlob);
      const fileName = makeFileName(loadedImage.fileName);

      if (download) {
        URL.revokeObjectURL(download.url);
      }

      setDownload({
        fileName,
        sizeLabel: formatSize(pngBlob.size),
        url: nextUrl,
      });

      triggerDownload(nextUrl, fileName);
    } catch (error) {
      setErrorMessage(getConversionErrorMessage(error));
    } finally {
      setIsConverting(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="app-shell__glow app-shell__glow--top" />
      <div className="app-shell__glow app-shell__glow--bottom" />

      <header className="hero">
        <p className="hero__eyebrow">Darkroom / Browser-only PNG lab</p>
        <div className="hero__grid">
          <div className="hero__lead">
            <h1>Convert image and SVG uploads into crisp PNG exports.</h1>
            <p>
              A local-first converter with zero uploads, a dramatic low-light interface, and a single focused
              workflow built for fast handoff from source to PNG.
            </p>
          </div>

          <div className="hero__aside">
            <p>Static deploy</p>
            <p>No backend</p>
            <p>PNG-first</p>
          </div>
        </div>
      </header>

      <main className="workspace">
        <section className="workspace__preview">
          <Panel eyebrow="Preview stage" title={loadedImage ? loadedImage.fileName : "Drop a file to begin"}>
            <PreviewFrame
              caption={
                loadedImage
                  ? `${loadedImage.width} × ${loadedImage.height} ${formatLabels[loadedImage.format]} source`
                  : "PNG, JPG, WebP, GIF, BMP, AVIF, and SVG are accepted."
              }
            >
              {loadedImage ? (
                <img alt={`Preview of ${loadedImage.fileName}`} className="preview-image" src={loadedImage.previewUrl} />
              ) : (
                <div className="empty-stage">
                  <span className="empty-stage__index">01</span>
                  <p>Drop artwork onto the stage. The file stays in your browser and never leaves the session.</p>
                </div>
              )}
            </PreviewFrame>
          </Panel>
        </section>

        <aside className="workspace__controls">
          <Panel eyebrow="Input" title="Upload">
            <UploadSurface
              accept={SUPPORTED_IMAGE_ACCEPT}
              disabled={isLoading}
              isDragging={isDragging}
              onBrowse={openFilePicker}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            />
            <input
              ref={fileInputRef}
              accept={SUPPORTED_IMAGE_ACCEPT}
              className="sr-only"
              onChange={handleFileInput}
              type="file"
            />
          </Panel>

          <Panel eyebrow="Readout" title="Source details">
            {loadedImage ? (
              <div className="status-list">
                {details.map((item) => (
                  <StatusRow key={item.label} label={item.label} value={item.value} />
                ))}
              </div>
            ) : (
              <p className="muted-copy">Load a single image or SVG to inspect dimensions and export it as PNG.</p>
            )}
          </Panel>

          <Panel eyebrow="Output" title="Convert">
            <div className="actions">
              <ActionButton disabled={!loadedImage || isLoading || isConverting} onClick={() => void handleConvert()}>
                {isConverting ? "Rendering PNG..." : "Convert to PNG"}
              </ActionButton>
              {download ? (
                <p className="download-note">
                  PNG exported as <strong>{download.fileName}</strong> ({download.sizeLabel}).
                </p>
              ) : (
                <p className="download-note">The export downloads instantly after conversion.</p>
              )}
            </div>
          </Panel>

          {(errorMessage || isLoading) && (
            <Panel eyebrow="Status" title={isLoading ? "Reading file" : "Needs attention"}>
              {isLoading ? <p className="muted-copy">Decoding the source and preparing a preview stage.</p> : null}
              {errorMessage ? <ErrorMessage message={errorMessage} /> : null}
            </Panel>
          )}
        </aside>
      </main>
    </div>
  );
}
