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

function makeFileName(name: string, suffix = "") {
  const trimmed = name
    .replace(/\.[^.]+$/, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${trimmed || "converted-image"}${suffix}.png`;
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

  // Background removal state
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [bgProgress, setBgProgress] = useState<number | null>(null);
  const [bgProgressLabel, setBgProgressLabel] = useState<string>("");
  const [bgRemovedDownload, setBgRemovedDownload] = useState<DownloadState | null>(null);

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

  useEffect(() => {
    return () => {
      if (bgRemovedDownload) {
        URL.revokeObjectURL(bgRemovedDownload.url);
      }
    };
  }, [bgRemovedDownload]);

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

    // Reset bg removal state on new file
    if (bgRemovedDownload) {
      URL.revokeObjectURL(bgRemovedDownload.url);
      setBgRemovedDownload(null);
    }
    setBgProgress(null);
    setBgProgressLabel("");

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

  async function handleRemoveBackground() {
    if (!loadedImage) return;

    setIsRemovingBg(true);
    setErrorMessage(null);
    setBgProgress(0);
    setBgProgressLabel("Loading AI model…");
    setBgRemovedDownload(null);

    try {
      // Lazy-load the library so it doesn't bloat the initial bundle
      const { removeBackground } = await import("@imgly/background-removal");

      const blob = await removeBackground(loadedImage.previewUrl, {
        progress: (key: string, current: number, total: number) => {
          const pct = total > 0 ? Math.round((current / total) * 100) : 0;
          setBgProgress(pct);

          // Friendly labels for each model-loading stage
          if (key.includes("fetch") || key.includes("load")) {
            setBgProgressLabel(`Downloading AI model… ${pct}%`);
          } else if (key.includes("compute") || key.includes("run")) {
            setBgProgressLabel(`Removing background… ${pct}%`);
          } else {
            setBgProgressLabel(`Processing… ${pct}%`);
          }
        },
      });

      const url = URL.createObjectURL(blob);
      const fileName = makeFileName(loadedImage.fileName, "-no-bg");

      if (bgRemovedDownload) {
        URL.revokeObjectURL(bgRemovedDownload.url);
      }

      setBgRemovedDownload({ fileName, sizeLabel: formatSize(blob.size), url });
      triggerDownload(url, fileName);
    } catch (error) {
      setErrorMessage(getConversionErrorMessage(error));
    } finally {
      setIsRemovingBg(false);
      setBgProgress(null);
      setBgProgressLabel("");
    }
  }

  const isBusy = isLoading || isConverting || isRemovingBg;

  return (
    <div className="app-shell">
      <div className="app-shell__glow app-shell__glow--top" />
      <div className="app-shell__glow app-shell__glow--bottom" />

      <header className="hero">
        <div className="hero__grid">
          <div className="hero__lead">
            <p className="hero__eyebrow">PNG Lab - Browser-based image tools</p>
            <h1>Free PNG converter and background remover.</h1>
            <p>
              A local-first image converter with zero uploads. Convert to PNG and remove backgrounds entirely in your browser. Fast, private, and secure.
            </p>
          </div>

          <div className="hero__aside hero__aside--graphic">
            <div className="hero__graphic-glow"></div>
            <img 
              src={`${import.meta.env.BASE_URL}hero-graphic.png`} 
              alt="High-tech 3D graphic showing a camera lens breaking out of a dark transparency grid, representing background removal and image conversion." 
              className="hero__graphic-image"
            />
          </div>
        </div>
      </header>

      <main className="workspace">
        <section className="workspace__preview">
          <Panel eyebrow="Preview stage" title={loadedImage ? loadedImage.fileName : "Drop a file to begin"}>
            <PreviewFrame
              caption={
                loadedImage
                  ? ""
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
            
            {loadedImage && (
              <div className="preview-source-details">
                {details.map((item) => (
                  <div key={item.label} className="preview-detail-item">
                    <span className="preview-detail-label">{item.label}</span>
                    <span className="preview-detail-value">{item.value}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>

        <aside className="workspace__controls">
          <Panel eyebrow="Input" glow={false} title="Upload">
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

          <div className="workspace__output">
            {/* ── Actions ── */}
            <Panel eyebrow="Output" glow={false} title="Actions">
              <div className="actions">
                <ActionButton 
                  disabled={!loadedImage || isBusy} 
                  onClick={() => void handleConvert()}
                  title={!loadedImage ? "Please upload an image first." : undefined}
                >
                  {isConverting ? "Rendering PNG…" : "Convert to PNG"}
                </ActionButton>
                {download && (
                  <p className="download-note">
                    PNG exported as <strong>{download.fileName}</strong> ({download.sizeLabel}).
                  </p>
                )}

                <ActionButton
                  disabled={!loadedImage || isBusy || loadedImage?.format === "svg"}
                  onClick={() => void handleRemoveBackground()}
                  title={!loadedImage ? "Please upload an image first." : loadedImage?.format === "svg" ? "Background removal is not supported for SVGs." : undefined}
                >
                  {isRemovingBg ? bgProgressLabel || "Processing…" : "Remove Background"}
                </ActionButton>

                {isRemovingBg && (
                  <div className="bg-progress" role="progressbar" aria-valuenow={bgProgress ?? 0} aria-valuemin={0} aria-valuemax={100}>
                    <div className="bg-progress__fill" style={{ width: `${bgProgress ?? 0}%` }} />
                  </div>
                )}

                {bgRemovedDownload && !isRemovingBg ? (
                  <p className="download-note">
                    Saved as <strong>{bgRemovedDownload.fileName}</strong> ({bgRemovedDownload.sizeLabel}).{" "}
                    <button
                      className="re-download-link"
                      onClick={() => triggerDownload(bgRemovedDownload.url, bgRemovedDownload.fileName)}
                    >
                      Download again
                    </button>
                  </p>
                ) : !isRemovingBg ? (
                  <p className="muted-copy" style={{ marginTop: '0.25rem' }}>
                    Convert format or remove background entirely in your browser.
                  </p>
                ) : null}
              </div>
            </Panel>

            {(errorMessage || isLoading) && (
              <Panel eyebrow="Status" glow={false} title={isLoading ? "Reading file" : "Needs attention"}>
                {isLoading ? <p className="muted-copy">Decoding the source and preparing a preview stage.</p> : null}
                {errorMessage ? <ErrorMessage message={errorMessage} /> : null}
              </Panel>
            )}
          </div>

          <div className="privacy-badge">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="privacy-badge__icon">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <div className="privacy-badge__content">
              <h4>100% Local Processing</h4>
              <p>No backend, no uploads. Everything happens securely on your device.</p>
              <p className="privacy-badge__disclaimer">
                * The AI background removal model is downloaded and cached in your browser on <strong>first use</strong>. It is automatically managed and can be cleared via your browser's history settings.
              </p>
            </div>
          </div>
        </aside>
      </main>

      <footer className="app-footer">
        <p>
          Made by <a href="https://github.com/shihasbacker" target="_blank" rel="noopener noreferrer">Shihas Backer</a>
        </p>
      </footer>
    </div>
  );
}
